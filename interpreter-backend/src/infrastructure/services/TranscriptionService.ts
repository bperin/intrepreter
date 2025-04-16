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
import { CommandExecutionService, CommandExecutionResult } from './CommandExecutionService';
import { ILanguageDetectionService } from '../../domain/services/ILanguageDetectionService';
import { FFmpegService } from './FFmpegService';

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
    ffmpegService: FFmpegService | null;
    isOpenAIConnected: boolean;
    isConnecting: boolean;
    openaiConnectionCooldownUntil: number;
    openaiReconnectionAttempts: number;
    isPaused: boolean;
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
      @inject(CommandExecutionService) private commandExecutionService: CommandExecutionService,
      @inject('ILanguageDetectionService') private languageDetectionService: ILanguageDetectionService
  ) {
      this.openaiApiKey = process.env.OPENAI_API_KEY || '';
      // --- DEBUG LOG ---
      console.log(`[TranscriptionService DEBUG] Constructor: Read OPENAI_API_KEY from process.env. Value: '${this.openaiApiKey ? this.openaiApiKey.substring(0, 5) + '...' + this.openaiApiKey.substring(this.openaiApiKey.length - 4) : 'NOT SET'}'`);
      // -----------------
      if (!this.openaiApiKey) {
          console.error('[TranscriptionService] OPENAI_API_KEY is not set! Language detection and other features may fail.');
      }
      else{
        console.log('[TranscriptionService] OPENAI_API_KEY is set to: ' + this.openaiApiKey);
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

    if (!this.openaiApiKey) {
      console.error(`[TranscriptionService][${conversationId}] OPENAI_API_KEY not set! Cannot connect.`);
      this.broadcastToClients(conversationId, { type: 'error', message: 'Backend service cannot connect to OpenAI (config missing).' });
      // Maybe remove conversation state here?
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
        headers: { 'Authorization': `Bearer ${this.openaiApiKey}`, 'OpenAI-Beta': 'realtime=v1' }
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
        // TODO: Refactor the message processing logic here
        const rawMessage = data.toString();
        // console.log(`[TranscriptionService][${conversationId}] Raw message from OpenAI: ${rawMessage.substring(0, 100)}...`); // Can be verbose

        try {
            const message: OpenAITranscriptionMessage = JSON.parse(rawMessage);

            if (message.type === 'transcription_session.created') {
                console.log(`[TranscriptionService][${conversationId}] OpenAI session created.`);
            } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
                // --- Start of Moved Processing Logic ---
                const completedText = message.transcript || '';
                if (!completedText) {
                    console.log(`[TranscriptionService][${conversationId}] Skipping empty completed transcription.`);
                    return; // Exit if no text
                }

                console.log(`[TranscriptionService][${conversationId}] Processing completed transcription: "${completedText.substring(0, 50)}..."`);

                const detectedLanguage = await this.languageDetectionService.detectLanguage(completedText);
                const sender = (detectedLanguage === 'en' || detectedLanguage === 'unknown') ? 'user' : 'patient'; // user=clinician, patient=patient

                let textForTTS: string = completedText; // Default TTS text
                let savedOriginalMessageId: string | undefined = undefined;
                let translationToSave: string | null = null; // Text of the translation to be saved
                let translationLangToSave: string | null = null; // Language of the translation to be saved
                let currentPatientLanguage: string = 'es'; // Default assumption
                let isVoiceCommand: boolean = false; // Flag to track if this is a voice command

                // --- Fetch current conversation state --- 
                let conversation;
                try {
                     conversation = await this.conversationRepository.findById(conversationId);
                     if (!conversation) {
                         console.error(`[TranscriptionService][${conversationId}] CRITICAL: Conversation not found! Cannot proceed.`);
                         // Maybe cleanup resources? this._cleanupConversationResources(conversationId);
                         return;
                     }
                     currentPatientLanguage = conversation.patientLanguage; // Get actual patient language
                     console.log(`[TranscriptionService][${conversationId}] Fetched conversation. Current patientLanguage: ${currentPatientLanguage}`);
                } catch (fetchErr) {
                    console.error(`[TranscriptionService][${conversationId}] Error fetching conversation:`, fetchErr);
                    // Maybe cleanup? return;
                    return; // Stop if we can't fetch conversation
                }
                // --------------------------------------

                // --- Process based on sender --- 
                if (sender === 'user') {
                    // Clinician spoke - check for commands using the new service ASYNCHRONOUSLY
                    console.log(`[TranscriptionService][${conversationId}] Clinician spoke. Starting async command detection...`);
                    
                    // Call detectCommand without await and handle the promise
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
            
                
                // +++ Send transcription_started event +++
                this.broadcastToClients(conversationId, { type: 'transcription_started' });
                
                // 1. Save the original message
                try {
                    if (!completedText || completedText.trim() === '') {
                        console.log(`[TranscriptionService][${conversationId}] Skipping save for empty original message.`);
                    } else {
                        console.log(`[TranscriptionService][${conversationId}] Saving original message. Sender: ${sender}, Lang: ${detectedLanguage}...`);
                        const savedMessage = await this.messageService.createMessage(
                            conversationId,
                            completedText,
                            sender,
                            detectedLanguage
                        );
                        savedOriginalMessageId = savedMessage.id;
                        console.log(`[TranscriptionService][${conversationId}] Original message saved (ID: ${savedOriginalMessageId}). Broadcasting.`);
                        this.broadcastToClients(conversationId, { type: 'new_message', payload: savedMessage });
                    }
                } catch (saveError) {
                    console.error(`[TranscriptionService][${conversationId}] Failed to save original message:`, saveError);
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
                             // Continue, but log the error
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
                        textForTTS = completedText; // Fallback to original if translation fails
                    }

                } else if (sender === 'user') {
                    // --- Clinician spoke English --- 
                    const patientTargetLang = currentPatientLanguage; // Use fetched patient language
                    if (patientTargetLang && patientTargetLang !== 'en') { // Only translate if patient lang is set and not English
                        console.log(`[Translation Logic][${conversationId}] Clinician spoke English. Translating to Patient language (${patientTargetLang}).`);
                        this.broadcastToClients(conversationId, { type: 'translation_started' });
                        translationToSave = await this.translateText(completedText, 'en', patientTargetLang);
                        if (translationToSave) {
                            textForTTS = translationToSave; // Patient hears their language
                            translationLangToSave = patientTargetLang;
                            console.log(`[Translation Logic][${conversationId}] Translation to ${patientTargetLang} successful.`);
                        } else {
                            console.warn(`[Translation Logic][${conversationId}] Failed to translate en -> ${patientTargetLang}. Patient TTS will use original English text.`);
                            textForTTS = completedText; // Fallback to original
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
                if (translationToSave && translationLangToSave && savedOriginalMessageId) { // Also ensure original was saved
                    try {
                        if (translationToSave.trim() === '') {
                            console.log(`[TranscriptionService][${conversationId}] Skipping save for empty translation message.`);
                        } else {
                            console.log(`[TranscriptionService][${conversationId}] Saving translated (${translationLangToSave}) message...`);
                            const savedTranslation = await this.messageService.createMessage(
                                conversationId,
                                translationToSave,
                                'translation',
                                translationLangToSave,
                                savedOriginalMessageId // Link to original message
                            );
                            console.log(`[TranscriptionService][${conversationId}] Translated (${translationLangToSave}) message saved (ID: ${savedTranslation.id}). Broadcasting.`);
                            this.broadcastToClients(conversationId, { type: 'new_message', payload: savedTranslation });
                        }
                    } catch (saveTranslationError) {
                        console.error(`[TranscriptionService][${conversationId}] Failed to save translated (${translationLangToSave}) message:`, saveTranslationError);
                        this.broadcastToClients(conversationId, { type: 'error', message: `Failed to save ${translationLangToSave} translation.` });
                        // Continue with TTS even if translation saving fails?
                    }
                }

                // 4. Trigger TTS with the final determined text (if original message was saved)
                if (textForTTS && savedOriginalMessageId) {
                     try {
                         console.log(`[TranscriptionService][${conversationId}] Synthesizing speech linked to original message ID: ${savedOriginalMessageId}. Using text (first 50): "${textForTTS.substring(0, 50)}..."`);
                         // Determine language/voice for TTS based on who is speaking and target language
                         // This might need more sophisticated logic based on detectedLanguage, translationLangToSave, etc.
                         const ttsLang = translationLangToSave || detectedLanguage; // Simplified: Use translation lang if available, else detected lang
                         const audioBuffer = await this.ttsService.synthesizeSpeech(textForTTS, ttsLang); // Pass language if your TTS service supports it

                         if (audioBuffer && audioBuffer.length > 0) {
                             const audioBase64 = audioBuffer.toString('base64');
                             console.log(`[TranscriptionService][${conversationId}] Speech synthesized (${audioBuffer.length} bytes). Broadcasting 'tts_audio' event linked to original message ID: ${savedOriginalMessageId}.`);
                             
                             // *** Added Backend Debug Logging: Before Broadcast ***
                             const ttsPayload = {
                                 type: 'tts_audio',
                                 payload: {
                                     audioBase64: audioBase64.substring(0, 50) + '...', // Log only snippet
                                     format: 'audio/mpeg',
                                     originalMessageId: savedOriginalMessageId
                                 }
                             };
                             console.log(`[Backend TTS Debug][${conversationId}] Broadcasting payload:`, JSON.stringify(ttsPayload));
                             // *** End Backend Debug Logging ***

                             // *** Check the broadcast call ***
                             this.broadcastToClients(conversationId, {
                                 type: 'tts_audio', // Correct type? YES
                                 payload: {
                                     audioBase64: audioBase64,
                                     format: 'audio/mpeg', // Assuming TTS service returns mp3
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
                     console.log(`[TranscriptionService][${conversationId}] Skipping TTS as textForTTS is empty or original message wasn't saved.`);
                }

                // +++ Send processing_completed event +++
                this.broadcastToClients(conversationId, { type: 'processing_completed' });
                // ++++++++++++++++++++++++++++++++++++++++
                // --- End of Moved Processing Logic ---

            } else if (message.type === 'error') {
                console.error(`[TranscriptionService][${conversationId}] OpenAI Error:`, JSON.stringify(message, null, 2));
                this.broadcastToClients(conversationId, { type: 'error', message: 'OpenAI processing error.' });
            } else {
                console.log(`[TranscriptionService][${conversationId}] Received unhandled OpenAI message type: ${message.type}`);
                // Optionally forward other types if needed
                // this.broadcastToClients(conversationId, message);
          }
        } catch (err) {
            console.error(`[TranscriptionService][${conversationId}] Error handling OpenAI message:`, err, `Raw Data: ${rawMessage.substring(0, 100)}...`);
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
} 
