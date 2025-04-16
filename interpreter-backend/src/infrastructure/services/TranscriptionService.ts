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
import { VoiceCommandService } from './VoiceCommandService';

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
      @inject(VoiceCommandService) private voiceCommandService: VoiceCommandService
  ) {
      this.openaiApiKey = process.env.OPENAI_API_KEY || '';
      if (!this.openaiApiKey) {
          console.error('[TranscriptionService] OPENAI_API_KEY is not set! Language detection and other features may fail.');
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
      if (!convState || !convState.ffmpegProcess || !convState.ffmpegProcess.stdin || convState.ffmpegProcess.stdin.destroyed || convState.ffmpegStdinEnded) {
          console.warn(`[TranscriptionService][${conversationId}] FFmpeg process not ready or stdin closed for this conversation, cannot process audio chunk.`);
          return;
      }
      const currentFfmpegProcess = convState.ffmpegProcess; // Use the specific ffmpeg process
      const currentFfmpegStdinEnded = convState.ffmpegStdinEnded; // Use the specific flag

      // --- TEMPORARY - Keep old logic structure but use conversation-specific vars ---
      if (!currentFfmpegProcess || !currentFfmpegProcess.stdin || currentFfmpegProcess.stdin.destroyed || currentFfmpegStdinEnded) {
           console.warn(`[TranscriptionService][${conversationId}] FFmpeg process not ready or stdin closed, cannot process audio chunk.`);
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
          // Close this specific connection if config fails?
          // this._cleanupConversationResources(conversationId);
        }

        this.broadcastToClients(conversationId, { type: 'openai_connected', message: 'Ready for audio' });
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

                const detectedLanguage = await this.detectLanguage(completedText);
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

                // +++ Voice Command Check (Clinician Only) - BEFORE MESSAGE SAVING +++
                if (sender === 'user') {
                    console.log(`[Voice Command Debug][${conversationId}] Checking for voice command in text: "${completedText}"`);
                    const lowerCaseText = completedText.toLowerCase().trim();
                    // Using first word as trigger for flexibility
                    const triggerWords = ["clara","claira","claire","clairea", "c"]; // Added "c"
                    const firstWordMatch = lowerCaseText.match(/^([a-z]+)/i);
                    const firstWord = firstWordMatch ? firstWordMatch[1].toLowerCase() : '';

                    console.log(`[Voice Command Debug][${conversationId}] First word extracted: "${firstWord}"`);
                    console.log(`[Voice Command Debug][${conversationId}] Checking against trigger words:`, triggerWords);

                    const hasCommand = triggerWords.includes(firstWord);

                    console.log(`[Voice Command Debug][${conversationId}] Has command: ${hasCommand}`);

                    if (hasCommand) {
                        isVoiceCommand = true; // Set flag to skip message saving/translation/TTS
                        // Extract everything after the first word and any punctuation
                        const commandText = lowerCaseText.replace(/^[a-z]+[.,!?;:\s]*/i, '').trim(); // Improved regex to handle punctuation
                        console.log(`[Voice Command Debug][${conversationId}] Extracted command text: "${commandText}"`);

                        console.log(`[Voice Command][${conversationId}] Detected command attempt from clinician: "${commandText}"`);

                        // Process structured commands (Note, Follow-up) via VoiceCommandService
                        if (commandText.startsWith("take a note") ||
                            commandText.startsWith("note") ||
                            commandText.startsWith("follow up") ||
                            commandText.startsWith("schedule follow up")) {
                            console.log(`[Voice Command][${conversationId}] Routing structured command to VoiceCommandService: "${commandText}"`);
                            // Pass the *original* text for context if needed by the service
                            this.voiceCommandService.processCommand(completedText, conversationId)
                                .then(() => console.log(`[Voice Command][${conversationId}] VoiceCommandService processed structured command.`))
                                .catch(err => console.error(`[TranscriptionService][${conversationId}] Error processing command via VoiceCommandService:`, err));
                            // Don't proceed further with this message
                            return;
                        }

                        // --- Handle Simple Phrase Matching Commands Directly --- 
                        switch (commandText) {
                            case "pause session":
                                console.log(`[Voice Command][${conversationId}] Recognized: Pause Session`);
                                // TODO: Implement pause logic (e.g., emit event, call service)
                                this.broadcastToClients(conversationId, { type: 'session_paused' });
                                break;
                            case "resume session":
                                console.log(`[Voice Command][${conversationId}] Recognized: Resume Session`);
                                // TODO: Implement resume logic
                                this.broadcastToClients(conversationId, { type: 'session_resumed' });
                                break;
                            case "end session":
                                console.log(`[Voice Command][${conversationId}] Recognized: End Session`);
                                // TODO: Implement end logic (e.g., call conversationService.endAndSummarizeConversation)
                                this.broadcastToClients(conversationId, { type: 'session_ended' }); // Example event
                                // Consider cleanup: this._cleanupConversationResources(conversationId);
                                break;
                            case "repeat that":
                            case "say again":
                                console.log(`[Voice Command][${conversationId}] Recognized: Repeat Last Utterance`);
                                // TODO: Implement repeat logic (needs access to last TTS content - complex)
                                this.broadcastToClients(conversationId, { type: 'repeat_last_tts_request' });
                                break;
                            case "show summary":
                                console.log(`[Voice Command][${conversationId}] Recognized: Show Summary`);
                                this.broadcastToClients(conversationId, { type: 'ui_command', payload: { command: 'show_summary' } });
                                break;
                            case "list actions":
                                console.log(`[Voice Command][${conversationId}] Recognized: List Actions`);
                                this.broadcastToClients(conversationId, { type: 'ui_command', payload: { command: 'list_actions' } });
                                break;
                            default:
                                console.log(`[Voice Command][${conversationId}] Command "${commandText}" not recognized.`);
                                // Optionally send a feedback message to the user?
                                // this.broadcastToClients(conversationId, { type: 'command_not_recognized', payload: { command: commandText } });
                                break;
                        }
                        // Skip the rest of the processing (saving, translation, TTS) for *all* voice commands
                        return;
                    }
                }
                // +++ End Voice Command Check +++

                // +++ Send transcription_started event +++
                this.broadcastToClients(conversationId, { type: 'transcription_started' });
                // ++++++++++++++++++++++++++++++++++++++++

                // 1. Save the original message (only if NOT a voice command)
                // isVoiceCommand flag ensures this doesn't run for commands
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
             const currentState = this.conversationStates.get(conversationId);
            if (currentState && currentState.isOpenAIConnected) {
                try {
                    const pcmBase64 = chunk.toString('base64');
                    this._sendToOpenAIForConversation(conversationId, JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64 }));
                } catch (err) {
                    console.error(`[TranscriptionService][${conversationId}] Error sending PCM chunk to OpenAI:`, err);
                    // Maybe close this conversation? this._cleanupConversationResources(conversationId);
                }
            } else {
                console.warn(`[TranscriptionService][${conversationId}] Received FFmpeg stdout data, but OpenAI not connected. Discarding.`);
            }
        });

        // Handle FFmpeg stderr (for debugging)
        ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
            // console.error(`[TranscriptionService][${conversationId}] FFmpeg stderr: ${chunk.toString()}`); // Keep commented unless debugging
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
                 console.log(`[TranscriptionService][${conversationId}] FFmpeg finished after stdin ended. Sending commit to OpenAI.`);
                 try {
                      this._sendToOpenAIForConversation(conversationId, JSON.stringify({ type: "input_audio_buffer.commit" }));
                 } catch (commitErr) {
                      console.error(`[TranscriptionService][${conversationId}] Error sending final commit to OpenAI after FFmpeg exit:`, commitErr);
                 }
            } else if (code !== 0 && code !== null) {
                 console.error(`[TranscriptionService][${conversationId}] FFmpeg exited unexpectedly.`);
                 // Maybe signal error to clients
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
}