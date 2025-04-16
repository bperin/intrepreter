import React, { useState, useRef, useEffect, useCallback } from "react";
import styled from "styled-components";
import { Theme } from "../theme";
import { useWebSocket } from "../hooks/useWebSocket";
import { useError } from "../context/ErrorContext";
import { useConversation } from "../context/ConversationContext";
// import useSpeechToText, { SttStatus } from "../hooks/useSpeechToText";
import useSpeechToTextBackend from "../hooks/useSpeechToTextBackend";
// import useTranslation from "../hooks/useTranslation";
// import { useAuth } from '../context/AuthContext'; // Removed unused import
// import Button from './common/Button'; // TODO: Fix Button import path issue

// Extend Window interface to include our custom property
declare global {
    interface Window {
        updateRtcStatus?: (status: string, error: Error | null) => void;
    }
}

// Update RTC context definition to use SttStatus
export const RtcContext = React.createContext<{
    status: string; // Changed from specific type to string
    error: Error | null;
}>({
    status: 'idle',
    error: null
});

type ThemedProps = { theme: Theme };

const ChatContainer = styled.div<ThemedProps>`
    flex: 1;
    display: flex;
    flex-direction: column;
    background-color: ${({ theme }) => theme.colors.background.primary};
    overflow: hidden;
    position: relative;
`;

const MessageArea = styled.div<ThemedProps>`
    flex: 1;
    overflow-y: auto;
    padding: ${({ theme }) => theme.spacing.xl};
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.md};

    /* Custom scrollbar */
    &::-webkit-scrollbar {
        width: 6px;
    }

    &::-webkit-scrollbar-track {
        background: ${({ theme }) => theme.colors.background.primary};
    }

    &::-webkit-scrollbar-thumb {
        background: ${({ theme }) => theme.colors.border.light};
        border-radius: ${({ theme }) => theme.borderRadius.full};
    }
`;

const MessageGroup = styled.div<{ $isSender?: boolean }>`
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.xs};
    align-self: ${({ $isSender }) => ($isSender ? "flex-end" : "flex-start")};
    max-width: 70%;
`;

const Bubble = styled.div<{ $isSender?: boolean; $type?: string } & ThemedProps>`
    padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
    border-radius: ${({ theme }) => theme.borderRadius.xl};
    background-color: ${({ $type, theme }) => {
        if ($type === "error") return theme.colors.status.error;
        if ($type === "system") return "rgba(0, 0, 0, 0.8)";
        return "#000000";
    }};
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: ${({ theme }) => theme.shadows.sm};
    word-wrap: break-word;
    transition: transform 0.2s ease;
    animation: fadeIn 0.5s ease;

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    &:hover {
        transform: translateY(-1px);
        border-color: rgba(255, 255, 255, 0.3);
    }
`;

const MessageMeta = styled.div<ThemedProps>`
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    color: ${({ theme }) => theme.colors.text.muted};
    margin-top: ${({ theme }) => theme.spacing.xs};
    padding: 0 ${({ theme }) => theme.spacing.sm};
`;

const ConnectionStatus = styled.div<ThemedProps & { $isConnected: boolean }>`
    position: absolute;
    top: ${({ theme }) => theme.spacing.sm};
    right: ${({ theme }) => theme.spacing.sm};
    padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
    border-radius: ${({ theme }) => theme.borderRadius.full};
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    background-color: ${({ $isConnected, theme }) => ($isConnected ? theme.colors.status.success : theme.colors.status.error)}20;
    color: ${({ $isConnected, theme }) => ($isConnected ? theme.colors.status.success : theme.colors.status.error)};
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.xs};
`;

// New container for top-right status indicators
const TopStatusContainer = styled.div`
    position: absolute;
    top: ${({ theme }) => theme.spacing.sm};
    right: ${({ theme }) => theme.spacing.sm};
    display: flex;
    gap: ${({ theme }) => theme.spacing.sm};
`;

// Renamed for clarity
const WsConnectionStatus = styled.div<ThemedProps & { $isConnected: boolean }>`
    padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
    border-radius: ${({ theme }) => theme.borderRadius.full};
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    background-color: ${({ $isConnected, theme }) => ($isConnected ? theme.colors.status.success : theme.colors.status.error)}20;
    color: ${({ $isConnected, theme }) => ($isConnected ? theme.colors.status.success : theme.colors.status.error)};
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.xs};
`;

// New styled component for STT status
const SttStatusDisplay = styled.div<ThemedProps & { $status: string }>`
    padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
    border-radius: ${({ theme }) => theme.borderRadius.full};
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    background-color: ${({ $status, theme }) => {
        switch ($status) {
            case 'connected': return theme.colors.status.success + '20';
            case 'connecting': return theme.colors.status.warning + '20';
            case 'error':
            case 'failed': return theme.colors.status.error + '20';
            default: return theme.colors.background.hover + '50'; // idle, closed, disconnected
        }
    }};
    color: ${({ $status, theme }) => {
        switch ($status) {
            case 'connected': return theme.colors.status.success;
            case 'connecting': return theme.colors.status.warning;
            case 'error':
            case 'failed': return theme.colors.status.error;
            default: return theme.colors.text.secondary;
        }
    }};
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.xs};
`;

const ControlsArea = styled.div<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.md};
    border-top: 1px solid ${({ theme }) => theme.colors.border.light};
    background-color: ${({ theme }) => theme.colors.background.secondary};
    display: flex;
    justify-content: center;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.md};
    min-height: 60px;
`;

const EndSessionButton = styled.button<ThemedProps>`
    padding: 10px 20px;
    background-color: ${({ theme }) => theme.colors.status.error}B3;
    color: white;
    border: 1px solid ${({ theme }) => theme.colors.status.error};
    border-radius: 4px;
    cursor: pointer;
    font-size: 15px;
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    transition: all 0.15s ease;

    &:hover {
        background-color: ${({ theme }) => theme.colors.status.error};
        border-color: ${({ theme }) => theme.colors.status.error};
    }

    &:disabled {
        background-color: ${({ theme }) => theme.colors.text.secondary}30;
        border-color: ${({ theme }) => theme.colors.text.secondary}30;
        color: ${({ theme }) => theme.colors.text.secondary};
        cursor: not-allowed;
    }
`;

const NoSessionText = styled.p<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
`;

// Define Message type based on Prisma schema and backend payload
interface Message { // Update this interface definition
    id: string;
    conversationId: string;
    timestamp: string; // Keep as string for simplicity from JSON
    senderType: string; // Use string, handle specific types in convertToDisplayMessage
    originalText: string; // This field holds the text content
    translatedText?: string | null;
    language?: string; // Language is present in backend data
    isFinal?: boolean; // isFinal is present in backend data
    // Remove contentType and content as they are not in the backend payload/schema
    // contentType: "TEXT" | "AUDIO_URL" | "ACTION_DATA"; 
    // content: string | any; 
    // originalMessageId?: string | null; // Keep if needed for linking translations/actions
}

// Refined Message interface for display
interface DisplayMessage {
    id: string;
    text: string;
    originalText?: string; // Store original for context if needed
    sender: "user" | "other" | "system" | "translation" | "error"; // Keep simple sender types for display logic
}

// Type guard for incoming WS messages
interface BackendMessage {
    type: string;
    text?: string;
    originalText?: string;
    translatedText?: string;
    id?: string;
    speaker?: "clinician" | "patient";
    payload?: any;
    // For message_list
    messages?: Message[];
    conversationId?: string;
}

function isBackendMessage(obj: any): obj is BackendMessage {
    return typeof obj === "object" && obj !== null && typeof obj.type === "string";
}

// --- Helper function to convert Base64 Data URL to ArrayBuffer ---
// (Ensure this function is outside the component or memoized if inside)
const base64ToArrayBuffer = (base64: string): ArrayBuffer | null => {
    // Corrected log statement syntax
    console.log('[Base64Decode] Attempting to decode base64 string (first 50 chars):', base64.substring(0, 50));
    try {
        const base64String = base64.split(",")[1] || base64;
        const binaryString = window.atob(base64String);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        console.log('[Base64Decode] Decoded successfully. Byte length:', bytes.buffer.byteLength);
        return bytes.buffer;
    } catch (error) {
        console.error("[Base64Decode] Error decoding Base64 string:", error);
        return null;
    }
};

// Helper to convert backend Message to DisplayMessage
const convertToDisplayMessage = (msg: Message): DisplayMessage | null => {
    console.log('🔄 [convertToDisplayMessage] Converting message:', JSON.stringify(msg, null, 2)); // Log input

    // Check if the input is a valid message object expected from backend
    if (!msg || typeof msg.originalText !== 'string' || typeof msg.senderType !== 'string' /* || typeof msg.language !== 'string' */) {
        console.warn('⚠️ [convertToDisplayMessage] Invalid message structure received:', msg);
        return null;
    }

    let textContent = msg.originalText; // Use originalText directly
    let sender: DisplayMessage["sender"] = "system"; // Default to system

    // Remove the logic based on contentType, as it's not in the Prisma model/backend payload
    /* 
    if (msg.contentType === "TEXT") { ... } 
    else if (msg.contentType === "ACTION_DATA") { ... } 
    else if (msg.contentType === "AUDIO_URL") { ... } 
    else { return null; } 
    */

    const msgSenderType = msg.senderType?.toUpperCase();
    const msgLang = msg.language?.toLowerCase() || 'unknown'; // Normalize language, default to unknown

    switch (msgSenderType) { 
        case "USER": // Clinician
        case "CLINICIAN": // Added potential alternative
            sender = "user";
            break;
        case "PATIENT":
            sender = "other";
            break;
        case "ASSISTANT": // Transcribed message from backend
            // Align based on language: Non-english maps to 'other' (patient/left), English maps to 'user' (clinician/right)
            sender = (msgLang === 'en' || msgLang === 'unknown') ? 'user' : 'other';
            console.log(`[convertToDisplayMessage] Assistant message language: ${msgLang}, setting sender to: ${sender}`);
            break;
        case "TRANSLATION":
            sender = "translation";
            // TODO: Handle translatedText if needed
            // textContent = msg.translatedText || textContent;
            break;
        case "SYSTEM":
        case "ACTION": 
            sender = "system";
            break;
        default:
            console.warn(`[convertToDisplayMessage] Unhandled senderType: ${msg.senderType}, defaulting to system.`);
            sender = "system"; // Fallback
    }

    return {
        id: msg.id,
        text: textContent,
        sender: sender,
    };
};

const ChatInterface: React.FC = () => {
    console.log('[ChatInterface] Component Rendered.'); // Log component render
    const { isConnected, lastMessage, sendMessage } = useWebSocket();
    const { showError } = useError();
    const {
        selectedConversationId,
        isSessionActive,
        endCurrentSession,
    } = useConversation();
    const messageAreaRef = useRef<HTMLDivElement>(null);
    const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
    const audioContextRef = useRef<AudioContext | null>(null);

    // Define getAudioContext FIRST
    const getAudioContext = (): AudioContext | null => {
        if (!audioContextRef.current) {
            try {
                console.log('[AudioContext] Creating new AudioContext...');
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                console.log('[AudioContext] AudioContext created, state:', audioContextRef.current.state);
            } catch (e) {
                console.error("[AudioContext] Web Audio API is not supported in this browser", e);
                showError("Audio playback not supported in this browser.", "error");
                return null;
            }
        }
        if (audioContextRef.current.state === "suspended") {
            console.log('[AudioContext] Resuming suspended AudioContext...');
            audioContextRef.current.resume().then(() => {
                console.log('[AudioContext] AudioContext resumed successfully.');
            }).catch((err) => console.error("[AudioContext] Error resuming AudioContext:", err));
        }
        return audioContextRef.current;
    };

    // Define playAudio SECOND (depends on getAudioContext)
    const playAudio = useCallback(async (audioData: ArrayBuffer) => {
        console.log('[PlayAudio] Attempting to play audio buffer, size:', audioData.byteLength);
        const context = getAudioContext();
        if (!context) {
            console.error('[PlayAudio] Cannot play audio, AudioContext not available.');
            showError("Audio context not available for playback.", "error");
            return;
        }
        if (context.state !== 'running') {
             console.warn(`[PlayAudio] AudioContext state is ${context.state}. Playback might require user interaction.`);
             context.resume(); 
        }
        try {
            console.log('[PlayAudio] Decoding audio data...');
            const audioBuffer = await context.decodeAudioData(audioData);
            console.log('[PlayAudio] Audio data decoded successfully. Duration:', audioBuffer.duration);
            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);
            console.log('[PlayAudio] Starting playback...');
            source.start(0);
            source.onended = () => {
                 console.log('[PlayAudio] Playback finished.');
            };
        } catch (error) {
            console.error("[PlayAudio] Error decoding or playing audio data:", error);
            showError("Failed to play received audio.", "error");
        }
    }, [showError]); // Dependency array only includes external dependencies like showError

    // Define handleNewMessage THIRD (might be used by the hook)
    const handleNewMessage = useCallback((messageData: any) => {
        console.log('🔵 [ChatInterface] handleNewMessage called with data:', JSON.stringify(messageData, null, 2));
        
        // Check if the messageData is a valid Message object
        if (!messageData || !messageData.id || !messageData.conversationId) {
            console.warn('⚠️ [ChatInterface] Invalid message data received:', messageData);
            return;
        }

        try {
            const displayMsg = convertToDisplayMessage(messageData);
            console.log('🔵 [ChatInterface] Converted to DisplayMessage:', displayMsg);
            
            if (displayMsg) {
                console.log('✅ [ChatInterface] Adding new message to display:', displayMsg);
                setDisplayMessages(prev => {
                    console.log('📋 [ChatInterface] Current messages:', prev.length);
                    const newMessages = [...prev, displayMsg];
                    console.log('📋 [ChatInterface] New messages length:', newMessages.length);
                    return newMessages;
                });
            } else {
                console.warn('⚠️ [ChatInterface] convertToDisplayMessage returned null');
            }
        } catch (error) {
            console.error('❌ [ChatInterface] Error processing new message:', error);
        }
    }, []); // Empty dependency array if it doesn't rely on changing component state/props

    // Call useSpeechToTextBackend LAST (depends on handleNewMessage and playAudio)
    const { 
        status, 
        error, 
        transcript, 
        isProcessing,
        language,
        startRecording,
        stopRecording, 
        pauseRecording, 
        resumeRecording, 
    } = useSpeechToTextBackend(selectedConversationId, handleNewMessage, playAudio); // Correct types should now match

    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);

    const scrollToBottom = useCallback(() => {
        if (messageAreaRef.current) {
            messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight;
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [displayMessages, scrollToBottom]);

    useEffect(() => {
        if (transcript !== null) {
            console.log('📝 [ChatInterface] Transcript updated:', transcript);
        }
    }, [transcript]);

    useEffect(() => {
        if (error) {
            console.error("[ChatInterface] STT Error:", error);
            showError(`Speech-to-text error: ${error.message}`, "error");
            const sttErrorMsg: DisplayMessage = {
                id: `stt-error-${Date.now()}`,
                sender: 'error',
                text: `STT Error: ${error.message}`,
            };
            setDisplayMessages(prev => [...prev, sttErrorMsg]);
        }
    }, [error, showError]);

    useEffect(() => {
        console.log("[ChatInterface] STT Status:", status);
        if (status === 'failed' || status === 'error') {
        } else if (status === 'closed' || status === 'disconnected') {
             setIsRecording(false);
             setIsPaused(false);
        }
    }, [status]);

    // --- Re-add Effect to automatically start/stop recording on session change --- 
    useEffect(() => {
        // Only act if a conversation is selected and the session is marked active
        if (selectedConversationId && isSessionActive) {
            // Start recording only if STT is currently idle or closed
            if (status === 'idle' || status === 'closed') {
                console.log(`[ChatInterface] Session active (${selectedConversationId}), auto-starting STT recording...`);
                startRecording(); 
                // We might not need local isRecording state if UI doesn't depend on it directly anymore
            }
        } else {
            // Stop recording if no conversation is selected or session is inactive
            // Check status to avoid stopping if already stopped/idle
            if (status === 'connected' || status === 'connecting') { 
                console.log(`[ChatInterface] Session inactive or deselected, stopping STT recording.`);
                stopRecording();
            }
        }
        // Ensure start/stop recording functions from the hook are stable (useCallback) 
        // and include them if their identity can change. Status is needed to prevent restart loops.
    }, [selectedConversationId, isSessionActive, status, startRecording, stopRecording]);

    // Effect to fetch historical messages when conversation changes
    useEffect(() => {
        if (selectedConversationId) {
            console.log(`🚀 [ChatInterface] useEffect[selectedConversationId] - RUNNING for ID: ${selectedConversationId}. Fetching messages...`);
            // Clear messages from previous conversation
            console.log('🧹 [ChatInterface] useEffect[selectedConversationId] - Clearing previous messages.');
            setDisplayMessages([]); 
            
            // Send request via control channel WebSocket
            console.log('📤 [ChatInterface] Sending get_messages request.');
            sendMessage({
                type: 'get_messages',
                payload: { conversationId: selectedConversationId }
            });
        } else {
            console.log('🧹 [ChatInterface] useEffect[selectedConversationId] - RUNNING for null ID. Clearing messages.');
            setDisplayMessages([]); // Clear messages if no conversation is selected
        }
    }, [selectedConversationId, sendMessage]); // Depend on selection and sendMessage function

    const handleEndSession = () => {
        if (selectedConversationId) {
            console.log(`[ChatInterface] User initiated end session for ${selectedConversationId}`);
            sendMessage({ type: 'end_session', payload: { conversationId: selectedConversationId } });
            if (isRecording) {
                stopRecording();
                setIsRecording(false);
                setIsPaused(false);
            }
        } else {
            console.warn("[ChatInterface] Cannot end session: No conversation selected.");
            showError("No active session to end.", "warning");
        }
    };

    // Effect to handle incoming WebSocket messages
    useEffect(() => {
        console.log('[WS Effect] Running. SelectedID:', selectedConversationId, 'lastMessage:', JSON.stringify(lastMessage)); // Log selected ID too
        if (lastMessage && isBackendMessage(lastMessage)) {
            const message = lastMessage;
            console.log('[WS Effect] Processing type:', message.type);

            // Check payload for message_list data
            if (message.type === 'message_list' && message.payload) {
                console.log('[WS Effect] Received message_list payload:', message.payload);
                // Log IDs for comparison
                console.log(`[WS Effect] Comparing received ConvID (${message.payload.conversationId}) with selected ConvID (${selectedConversationId})`);
                
                if (message.payload.messages && message.payload.conversationId === selectedConversationId) {
                    console.log(`[ChatInterface] ConvID match. Processing ${message.payload.messages.length} historical messages.`);
                    const messagesArray = message.payload.messages as Message[]; 
                    if (!Array.isArray(messagesArray)) {
                        console.error('[ChatInterface] Error: message.payload.messages is not an array!');
                        return;
                    }

                    const mapMessageToDisplay = (msg: Message): DisplayMessage | null => {
                        return convertToDisplayMessage(msg);
                    };

                    const newDisplayMessages = messagesArray
                        .map(mapMessageToDisplay)
                        .filter((msg): msg is DisplayMessage => msg !== null);
                    console.log(`[ChatInterface] Converted historical messages:`, newDisplayMessages); 
                    setDisplayMessages(newDisplayMessages); 
                    console.log(`[ChatInterface] Called setDisplayMessages with ${newDisplayMessages.length} historical messages.`);
                } else {
                     console.log('[ChatInterface] message_list received, but ConvID mismatch or no messages array.');
                }
            }

            // ... other message type handling ...

        } else {
            // console.log('[WS Effect] lastMessage is null or not a BackendMessage.');
        }
    }, [lastMessage, selectedConversationId, showError, endCurrentSession, sendMessage]);

    // Effect to scroll message area
    useEffect(() => {
        scrollToBottom();
    }, [displayMessages, scrollToBottom]);

    // Effect to log transcript changes (Debug)
    useEffect(() => {
        if (transcript !== null) {
            console.log('📝 [ChatInterface] Transcript updated:', transcript);
        }
    }, [transcript]);

    // Effect to show STT errors
    useEffect(() => {
        if (error) {
            console.error("[ChatInterface] STT Error:", error);
            showError(`Speech-to-text error: ${error.message}`, "error");
            const sttErrorMsg: DisplayMessage = {
                id: `stt-error-${Date.now()}`,
                sender: 'error',
                text: `STT Error: ${error.message}`,
            };
            setDisplayMessages(prev => [...prev, sttErrorMsg]);
        }
    }, [error, showError]);

    // Effect to react to STT status changes
    useEffect(() => {
        console.log("[ChatInterface] STT Status:", status);
        if (status === 'failed' || status === 'error') {
            // Optionally add a system message or indicator
        } else if (status === 'closed' || status === 'disconnected') {
             // Reset recording state if connection closes unexpectedly
             setIsRecording(false); 
             setIsPaused(false);
        }
    }, [status]);

    return (
        <ChatContainer>
            <TopStatusContainer>
                <WsConnectionStatus $isConnected={isConnected}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'currentColor', display: 'inline-block' }}></span>
                    Backend: {isConnected ? "Connected" : "Disconnected"}
                </WsConnectionStatus>
                {isSessionActive && (
                    <SttStatusDisplay $status={status}>
                         {/* Optional: Add an icon based on status */} 
                        Mic: {status} {isRecording && !isPaused && '🔴'} {isPaused && '⏸️'} {isProcessing && '...'}
                        {/* {error ? `(${error.message})` : ''} */}
                    </SttStatusDisplay>
                )}
            </TopStatusContainer>

            <MessageArea ref={messageAreaRef}>
                {displayMessages.length === 0 && !isSessionActive && (
                    <NoSessionText>Select or start a new conversation to begin.</NoSessionText>
                )}
                 {displayMessages.length === 0 && isSessionActive && (
                    <NoSessionText>Session active. Start speaking or wait for messages.</NoSessionText>
                )}
                {(() => { // Wrap log in an IIFE or similar structure
                    console.log('[ChatInterface] About to map messages. Count:', displayMessages.length, 'Value:', JSON.stringify(displayMessages)); // Stringify for better logging
                    return null; // Return null so nothing renders here
                })()}
                {displayMessages.map((msg, index) => {
                    console.log(`[ChatInterface] Rendering message ${index + 1}/${displayMessages.length}:`, msg);
                    return (
                        <MessageGroup key={msg.id || index} $isSender={msg.sender === "user"}>
                            <Bubble $isSender={msg.sender === "user"} $type={msg.sender === "error" ? "error" : msg.sender === "system" ? "system" : undefined}>
                                {msg.text}
                                {msg.sender === 'translation' && msg.originalText && (
                                    <MessageMeta>Original: {msg.originalText}</MessageMeta>
                                )}
                            </Bubble>
                        </MessageGroup>
                    );
                })}
                 {isRecording && transcript && (
                      <MessageGroup key="live-transcript">
                          <Bubble $type="system">
                              <i>Live: {transcript}</i> {isProcessing ? '...' : ''} {language ? `(${language})` : ''}
                              {/* Debug info */}
                              <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
                                  {displayMessages.length} messages in state
                              </div>
                          </Bubble>
                      </MessageGroup>
                 )}
            </MessageArea>

            <ControlsArea>
                {!isSessionActive ? (
                    <NoSessionText>No active session.</NoSessionText>
                ) : (
                    <>
                        {/* Pause/Resume might still be needed, but let's simplify first */}

                        {/* Keep Stop and End Session */}
                        <button 
                            onClick={stopRecording} 
                            disabled={status !== 'connected' && status !== 'connecting'} // Disable if not connected or connecting
                        > 
                           Stop Mic 
                        </button>
                        <EndSessionButton 
                            onClick={handleEndSession} 
                            disabled={!isSessionActive}
                        >
                            End Session
                        </EndSessionButton>
                    </>
                )}
            </ControlsArea>
        </ChatContainer>
    );
};

export default ChatInterface;
