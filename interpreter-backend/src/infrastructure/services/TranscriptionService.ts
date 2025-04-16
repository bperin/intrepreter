import WebSocket from 'ws';
import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import axios from 'axios';
import { IMessageService, IMessageService as IMessageServiceToken } from '../../domain/services/IMessageService';
import { ITextToSpeechService, ITextToSpeechService as ITextToSpeechServiceToken } from '../../domain/services/ITextToSpeechService';
import dotenv from 'dotenv';
import { IConversationRepository } from '../../domain/repositories/IConversationRepository';
import { CommandDetectionService } from './CommandDetectionService';
import { INoteService } from '../../domain/services/INoteService';
import { IFollowUpService, FollowUpUnit } from '../../domain/services/IFollowUpService';
import { IPrescriptionService } from '../../domain/services/IPrescriptionService';

// Load environment variables from .env file in the parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Set the path for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// OpenAI Transcription Types
interface OpenAITurnDetection {
  type: 'server_vad';
  threshold: number;
  prefix_padding_ms: number;
  silence_duration_ms: number;
}

interface OpenAITranscriptionSession {
  id: string;
  object: string;
  expires_at: number;
  input_audio_noise_reduction: any;
  turn_detection: OpenAITurnDetection;
  input_audio_format: string;
  input_audio_transcription: any;
  client_secret: any;
  include: any;
}

interface OpenAISessionCreatedResponse {
  type: 'transcription_session.created';
  event_id: string;
  session: OpenAITranscriptionSession;
}

interface OpenAITranscriptionMessage {
  type: string;
  [key: string]: any;
}

// Interface for the expected OpenAI Chat Completion response structure
interface OpenAIChatCompletionResponse {
    choices?: [
        {
            message?: {
                content?: string;
            };
        }
    ];
    // other potential fields...
}

// --- NEW: Interface for Per-Conversation State ---
interface ConversationState {
    openaiConnection: WebSocket | null;
    ffmpegProcess: ChildProcessWithoutNullStreams | null;
    isOpenAIConnected: boolean;
    isConnecting: boolean;
    openaiConnectionCooldownUntil: number;
    openaiReconnectionAttempts: number;
    ffmpegStdinEnded: boolean;
    // Add any other state that needs to be per-conversation
}
// ---------------------------------------------

@injectable()
export class TranscriptionService {
  // --- NEW: Per-Conversation State Management ---
  private conversationStates: Map<string, ConversationState> = new Map();
  // -------------------------------------------

  // --- Client Management State (per conversation) ---
  private clientConnections: Map<string, Set<WebSocket>> = new Map();
  // --------------------------------------------------

  private readonly openaiApiKey: string;

  constructor(
      @inject(IMessageServiceToken) private messageService: IMessageService,
      @inject(ITextToSpeechServiceToken) private ttsService: ITextToSpeechService,
      @inject('IConversationRepository') private conversationRepository: IConversationRepository,
      @inject(CommandDetectionService) private commandDetectionService: CommandDetectionService,
      @inject('INoteService') private noteService: INoteService,
      @inject('IFollowUpService') private followUpService: IFollowUpService,
      @inject('IPrescriptionService') private prescriptionService: IPrescriptionService
  ) {
      this.openaiApiKey = process.env.OPENAI_API_KEY || '';
      if (!this.openaiApiKey) {
          // --- Throw Error ---
          console.error('[TranscriptionService] FATAL ERROR: OPENAI_API_KEY environment variable is not set.');
          throw new Error('OPENAI_API_KEY environment variable is not set. The TranscriptionService cannot function without it.');
          // -----------------
      } else {
          // --- DEBUG LOG ---
          console.log(`[TranscriptionService DEBUG] Constructor: Read OPENAI_API_KEY from process.env. Value: '${this.openaiApiKey.substring(0, 5)}...${this.openaiApiKey.substring(this.openaiApiKey.length - 4)}'`);
          // -----------------
          console.log('[TranscriptionService] OPENAI_API_KEY is set.');
      }
  }

  /**
   * Handle a new client WebSocket connection for transcription
   */
  public handleConnection(clientWs: WebSocket, conversationId: string): void {
    console.log(`[TranscriptionService][${conversationId}] New client connection.`);
    
    // Initialize conversation state if it's the first client for this conversation
    if (!this.conversationStates.has(conversationId)) {
        console.log(`[TranscriptionService][${conversationId}] Initializing state for new conversation.`);
        this.conversationStates.set(conversationId, {
            openaiConnection: null,
            ffmpegProcess: null,
            isOpenAIConnected: false,
            isConnecting: false,
            openaiConnectionCooldownUntil: 0,
            openaiReconnectionAttempts: 0,
            ffmpegStdinEnded: false,
        });
    }
    const conversationState = this.conversationStates.get(conversationId)!; // Assert non-null as we just set it

    // Add client for this conversation
    if (!this.clientConnections.has(conversationId)) {
      this.clientConnections.set(conversationId, new Set());
    }
    this.clientConnections.get(conversationId)?.add(clientWs);

    // --- Ensure OpenAI Connection & FFmpeg are initiated for this conversation ---
    this._ensureConversationResources(conversationId);
    // ----------------------------------------------------------------------------

    clientWs.on('close', (code, reason) => {
      console.log(`[TranscriptionService][${conversationId}] Client disconnected. Code: ${code}, Reason: ${reason?.toString()}`);
      const clients = this.clientConnections.get(conversationId);
      clients?.delete(clientWs);
      if (clients?.size === 0) {
          this.clientConnections.delete(conversationId);
          console.log(`[TranscriptionService][${conversationId}] Last client disconnected. Cleaning up resources.`);
          this._cleanupConversationResources(conversationId); // Clean up specific conversation resources
      }
    });

    clientWs.on('message', async (message) => {
      // TODO: Refactor this message handler to use conversationState
      const convState = this.conversationStates.get(conversationId);

      // +++ Add Detailed Debug Log +++
      const ffmpegExists = !!(convState && convState.ffmpegProcess);
      const stdinOk = ffmpegExists && convState!.ffmpegProcess!.stdin && !convState!.ffmpegProcess!.stdin.destroyed;
      const stdinEndedFlag = convState ? convState.ffmpegStdinEnded : 'N/A';
      console.log(`[Transcription Debug][${conversationId}] Message received. convState exists: ${!!convState}, ffmpegProcess exists: ${ffmpegExists}, stdin OK: ${stdinOk}, stdinEndedFlag: ${stdinEndedFlag}`);
      // +++ End Debug Log +++

      if (!convState || !convState.ffmpegProcess || !convState.ffmpegProcess.stdin || convState.ffmpegProcess.stdin.destroyed || convState.ffmpegStdinEnded) {
          console.warn(`[TranscriptionService][${conversationId}] FFmpeg process not ready or stdin closed for this conversation, cannot process audio chunk.`);
          return;
      }
      const currentFfmpegProcess = convState.ffmpegProcess; // Use the specific ffmpeg process
      const currentFfmpegStdinEnded = convState.ffmpegStdinEnded; // Use the specific flag

      // --- TEMPORARY - Keep old logic structure but use conversation-specific vars ---
      if (!currentFfmpegProcess || !currentFfmpegProcess.stdin || currentFfmpegProcess.stdin.destroyed || currentFfmpegStdinEnded) {
           console.warn(`[TranscriptionService][${conversationId}] FFmpeg process not ready or stdin closed (redundant check).`);
           return;
      }

      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'input_audio_buffer.append' && data.audio) {
          try {
            const inputChunkBuffer = Buffer.from(data.audio, 'base64');
            // Write the raw WebM/Opus chunk to the CONVERSATION'S FFmpeg process
            currentFfmpegProcess.stdin.write(inputChunkBuffer, (error) => {
                 if (error) {
                     console.error(`[TranscriptionService][${conversationId}] Error writing chunk to FFmpeg stdin:`, error);
                 }
            });
          } catch (decodeOrWriteError) {
            console.error(`[TranscriptionService][${conversationId}] Error decoding or writing audio chunk to FFmpeg:`, decodeOrWriteError);
            this.broadcastToClients(conversationId, { type: 'error', message: 'Backend audio processing error.' });
          }

        } else if (data.type === 'input_audio_buffer.finalize') {
          console.log(`[TranscriptionService][${conversationId}] Finalize received. Ending FFmpeg stdin stream.`);
          try {
            if (currentFfmpegProcess && currentFfmpegProcess.stdin && !currentFfmpegProcess.stdin.destroyed) {
               currentFfmpegProcess.stdin.end(); // Signal end of input to FFmpeg
               convState.ffmpegStdinEnded = true; // Mark that we've ended input FOR THIS CONVERSATION
               console.log(`[TranscriptionService][${conversationId}] FFmpeg stdin stream ended.`);
            } else {
                 console.warn(`[TranscriptionService][${conversationId}] Cannot end FFmpeg stdin: Process not running or stdin destroyed.`);
            }
          } catch (finalizeError) {
            console.error(`[TranscriptionService][${conversationId}] Error ending FFmpeg stdin stream:`, finalizeError);
            this.broadcastToClients(conversationId, { type: 'error', message: 'Backend failed to finalize stream.' });
          }
        }
      } catch (err) {
        console.error(`[TranscriptionService][${conversationId}] Error handling client message:`, err);
         this.broadcastToClients(conversationId, { type: 'error', message: 'Backend error processing message.' });
      }
    });

    clientWs.on('error', (error) => {
      console.error(`[TranscriptionService][${conversationId}] Client WebSocket error:`, error);
      // Consider cleaning up resources if a client connection errors out significantly
      // this._cleanupConversationResources(conversationId);
    });

    // Send confirmation to this specific client, reflecting the conversation's state
    clientWs.send(JSON.stringify({ 
      type: 'backend_connected',
      message: 'Connected to backend service.',
      status: conversationState.isOpenAIConnected ? 'openai_connected' : (conversationState.isConnecting ? 'openai_connecting' : 'openai_disconnected')
    }));
  }

  // --- NEW Conversation Resource Management Methods ---
  /**
   * Ensures OpenAI connection and FFmpeg process are running for a specific conversation.
   * Initiates connection/process if they don't exist.
   */
  private _ensureConversationResources(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (!conversationState) {
      console.error(`[TranscriptionService][${conversationId}] Attempted to ensure resources for non-existent state.`);
      return;
    }

    // Check if already connected or connecting
    if (conversationState.openaiConnection || conversationState.isConnecting) {
        console.log(`[TranscriptionService][${conversationId}] Resources already ensured or in progress.`);
        // Optionally check ffmpeg process state here too if needed
        return;
    }

    console.log(`[TranscriptionService][${conversationId}] Ensuring resources: Initiating OpenAI connection...`);
    this._connectOpenAIForConversation(conversationId);
    // FFmpeg start is triggered within the OpenAI 'open' event handler
  }

  /**
   * Cleans up resources (OpenAI connection, FFmpeg process) for a specific conversation.
   * Called when the last client disconnects or a fatal error occurs.
   */
  private _cleanupConversationResources(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (!conversationState) {
      console.warn(`[TranscriptionService][${conversationId}] Attempted to clean up resources for already removed state.`);
      return;
    }

    console.log(`[TranscriptionService][${conversationId}] Cleaning up resources...`);

    this._killFFmpegForConversation(conversationId); // Kill FFmpeg first
    this._closeOpenAIConnectionForConversation(conversationId); // Then close WebSocket

    // Remove the state from the map AFTER cleanup attempts
    this.conversationStates.delete(conversationId);
    console.log(`[TranscriptionService][${conversationId}] Conversation state removed.`);
  }

  /**
   * Establishes a WebSocket connection to OpenAI for a SPECIFIC conversation.
   * Manages the connection lifecycle and associated FFmpeg process for that conversation.
   */
  private _connectOpenAIForConversation(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (!conversationState || conversationState.openaiConnection || conversationState.isConnecting) {
      console.log(`[TranscriptionService][${conversationId}] OpenAI connection attempt skipped (already connected, connecting, or state missing).`);
      return;
    }

    const now = Date.now();
    if (now < conversationState.openaiConnectionCooldownUntil) {
      const waitTimeSeconds = Math.ceil((conversationState.openaiConnectionCooldownUntil - now) / 1000);
      console.log(`[TranscriptionService][${conversationId}] OpenAI connection attempt skipped due to cooldown. Retrying in ${waitTimeSeconds}s.`);
      setTimeout(() => this._connectOpenAIForConversation(conversationId), conversationState.openaiConnectionCooldownUntil - now + 50);
      return;
    }

    if (!this.openaiApiKey) {
      console.error(`[TranscriptionService][${conversationId}] OPENAI_API_KEY not set! Cannot connect.`);
      this.broadcastToClients(conversationId, { type: 'error', message: 'Backend service cannot connect to OpenAI (config missing).' });
      // Maybe remove conversation state here?
      return;
    }

    console.log(`[TranscriptionService][${conversationId}] Attempting connection to OpenAI...`);
    conversationState.isConnecting = true;
    conversationState.isOpenAIConnected = false;
    this._killFFmpegForConversation(conversationId); // Ensure any old process for THIS convo is gone

    try {
      const newWs = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      conversationState.openaiConnection = newWs; // Store the WS temporarily even before open

      newWs.on('open', () => {
        console.log(`[TranscriptionService][${conversationId}] OpenAI connection established.`);
        // Update state for this specific conversation
        conversationState.isOpenAIConnected = true;
        conversationState.isConnecting = false;
        conversationState.openaiReconnectionAttempts = 0;

        // Start FFmpeg process specific to this conversation
        this._startFFmpegForConversation(conversationId);

        console.log(`[TranscriptionService][${conversationId}] Sending configuration update to OpenAI...`);
        const updateConfig = {
          type: "transcription_session.update",
          session: {
          input_audio_transcription: {
              model: "whisper-1",
              prompt: "Transcribe the input audio to text"
          },
          turn_detection: {
            type: "server_vad",
              silence_duration_ms: 500,
            prefix_padding_ms: 300,
              threshold: 0.5
            },
            include: ["item.input_audio_transcription.logprobs"]
          }
        };

        try {
          this._sendToOpenAIForConversation(conversationId, JSON.stringify(updateConfig));
          console.log(`[TranscriptionService][${conversationId}] Configuration update sent successfully.`);
        } catch (configError) {
          console.error(`[TranscriptionService][${conversationId}] Error sending configuration update:`, configError);
        }

        this.broadcastToClients(conversationId, { type: 'openai_connected', message: 'Ready for audio' });
      });

      newWs.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          // console.log(`[OpenAI WS][${conversationId}] Raw Message Received:`, JSON.stringify(message, null, 2));
          await this.handleOpenAIMessage(conversationId, message); // Handle message
        } catch (error) {
          console.error(`[OpenAI WS][${conversationId}] Error parsing OpenAI message:`, error);
        }
      });

      newWs.on('close', (code, reason) => {
        console.log(`[TranscriptionService][${conversationId}] OpenAI connection closed. Code: ${code}, Reason: ${reason?.toString()}`);
        // Update state for this conversation only
        conversationState.openaiConnection = null;
        conversationState.isOpenAIConnected = false;
        conversationState.isConnecting = false;
        this._killFFmpegForConversation(conversationId); // Ensure FFmpeg is killed

        // Handle reconnection attempt for this conversation
        conversationState.openaiReconnectionAttempts++;
        const cooldownMs = Math.min(30000, Math.pow(2, conversationState.openaiReconnectionAttempts) * 1000);
        conversationState.openaiConnectionCooldownUntil = Date.now() + cooldownMs;
        console.log(`[TranscriptionService][${conversationId}] Setting OpenAI reconnect cooldown for ${cooldownMs}ms.`);
        this.broadcastToClients(conversationId, { type: 'openai_disconnected', message: 'Disconnected. Attempting reconnect...' });

        // Attempt reconnect only if clients are still connected for this conversation
        if (this.clientConnections.has(conversationId) && (this.clientConnections.get(conversationId)?.size || 0) > 0) {
          setTimeout(() => this._connectOpenAIForConversation(conversationId), cooldownMs);
        }
      });

      newWs.on('error', (error) => {
        console.error(`[TranscriptionService][${conversationId}] OpenAI WebSocket error:`, error);
        conversationState.isConnecting = false;
        // Let the 'close' event handle state changes and reconnection attempt
        // Consider immediate cleanup if error is severe: this._cleanupConversationResources(conversationId);
      });

    } catch (err) {
      console.error(`[TranscriptionService][${conversationId}] Error initiating OpenAI connection:`, err);
      conversationState.isConnecting = false;
      conversationState.isOpenAIConnected = false;
      this._killFFmpegForConversation(conversationId); // Ensure FFmpeg is killed
      this.broadcastToClients(conversationId, { type: 'error', message: `Failed to connect to OpenAI: ${err instanceof Error ? err.message : String(err)}` });
      // Consider removing the state entirely
      // this.conversationStates.delete(conversationId);
    }
  }

  /** Starts the FFmpeg process for a SPECIFIC conversation */
  private _startFFmpegForConversation(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (!conversationState) {
        console.error(`[TranscriptionService][${conversationId}] Cannot start FFmpeg: State not found.`);
        return;
    }
    if (conversationState.ffmpegProcess) {
        console.warn(`[TranscriptionService][${conversationId}] Attempted to start FFmpeg process, but one already exists.`);
      return;
    }
    console.log(`[TranscriptionService][${conversationId}] Starting FFmpeg process...`);
    conversationState.ffmpegStdinEnded = false; // Reset flag

    const ffmpegPath = ffmpegInstaller.path;
    const ffmpegArgs = [
        '-i', 'pipe:0',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ar', '24000',
        '-ac', '1',
        'pipe:1'
    ];

    try {
        const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
        conversationState.ffmpegProcess = ffmpegProcess; // Store in conversation state
        console.log(`[TranscriptionService][${conversationId}] FFmpeg process spawned with PID: ${ffmpegProcess.pid}`);

        // Handle PCM data coming out of FFmpeg
        ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
            console.log(`[TranscriptionService][${conversationId}] FFmpeg stdout received chunk, size: ${chunk.length}`);
             const currentState = this.conversationStates.get(conversationId);
            if (currentState && currentState.isOpenAIConnected) {
                try {
                    const pcmBase64 = chunk.toString('base64');
                    this._sendToOpenAIForConversation(conversationId, JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64 }));
                } catch (err) {
                    console.error(`[TranscriptionService][${conversationId}] Error sending PCM chunk to OpenAI:`, err);
                }
            } else {
                console.warn(`[TranscriptionService][${conversationId}] Received FFmpeg stdout data, but OpenAI not connected. Discarding.`);
            }
        });

        // Handle FFmpeg stderr (for debugging)
        ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
            // console.error(`[TranscriptionService][${conversationId}] FFmpeg stderr: ${chunk.toString()}`); 
        });

        // Handle FFmpeg process errors
        ffmpegProcess.on('error', (error) => {
            console.error(`[TranscriptionService][${conversationId}] FFmpeg process error:`, error);
            this._killFFmpegForConversation(conversationId); // Clean up on error
            this.broadcastToClients(conversationId, { type: 'error', message: 'Internal audio processing error.'});
        });

        // Handle FFmpeg process exit
        ffmpegProcess.on('close', (code, signal) => {
            console.log(`[TranscriptionService][${conversationId}] FFmpeg process exited with code ${code}, signal ${signal}.`);
            const currentState = this.conversationStates.get(conversationId);
            // If stdin was ended gracefully, send commit
            if (currentState && currentState.ffmpegStdinEnded && code === 0) {
                 console.log(`[TranscriptionService][${conversationId}] FFmpeg finished after stdin ended. Attempting to send commit to OpenAI.`);
                 try {
                      this._sendToOpenAIForConversation(conversationId, JSON.stringify({ type: "input_audio_buffer.commit" }));
                      console.log(`[TranscriptionService][${conversationId}] Commit message sent to OpenAI.`);
                 } catch (commitErr) {
                      console.error(`[TranscriptionService][${conversationId}] Error sending final commit to OpenAI after FFmpeg exit:`, commitErr);
                 }
            } else if (code !== 0 && code !== null) {
                 console.error(`[TranscriptionService][${conversationId}] FFmpeg exited unexpectedly (code: ${code}, signal: ${signal}).`);
            }
            // Clear the handle in the state, even if exit was ok
            if(currentState) {
                 currentState.ffmpegProcess = null;
            }
        });

        // Handle FFmpeg stdin errors (like EPIPE)
        ffmpegProcess.stdin.on('error', (error: NodeJS.ErrnoException) => {
             console.error(`[TranscriptionService][${conversationId}] FFmpeg stdin error:`, error);
             this._killFFmpegForConversation(conversationId); // Ensure it's cleaned up
        });

    } catch (spawnError) {
         console.error(`[TranscriptionService][${conversationId}] Failed to spawn FFmpeg process:`, spawnError);
         if (conversationState) {
             conversationState.ffmpegProcess = null;
         }
         this.broadcastToClients(conversationId, { type: 'error', message: 'Failed to start internal audio processing.'});
    }
  }

  /** Kills the FFmpeg process for a SPECIFIC conversation */
  private _killFFmpegForConversation(conversationId: string): void {
      const conversationState = this.conversationStates.get(conversationId);
      if (conversationState && conversationState.ffmpegProcess && !conversationState.ffmpegProcess.killed) {
          console.log(`[TranscriptionService][${conversationId}] Killing FFmpeg process (PID: ${conversationState.ffmpegProcess.pid})...`);
          conversationState.ffmpegProcess.kill('SIGTERM');
          conversationState.ffmpegProcess = null;
          conversationState.ffmpegStdinEnded = false; // Reset flag
      }
  }

  /**
   * Send a message over the OpenAI connection for a SPECIFIC conversation.
   */
  private _sendToOpenAIForConversation(conversationId: string, message: string): void {
    let messageType = 'unknown';
    try {
        const parsed = JSON.parse(message);
        messageType = parsed.type || 'unknown';
    } catch {}
    console.log(`[TranscriptionService][${conversationId}] Attempting to send to OpenAI. Type: ${messageType}, Size: ${message.length}`);
    
    const conversationState = this.conversationStates.get(conversationId);
    if (conversationState && conversationState.openaiConnection && conversationState.isOpenAIConnected && conversationState.openaiConnection.readyState === WebSocket.OPEN) {
      try {
        conversationState.openaiConnection.send(message);
        // console.log(`[TranscriptionService][${conversationId}] Successfully sent message type ${messageType} to OpenAI.`); // Can be verbose
      } catch (sendError) {
        console.error(`[TranscriptionService][${conversationId}] _sendToOpenAIForConversation Error during send:`, sendError);
        throw sendError; // Re-throw send error
      }
    } else {
      const stateDetails = conversationState
        ? `State: ${conversationState.openaiConnection?.readyState}, ConnectedFlag: ${conversationState.isOpenAIConnected}`
        : 'State not found';
      const errMsg = `[TranscriptionService][${conversationId}] _sendToOpenAIForConversation: Cannot send, OpenAI WebSocket not ready or state missing. ${stateDetails}`; // Log state details
      console.error(errMsg);
      throw new Error('OpenAI WebSocket not ready for conversation');
    }
  }

  // BroadcastToClients (per conversation) remains the same
  private broadcastToClients(conversationId: string, message: any): void {
    // *** Added Broadcast Debug Logging ***
    console.log(`[Broadcast Debug][${conversationId}] Attempting broadcast. Type: ${message?.type}`);

    const clients = this.clientConnections.get(conversationId);
    if (clients && clients.size > 0) {
        console.log(`[Broadcast Debug][${conversationId}] Found ${clients.size} client(s) in map.`);
        const messageStr = JSON.stringify(message);
        clients.forEach(client => {
            console.log(`[Broadcast Debug][${conversationId}] Checking client. ReadyState: ${client.readyState === WebSocket.OPEN ? 'OPEN' : client.readyState}`);
            if (client.readyState === WebSocket.OPEN) {
                try { 
                    console.log(`[Broadcast Debug][${conversationId}] Sending message to client.`);
                    client.send(messageStr); 
                } catch (e) { 
                    console.error(`Error sending to client ${conversationId}:`, e); 
                }
            } else {
                console.warn(`[Broadcast Debug][${conversationId}] Skipping send, client not OPEN.`);
            }
        });
    } else {
        console.warn(`[Broadcast Debug][${conversationId}] No clients found in map for broadcast. Message type: ${message?.type}`);
    }
    // *** End Broadcast Debug Logging ***
  }
  
  // --- Helper Methods ---
  /** Broadcast a message to ALL connected clients across ALL conversations - **TO BE REFACTORED or REMOVED** */
  private broadcastToAll(message: any): void {
      // This method might need rethinking. Do we need truly global broadcasts anymore?
      // If so, iterate over conversationStates map AND clientConnections map.
      console.warn("[TranscriptionService] broadcastToAll() called - Review its necessity/implementation.");
      const messageStr = JSON.stringify(message);
      this.clientConnections.forEach((clientSet, conversationId) => {
          console.log(`[Broadcasting All] Sending to clients of conversation ${conversationId}`);
    clientSet.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
                   try { client.send(messageStr); } catch (e) { console.error(`Error broadcasting to client in ${conversationId}:`, e); }
               }
          });
      });
  }
  
  /** Check if any clients are connected */
  private isClientMapEmpty(): boolean {
       // NOTE: This method now only checks if *any* conversation has clients.
       // It doesn't reflect the shared resource state anymore.
       return this.clientConnections.size === 0;
  }

  /** Closes the OpenAI connection for a SPECIFIC conversation */
  private _closeOpenAIConnectionForConversation(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (conversationState && conversationState.openaiConnection) {
      console.log(`[TranscriptionService][${conversationId}] Closing OpenAI connection.`);
      // Remove listeners before closing to prevent potential issues during cleanup
      conversationState.openaiConnection.removeAllListeners(); 
      conversationState.openaiConnection.close();
      conversationState.openaiConnection = null;
      conversationState.isOpenAIConnected = false;
      conversationState.isConnecting = false;
    }
  }

  /**
   * Check if a string is likely to be Base64 encoded
   */
  private isBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch (e) {
      return false;
    }
  }

  /**
   * Detects the language of a given text using a secondary OpenAI API call.
   * @param text The text to detect the language for.
   * @returns A promise resolving to the ISO 639-1 language code (e.g., 'en', 'es') or 'unknown'.
   */
  private async detectLanguage(text: string): Promise<string> {
      if (!this.openaiApiKey) {
          console.warn('[TranscriptionService] Cannot detect language: OPENAI_API_KEY not set.');
          return 'unknown';
      }
      if (!text || text.trim().length === 0) {
          return 'unknown'; // No text to detect
      }

      const languageDetectionUrl = 'https://api.openai.com/v1/chat/completions';
      const prompt = `Identify the predominant language of the following text and return only its two-letter ISO 639-1 code (e.g., en, es, fr, ja). Text: "${text}"`;

      console.log(`[TranscriptionService] Detecting language for text (first 50 chars): "${text.substring(0, 50)}..."`);

      try {
          const response = await axios.post<OpenAIChatCompletionResponse>(
              languageDetectionUrl,
              {
                  model: 'gpt-4o-mini',
                  messages: [{ role: 'user', content: prompt }],
                  max_tokens: 5,
                  temperature: 0.1,
              },
              {
                  headers: {
                      'Authorization': `Bearer ${this.openaiApiKey}`,
                      'Content-Type': 'application/json',
                  },
              }
          );

          const detectedLang = response.data?.choices?.[0]?.message?.content?.trim().toLowerCase();
          
          if (detectedLang && /^[a-z]{2}$/.test(detectedLang)) {
               console.log(`[TranscriptionService] Detected language: ${detectedLang}`);
               return detectedLang;
          } else {
               console.warn(`[TranscriptionService] Language detection returned unexpected result: '${detectedLang}'. Defaulting to 'unknown'. Full response:`, JSON.stringify(response.data));
               return 'unknown'; 
          }

      } catch (error) {
          console.error('[TranscriptionService] Error calling OpenAI Language Detection API:');
          // Replace the type guard
          if (error && typeof error === 'object' && 'isAxiosError' in error && error.isAxiosError) {
              // Now we assume it's an AxiosError, but cast to access specific props safely
              const axiosError = error as { response?: { status?: number; data?: any } }; 
              console.error('Status:', axiosError.response?.status);
              // Try to parse error data if it exists
              if (axiosError.response?.data) {
                  try {
                      // Assuming error data might be JSON
                      console.error('Data:', JSON.stringify(axiosError.response.data)); 
                  } catch (parseError) {
                      // If not JSON, log as is (might be ArrayBuffer or string)
                      console.error('Data (raw):', axiosError.response.data);
                  }
              } else {
                  console.error('No response data received.');
              }
          } else if (error instanceof Error) {
               console.error(error.message);
          } else {
               console.error('An unknown error occurred:', String(error));
          }
          return 'unknown'; // Default on error
      }
  }

  /**
   * Translates text from a source language to a target language using OpenAI.
   * @param text The text to translate.
   * @param sourceLang ISO 639-1 code of the source language.
   * @param targetLang ISO 639-1 code of the target language (defaults to 'en').
   * @returns A promise resolving to the translated text or null if translation fails.
   */
  private async translateText(text: string, sourceLang: string, targetLang: string = 'en'): Promise<string | null> {
    if (!this.openaiApiKey) {
        console.warn('[TranscriptionService] Cannot translate text: OPENAI_API_KEY not set.');
        return null;
    }
    if (!text || !sourceLang) {
        console.warn('[TranscriptionService] Cannot translate text: Missing text or source language.');
        return null;
    }

    const translationUrl = 'https://api.openai.com/v1/chat/completions';
    const prompt = `Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translated text, without any introductory phrases or explanations. Text: "${text}"`;

    console.log(`[TranscriptionService] Translating text from ${sourceLang} to ${targetLang} (first 50 chars): "${text.substring(0, 50)}..."`);

    try {
        const response = await axios.post<OpenAIChatCompletionResponse>(
            translationUrl,
            {
                model: 'gpt-4o-mini', 
                messages: [{ role: 'user', content: prompt }],
                max_tokens: Math.ceil(text.length * 1.5) + 10, // Add a small buffer for token variance
                temperature: 0.2, // Slightly lower temp might help directness
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        // Strip potential leading/trailing quotes from the response content
        const translatedContent = response.data?.choices?.[0]?.message?.content?.trim().replace(/^"|"$/g, '');

        if (translatedContent) {
            console.log(`[TranscriptionService] Raw translation response content: "${response.data?.choices?.[0]?.message?.content}"`);
            console.log(`[TranscriptionService] Processed translation: "${translatedContent}"`);
            return translatedContent;
        } else {
            console.warn(`[TranscriptionService] Translation API returned empty content. Full response:`, JSON.stringify(response.data));
            return null;
        }

    } catch (error) {
        console.error(`[TranscriptionService] Error calling OpenAI Translation (Chat Completion) API:`);
         if (error && typeof error === 'object' && 'isAxiosError' in error && error.isAxiosError) {
            const axiosError = error as { response?: { status?: number; data?: any } }; 
            console.error('Status:', axiosError.response?.status);
            if (axiosError.response?.data) {
                try {
                     console.error('Data:', JSON.stringify(axiosError.response.data)); 
                } catch { console.error('Data (raw):', axiosError.response.data); }
            } else { console.error('No response data received.'); }
        } else if (error instanceof Error) { console.error(error.message); }
        else { console.error('An unknown translation error occurred:', String(error)); }
        return null; 
    }
  }

  // --- NEW: Unified OpenAI Message Handler ---
  private async handleOpenAIMessage(conversationId: string, message: any): Promise<void> {
    // console.log(`[OpenAI Handler][${conversationId}] Processing message type: ${message.type}`);
    switch (message.type) {
      case 'transcription_session.created':
        console.log(`[OpenAI Handler][${conversationId}] Session Created. Session ID: ${message.session?.id}`);
        // Store session info if needed
        break;
      
      case 'transcription.final':
        // --- Start of Restored Processing Logic (with integrated command detection) ---
        const completedText = message.transcription?.text || '';
        const detectedLanguage = message.transcription?.language || 'unknown'; // Use language from final message

        if (!completedText) {
            console.log(`[OpenAI Handler][${conversationId}] Skipping empty final transcription.`);
            return; // Exit if no text
        }

        console.log(`[OpenAI Handler][${conversationId}] Processing final transcription (Lang: ${detectedLanguage}): "${completedText.substring(0, 50)}..."`);

        // Assume sender is 'user' (clinician) for now if language is english-like, else 'patient'
        // TODO: Implement proper speaker diarization if needed
        const sender = (detectedLanguage === 'en' || detectedLanguage === 'unknown') ? 'user' : 'patient';

        let textForTTS: string = completedText; // Default TTS text
        let savedOriginalMessageId: string | undefined = undefined;
        let translationToSave: string | null = null; // Text of the translation to be saved
        let translationLangToSave: string | null = null; // Language of the translation to be saved
        let currentPatientLanguage: string = 'es'; // Default assumption

        // --- Fetch current conversation state --- 
        let conversation;
        try {
             conversation = await this.conversationRepository.findById(conversationId);
             if (!conversation) {
                 console.error(`[OpenAI Handler][${conversationId}] CRITICAL: Conversation not found! Cannot process final transcription.`);
                 return;
             }
             currentPatientLanguage = conversation.patientLanguage; // Get actual patient language
             console.log(`[OpenAI Handler][${conversationId}] Fetched conversation. Current patientLanguage: ${currentPatientLanguage}`);
        } catch (fetchErr) {
            console.error(`[OpenAI Handler][${conversationId}] Error fetching conversation:`, fetchErr);
            return; // Stop if we can't fetch conversation
        }
        // --------------------------------------

        // +++ Send transcription_started event +++
        this.broadcastToClients(conversationId, { type: 'transcription_started' });

        // --- ASYNC: Command Detection for Clinician --- 
        let commandDetectionPromise: Promise<void> | null = null;
        if (sender === 'user') {
             console.log(`[OpenAI Handler][${conversationId}] Clinician spoke (${detectedLanguage}). Starting async command detection...`);
             commandDetectionPromise = this.commandDetectionService.detectCommand(completedText)
                 .then(commandResult => {
                     if (commandResult) {
                         console.log(`[OpenAI Handler][${conversationId}][Async] Command detected by service: ${commandResult.toolName}. Executing...`);
                         // Execute the command asynchronously
                         return this.executeDetectedCommand(conversationId, commandResult.toolName, commandResult.arguments);
                     } else {
                         console.log(`[OpenAI Handler][${conversationId}][Async] No command detected by service.`);
                     }
                 })
                 .catch(detectionError => {
                     console.error(`[OpenAI Handler][${conversationId}][Async] Error during command detection/execution:`, detectionError);
                 });
         }
         // --- End Async Command Detection --- 

        // --- Proceed with standard message processing IMMEDIATELY ---
        
        // 1. Save the original message
        try {
            if (!completedText || completedText.trim() === '') {
                console.log(`[OpenAI Handler][${conversationId}] Skipping save for empty original message.`);
            } else {
                console.log(`[OpenAI Handler][${conversationId}] Saving original message. Sender: ${sender}, Lang: ${detectedLanguage}...`);
                // Use the correct createMessage method
                const savedMessage = await this.messageService.createMessage(
                    conversationId,
                    completedText,
                    sender,
                    detectedLanguage
                );
                savedOriginalMessageId = savedMessage.id;
                console.log(`[OpenAI Handler][${conversationId}] Original message saved (ID: ${savedOriginalMessageId}). Broadcasting.`);
                this.broadcastToClients(conversationId, { type: 'new_message', payload: savedMessage });
            }
        } catch (saveError) {
            console.error(`[OpenAI Handler][${conversationId}] Failed to save original message:`, saveError);
            this.broadcastToClients(conversationId, { type: 'error', message: 'Failed to save transcription.' });
            return; // Don't proceed if saving failed
        }

        // 2. Handle Translation, Patient Language Update, and Determine TTS Text
        if (sender === 'patient' && detectedLanguage !== 'en' && detectedLanguage !== 'unknown') {
            // --- Patient spoke Non-English --- 
            console.log(`[Translation Logic][${conversationId}] Patient spoke ${detectedLanguage}. Current patient lang: ${currentPatientLanguage}`);
            if (detectedLanguage !== currentPatientLanguage) {
                console.log(`[Translation Logic][${conversationId}] Detected language ${detectedLanguage} differs from stored ${currentPatientLanguage}. Updating conversation...`);
                try {
                    await this.conversationRepository.update(conversationId, { patientLanguage: detectedLanguage });
                    console.log(`[Translation Logic][${conversationId}] Conversation patientLanguage updated to ${detectedLanguage}.`);
                    currentPatientLanguage = detectedLanguage; // Update local variable
                } catch (updateErr) {
                     console.error(`[Translation Logic][${conversationId}] Failed to update patient language:`, updateErr);
                }
            }
            console.log(`[Translation Logic][${conversationId}] Translating ${detectedLanguage} -> English for Clinician.`);
            this.broadcastToClients(conversationId, { type: 'translation_started' });
            translationToSave = await this.translateText(completedText, detectedLanguage, 'en');
            if (translationToSave) {
                textForTTS = translationToSave; // Clinician hears English
                translationLangToSave = 'en';
                console.log(`[Translation Logic][${conversationId}] English translation successful.`);
            } else {
                console.warn(`[Translation Logic][${conversationId}] Failed to translate ${detectedLanguage} -> en. Clinician TTS will use original text.`);
                textForTTS = completedText; // Fallback
            }
        } else if (sender === 'user') {
            // --- Clinician spoke English (or detected as such) --- 
            const patientTargetLang = currentPatientLanguage;
            if (patientTargetLang && patientTargetLang !== 'en') { // Translate if patient lang is set and not English
                console.log(`[Translation Logic][${conversationId}] Clinician spoke English. Translating to Patient language (${patientTargetLang}).`);
                this.broadcastToClients(conversationId, { type: 'translation_started' });
                translationToSave = await this.translateText(completedText, 'en', patientTargetLang);
                if (translationToSave) {
                    textForTTS = translationToSave; // Patient hears their language
                    translationLangToSave = patientTargetLang;
                    console.log(`[Translation Logic][${conversationId}] Translation to ${patientTargetLang} successful.`);
                } else {
                    console.warn(`[Translation Logic][${conversationId}] Failed to translate en -> ${patientTargetLang}. Patient TTS will use original English text.`);
                    textForTTS = completedText; // Fallback
                }
            } else {
                console.log(`[Translation Logic][${conversationId}] Clinician spoke English, Patient language is English or unset. No translation needed.`);
                textForTTS = completedText; // No translation needed
            }
         } else {
               // --- Patient spoke English (or detected as unknown/en) ---
               console.log(`[Translation Logic][${conversationId}] Patient spoke English/Unknown. No translation needed.`);
               textForTTS = completedText;
          }

        // 3. Save Translation if one was generated
        if (translationToSave && translationLangToSave && savedOriginalMessageId) { 
            try {
                if (translationToSave.trim() === '') {
                    console.log(`[OpenAI Handler][${conversationId}] Skipping save for empty translation message.`);
                } else {
                    console.log(`[OpenAI Handler][${conversationId}] Saving translated (${translationLangToSave}) message...`);
                    const savedTranslation = await this.messageService.createMessage(
                        conversationId,
                        translationToSave,
                        'translation',
                        translationLangToSave,
                        savedOriginalMessageId // Link to original message
                    );
                    console.log(`[OpenAI Handler][${conversationId}] Translated (${translationLangToSave}) message saved (ID: ${savedTranslation.id}). Broadcasting.`);
                    this.broadcastToClients(conversationId, { type: 'new_message', payload: savedTranslation });
                }
            } catch (saveTranslationError) {
                console.error(`[OpenAI Handler][${conversationId}] Failed to save translated (${translationLangToSave}) message:`, saveTranslationError);
                this.broadcastToClients(conversationId, { type: 'error', message: `Failed to save ${translationLangToSave} translation.` });
            }
        }

        // 4. Trigger TTS with the final determined text (if original message was saved)
        if (textForTTS && savedOriginalMessageId) {
             try {
                 console.log(`[OpenAI Handler][${conversationId}] Synthesizing speech linked to original message ID: ${savedOriginalMessageId}. Using text (first 50): "${textForTTS.substring(0, 50)}..."`);
                 const ttsLang = translationLangToSave || detectedLanguage; // Use translation lang if available, else detected lang
                 const audioBuffer = await this.ttsService.synthesizeSpeech(textForTTS, ttsLang);

                 if (audioBuffer && audioBuffer.length > 0) {
                     const audioBase64 = audioBuffer.toString('base64');
                     console.log(`[OpenAI Handler][${conversationId}] Speech synthesized (${audioBuffer.length} bytes). Broadcasting 'tts_audio' event linked to original message ID: ${savedOriginalMessageId}.`);
                     this.broadcastToClients(conversationId, {
                         type: 'tts_audio',
                         payload: {
                             audioBase64: audioBase64,
                             format: 'audio/mpeg',
                             originalMessageId: savedOriginalMessageId
                         }
                     });
                 } else {
                     console.log(`[OpenAI Handler][${conversationId}] TTS returned empty buffer, skipping broadcast.`);
                 }
             } catch (ttsError) {
                 console.error(`[OpenAI Handler][${conversationId}] Failed to synthesize or broadcast TTS for original message ${savedOriginalMessageId}:`, ttsError);
             }
        } else {
             console.log(`[OpenAI Handler][${conversationId}] Skipping TTS as textForTTS is empty or original message wasn't saved.`);
        }

        // +++ Send processing_completed event +++
        this.broadcastToClients(conversationId, { type: 'processing_completed' });

        // Await the command detection promise here if necessary (though it runs in parallel)
        // This ensures the handler function doesn't exit before the async command logic finishes
        // if there are race conditions to worry about, otherwise it can run truly in background.
        // For now, let's await it to ensure logs appear in sequence if a command *was* detected.
        if (commandDetectionPromise) {
             await commandDetectionPromise;
        }
        
        // --- End of Restored Processing Logic ---
        break;

      case 'transcription.partial':
        // console.log(`[OpenAI Handler][${conversationId}] Partial Transcription:`, message.transcription.text);
        // Broadcast partial transcription for real-time feedback
        this.broadcastToClients(conversationId, {
          type: 'partial_transcription',
          text: message.transcription.text,
          language: message.transcription.language
        });
        break;

      case 'transcription.error':
        console.error(`[OpenAI Handler][${conversationId}] Transcription Error:`, message.error.message);
        this.broadcastToClients(conversationId, { type: 'error', message: `Transcription Error: ${message.error.message}` });
        break;

      default:
        // console.log(`[OpenAI Handler][${conversationId}] Received unhandled message type: ${message.type}`);
        break;
    }
  }

  // --- NEW: Command Execution Logic ---
  private async executeDetectedCommand(conversationId: string, toolName: string, args: any): Promise<void> {
      console.log(`[Command Executor][${conversationId}] Executing command: ${toolName} with args:`, args);
      try {
          switch (toolName) {
              case 'take_note':
                  if (!args.note_content) {
                      console.error(`[Command Executor][${conversationId}] Missing 'note_content' for take_note`);
                      return;
                  }
                  await this.noteService.createNote(conversationId, args.note_content);
                  console.log(`[Command Executor][${conversationId}] Note created successfully.`);
                  // Optionally send confirmation back to client?
                  this.broadcastToClients(conversationId, { type: 'command_executed', name: 'take_note', status: 'success' });
                  break;

              case 'schedule_follow_up':
                  if (args.duration === undefined || args.unit === undefined) {
                      console.error(`[Command Executor][${conversationId}] Missing 'duration' or 'unit' for schedule_follow_up`);
                      return;
                  }
                  // Validate unit
                  const validUnits: FollowUpUnit[] = ["day", "week", "month"];
                  if (!validUnits.includes(args.unit)) {
                      console.error(`[Command Executor][${conversationId}] Invalid 'unit' for schedule_follow_up: ${args.unit}`);
                      return;
                  }
                  const followUp = await this.followUpService.createFollowUp(
                      conversationId, 
                      parseInt(args.duration, 10),
                      args.unit as FollowUpUnit,
                      args.details // Optional details
                  );
                  console.log(`[Command Executor][${conversationId}] Follow-up scheduled successfully for ${followUp.scheduledFor?.toISOString()}.`);
                  // Optionally send confirmation back to client?
                  this.broadcastToClients(conversationId, {
                      type: 'command_executed', 
                      name: 'schedule_follow_up', 
                      status: 'success', 
                      details: { scheduledFor: followUp.scheduledFor?.toISOString() } 
                  });
                  break;

              case 'write_prescription':
                  if (!args.medication_name || !args.dosage || !args.frequency) {
                      console.error(`[Command Executor][${conversationId}] Missing required fields for write_prescription`);
                      return;
                  }
                  await this.prescriptionService.createPrescription(
                      conversationId,
                      args.medication_name,
                      args.dosage,
                      args.frequency,
                      args.details // Optional details
                  );
                  console.log(`[Command Executor][${conversationId}] Prescription created successfully.`);
                  // Optionally send confirmation back to client?
                  this.broadcastToClients(conversationId, { type: 'command_executed', name: 'write_prescription', status: 'success' });
                  break;

              default:
                  console.warn(`[Command Executor][${conversationId}] Attempted to execute unhandled command: ${toolName}`);
          }
      } catch (error) {
          console.error(`[Command Executor][${conversationId}] Error executing command ${toolName}:`, error);
          // Optionally send error back to client?
          this.broadcastToClients(conversationId, { type: 'command_executed', name: toolName, status: 'error', message: 'Failed to execute command.' });
      }
  }
} 