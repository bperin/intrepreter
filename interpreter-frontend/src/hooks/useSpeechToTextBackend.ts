import { useState, useEffect, useCallback, useRef } from 'react';

export type SttStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' | 'error';

// Define the type for the new message callback function
// Adjust the 'any' to match your actual message object structure from the backend
type OnNewMessage = (message: any) => void; 

interface SpeechToTextResult {
  status: SttStatus;
  error: Error | null;
  transcript: string | null;
  isProcessing: boolean;
  language: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
}

/**
 * Hook for speech-to-text functionality using backend as a proxy to OpenAI.
 * This approach streams audio to our backend which then forwards it to OpenAI.
 * 
 * @param conversationId The ID of the current conversation.
 * @param onNewMessage Callback function triggered when the backend broadcasts a newly saved message.
 */
export const useSpeechToTextBackend = (
  conversationId: string | null,
  onNewMessage?: OnNewMessage // Add optional callback for new messages
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
  
  // Accumulated transcript ref
  const accumulatedTranscriptRef = useRef<string>('');

  // Constants for WebSocket connection
  const getBackendWsUrl = useCallback(() => {
    console.log(`[useSpeechToTextBackend] getBackendWsUrl called. Conversation ID: ${conversationId}`);
    if (!conversationId) return null;
    
    // Use secure WebSocket if on HTTPS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use environment variable for backend host, fallback to window location
    const backendHost = import.meta.env.VITE_BACKEND_WS_HOST || window.location.host;
    
    // Construct the WebSocket URL with query params
    return `${protocol}//${backendHost}/transcription?conversationId=${conversationId}`;
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
          const data = JSON.parse(event.data);
          logDebug("Received WebSocket message from backend", data);

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
          // --- End NEW Event Handling ---
          
          /* --- Remove OLD Event Handling ---
          // Handle transcription updates from OpenAI via backend
          if (data.type === 'transcription.partial') { ... }
          // Handle final transcription from OpenAI via backend
          if (data.type === 'transcription.final') { ... }
          */
          
        } catch (err) {
          logError("Error parsing WebSocket message", err);
        }
      };
    } catch (err) {
      logError("Failed to initialize WebSocket", err);
      setError(err instanceof Error ? err : new Error("Failed to initialize WebSocket"));
      setStatus('failed');
    }
  }, [getBackendWsUrl, onNewMessage, language]); // Update dependency array

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
      logDebug(`[useSpeechToTextBackend] Sending audio chunk (Base64 size: ${base64Audio.length})`);
      
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
      logDebug(`Starting MediaRecorder with timeslice: ${timeslice}ms`);
      mediaRecorderRef.current.start(timeslice);

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
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording
  };
};

export default useSpeechToTextBackend; 