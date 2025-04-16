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
import { ICommandDetectionService } from '../../domain/services/ICommandDetectionService';
import { ICommandExecutionService } from '../../domain/services/ICommandExecutionService';
import { ILanguageDetectionService } from '../../domain/services/ILanguageDetectionService';
import { ITranslationService } from '../../domain/services/ITranslationService';
import { FFmpegService } from './FFmpegService';
import { TranslationService } from './TranslationService';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { ILanguageModelService } from '../../domain/services/ILanguageModelService';
import { ISummaryService } from '../../domain/services/ISummaryService';
import { createLogger } from '../../utils/Logger';

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

// --- NEW: Interface for Per-Conversation State ---
interface ConversationState {
    openaiConnection: WebSocket | null;
    ffmpegService: FFmpegService | null;
    isOpenAIConnected: boolean;
    isConnecting: boolean;
    openaiConnectionCooldownUntil: number;
    openaiReconnectionAttempts: number;
    isPaused: boolean;
}
// ---------------------------------------------

@injectable()
export class ConversationPipelineService {
  // --- NEW: Per-Conversation State Management ---
  private conversationStates: Map<string, ConversationState> = new Map();
  // -------------------------------------------

  // --- Client Management State (per conversation) ---
  private clientConnections: Map<string, Set<WebSocket>> = new Map();
  // --------------------------------------------------

  private logger: Logger;

  constructor(
      @inject(IMessageServiceToken) private messageService: IMessageService,
      @inject(ITextToSpeechServiceToken) private ttsService: ITextToSpeechService,
      @inject('IConversationRepository') private conversationRepository: IConversationRepository,
      @inject("ICommandDetectionService") private commandDetectionService: ICommandDetectionService,
      @inject("ICommandExecutionService") private commandExecutionService: ICommandExecutionService,
      @inject('ILanguageDetectionService') private languageDetectionService: ILanguageDetectionService,
      @inject("ITranslationService") private translationService: ITranslationService,
      @inject("ILanguageModelService") private llmService: ILanguageModelService,
      @inject("ISummaryService") private summaryService: ISummaryService
  ) {
      // --- DEBUG LOG ---
      console.log(`[TranscriptionService DEBUG] Constructor: Read OPENAI_API_KEY from process.env. Value: '${process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 5) + '...' + process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 4) : 'NOT SET'}'`);
      // -----------------
      if (!process.env.OPENAI_API_KEY) {
          console.error('[TranscriptionService] OPENAI_API_KEY is not set! Language detection and other features may fail.');
      }
      else{
        console.log('[TranscriptionService] OPENAI_API_KEY is set to: ' + process.env.OPENAI_API_KEY);
      }

      // Ensure upload directory exists
      const dir = './uploads';
      if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
      }
      this.logger = createLogger('ConversationPipelineService');
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
            ffmpegService: null,
            isOpenAIConnected: false,
            isConnecting: false,
            openaiConnectionCooldownUntil: 0,
            openaiReconnectionAttempts: 0,
            isPaused: false,
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
      const convState = this.conversationStates.get(conversationId);
      const currentFfmpegService = convState?.ffmpegService;

      if (!convState) {
           console.warn(`[TranscriptionService][${conversationId}] Message received but state missing.`);
           return;
      }

      // +++ Add Detailed Debug Log +++
      const ffmpegExists = !!currentFfmpegService;
      const stdinOk = ffmpegExists && currentFfmpegService!.isReadyForData(); // Use the helper method
      // const stdinEndedFlag = convState ? !currentFfmpegService!.isReadyForData() : 'N/A'; // Infer ended if not ready
      // console.log(`[Transcription Debug][${conversationId}] Message received. convState exists: ${!!convState}, ffmpegService exists: ${ffmpegExists}, stdin OK: ${stdinOk}`);
      // +++ End Debug Log +++

      // Check if the service exists and is ready for data
      if (!currentFfmpegService || !currentFfmpegService.isReadyForData()) {
          console.warn(`[TranscriptionService][${conversationId}] FFmpeg service not ready or missing for this conversation, cannot process audio chunk.`);
          return;
      }
      // --- REMOVED redundant check --- 

      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'input_audio_buffer.append' && data.audio) {
          // Re-check readiness just before writing (optional, but safer)
          if (!currentFfmpegService.isReadyForData()) {
              console.warn(`[TranscriptionService][${conversationId}] FFmpeg service became not ready before write.`);
              return;
          }
          try {
            const inputChunkBuffer = Buffer.from(data.audio, 'base64');
            currentFfmpegService.writeChunk(inputChunkBuffer);
          } catch (decodeError) {
            console.error(`[TranscriptionService][${conversationId}] Error decoding base64 audio chunk:`, decodeError);
            this.broadcastToClients(conversationId, { type: 'error', message: 'Backend audio decoding error.' });
          }
        } else if (data.type === 'input_audio_buffer.finalize') {
          console.log(`[TranscriptionService][${conversationId}] Finalize received.`);
          // Service handles internal checks, just call finalize
          currentFfmpegService.finalizeInput();
        } else if (data.type === 'input_audio_buffer.pause') {
             console.log(`[TranscriptionService][${conversationId}] Pause message received. Setting isPaused flag.`);
             convState.isPaused = true;
        } else if (data.type === 'input_audio_buffer.resume') {
             console.log(`[TranscriptionService][${conversationId}] Resume message received. Clearing isPaused flag.`);
             convState.isPaused = false;
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

  /**
   * Ensures OpenAI connection and FFmpeg service are running for a specific conversation.
   * Initiates connection/process if needed, ensuring old resources are handled.
   */
  private _ensureConversationResources(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (!conversationState) {
      console.error(`[TranscriptionService][${conversationId}] Attempted to ensure resources for non-existent state.`);
      // Attempt to initialize state if missing, as handleConnection should have set it.
      // This might indicate a race condition or error elsewhere.
      console.warn(`[TranscriptionService][${conversationId}] Re-initializing missing state.`);
      this.conversationStates.set(conversationId, {
          openaiConnection: null, ffmpegService: null, isOpenAIConnected: false, isConnecting: false,
          openaiConnectionCooldownUntil: 0, openaiReconnectionAttempts: 0, isPaused: false,
       });
       // Proceed to connect after initializing state
       this._connectOpenAIForConversation(conversationId);
       return;
    }

    // --- Refined Check --- 
    // Check if already connecting OR if a connection exists AND is OPEN
    if (conversationState.isConnecting || 
        (conversationState.openaiConnection && conversationState.openaiConnection.readyState === WebSocket.OPEN)) 
    {
        console.log(`[TranscriptionService][${conversationId}] Resources already ensured (connecting or open).`);
        // Additionally ensure FFmpeg is running if WS is open but process is missing (edge case)
        if (conversationState.openaiConnection?.readyState === WebSocket.OPEN && !conversationState.ffmpegService) {
             console.warn(`[TranscriptionService][${conversationId}] OpenAI connection is open, but FFmpeg service missing. Re-creating.`);
             this._createAndStartFFmpegService(conversationId);
        }
        return; // Exit if connecting or already connected and open
    }
    // --- End Refined Check ---

    // If we reach here, it means:
    // - No connection attempt is in progress (isConnecting is false)
    // - EITHER no openaiConnection exists OR it exists but is NOT OPEN (CLOSING/CLOSED/null)
    // Therefore, we should proceed to establish a fresh connection.
    console.log(`[TranscriptionService][${conversationId}] Ensuring resources: Existing connection is not open or doesn't exist. Initiating connection process...`);
    this._connectOpenAIForConversation(conversationId);
  }

  /**
   * Cleans up resources (OpenAI connection, FFmpeg service) for a specific conversation.
   * Called when the last client disconnects or a fatal error occurs.
   */
  private _cleanupConversationResources(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (!conversationState) {
      console.warn(`[TranscriptionService][${conversationId}] Attempted to clean up resources for already removed state.`);
      return;
    }

    console.log(`[TranscriptionService][${conversationId}] Cleaning up resources...`);

    // Stop FFmpegService if it exists
    conversationState.ffmpegService?.stop();
    conversationState.ffmpegService = null;

    // Close OpenAI connection
    this._closeOpenAIConnectionForConversation(conversationId);

    // Remove the state from the map AFTER cleanup attempts
    this.conversationStates.delete(conversationId);
    console.log(`[TranscriptionService][${conversationId}] Conversation state removed.`);
  }

  /**
   * Establishes a WebSocket connection to OpenAI for a SPECIFIC conversation.
   * Manages the connection lifecycle and associated FFmpeg service for that conversation.
   */
  private _connectOpenAIForConversation(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    // Guard against missing state (should have been handled by ensureResources)
    if (!conversationState) {
        console.error(`[TranscriptionService][${conversationId}] _connectOpenAI called with missing conversation state.`);
        return;
    }
    
    // Guard against starting if already connecting or connected & open
    if (conversationState.isConnecting || (conversationState.openaiConnection && conversationState.openaiConnection.readyState === WebSocket.OPEN)) {
        console.log(`[TranscriptionService][${conversationId}] _connectOpenAI skipped: Already connecting or connected.`);
        return;
    }

    const now = Date.now();
    if (now < conversationState.openaiConnectionCooldownUntil) {
        const waitTimeSeconds = Math.ceil((conversationState.openaiConnectionCooldownUntil - now) / 1000);
        console.log(`[TranscriptionService][${conversationId}] OpenAI connection attempt skipped due to cooldown. Retrying in ${waitTimeSeconds}s.`);
        setTimeout(() => this._connectOpenAIForConversation(conversationId), conversationState.openaiConnectionCooldownUntil - now + 50);
        return;
    }

    // Check for API key still needed here for the primary OpenAI WS connection
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
        console.error(`[TranscriptionService][${conversationId}] OPENAI_API_KEY not set! Cannot connect to OpenAI Transcription.`);
        this.broadcastToClients(conversationId, { type: 'error', message: 'Backend service cannot connect to OpenAI (config missing).' });
        return;
    }

    console.log(`[TranscriptionService][${conversationId}] Attempting connection to OpenAI...`);
    conversationState.isConnecting = true;
    conversationState.isOpenAIConnected = false;
    
    // Cleanup before connecting
    console.log(`[TranscriptionService][${conversationId}] Cleaning up stale resources before connecting...`);
    conversationState.ffmpegService?.stop(); // Stop existing FFmpeg service
    conversationState.ffmpegService = null;
    this._closeOpenAIConnectionForConversation(conversationId);

    try {
      console.log(`[TranscriptionService][${conversationId}] Creating new OpenAI WebSocket...`);
      const newWs = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'OpenAI-Beta': 'realtime=v1' }
      });

      // Store immediately, even before 'open'
      conversationState.openaiConnection = newWs; 

      newWs.on('open', () => {
        console.log(`[TranscriptionService][${conversationId}] OpenAI connection established.`);
        // Update state for this specific conversation
        if (this.conversationStates.has(conversationId)) { // Check state still exists
            const currentState = this.conversationStates.get(conversationId)!;
            currentState.isOpenAIConnected = true;
            currentState.isConnecting = false;
            currentState.openaiReconnectionAttempts = 0;
            
            // Create and start the FFmpeg service for this conversation
            this._createAndStartFFmpegService(conversationId);
            
            console.log(`[TranscriptionService][${conversationId}] Sending configuration update to OpenAI...`);
            const updateConfig = {
                 type: "transcription_session.update",
                 session: { 
                     input_audio_transcription: { model: "whisper-1", prompt: "Transcribe the input audio to text" },
                     turn_detection: { type: "server_vad", silence_duration_ms: 500, prefix_padding_ms: 300, threshold: 0.5 },
                     include: ["item.input_audio_transcription.logprobs"]
                 }
            };
            try {
                 this._sendToOpenAIForConversation(conversationId, JSON.stringify(updateConfig));
                 console.log(`[TranscriptionService][${conversationId}] Configuration update sent successfully.`);
            } catch (configError) {
                console.error(`[TranscriptionService][${conversationId}] Error sending configuration update:`, configError);
                // Consider cleanup if config fails critically
                 this._cleanupConversationResources(conversationId);
            }
            this.broadcastToClients(conversationId, { type: 'openai_connected', message: 'Ready for audio' });
        } else {
             console.warn(`[TranscriptionService][${conversationId}] OpenAI connection opened, but conversation state was removed. Closing WS.`);
             newWs.close();
        }
      });

      newWs.on('message', async (data) => {
        const rawMessage = data.toString();
        try {
            const message: OpenAITranscriptionMessage = JSON.parse(rawMessage);

            if (message.type === 'conversation.item.input_audio_transcription.completed') {
                const completedText = message.transcript || '';
                if (!completedText) {
                    console.log(`[TranscriptionService][${conversationId}] Skipping empty completed transcription.`);
                    return;
                }
                console.log(`[TranscriptionService][${conversationId}] Processing completed transcription: "${completedText.substring(0, 50)}..."`);

                const detectedLanguage = await this.languageDetectionService.detectLanguage(completedText);
                const sender = (detectedLanguage === 'en' || detectedLanguage === 'unknown') ? 'user' : 'patient';
                let savedOriginalMessageId: string | undefined = undefined;
                let currentPatientLanguage: string = 'es';

                // Fetch conversation details (incl. patient language)
                let conversation;
                try {
                    conversation = await this.conversationRepository.findById(conversationId);
                    if (!conversation) {
                        console.error(`[TranscriptionService][${conversationId}] CRITICAL: Conversation not found! Cannot proceed.`);
                        return;
                    }
                    currentPatientLanguage = conversation.patientLanguage;
                } catch (fetchErr) {
                    console.error(`[TranscriptionService][${conversationId}] Error fetching conversation:`, fetchErr);
                    return;
                }
                
                // --- Command Detection (Async - remains the same) ---
                if (sender === 'user') {
                     this.commandDetectionService.detectCommand(completedText)
                        .then(commandResult => {
                            if (commandResult) {
                                // Command detected! Execute it and handle the result.
                                console.log(`[TranscriptionService][${conversationId}][Async] Command detected: ${commandResult.toolName}. Triggering execution...`);
                                this.commandExecutionService.executeCommand(conversationId, commandResult.toolName, commandResult.arguments)
                                    .then(executionResult => {
                                        console.log(`[TranscriptionService][${conversationId}][Async] Command execution finished. Status: ${executionResult.status}`);
                                        // Broadcast the execution result to clients
                                        this.broadcastToClients(conversationId, {
                                            type: 'command_executed',
                                            payload: executionResult // Send the whole result object
                                        });
                                    })
                                    .catch(execError => {
                                        // Catch errors specifically from the executeCommand promise itself (should be rare if it always returns a result object)
                                        console.error(`[TranscriptionService][${conversationId}][Async] CRITICAL ERROR during command execution promise:`, execError);
                                        // Broadcast a generic error in this unlikely case
                                        this.broadcastToClients(conversationId, {
                                            type: 'command_executed',
                                            payload: { status: 'error', name: commandResult.toolName, message: 'Internal error during command execution.' }
                                        });
                                    });
                            } else {
                                // No command detected by the async check
                                console.log(`[TranscriptionService][${conversationId}][Async] No command detected by service.`);
                            }
                        })
                        .catch(detectionError => {
                            // Log errors specifically from the command detection process
                            console.error(`[TranscriptionService][${conversationId}][Async] Error during command detection:`, detectionError);
                        });
                    
                }
                
                // Save original message (remains the same)
                try {
                    if (completedText.trim()) {
                        const savedMessage = await this.messageService.createMessage(conversationId, completedText, sender, detectedLanguage);
                        savedOriginalMessageId = savedMessage.id;
                        this.broadcastToClients(conversationId, { type: 'new_message', payload: savedMessage });
                    } else { /* skip save */ }
                } catch (saveError) {
                    console.error(`[TranscriptionService][${conversationId}] Failed to save original message:`, saveError);
                    this.broadcastToClients(conversationId, { type: 'error', message: 'Failed to save transcription.' });
                    return; // Don't proceed if saving failed
                }

                if (!savedOriginalMessageId) {
                     console.warn(`[TranscriptionService][${conversationId}] Original message was not saved (or empty), skipping translation/TTS.`);
                     return; // Need original message ID to link translation/TTS
                }

                // --- Handle Translation Streaming & TTS --- 
                let shouldTranslate = false;
                let sourceLangForTranslation: string | null = null;
                let targetLangForTranslation: string | null = null;
                let ttsText: string = completedText; // Default to original text for TTS
                let ttsLang: string = detectedLanguage; // Default TTS lang

                if (sender === 'patient' && detectedLanguage !== 'en' && detectedLanguage !== 'unknown') {
                    // Patient spoke Non-English
                    if (detectedLanguage !== currentPatientLanguage) {
                        console.log(`[Translation Logic][${conversationId}] Detected language ${detectedLanguage} differs from stored ${currentPatientLanguage}. Updating conversation...`);
                        try {
                            await this.conversationRepository.update(conversationId, { patientLanguage: detectedLanguage });
                            console.log(`[Translation Logic][${conversationId}] Conversation patientLanguage updated to ${detectedLanguage}.`);
                            currentPatientLanguage = detectedLanguage; // Update local variable
                        } catch (updateErr) {
                             console.error(`[Translation Logic][${conversationId}] Failed to update patient language:`, updateErr);
                             // Continue, but log the error
                        }
                    }
                    shouldTranslate = true;
                    sourceLangForTranslation = detectedLanguage;
                    targetLangForTranslation = 'en'; 
                } else if (sender === 'user' && currentPatientLanguage && currentPatientLanguage !== 'en') {
                    // Clinician spoke English, Patient expects non-English
                    shouldTranslate = true;
                    sourceLangForTranslation = 'en';
                    targetLangForTranslation = currentPatientLanguage;
                }

                if (shouldTranslate && sourceLangForTranslation && targetLangForTranslation) {
                    console.log(`[Translation Non-Stream][${conversationId}] Starting translation: ${sourceLangForTranslation} -> ${targetLangForTranslation}`);
                    // No translation_started broadcast
                    let fullTranslatedText: string | null = null;
                    let translationErrorOccurred = false;
                    try {
                        // Call the non-streaming translateText method
                        fullTranslatedText = await this.translationService.translateText(completedText, sourceLangForTranslation, targetLangForTranslation);
                        
                        if (fullTranslatedText) {
                            console.log(`[Translation Non-Stream][${conversationId}] Finished. Full translation: "${fullTranslatedText.substring(0, 50)}..."`);
                            // Use the complete translation for saving and TTS
                            ttsText = fullTranslatedText; 
                            ttsLang = targetLangForTranslation;

                            // Save the complete translation message
                            if (fullTranslatedText.trim()) {
                                 try {
                                     const savedTranslation = await this.messageService.createMessage(
                                         conversationId,
                                         fullTranslatedText,
                                         'translation',
                                         targetLangForTranslation,
                                         savedOriginalMessageId // Link to original message
                                     );
                                     console.log(`[TranscriptionService][${conversationId}] Saved full translation (ID: ${savedTranslation.id}). Broadcasting.`);
                                     // Broadcast the SAVED translation message
                                     this.broadcastToClients(conversationId, { type: 'new_message', payload: savedTranslation });
                                 } catch (saveTranslationError) {
                                     console.error(`[TranscriptionService][${conversationId}] Failed to save full translated message:`, saveTranslationError);
                                     // Don't block TTS, just log the error
                                     translationErrorOccurred = true; // Mark error if saving failed
                                 }
                             } else {
                                  console.log(`[TranscriptionService][${conversationId}] Skipping save/broadcast for empty full translation.`);
                             }
                        } else {
                             console.warn(`[Translation Non-Stream][${conversationId}] Translation returned null or empty.`);
                             translationErrorOccurred = true;
                        }

                    } catch (translationError) {
                        console.error(`[Translation Non-Stream][${conversationId}] Error during translation call:`, translationError);
                        this.broadcastToClients(conversationId, { type: 'error', message: `Translation failed: ${translationError instanceof Error ? translationError.message : String(translationError)}` });
                        translationErrorOccurred = true;
                        // Fallback: TTS will use original text/language if translation failed
                        ttsText = completedText;
                        ttsLang = detectedLanguage;
                    }
                    // No translation_completed broadcast needed in this pattern
                }

                // --- Trigger TTS (uses ttsText determined above) ---
                if (ttsText.trim()) {
                    try {
                        console.log(`[TranscriptionService][${conversationId}] Synthesizing speech (lang: ${ttsLang}) for original message ${savedOriginalMessageId}. Text: "${ttsText.substring(0, 50)}..."`);
                        const audioBuffer = await this.ttsService.synthesizeSpeech(ttsText, ttsLang);
                        if (audioBuffer && audioBuffer.length > 0) {
                            const audioBase64 = audioBuffer.toString('base64');
                            this.broadcastToClients(conversationId, {
                                type: 'tts_audio',
                                payload: {
                                    audioBase64: audioBase64,
                                    format: 'audio/mpeg', 
                                    originalMessageId: savedOriginalMessageId
                                }
                            });
                        } else {
                             console.log(`[TranscriptionService][${conversationId}] TTS returned empty buffer, skipping broadcast.`);
                        }
                    } catch (ttsError) {
                        console.error(`[TranscriptionService][${conversationId}] Failed to synthesize or broadcast TTS for original message ${savedOriginalMessageId}:`, ttsError);
                    }
                } else {
                     console.log(`[TranscriptionService][${conversationId}] Skipping TTS for empty text.`);
                }

                // +++ Send processing_completed event +++
                this.broadcastToClients(conversationId, { type: 'processing_completed' });
                // ++++++++++++++++++++++++++++++++++++++++
            } else if (message.type === 'error') {
                console.error(`[TranscriptionService][${conversationId}] OpenAI Error:`, JSON.stringify(message, null, 2));
                this.broadcastToClients(conversationId, { type: 'error', message: 'OpenAI processing error.' });
            } else {
                console.log(`[TranscriptionService][${conversationId}] Received unhandled OpenAI message type: ${message.type}`);
                // Optionally forward other types if needed
                // this.broadcastToClients(conversationId, message);
          }
        } catch (err) {
            console.error(`[TranscriptionService][${conversationId}] Error handling OpenAI message:`, err);
        }
      });

      newWs.on('error', (error) => {
        console.error(`[TranscriptionService][${conversationId}] OpenAI WebSocket Error:`, error);
         if (this.conversationStates.has(conversationId)) {
            const currentState = this.conversationStates.get(conversationId)!;
            currentState.isOpenAIConnected = false;
            currentState.isConnecting = false;
            currentState.openaiConnection = null; // Clear the connection ref on error
            // Implement backoff strategy
            currentState.openaiReconnectionAttempts++;
            const delay = Math.min(30000, (1000 * Math.pow(2, currentState.openaiReconnectionAttempts))); // Exponential backoff capped at 30s
            currentState.openaiConnectionCooldownUntil = Date.now() + delay;
            console.log(`[TranscriptionService][${conversationId}] OpenAI connection error. Attempt ${currentState.openaiReconnectionAttempts}. Retrying in ${delay / 1000}s.`);
            this.broadcastToClients(conversationId, { type: 'error', message: `OpenAI connection error. Retrying...` });
            setTimeout(() => this._ensureConversationResources(conversationId), delay); // Retry ensuring resources after delay
         } else {
             console.warn(`[TranscriptionService][${conversationId}] OpenAI WS error, but state already removed.`);
         }
      });

      newWs.on('close', (code, reason) => {
        const reasonString = reason.toString();
        console.log(`[TranscriptionService][${conversationId}] OpenAI WebSocket closed. Code: ${code}, Reason: ${reasonString}`);
        if (this.conversationStates.has(conversationId)) {
            const currentState = this.conversationStates.get(conversationId)!;
            currentState.isOpenAIConnected = false;
            currentState.isConnecting = false;
            currentState.openaiConnection = null; // Clear the connection ref

            // Decide whether to reconnect based on close code/reason
            // Avoid reconnecting on normal closure (e.g., code 1000) unless explicitly desired
            if (code !== 1000) { 
                // Implement backoff strategy for unexpected closures
                currentState.openaiReconnectionAttempts++;
                const delay = Math.min(30000, (1000 * Math.pow(2, currentState.openaiReconnectionAttempts))); // Exponential backoff capped at 30s
                currentState.openaiConnectionCooldownUntil = Date.now() + delay;
                console.log(`[TranscriptionService][${conversationId}] OpenAI connection closed unexpectedly. Attempt ${currentState.openaiReconnectionAttempts}. Retrying in ${delay / 1000}s.`);
                this.broadcastToClients(conversationId, { type: 'error', message: `OpenAI connection lost. Retrying...` });
                setTimeout(() => this._ensureConversationResources(conversationId), delay); // Retry ensuring resources after delay
            } else {
                 console.log(`[TranscriptionService][${conversationId}] OpenAI connection closed normally.`);
                 this.broadcastToClients(conversationId, { type: 'openai_disconnected', message: 'OpenAI connection closed.' });
                 // Don't automatically reconnect on normal closure unless specific logic requires it.
            }
        } else {
             console.warn(`[TranscriptionService][${conversationId}] OpenAI WS closed, but state already removed.`);
         }
      });

    } catch (error) {
      console.error(`[TranscriptionService][${conversationId}] Failed to create OpenAI WebSocket:`, error);
      if (this.conversationStates.has(conversationId)) {
        const currentState = this.conversationStates.get(conversationId)!;
        currentState.isConnecting = false;
        // Apply cooldown even if WebSocket constructor fails
        currentState.openaiReconnectionAttempts++;
        const delay = Math.min(30000, (1000 * Math.pow(2, currentState.openaiReconnectionAttempts)));
        currentState.openaiConnectionCooldownUntil = Date.now() + delay;
         console.log(`[TranscriptionService][${conversationId}] WebSocket creation failed. Attempt ${currentState.openaiReconnectionAttempts}. Retrying in ${delay / 1000}s.`);
         this.broadcastToClients(conversationId, { type: 'error', message: `Failed to connect to OpenAI. Retrying...` });
        setTimeout(() => this._ensureConversationResources(conversationId), delay);
      }
    }
  }

  /** Starts the FFmpeg service for a SPECIFIC conversation */
  private _createAndStartFFmpegService(conversationId: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (!conversationState) {
        console.error(`[TranscriptionService][${conversationId}] Cannot create FFmpeg service: State not found.`);
        return;
    }
    if (conversationState.ffmpegService) {
        console.warn(`[TranscriptionService][${conversationId}] FFmpeg service already exists. Stopping old one.`);
        conversationState.ffmpegService.stop();
    }

    console.log(`[TranscriptionService][${conversationId}] Creating and starting FFmpegService...`);
    const ffmpegService = new FFmpegService(conversationId);
    conversationState.ffmpegService = ffmpegService;

    ffmpegService.on('data', (pcmChunk: Buffer) => {
        const currentState = this.conversationStates.get(conversationId); // Re-fetch state
        if (currentState?.isPaused) {
            // console.log(`[TranscriptionService][${conversationId}] Dropping FFmpeg output chunk due to paused state.`);
            return; // Skip sending if paused
        }
        if (currentState && currentState.isOpenAIConnected) {
            try {
                const pcmBase64 = pcmChunk.toString('base64');
                this._sendToOpenAIForConversation(conversationId, JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64 }));
            } catch (err) {
                console.error(`[TranscriptionService][${conversationId}] Error sending PCM chunk to OpenAI:`, err);
            }
        } else {
            // console.warn(`[TranscriptionService][${conversationId}] Received FFmpeg data, but OpenAI not connected/state missing.`);
        }
    });

    ffmpegService.on('finished', () => {
        const currentState = this.conversationStates.get(conversationId); // Re-fetch state
         console.log(`[TranscriptionService][${conversationId}] FFmpeg finished cleanly. Sending commit to OpenAI.`);
         if (currentState && currentState.isOpenAIConnected) {
             try {
                 this._sendToOpenAIForConversation(conversationId, JSON.stringify({ type: "input_audio_buffer.commit" }));
             } catch (commitErr) {
                  console.error(`[TranscriptionService][${conversationId}] Error sending final commit to OpenAI:`, commitErr);
             }
         } else {
              console.warn(`[TranscriptionService][${conversationId}] FFmpeg finished, but OpenAI not connected/state missing.`);
         }
    });

    ffmpegService.on('error', (error) => {
        console.error(`[TranscriptionService][${conversationId}] FFmpegService emitted error:`, error);
        this.broadcastToClients(conversationId, { type: 'error', message: 'Internal audio processing error.'});
        // Consider full cleanup on FFmpeg error
        this._cleanupConversationResources(conversationId);
    });

    ffmpegService.start(); // Start the process
  }

  /**
   * Send a message over the OpenAI connection for a SPECIFIC conversation.
   */
  private _sendToOpenAIForConversation(conversationId: string, message: string): void {
    const conversationState = this.conversationStates.get(conversationId);
    if (conversationState && conversationState.openaiConnection && conversationState.isOpenAIConnected && conversationState.openaiConnection.readyState === WebSocket.OPEN) {
      try {
        conversationState.openaiConnection.send(message);
      } catch (sendError) {
        console.error(`[TranscriptionService][${conversationId}] _sendToOpenAIForConversation Error during send:`, sendError);
        // Consider cleaning up this conversation's resources on send error
        // this._cleanupConversationResources(conversationId);
        throw sendError; // Re-throw send error
      }
    } else {
      const stateDetails = conversationState
        ? `State: ${conversationState.openaiConnection?.readyState}, ConnectedFlag: ${conversationState.isOpenAIConnected}`
        : 'State not found';
      const errMsg = `[TranscriptionService][${conversationId}] _sendToOpenAIForConversation: Cannot send, OpenAI WebSocket not ready or state missing. ${stateDetails}`;
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
} 
