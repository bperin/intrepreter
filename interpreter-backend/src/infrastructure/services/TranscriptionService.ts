import WebSocket from 'ws';
import { injectable } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

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

@injectable()
export class TranscriptionService {
  // --- Single Shared OpenAI Connection State ---
  private openaiConnection: WebSocket | null = null;
  private isOpenAIConnected: boolean = false;
  private isConnecting: boolean = false; // Prevent multiple connection attempts
  private openaiConnectionCooldownUntil: number = 0;
  private openaiReconnectionAttempts: number = 0;
  // --- Persistent FFmpeg Process State ---
  private ffmpegProcess: ChildProcessWithoutNullStreams | null = null;
  private ffmpegStdinEnded: boolean = false; // Flag to track if we've ended stdin
  // ---------------------------------------------

  // --- Client Management State (per conversation) ---
  private clientConnections: Map<string, Set<WebSocket>> = new Map();
  // --------------------------------------------------

  constructor() {}

  /**
   * Handle a new client WebSocket connection for transcription
   */
  public handleConnection(clientWs: WebSocket, conversationId: string): void {
    console.log(`[TranscriptionService][${conversationId}] New client connection.`);
    
    // Add client for this conversation
    if (!this.clientConnections.has(conversationId)) {
      this.clientConnections.set(conversationId, new Set());
    }
    this.clientConnections.get(conversationId)?.add(clientWs);
    
    // --- Initiate Shared OpenAI Connection (if needed) ---
    this.connectToOpenAI(); 
    // -----------------------------------------------------

    clientWs.on('close', (code, reason) => {
      console.log(`[TranscriptionService][${conversationId}] Client disconnected. Code: ${code}, Reason: ${reason?.toString()}`);
      const clients = this.clientConnections.get(conversationId);
      clients?.delete(clientWs);
      if (clients?.size === 0) {
          this.clientConnections.delete(conversationId);
          console.log(`[TranscriptionService] Last client for conversation ${conversationId} disconnected.`);
      }
      
      // Optional: Consider closing shared OpenAI connection if *all* clients across *all* conversations disconnect
      if (this.isClientMapEmpty()) {
           console.log('[TranscriptionService] All clients disconnected. Closing shared OpenAI connection and FFmpeg.');
           this.closeOpenAIConnection(); // This will also trigger ffmpeg kill
      }
    });

    clientWs.on('message', async (message) => {
      // Ensure FFmpeg process is running before piping data
      if (!this.ffmpegProcess || !this.ffmpegProcess.stdin || this.ffmpegProcess.stdin.destroyed || this.ffmpegStdinEnded) {
           console.warn(`[TranscriptionService][${conversationId}] FFmpeg process not ready or stdin closed, cannot process audio chunk.`);
           // Maybe retry or drop? For now, just log.
           return;
      }

      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'input_audio_buffer.append' && data.audio) {
          try {
            const inputChunkBuffer = Buffer.from(data.audio, 'base64');
            // Write the raw WebM/Opus chunk to the persistent FFmpeg process
            this.ffmpegProcess.stdin.write(inputChunkBuffer, (error) => {
                 if (error) {
                     console.error(`[TranscriptionService][${conversationId}] Error writing chunk to FFmpeg stdin:`, error);
                     // Handle error - maybe kill ffmpeg? Depends on error type
                 } else {
                     // console.log(`[TranscriptionService][${conversationId}] Wrote chunk (${inputChunkBuffer.length} bytes) to FFmpeg stdin.`); // Verbose
                 }
            });
          } catch (decodeOrWriteError) {
            console.error(`[TranscriptionService][${conversationId}] Error decoding or writing audio chunk to FFmpeg:`, decodeOrWriteError);
            this.broadcastToClients(conversationId, { type: 'error', message: 'Backend audio processing error.' });
          }

        } else if (data.type === 'input_audio_buffer.finalize') {
          console.log(`[TranscriptionService][${conversationId}] Finalize received. Ending FFmpeg stdin stream.`);
          try {
            if (this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
               this.ffmpegProcess.stdin.end(); // Signal end of input to FFmpeg
               this.ffmpegStdinEnded = true; // Mark that we've ended input
               console.log(`[TranscriptionService][${conversationId}] FFmpeg stdin stream ended.`);
               // NOTE: We now need to wait for FFmpeg stdout to end before sending OpenAI commit
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
    });

    // Send confirmation to this specific client
    clientWs.send(JSON.stringify({ 
      type: 'backend_connected',
      message: 'Connected to backend service.',
      status: this.isOpenAIConnected ? 'openai_connected' : (this.isConnecting ? 'openai_connecting' : 'openai_disconnected')
    }));
  }

  /**
   * Establish THE SHARED WebSocket connection to OpenAI and start FFmpeg
   */
  private connectToOpenAI(): void {
    if (this.openaiConnection || this.isConnecting) return;
    
    const now = Date.now();
    if (now < this.openaiConnectionCooldownUntil) {
       const waitTimeSeconds = Math.ceil((this.openaiConnectionCooldownUntil - now) / 1000);
       console.log(`[TranscriptionService] OpenAI connection attempt skipped due to cooldown. Retrying in ${waitTimeSeconds}s.`);
       // Schedule a single retry attempt after cooldown
       setTimeout(() => this.connectToOpenAI(), this.openaiConnectionCooldownUntil - now + 50); // Add small buffer
       return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[TranscriptionService] OPENAI_API_KEY not set! Cannot connect.");
      // Broadcast error to all connected clients? 
      this.broadcastToAll({ type: 'error', message: 'Backend service cannot connect to OpenAI (config missing).' });
      return;
    }

    console.log('[TranscriptionService] Attempting connection to OpenAI...');
    this.isConnecting = true;
    this.isOpenAIConnected = false;
    this.killFFmpegProcess(); // Ensure any old process is gone
    
    try {
      const newWs = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });
      
      newWs.on('open', () => { 
        console.log('[TranscriptionService] OpenAI connection established.');
        this.openaiConnection = newWs;
        this.isOpenAIConnected = true;
        this.isConnecting = false;
        this.openaiReconnectionAttempts = 0;
        
        // Start Persistent FFmpeg Process FIRST
        this.startFFmpegProcess();
        
        // Now, send the working update configuration
        console.log('[TranscriptionService] Sending configuration update to OpenAI...');
        const updateConfig = {
          type: "transcription_session.update",
          session: { // Nested structure, NO ID inside
            // NO id: currentSessionId here
            input_audio_transcription: {
              model: "whisper-1", 
              language: "en",
              prompt: "Transcribe speech to text in English."
            },
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 500,
              prefix_padding_ms: 300,
              threshold: 0.5
            },
            include: [
              // Use the include value confirmed to work, or omit/empty if not needed
              "item.input_audio_transcription.logprobs" 
            ]
          }
        };
        
        try {
           // Use the synchronous sendToOpenAI as connection is guaranteed open here
           this.sendToOpenAI(JSON.stringify(updateConfig));
           console.log('[TranscriptionService] Configuration update sent successfully.');
        } catch (configError) {
           console.error('[TranscriptionService] Error sending configuration update:', configError);
           // Decide if this is fatal - maybe close connection?
           // For now, just log it. The connection is open, but config failed.
        }
        
        this.broadcastToAll({ type: 'openai_connected', message: 'Ready for audio' });
      });
      
      newWs.on('message', async (data) => {
        // Log raw message from OpenAI for debugging
        const rawMessage = data.toString();
        console.log(`[TranscriptionService] Raw message from OpenAI: ${rawMessage}`); 

        // Handle incoming messages - Route based on heuristic (first client)
        try {
          const message: OpenAITranscriptionMessage = JSON.parse(rawMessage);
          
          // --- Simple Routing Logic (Assumes Single Active User) ---
          let targetConversationId: string | undefined = undefined;
          if (this.clientConnections.size > 0) {
               targetConversationId = this.clientConnections.keys().next().value;
          }
          // --------------------------------------------------------

          if (targetConversationId) {
               if (message.type !== 'transcription_session.created') { // Don't broadcast session created
                   console.warn(`[TranscriptionService] Routing OpenAI message (${message.type}) to first client: ${targetConversationId} (Limitation: Assumes single active user)`);
                   this.broadcastToClients(targetConversationId, message);
               }
          } else {
               console.warn(`[TranscriptionService] Received OpenAI message (${message.type}) but no clients connected to route to.`);
          }

          if (message.type === 'error') {
            console.error('[TranscriptionService] OpenAI Error:', JSON.stringify(message, null, 2));
          }
        } catch (err) {
          console.error('[TranscriptionService] Error handling OpenAI message:', err, `Raw Data: ${rawMessage}`);
        }
      });
      
      newWs.on('close', (code, reason) => {
        console.log(`[TranscriptionService] OpenAI connection closed. Code: ${code}, Reason: ${reason?.toString()}`);
        this.openaiConnection = null;
        this.isOpenAIConnected = false;
        this.isConnecting = false;
        this.killFFmpegProcess(); // Kill FFmpeg when OpenAI disconnects
        
        // Handle reconnection attempt with backoff
        this.openaiReconnectionAttempts++;
        const cooldownMs = Math.min(30000, Math.pow(2, this.openaiReconnectionAttempts) * 1000);
        this.openaiConnectionCooldownUntil = Date.now() + cooldownMs;
        console.log(`[TranscriptionService] Setting OpenAI reconnect cooldown for ${cooldownMs}ms.`);
        this.broadcastToAll({ type: 'openai_disconnected', message: 'Disconnected. Attempting reconnect...' });
        
        // Attempt reconnect after cooldown if clients are still connected
        if (!this.isClientMapEmpty()) { 
             setTimeout(() => this.connectToOpenAI(), cooldownMs);
        }
      });
      
      newWs.on('error', (error) => {
        console.error('[TranscriptionService] OpenAI WebSocket error:', error);
        this.isConnecting = false; 
        this.killFFmpegProcess(); // Kill FFmpeg on OpenAI error too
        // Let the 'close' event handle state changes and reconnection attempt
      });

    } catch (err) {
      console.error('[TranscriptionService] Error initiating OpenAI connection:', err);
      this.isConnecting = false;
      this.isOpenAIConnected = false;
      this.killFFmpegProcess(); // Ensure FFmpeg is killed on connection init error
      this.broadcastToAll({ type: 'error', message: `Failed to connect to OpenAI: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Starts the persistent FFmpeg process */
  private startFFmpegProcess(): void {
      if (this.ffmpegProcess) {
          console.warn('[TranscriptionService] Attempted to start FFmpeg process, but one already exists.');
          return;
      }
      console.log('[TranscriptionService] Starting persistent FFmpeg process...');
      this.ffmpegStdinEnded = false; // Reset flag

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
          this.ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
          console.log(`[TranscriptionService] FFmpeg process spawned with PID: ${this.ffmpegProcess.pid}`);
          let pcmChunkCounter = 0; // Counter for debugging file names

          // Handle PCM data coming out of FFmpeg
          this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
              // console.log(`[TranscriptionService] Received PCM chunk from FFmpeg stdout (Length: ${chunk.length})`); // Commented out: Verbose
              
              // --- DEBUG: Save raw PCM chunk --- 
              /* // Commented out: Verbose debug file saving
              const tempDir = os.tmpdir();
              const pcmFileName = `ffmpeg_output_${Date.now()}_${pcmChunkCounter++}.raw`;
              const pcmFilePath = path.join(tempDir, pcmFileName);
              try {
                   fs.writeFileSync(pcmFilePath, chunk);
                   console.log(`[TranscriptionService] DEBUG: Saved raw PCM chunk to ${pcmFilePath}`);
              } catch (writeErr) {
                   console.error(`[TranscriptionService] DEBUG: Error saving PCM chunk:`, writeErr);
              }
              */
              // --- END DEBUG --- 

              if (this.isOpenAIConnected) {
                  try {
                      const pcmBase64 = chunk.toString('base64');
                      this.sendToOpenAI(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64 }));
                  } catch (err) {
                      console.error('[TranscriptionService] Error sending PCM chunk to OpenAI:', err);
                  }
              } else {
                  console.warn('[TranscriptionService] Received FFmpeg stdout data, but OpenAI not connected. Discarding.');
              }
          });

          // Handle FFmpeg stderr (for debugging)
          this.ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
              // console.error(`[TranscriptionService] FFmpeg stderr: ${chunk.toString()}`); // Commented out: Can be very verbose
          });

          // Handle FFmpeg process errors
          this.ffmpegProcess.on('error', (error) => {
              console.error('[TranscriptionService] Persistent FFmpeg process error:', error);
              this.killFFmpegProcess(); // Clean up on error
              // Potentially try to restart? Or signal fatal error?
          });

          // Handle FFmpeg process exit
          this.ffmpegProcess.on('close', (code, signal) => {
              console.log(`[TranscriptionService] Persistent FFmpeg process exited with code ${code}, signal ${signal}.`);
              // If stdin was ended, this exit might be expected - send OpenAI commit
              if (this.ffmpegStdinEnded && code === 0) {
                   console.log('[TranscriptionService] FFmpeg finished after stdin ended. Sending commit to OpenAI.');
                   try {
                        this.sendToOpenAI(JSON.stringify({ type: "input_audio_buffer.commit" }));
                   } catch (commitErr) {
                        console.error('[TranscriptionService] Error sending final commit to OpenAI after FFmpeg exit:', commitErr);
                   }
              } else if (code !== 0 && code !== null) {
                   // Unexpected exit
                   console.error('[TranscriptionService] FFmpeg exited unexpectedly.');
                   // Maybe signal error to clients or attempt restart?
              }
              this.ffmpegProcess = null; // Clear the handle
          });

          // Handle FFmpeg stdin errors (like EPIPE)
          this.ffmpegProcess.stdin.on('error', (error: NodeJS.ErrnoException) => {
               console.error(`[TranscriptionService] Persistent FFmpeg stdin error:`, error);
               // This often means FFmpeg exited prematurely
               this.killFFmpegProcess(); // Ensure it's cleaned up
          });

      } catch (spawnError) {
           console.error('[TranscriptionService] Failed to spawn persistent FFmpeg process:', spawnError);
           this.ffmpegProcess = null; 
           // Signal error to clients?
      }
  }

  /** Kills the persistent FFmpeg process if it's running */
  private killFFmpegProcess(): void {
      if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
          console.log(`[TranscriptionService] Killing persistent FFmpeg process (PID: ${this.ffmpegProcess.pid})...`);
          this.ffmpegProcess.kill('SIGTERM'); // Send termination signal
          this.ffmpegProcess = null;
          this.ffmpegStdinEnded = false; // Reset flag
      }
  }

  /**
   * Send a message over THE SHARED OpenAI connection (Synchronous check).
   */
  private sendToOpenAI(message: string): void {
    // Synchronous check if connection is ready
    if (this.openaiConnection && this.isOpenAIConnected && this.openaiConnection.readyState === WebSocket.OPEN) {
      try {
         this.openaiConnection.send(message);
      } catch (sendError) {
           console.error('[TranscriptionService] sendToOpenAI Error during send:', sendError);
           throw sendError; // Re-throw send error
      }
    } else {
      const errMsg = `[TranscriptionService] sendToOpenAI: Cannot send, OpenAI WebSocket not ready. State: ${this.openaiConnection?.readyState}, ConnectedFlag: ${this.isOpenAIConnected}`; 
      console.error(errMsg);
      throw new Error('OpenAI WebSocket not ready');
    }
  }

  // BroadcastToClients (per conversation) remains the same
  private broadcastToClients(conversationId: string, message: any): void {
    const clients = this.clientConnections.get(conversationId);
    if (clients) {
      const messageStr = JSON.stringify(message);
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(messageStr); } catch (e) { console.error(`Error sending to client ${conversationId}:`, e); }
        }
      });
    }
  }
  
  // --- Helper Methods ---
  /** Broadcast a message to ALL connected clients across ALL conversations */
  private broadcastToAll(message: any): void {
      const messageStr = JSON.stringify(message);
      this.clientConnections.forEach(clientSet => {
          clientSet.forEach(client => {
               if (client.readyState === WebSocket.OPEN) {
                   try { client.send(messageStr); } catch (e) { console.error('Error broadcasting to client:', e); }
               }
          });
      });
  }
  
  /** Check if any clients are connected */
  private isClientMapEmpty(): boolean {
       for (const clientSet of this.clientConnections.values()) {
           if (clientSet.size > 0) {
               return false;
           }
       }
       return true;
  }

  /** Close the shared OpenAI connection and kill FFmpeg */
  private closeOpenAIConnection(): void {
    this.killFFmpegProcess(); // Kill FFmpeg first
    if (this.openaiConnection) {
         console.log('[TranscriptionService] Closing shared OpenAI connection.');
         this.openaiConnection.close();
         this.openaiConnection = null;
         this.isOpenAIConnected = false;
         this.isConnecting = false; 
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
}