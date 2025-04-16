import { useState, useEffect, useCallback, useRef } from 'react';
import { useActions } from '../context/ActionContext';
import { AggregatedAction } from '../types/actions';

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
    // Sanitize conversationId by removing any query string
    const sanitizedConversationId = conversationId.split('?')[0];
    // Use encodeURIComponent to safely append the sanitized conversationId
    return `${protocol}//${url.host}/transcription?conversationId=${encodeURIComponent(sanitizedConversationId)}`;
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

  // +++ Add ref to track intentional stops +++
  const intentionalStopRef = useRef<boolean>(false);

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
        // --- Ensure intentionalStopRef is false before closing previous --- 
        intentionalStopRef.current = false; 
        wsRef.current.close();
        wsRef.current = null;
        isWsOpenRef.current = false;
    }

    logDebug(`Initializing WebSocket connection to ${wsUrl}`);
    setStatus('connecting');
    // --- Reset error on new connection attempt --- 
    setError(null);

    try {
      // New code to append bearer token
      const token = localStorage.getItem('accessToken');
      if (!token) {
          logError("WebSocket: No access token, connection aborted.");
          setError(new Error("Authentication token is missing."));
          setStatus('failed');
          return;
      }
      const separator = wsUrl.includes('?') ? '&' : '?';
      const wsWithTokenUrl = `${wsUrl}${separator}token=${token}`;
      const ws = new WebSocket(wsWithTokenUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        logDebug("WebSocket connection to backend opened");
        isWsOpenRef.current = true;
        setStatus('connected');
         // --- Reset intentional stop flag on successful open --- 
         intentionalStopRef.current = false;
      };

      ws.onclose = (event) => {
        logDebug(`WebSocket connection closed: ${event.code} ${event.reason}`);
        isWsOpenRef.current = false;
        // --- Check for intentional stop --- 
        if (intentionalStopRef.current) {
            logDebug("WebSocket closed intentionally by stopRecording.");
            setStatus('idle'); // Set to idle after intentional stop
            intentionalStopRef.current = false; // Reset flag
        } else {
            logError(`WebSocket closed unexpectedly. Code: ${event.code}, Reason: ${event.reason}`);
            setError(new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason || 'Unknown reason'}`))
            setStatus('disconnected'); // Use a different status for unexpected closure
            // Optional: Trigger reconnection logic here if desired, but currently handled by ChatInterface effect
        }
      };

      ws.onerror = (event) => {
        logError("WebSocket error", event);
        // Check if it's an error event or just a general error object
        const errorMessage = (event instanceof ErrorEvent) ? event.message : "WebSocket connection error";
        setError(new Error(errorMessage));
        setStatus('error');
        isWsOpenRef.current = false; // Ensure state reflects connection is lost
        // --- Reset intentional stop flag on error too ---
        intentionalStopRef.current = false;
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
          else if (data.type === 'tts_audio' && data.payload && data.payload.audioBase64) { 
              logDebug('Received TTS audio data from backend.');
              // Access audioBase64 from the payload
              const audioBuffer = base64ToArrayBuffer(data.payload.audioBase64); 
              if (audioBuffer && onTtsAudio) {
                   logDebug('Calling onTtsAudio callback with decoded buffer.');
                   onTtsAudio(audioBuffer);
              } else if (!audioBuffer) {
                  logError('Failed to decode received TTS audio base64 data.');
              } else { logDebug('No onTtsAudio callback provided.'); }
          }
          // +++ Handle Command Execution Result +++
          else if (data.type === 'command_executed') {
              console.log('🚀 [useSpeechToTextBackend] ====== RECEIVED COMMAND_EXECUTED ====== ');
              const executionResult = data.payload; // Simplify variable name
              console.log('📄 [useSpeechToTextBackend] Payload:', JSON.stringify(executionResult, null, 2));

              if (executionResult?.status === 'success' && executionResult.payload?.type && executionResult.payload?.data) {
                  const { type: actionType, data: actionData } = executionResult.payload;
                  console.log(`✅ [useSpeechToTextBackend] Command successful. Type: ${actionType}, Extracted data:`, actionData);

                  // Construct the AggregatedAction object expected by the context
                  // We assume AggregatedAction might need properties directly from actionData
                  const newAggregatedAction: AggregatedAction = {
                      id: actionData.id, // From the specific entity data
                      type: actionType, // Explicit type from payload wrapper
                      conversationId: actionData.conversationId, // From the specific entity data
                      status: actionData.status, // From the specific entity data (e.g., 'created')
                      createdAt: actionData.createdAt, // From the specific entity data
                      updatedAt: actionData.updatedAt, // From the specific entity data
                      data: actionData, // Nest the original data object
                  };

                  // Check if essential fields are present after construction
                  if (!newAggregatedAction.id || !newAggregatedAction.createdAt || !newAggregatedAction.type) {
                      console.error('❌ [useSpeechToTextBackend] Failed to construct valid AggregatedAction from payload:', executionResult.payload);
                      return; // Don't proceed if essential fields are missing
                  }

                  if (onNewMessage) {
                      // Decide if onNewMessage should still be called, and what it should receive.
                      // Maybe it should receive the AggregatedAction? Or the raw data?
                      // For now, let's assume ActionContext handles the update via addAction.
                      console.log('🔵 [useSpeechToTextBackend] Skipping onNewMessage for command_executed, handled by addAction.');
                  }
                  // Call addAction from ActionContext
                  console.log('➕ [useSpeechToTextBackend] Calling addAction with constructed AggregatedAction...');
                  addAction(newAggregatedAction);
                  console.log('✅ [useSpeechToTextBackend] addAction callback executed.');

              } else if (executionResult?.status === 'error') {
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
      logError("Error creating WebSocket", err);
      setError(err instanceof Error ? err : new Error("Failed to create WebSocket"));
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
    logDebug('startRecording called');
    if (status === 'connected' || status === 'connecting') {
        logDebug('Already connected or connecting, ignoring startRecording call.');
        return;
    }
    // Reset state before starting
    setError(null);
    setTranscript('');
    accumulatedTranscriptRef.current = '';
    setIsPaused(false);
    intentionalStopRef.current = false; // Ensure flag is reset

    // 1. Initialize WebSocket
    initializeWebSocket(); // Establishes connection

    // 2. Get audio stream (moved after WS init)
    logDebug('Requesting microphone access...');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStreamRef.current = stream;
        logDebug('Microphone access granted.');

        // 3. Setup MediaRecorder
        if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
             console.warn('audio/webm;codecs=opus not supported, falling back to default.');
        }
        const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? { mimeType: 'audio/webm;codecs=opus' } 
            : {}; // Let browser choose default
        
        const recorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = async (event) => { // Make async to use await
            if (event.data.size > 0 && wsRef.current && isWsOpenRef.current) {
                logDebug(`Processing audio chunk, size: ${event.data.size}`);
                try {
                    // 1. Convert Blob to Base64
                    const base64Audio = await blobToBase64(event.data);
                    
                    // 2. Construct JSON message
                    const audioMessage = {
                        type: "input_audio_buffer.append",
                        audio: base64Audio
                    };
                    
                    // 3. Send stringified JSON
                    logDebug(`Sending audio chunk as JSON (Base64 size: ${base64Audio.length}).`);
                    wsRef.current.send(JSON.stringify(audioMessage));
                    
                } catch (error) {
                    logError("Error processing or sending audio chunk", error);
                    // Optionally notify the UI or handle the error
                }
            } else if (!wsRef.current || !isWsOpenRef.current) {
                logDebug('WebSocket not open, discarding audio chunk.');
                // Discard chunk if WS is not open
            }
        };

        recorder.onstop = () => {
            logDebug('MediaRecorder stopped.');
            // If WS still open, send any final buffered chunk (if buffering was implemented)
            // const finalBlob = new Blob(audioChunksRef.current, { type: options.mimeType });
            // if (finalBlob.size > 0 && wsRef.current && isWsOpenRef.current) { ... send finalBlob ... }
            audioChunksRef.current = [];
        };

        recorder.onerror = (event) => {
             logError('MediaRecorder error', event);
             //setError(new Error(`MediaRecorder error: ${event.error.name}`));
             //setStatus('error'); // Consider setting status
        };

        // Start recording, sending data periodically
        recorder.start(1000); // Send data every 1000ms (1 second)
        logDebug('MediaRecorder started.');

    } catch (err) {
        logError('Error getting media stream or starting recorder', err);
        setError(err instanceof Error ? err : new Error('Could not start recording'));
        setStatus('failed');
        // Clean up WS if media failed
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
            isWsOpenRef.current = false;
        }
    }
}, [initializeWebSocket, status]); // Include status

  /**
   * Stop recording and finalize
   */
  const stopRecording = useCallback(async () => {
    logDebug('stopRecording called');
    // --- Signal intentional stop --- 
    intentionalStopRef.current = true; 

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      logDebug('MediaRecorder stopping...');
    }
    
    // Stop audio stream tracks
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
      logDebug('Audio tracks stopped.');
    }

    // Close WebSocket connection
    if (wsRef.current) {
      logDebug('Closing WebSocket connection intentionally...');
      wsRef.current.close(1000, 'Client stopped recording'); // Use standard close code
      wsRef.current = null;
      isWsOpenRef.current = false;
    }
    
    // Reset state associated with recording
    // setStatus('idle'); // Let onclose handle setting status to idle
    setTranscript('');
    accumulatedTranscriptRef.current = '';
    setIsProcessing(false);
    setIsPaused(false); // Ensure pause state is reset
    // Don't reset error state here

  }, []); // No dependencies needed if it only uses refs and setters

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