import { useState, useEffect, useCallback, useRef } from 'react';
import { useActions } from '../context/ActionContext';
import { AggregatedAction, isActionEntityType } from '../types/actions';

export type SttStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' | 'error';

// Define the type for the new message callback function
// Adjust the 'any' to match your actual message object structure from the backend
type OnNewMessage = (message: any) => void; 
// Define the type for the TTS audio callback function - EXPECTS ArrayBuffer
type OnTtsAudio = (audioBuffer: ArrayBuffer) => void;

// --- Helper: Convert Base64 string to ArrayBuffer --- 
// (Moved here or import if defined elsewhere)
const base64ToArrayBuffer = (base64: string): ArrayBuffer | null => {
    console.log('[Base64Decode Hook] Attempting to decode base64 string (first 50 chars):', base64.substring(0, 50));
    try {
        const base64String = base64.split(",")[1] || base64;
        const binaryString = window.atob(base64String);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        console.log('[Base64Decode Hook] Decoded successfully. Byte length:', bytes.buffer.byteLength);
        return bytes.buffer;
    } catch (error) {
        console.error("[Base64Decode Hook] Error decoding Base64 string:", error);
        return null;
    }
};
// ---------------------------------------------------

interface SpeechToTextResult {
  status: SttStatus;
  error: Error | null;
  transcript: string | null;
  isProcessing: boolean;
  language: string | null;
  isPaused: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
}

// Get the host-accessible backend URL (e.g., http://localhost:8080) from build-time env var
const rawBackendUrl = import.meta.env.VITE_APP_BACKEND_URL;

if (!rawBackendUrl) {
  throw new Error("Configuration Error: VITE_APP_BACKEND_URL environment variable is not set.");
}

// Function to derive the host-accessible transcription WS URL
const getTranscriptionWsUrl = (baseUrl: string, conversationId: string | null): string | null => {
  if (!conversationId) return null;
  try {
    const url = new URL(baseUrl); // e.g., http://localhost:8080
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use the host and port from the baseUrl (which is localhost:8080)
    return `${protocol}//${url.host}/transcription?conversationId=${conversationId}`; // e.g., ws://localhost:8080/transcription?...
  } catch (e) {
    console.error("Failed to parse VITE_APP_BACKEND_URL to derive transcription WebSocket URL:", baseUrl, e);
    throw new Error(`Configuration Error: Invalid VITE_APP_BACKEND_URL format for transcription WebSocket: ${baseUrl}`);
  }
};

/**
 * Hook for speech-to-text functionality using backend as a proxy to OpenAI.
 * This approach streams audio to our backend which then forwards it to OpenAI.
 * 
 * @param conversationId The ID of the current conversation.
 * @param onNewMessage Callback function triggered when the backend broadcasts a newly saved message.
 * @param onTtsAudio Callback function triggered with the decoded TTS audio ArrayBuffer.
 */
export const useSpeechToTextBackend = (
  conversationId: string | null,
  onNewMessage?: OnNewMessage, 
  onTtsAudio?: OnTtsAudio // Expects (audioBuffer: ArrayBuffer) => void
): SpeechToTextResult => {
  console.log(`[useSpeechToTextBackend] Hook initialized. Conversation ID: ${conversationId}`);
  const [status, setStatus] = useState<SttStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Audio recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  
  // WebSocket connection to our backend
  const wsRef = useRef<WebSocket | null>(null);
  const isWsOpenRef = useRef<boolean>(false);
  
  // Get addAction from context
  const { addAction } = useActions();

  // Accumulated transcript ref
  const accumulatedTranscriptRef = useRef<string>('');
  // Flag to track if pause was triggered by visibility change
  const pausedByVisibilityRef = useRef<boolean>(false);

  // Constants for WebSocket connection
  const getBackendWsUrl = useCallback(() => {
    console.log(`[useSpeechToTextBackend] Constructing transcription WS URL. Base URL: ${rawBackendUrl}, Conversation ID: ${conversationId}`);
    return getTranscriptionWsUrl(rawBackendUrl, conversationId);
  }, [conversationId]);
  
  // Logging utility functions
  const logDebug = (message: string, data?: any) => {
    const prefix = '[Backend STT]';
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  };

  const logError = (message: string, err?: any) => {
    const prefix = '[Backend STT ERROR]';
    if (err) {
      console.error(`${prefix} ${message}`, err);
      if (err instanceof Error && err.stack) {
        console.error(`${prefix} Stack:`, err.stack);
      }
    } else {
      console.error(`${prefix} ${message}`);
    }
  };

  /**
   * Convert Blob to Base64
   */
  const blobToBase64 = async (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
        const base64 = base64String.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  /**
   * Initialize WebSocket connection to our backend
   */
  const initializeWebSocket = useCallback(() => {
    const wsUrl = getBackendWsUrl();
    console.log(`[useSpeechToTextBackend] initializeWebSocket called. URL: ${wsUrl}`);
    
    if (!wsUrl) {
      logError("Cannot initialize WebSocket: Missing conversationId");
      setError(new Error("Missing conversationId"));
      setStatus('failed');
      return;
    }

    if (wsRef.current && isWsOpenRef.current) {
      logDebug("WebSocket already initialized and open");
      return;
    }

    // Close existing websocket if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      isWsOpenRef.current = false;
    }

    logDebug(`Initializing WebSocket connection to ${wsUrl}`);
    setStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        logDebug("WebSocket connection to backend opened");
        isWsOpenRef.current = true;
        setStatus('connected');
      };

      ws.onclose = (event) => {
        logDebug(`WebSocket connection closed: ${event.code} ${event.reason}`);
        isWsOpenRef.current = false;
        setStatus('closed');
      };

      ws.onerror = (event) => {
        logError("WebSocket error", event);
        setError(new Error("WebSocket connection error"));
        setStatus('error');
      };

      ws.onmessage = (event) => {
        try {
          // *** Added Debug Logging: Raw message ***
          console.log('[WS Debug] Raw message received:', event.data);

          const data = JSON.parse(event.data);
          logDebug("Received WebSocket message from backend", data);
 
          // *** Added Debug Logging: Parsed message type ***
          console.log(`[WS Debug] Parsed message type: ${data.type}`);

          if (data.type === 'error') {
            logError("Received error from backend", data);
            setError(new Error(data.message || "Unknown error from backend"));
            if (data.details) { logError("Error details:", data.details); }
            // Consider setting status to 'error' or 'failed'?
            // setStatus('error'); 
            return;
          }
          
          // --- Handle NEW Transcription Event Types --- 
          if (data.type === 'conversation.item.input_audio_transcription.delta') {
            const deltaText = data.delta || '';
            logDebug(`Received delta transcription: "${deltaText}"`);
            // Append delta to the accumulated transcript for live preview
            accumulatedTranscriptRef.current += deltaText;
            setTranscript(accumulatedTranscriptRef.current);
            setIsProcessing(true); // Still processing while receiving deltas
          }
          
          else if (data.type === 'conversation.item.input_audio_transcription.completed') {
            // This event now primarily signals the *backend* to save.
            // We might still use it to finalize the live preview or clear it.
            const completedText = data.transcript || '';
            logDebug(`Received completed transcription signal. Final text: "${completedText}"`);
            accumulatedTranscriptRef.current = completedText; // Update ref with final text
            setTranscript(completedText); // Show final text briefly in live preview
            setIsProcessing(false); // Mark processing as done for this segment

             // Set language if provided and different from current
             if (data.language && data.language !== language) { 
                 logDebug(`Detected language (completed): ${data.language}`);
                 setLanguage(data.language);
             }
             
             // Clear the live transcript preview after a short delay, 
             // assuming a new_message event will arrive soon with the saved version.
             // setTimeout(() => setTranscript(''), 500); // Optional: Clear live preview
             accumulatedTranscriptRef.current = ''; // Reset accumulator for next utterance

          }

          // --- Handle Backend-Sent Saved Messages ---
          else if (data.type === 'new_message') {
              console.log('🚀 [useSpeechToTextBackend] ====== RECEIVED NEW_MESSAGE ======');
              console.log('📄 [useSpeechToTextBackend] Payload:', JSON.stringify(data.payload, null, 2));
              console.log('🔄 [useSpeechToTextBackend] onNewMessage callback available:', !!onNewMessage);
              
              if (onNewMessage && data.payload) {
                  console.log('🔄 [useSpeechToTextBackend] Calling onNewMessage with payload...');
                  onNewMessage(data.payload); // Pass the message object up
                  console.log('✅ [useSpeechToTextBackend] onNewMessage callback executed');
              } else if (!onNewMessage) {
                  console.warn('⚠️ [useSpeechToTextBackend] onNewMessage callback NOT PROVIDED - message not handled!');
              } else if (!data.payload) {
                  console.warn('⚠️ [useSpeechToTextBackend] new_message received without payload!', data);
              }
              // Optionally clear the live transcript display now that the saved message arrived
              console.log('🧹 [useSpeechToTextBackend] Clearing transcript state');
              setTranscript(null); 
              console.log('🚀 [useSpeechToTextBackend] ====== NEW_MESSAGE HANDLING COMPLETE ======');
          }
          // +++ Handle TTS Audio +++
          else if (data.type === 'tts_audio') {
              // *** Added Debug Logging: Entered tts_audio block ***
              console.log('[WS Debug] Entered tts_audio handler.');
              logDebug('Received tts_audio message', data.payload);
              const audioBase64 = data.payload?.audioBase64;
              if (onTtsAudio && audioBase64 && typeof audioBase64 === 'string') {
                  logDebug('Decoding base64 audio before calling callback...');
                  const audioBuffer = base64ToArrayBuffer(audioBase64);
                  if (audioBuffer) {
                      // *** Added Debug Logging: About to call onTtsAudio ***
                      console.log('[WS Debug] Audio decoded, about to call onTtsAudio callback...');
                      onTtsAudio(audioBuffer); // Pass the ArrayBuffer
                  } else {
                       logError('Failed to decode base64 audio for TTS.');
                  }
              } else if (!onTtsAudio) {
                  logError('Received tts_audio but onTtsAudio callback is not provided!');
              } else {
                  logError('Received tts_audio message without valid audioBase64 payload', data.payload);
              }
          }
          // +++ Handle Command Execution Result +++
          else if (data.type === 'command_executed') {
              console.log('🚀 [useSpeechToTextBackend] ====== RECEIVED COMMAND_EXECUTED ====== ');
              console.log('📄 [useSpeechToTextBackend] Payload:', JSON.stringify(data.payload, null, 2));
              if (data.payload?.status === 'success' && data.payload.payload) {
                  console.log('✅ [useSpeechToTextBackend] Command successful. Extracted entity:', data.payload.payload);
                  if (onNewMessage) {
                      console.log('🔄 [useSpeechToTextBackend] Calling onNewMessage with command result entity...');
                      onNewMessage(data.payload.payload); // Pass the created entity (Note, FollowUp, Prescription)
                      // console.log('✅ [useSpeechToTextBackend] onNewMessage callback executed for command result.'); // Keep separate logging if needed
                  }
                  // +++ Also call addAction from ActionContext +++
                  const entity = data.payload.payload;
                  // Ensure the entity looks like one of our action types before adding
                  if (isActionEntityType(entity)) { // Use a type guard
                      console.log('➕ [useSpeechToTextBackend] Calling addAction for command result entity...');
                      addAction(entity as AggregatedAction); // Add to ActionContext
                      console.log('✅ [useSpeechToTextBackend] addAction callback executed.');
                  } else {
                      console.warn('⚠️ [useSpeechToTextBackend] Command result payload did not match expected action structure:', entity);
                  }
              } else if (data.payload?.status === 'error') {
                  logError(`Command execution failed: ${data.payload.name}`, data.payload.message);
                  // Optionally, notify the parent component of the error?
                  // Maybe call an onError callback if it existed, or use setError state?
                  setError(new Error(`Command execution failed: ${data.payload.message || 'Unknown error'}`));
              } else {
                  logError('Received command_executed message with unexpected payload format', data.payload);
              }
              console.log('🚀 [useSpeechToTextBackend] ====== COMMAND_EXECUTED HANDLING COMPLETE ======');
          }
          // +++ End TTS Audio Handling +++
          
          
        } catch (err) {
          logError("Error parsing WebSocket message", err);
        }
      };
    } catch (err) {
      logError("Failed to initialize WebSocket", err);
      setError(err instanceof Error ? err : new Error("Failed to initialize WebSocket"));
      setStatus('failed');
    }
  }, [getBackendWsUrl, onNewMessage, language, onTtsAudio, addAction]); // Update dependency array

  /**
   * Send audio data over WebSocket
   */
  const sendAudioChunk = useCallback(async (audioBlob: Blob) => {
    if (!wsRef.current) {
      logError("Cannot send audio chunk: WebSocket not initialized");
      return;
    }
    
    if (wsRef.current.readyState !== WebSocket.OPEN) {
      logError(`Cannot send audio chunk: WebSocket not open (state: ${wsRef.current.readyState})`);
      return;
    }

    try {
      // Convert blob to base64
      const base64Audio = await blobToBase64(audioBlob);
      logDebug(`[sendAudioChunk] Sending audio chunk (Base64 size: ${base64Audio.length})`);
      
      // Send audio data
      const audioMessage = {
        type: "input_audio_buffer.append",
        audio: base64Audio
      };
      
      wsRef.current.send(JSON.stringify(audioMessage));
    } catch (err) {
      logError("Failed to send audio chunk", err);
    }
  }, [wsRef, logDebug, logError, blobToBase64]);

  /**
   * Start recording audio
   */
  const startRecording = useCallback(async () => {
    logDebug('Attempting to start recording...');
    if (status === 'connected') {
      logError('Cannot start recording: Already connected or recording.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      logError('getUserMedia not supported on your browser!');
      setError(new Error('MediaDevices API not supported.'));
      setStatus('failed');
      return;
    }

    // Clear previous state
    setError(null);
    setTranscript(null);
    accumulatedTranscriptRef.current = '';
    audioChunksRef.current = [];
    setIsPaused(false);

    // Ensure WebSocket is ready before getting media
    initializeWebSocket();

    try {
      logDebug('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      logDebug('Microphone access granted.');

      // --- MediaRecorder Setup --- 
      const supportedTypes: { mimeType: string; options?: MediaRecorderOptions }[] = [
           { mimeType: 'audio/wav' }, // Try PCM WAV first
           { mimeType: 'audio/webm;codecs=opus' },
           { mimeType: 'audio/ogg;codecs=opus' },
           { mimeType: 'audio/mp4' }, // Fallback
           { mimeType: '' } // Browser default
      ];

      let selectedMimeType = '';
      for (const typeInfo of supportedTypes) {
           const isSupported = MediaRecorder.isTypeSupported(typeInfo.mimeType);
           logDebug(`Checking support for mimeType: '${typeInfo.mimeType}' -> Supported: ${isSupported}`);
           if (isSupported) {
                selectedMimeType = typeInfo.mimeType;
                break;
           }
      }
      
      if (!selectedMimeType && supportedTypes[supportedTypes.length - 1].mimeType === '') {
           logDebug('No specific mimeType supported, using browser default.');
           selectedMimeType = ''; // Explicitly use default
      }
      
      logDebug(`Attempting to create MediaRecorder with mimeType: '${selectedMimeType || 'default'}'`);
      const options = selectedMimeType ? { mimeType: selectedMimeType } : {};
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      logDebug(`MediaRecorder created. Actual mimeType: '${mediaRecorderRef.current.mimeType}'`);
      // -------------------------

      mediaRecorderRef.current.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          logDebug(`[ondataavailable] Chunk received. Size: ${event.data.size}, Type: ${event.data.type}`);
          audioChunksRef.current.push(event.data);
          if (!isPaused) {
              // Send chunk immediately if not paused
              try {
                   const base64Audio = await blobToBase64(event.data);
                   logDebug(`[ondataavailable] Sending chunk. Base64 Start: ${base64Audio.substring(0, 50)}...`);
                   // Send via WebSocket (assuming sendAudioChunk handles base64 conversion if needed or is adapted)
                   // Based on review, sendAudioChunk expects a Blob, let's keep it that way or adapt it.
                   // Let's assume sendAudioChunk handles the blob correctly as per previous code review.
                   sendAudioChunk(event.data); // Send the blob directly
              } catch (error) {
                   logError("Error processing or sending audio chunk", error);
              }
          }
        }
      };

      mediaRecorderRef.current.onstart = () => {
        logDebug('MediaRecorder started.');
        setStatus('connected'); // Consider this connected for UI purposes
        setIsProcessing(true);
      };

      mediaRecorderRef.current.onstop = () => {
        logDebug('MediaRecorder stopped.');
        setIsProcessing(false);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
             logDebug('Sending finalize message to backend.');
             wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.finalize' }));
        }
        // Clean up stream tracks
        audioStreamRef.current?.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
        // Maybe set status to idle or disconnected?
        // setStatus('idle'); 
      };

      mediaRecorderRef.current.onerror = (event) => {
        logError('MediaRecorder error', event);
        setError(new Error('MediaRecorder encountered an error.'));
        setStatus('failed');
      };

      const timeslice = 500; // Send data approx every 500ms
      // --- Delay MediaRecorder start slightly --- 
      const startDelay = 200; // Delay in milliseconds (adjust if needed)
      logDebug(`MediaRecorder configured. Starting after ${startDelay}ms delay...`);
      setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
               logDebug(`Starting MediaRecorder now (after ${startDelay}ms delay). Timeslice: ${timeslice}ms`);
               mediaRecorderRef.current.start(timeslice);
          } else {
              logDebug(`Delay ended, but MediaRecorder ref is missing or state is not inactive (${mediaRecorderRef.current?.state}). Not starting.`);
          }
      }, startDelay);
      // ------------------------------------

    } catch (err) {
      logError('Error starting recording', err);
      setError(err instanceof Error ? err : new Error('Failed to start recording'));
      setStatus('failed');
      // Clean up stream tracks if acquired before error
      audioStreamRef.current?.getTracks().forEach(track => track.stop());
       audioStreamRef.current = null;
    }
  }, [status, initializeWebSocket, isPaused, sendAudioChunk]); // Dependencies adjusted

  /**
   * Stop recording and finalize
   */
  const stopRecording = useCallback(async () => {
    logDebug('== stopRecording called =='); // Make log more prominent
    
    // Stop media recorder
    logDebug(`Checking MediaRecorder... Ref exists: ${!!mediaRecorderRef.current}, State: ${mediaRecorderRef.current?.state}`);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      logDebug('--> Stopping MediaRecorder...');
      try {
        mediaRecorderRef.current.stop(); // stop() triggers onstop handler eventually
        logDebug('--> MediaRecorder.stop() called.');
      } catch (err) {
        logError("Error calling MediaRecorder.stop()", err);
      }
    } else { 
        logDebug('--> MediaRecorder already inactive or null.');
    }

    // Clean up audio stream tracks (releases microphone hardware)
    logDebug(`Checking audio stream... Ref exists: ${!!audioStreamRef.current}`);
    if (audioStreamRef.current) {
      logDebug('--> Stopping audio stream tracks...');
      audioStreamRef.current.getTracks().forEach(track => {
           logDebug(`Stopping track: ${track.label}, Kind: ${track.kind}, ReadyState: ${track.readyState}`);
           track.stop();
      });
      audioStreamRef.current = null;
      logDebug('--> Audio stream tracks stopped and ref cleared.');
    } else { 
        logDebug('--> Audio stream already null.');
    }

    // Close WebSocket connection 
    // Note: Finalize message is usually sent in mediaRecorder.onstop
    logDebug(`Checking WebSocket... Ref exists: ${!!wsRef.current}, State: ${wsRef.current?.readyState}`);
    if (wsRef.current) {
      logDebug('--> Closing WebSocket connection...');
      // Fallback: If stopRecording is called before onstop fires, ensure finalize is sent.
      if (mediaRecorderRef.current?.state !== 'inactive' && wsRef.current.readyState === WebSocket.OPEN) {
           logDebug('--> Fallback: Sending finalize message before closing WebSocket.');
           try {
                wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.finalize' }));
           } catch (sendErr) {
                logError("Error sending fallback finalize message", sendErr);
           }
      }
      wsRef.current.close(); 
      wsRef.current = null;
      isWsOpenRef.current = false;
      logDebug('--> WebSocket closed and refs cleared.');
    } else { 
        logDebug('--> WebSocket already null.');
    }

    // Reset component state
    logDebug('--> Resetting component state (paused, status, processing).');
    setIsPaused(false);
    setStatus('closed'); // Set clear final state
    setIsProcessing(false);
    logDebug('== stopRecording finished ==');
  }, [mediaRecorderRef, audioStreamRef, wsRef, isWsOpenRef, logDebug, logError, setStatus, setIsPaused, setIsProcessing]); // Added refs to dependency array for safety

  /**
   * Pause recording
   */
  const pauseRecording = useCallback(() => {
    console.log(`[useSpeechToTextBackend] pauseRecording called.`);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      logDebug("Pausing recording");
      mediaRecorderRef.current.pause();
      
      // Optionally notify the backend that we're pausing
      if (wsRef.current && isWsOpenRef.current) {
        try {
          wsRef.current.send(JSON.stringify({
            type: "input_audio_buffer.pause"
          }));
        } catch (err) {
          logError("Failed to send pause message", err);
        }
      }
      
      setIsPaused(true);
    }
  }, []);

  /**
   * Resume recording
   */
  const resumeRecording = useCallback(() => {
    console.log(`[useSpeechToTextBackend] resumeRecording called.`);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      logDebug("Resuming recording");
      mediaRecorderRef.current.resume();
      
      // Optionally notify the backend that we're resuming
      if (wsRef.current && isWsOpenRef.current) {
        try {
          wsRef.current.send(JSON.stringify({
            type: "input_audio_buffer.resume"
          }));
        } catch (err) {
          logError("Failed to send resume message", err);
        }
      }
      
      setIsPaused(false);
    }
  }, []);

  // --- Visibility Handling --- 
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab became hidden
        console.log('[Visibility] Tab hidden. Current status:', status);
        if (status === 'connected' && !isPaused) { // Check if actively recording
          console.log('[Visibility] Pausing recording due to tab inactivity...');
          pausedByVisibilityRef.current = true; // Mark pause as visibility-related
          pauseRecording(); // Call the existing pause function
        }
      } else {
        // Tab became visible
        console.log('[Visibility] Tab visible. Current status:', status, 'Paused by visibility:', pausedByVisibilityRef.current);
        // Resume only if it was paused by visibility and hook wasn't manually paused
        if (pausedByVisibilityRef.current && isPaused) { 
            console.log('[Visibility] Resuming recording automatically...');
            resumeRecording();
        }
        // Always reset the flag when tab becomes visible
        pausedByVisibilityRef.current = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    console.log('[Visibility] Event listener added.');

    // Cleanup listener on unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      console.log('[Visibility] Event listener removed.');
    };
    // Dependencies: status and isPaused to check current state, pause/resume functions to call them
  }, [status, isPaused, pauseRecording, resumeRecording]); 
  // --- End Visibility Handling ---

  // Clean up resources on unmount
  useEffect(() => {
    return () => {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    status,
    error,
    transcript,
    isProcessing,
    language,
    isPaused,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording
  };
};

export default useSpeechToTextBackend; 