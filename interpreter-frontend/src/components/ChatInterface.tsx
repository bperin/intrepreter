import React, { useState, useRef, useEffect, useCallback } from "react";
import styled, { css } from "styled-components";
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

const TopStatusContainer = styled.div`
    position: absolute;
    top: ${({ theme }) => theme.spacing.sm};
    right: ${({ theme }) => theme.spacing.sm};
    display: flex;
    gap: ${({ theme }) => theme.spacing.sm};
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
    originalMessageId?: string | null; // <-- Add this field
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
    language?: string; // Language of this specific message
    timestamp: string;
    originalMessageId?: string | null; // Link to the original message if this is a translation
    sourceLanguage?: string | null; // Optional: Store the source language (might derive at render time)
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

    if (!msg || typeof msg.originalText !== 'string' || typeof msg.senderType !== 'string' || typeof msg.timestamp !== 'string') {
        console.warn('⚠️ [convertToDisplayMessage] Invalid message structure received (missing required fields):', msg);
        return null;
    }

    let textContent = msg.translatedText || msg.originalText; // Prefer translated text if available
    let sender: DisplayMessage["sender"] = "system"; // Default
    const msgSenderType = msg.senderType?.toUpperCase();
    const msgLang = msg.language?.toLowerCase() || 'unknown';

    // --- Strict Language Alignment Logic ---
    switch (msgSenderType) {
        case "SYSTEM":
        case "ACTION":
            sender = "system"; // Keep system messages as system (usually left)
            textContent = msg.originalText; // System messages use original text
            break;
        case "ERROR":
            sender = "error"; // Keep error messages as error (usually left)
            textContent = msg.originalText; // Error messages use original text
            break;
        // For USER, PATIENT, TRANSLATION - alignment depends ONLY on language
        default:
            if (msgLang === 'en') {
                sender = "user"; // English -> Right align
            } else {
                sender = "other"; // Other language -> Left align
            }
            // Use translated text if sender was TRANSLATION, otherwise original
            textContent = (msgSenderType === "TRANSLATION" && msg.translatedText) ? msg.translatedText : msg.originalText;
            break;
    }
    // --- End Strict Language Alignment Logic ---

    return {
        id: msg.id,
        text: textContent,
        sender: sender,
        language: msg.language, // Keep language info for metadata
        timestamp: msg.timestamp,
        originalMessageId: msg.originalMessageId,
    };
};

// --- Added for Tabs ---
const TabContainer = styled.div<ThemedProps>`
  display: flex;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light};
    padding: 0 ${({ theme }) => theme.spacing.lg};
    background-color: ${({ theme }) => theme.colors.background.secondary};
`;

const TabButton = styled.button<{ $isActive: boolean } & ThemedProps>`
    padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
    border: none;
    background-color: transparent;
    color: ${({ theme, $isActive }) => $isActive ? theme.colors.text.primary : theme.colors.text.secondary};
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    position: relative;
    font-weight: ${({ theme, $isActive }) => $isActive ? theme.typography.weights.bold : theme.typography.weights.normal};

    &::after {
        content: '';
        position: absolute;
        bottom: -1px; // Align with the container border
        left: 0;
        right: 0;
        height: 2px;
        background-color: ${({ theme }) => theme.colors.text.primary};
        transform: scaleX(${({ $isActive }) => $isActive ? 1 : 0});
        transition: transform 0.2s ease-in-out;
    }

    &:hover {
        color: ${({ theme }) => theme.colors.text.primary};
    }
`;

const ContentArea = styled.div`
    flex: 1;
    display: flex; // Make it flex to contain MessageArea/SummaryArea
    flex-direction: column;
    overflow: hidden; // Prevent content overflow
`;

const SummaryArea = styled.div<ThemedProps>`
    flex: 1;
    overflow-y: auto;
    padding: ${({ theme }) => theme.spacing.xl};
    white-space: pre-wrap; // Preserve formatting
    line-height: 1.6;
    color: ${({ theme }) => theme.colors.text.primary};
    font-family: ${({ theme }) => theme.typography.fontFamily};
`;
// --- End Tabs ---

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
    const [activeTab, setActiveTab] = useState<'chat' | 'summary'>('chat');
    const [currentSummary, setCurrentSummary] = useState<string | null>(null);
    const [patientLanguage, setPatientLanguage] = useState<string | null>(null);
    const [processingStatus, setProcessingStatus] = useState<'idle' | 'transcribing' | 'translating'>('idle');

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

        // *** Added Debug Logging ***
        console.log(`[PlayAudio Debug] AudioContext state BEFORE decode: ${context.state}`);

        if (context.state !== 'running') {
             console.warn(`[PlayAudio] AudioContext state is ${context.state}. Playback might require user interaction.`);
             context.resume(); // Attempt to resume if suspended
        }

        try {
            console.log('[PlayAudio] Decoding audio data...');
            const audioBuffer = await context.decodeAudioData(audioData);
            console.log('[PlayAudio Debug] Audio data decoded successfully. Duration:', audioBuffer.duration);

            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);

            // *** Added Debug Logging ***
            console.log(`[PlayAudio Debug] AudioContext state BEFORE source.start: ${context.state}`);

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
        isPaused: hookIsPaused,
        startRecording,
        stopRecording, 
        pauseRecording, 
        resumeRecording, 
    } = useSpeechToTextBackend(selectedConversationId, handleNewMessage, playAudio); // Correct types should now match

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
                timestamp: new Date().toISOString(),
            };
            setDisplayMessages(prev => [...prev, sttErrorMsg]);
        }
    }, [error, showError]);

    useEffect(() => {
        console.log("[ChatInterface] STT Status:", status);
        if (status === 'failed' || status === 'error') {
        } else if (status === 'closed' || status === 'disconnected') {
            // No local state to set anymore
        }
    }, [status]);

    // Effect to automatically start/stop recording on session change
    useEffect(() => {
        console.log(`[Effect Auto Mic] Running. SelectedID: ${selectedConversationId}, SessionActive: ${isSessionActive}, STT Status: ${status}, IsPaused: ${hookIsPaused}`);
        // Only act if a conversation is selected and the session is marked active
        if (selectedConversationId && isSessionActive) {
            // <<< ADDED CHECK >>>: Don't auto-start if conversation is already finished
            if (currentSummary === 'summarized' || currentSummary === 'ended' || currentSummary === 'ended_error') {
                 console.log(`[Effect Auto Mic] Conversation ${selectedConversationId} has status ${currentSummary}. Preventing auto-start.`);
                 // If STT is somehow running, stop it
                 if (status === 'connected' || status === 'connecting') {
                     console.log(`[Effect Auto Mic] Stopping STT for finished conversation.`);
                     stopRecording();
                 }
                 return; // Do not proceed to start recording
            }
            // <<<<<<<<<<<<<<<<<<

            // Start recording only if STT is currently idle or closed
            if ((status === 'idle' || status === 'closed') && !hookIsPaused) {
                console.log(`[Effect Auto Mic] Session active (${selectedConversationId}), auto-starting STT recording...`);
                startRecording(); 
            } else if (hookIsPaused) {
                console.log(`[Effect Auto Mic] Session active but recording is paused. No action.`);
            } else {
                console.log(`[Effect Auto Mic] Session active but STT status is ${status}. No action.`);
            }
        } else {
            // Stop recording if no conversation is selected or session is inactive
            if (status === 'connected' || status === 'connecting') { 
                console.log(`[Effect Auto Mic] Session inactive or deselected, stopping STT recording.`);
                stopRecording();
            }
        }
    }, [selectedConversationId, isSessionActive, status, startRecording, stopRecording, hookIsPaused, currentSummary]);

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

            // --- Update conversation_selected handler --- 
            else if (message.type === 'conversation_selected') {
                console.log('[WS Effect] Handling conversation_selected:', message.payload);
                const { summary, patientLanguage: lang } = message.payload || {}; 
                console.log(`[WS Effect] Received Summary data type: ${typeof summary}, value:`, summary); // Log summary details
                console.log(`[WS Effect] Received Patient Language: ${lang}`);
                setCurrentSummary(summary || null);
                setPatientLanguage(lang || null);
                setActiveTab('chat');
            }
            // --- End updated handler ---

            // --- Update session_ended_and_summarized handler ---
            else if (message.type === 'session_ended_and_summarized') {
                console.log('[WS Effect] Handling session_ended_and_summarized:', message.payload);
                const { summary } = message.payload || {};
                console.log(`[WS Effect] Received Summary data type: ${typeof summary}, value:`, summary); // Log summary details
                setCurrentSummary(summary || null);
                if (summary) {
                     setActiveTab('summary');
                }
            }
            // --- End updated handler ---

            // +++ Add handler for summary_data +++
            else if (message.type === 'summary_data') {
                console.log('[WS Effect] Handling summary_data:', message.payload);
                const { summary, conversationId } = message.payload || {};
                // Update summary only if it pertains to the currently selected conversation
                if (conversationId && conversationId === selectedConversationId) {
                    console.log(`[WS Effect] Updating summary state for ${conversationId}`);
                    setCurrentSummary(summary || null);
                } else {
                     console.log(`[WS Effect] Received summary_data for non-selected conversation (${conversationId}). Ignoring.`);
                }
            }
            // +++ End handler +++

            else if (message.type === 'new_message') {
                // ... (existing new_message handling)
            }

            // +++ Add handlers for processing status +++
            else if (message.type === 'transcription_started') {
                console.log('[WS Effect] Handling transcription_started');
                setProcessingStatus('transcribing');
            } else if (message.type === 'translation_started') {
                console.log('[WS Effect] Handling translation_started');
                setProcessingStatus('translating');
            } else if (message.type === 'processing_completed') {
                console.log('[WS Effect] Handling processing_completed');
                setProcessingStatus('idle');
            }
            // +++ End processing status handlers +++

            // ... (rest of message handlers: tts_audio, error, etc.)

        } else {
            // console.log('[WS Effect] lastMessage is null or not a BackendMessage.');
        }
    }, [lastMessage, selectedConversationId, showError, endCurrentSession, sendMessage]);

    // Effect to reset summary/status when conversation changes
    useEffect(() => {
        console.log('[Effect selectedConversationId] Resetting summary and language for new/no selection.');
        setCurrentSummary(null);
        setPatientLanguage(null);
        setProcessingStatus('idle');
        setActiveTab('chat');
        
        if (selectedConversationId) {
            console.log(`🚀 [ChatInterface] useEffect[selectedConversationId] - Fetching messages for ID: ${selectedConversationId}`);
            setDisplayMessages([]); 
            sendMessage({
                type: 'get_messages',
                payload: { conversationId: selectedConversationId }
            });
        } else {
            console.log('🧹 [ChatInterface] useEffect[selectedConversationId] - Clearing messages.');
            setDisplayMessages([]); 
        }
        // Update dependency array if needed
    }, [selectedConversationId, sendMessage]);

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

    // Effect to react to STT status changes
    useEffect(() => {
        console.log("[ChatInterface] STT Status:", status);
        if (status === 'failed' || status === 'error') {
            // Optionally add a system message or indicator
        } else if (status === 'closed' || status === 'disconnected') {
            // No local state to reset here
        }
    }, [status]);

    const handleEndSession = () => {
        if (selectedConversationId) {
            console.log(`[ChatInterface] User initiated end session for ${selectedConversationId}`);
            // TODO: Add UI feedback like disabling button, showing spinner
            sendMessage({ type: 'end_session', payload: { conversationId: selectedConversationId } });
        }
        // ... (rest of handler)
    };

    // Function to handle clicking the summary tab
    const handleSelectSummaryTab = useCallback(() => {
        console.log('[handleSelectSummaryTab] Clicked. Current summary:', currentSummary);
        setActiveTab('summary');
        // If summary isn't loaded yet and a conversation is selected, request it
        if (currentSummary === null && selectedConversationId) {
             console.log(`[handleSelectSummaryTab] Summary not loaded. Requesting for ${selectedConversationId}...`);
             sendMessage({ 
                 type: 'get_summary', 
                 payload: { conversationId: selectedConversationId } 
             });
        }
    }, [currentSummary, selectedConversationId, sendMessage]); // Dependencies

    // Remove showTabs calculation
    // const showTabs = currentConvStatus === 'summarized' || currentConvStatus === 'ended_error';
    // console.log(`[Render] currentConvStatus: ${currentConvStatus}, showTabs: ${showTabs}`);
    console.log(`[Render] SelectedID: ${selectedConversationId}, ActiveTab: ${activeTab}, currentSummary:`, currentSummary); // Simplified log

    return (
            <ChatContainer>
            <TopStatusContainer>
                {isSessionActive && (
                    <SttStatusDisplay $status={status}>
                         {/* Optional: Add an icon based on status */} 
                        Mic: {status} {hookIsPaused && '⏸️'} {isProcessing && '...'}
                        {patientLanguage && ` (Lang: ${patientLanguage})`}
                        {/* {error ? `(${error.message})` : ''} */}
                    </SttStatusDisplay>
                )}
            </TopStatusContainer>

            {/* Always render Tabs if a conversation is selected */} 
            {selectedConversationId && (
                <TabContainer>
                    <TabButton $isActive={activeTab === 'chat'} onClick={() => setActiveTab('chat')}>Chat</TabButton>
                    <TabButton $isActive={activeTab === 'summary'} onClick={handleSelectSummaryTab}>Summary</TabButton>
                </TabContainer>
            )}
            
            {/* Content Area: Switches between Chat and Summary */} 
            <ContentArea>
                {/* Show MessageArea if no conversation selected OR chat tab is active */} 
                {(!selectedConversationId || activeTab === 'chat') && (
                     <MessageArea ref={messageAreaRef}>
                        {displayMessages.length === 0 && !selectedConversationId && (
                            <NoSessionText>Select or start a new conversation to begin.</NoSessionText>
                        )}
                         {displayMessages.length === 0 && selectedConversationId && (
                            <NoSessionText>Session selected. Messages loading or none exist yet.</NoSessionText>
                        )}
                         {(() => { // Wrap log in an IIFE or similar structure
                            console.log('[ChatInterface] About to map messages. Count:', displayMessages.length, 'Value:', JSON.stringify(displayMessages)); // Stringify for better logging
                            return null; // Return null so nothing renders here
                        })()}
                        {displayMessages.map((msg, index) => {
                            console.log(`[ChatInterface] Rendering message ${index + 1}/${displayMessages.length}:`, msg);
                            // Simple time formatting (HH:MM)
                            let formattedTime = '';
                            let metaText = '';
                            try {
                                formattedTime = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            } catch (e) {
                                console.error("Error formatting timestamp:", msg.timestamp, e);
                                formattedTime = msg.timestamp; // Fallback to raw string
                            }

                            // Determine metadata text (Language or Translation source)
                            if (msg.originalMessageId) {
                                // It's likely a translation, find the original message
                                const originalMsg = displayMessages.find(m => m.id === msg.originalMessageId);
                                if (originalMsg && originalMsg.language) {
                                    metaText = `(Translated from: ${originalMsg.language})`;
                                } else {
                                    // Fallback if original not found or has no language
                                    metaText = `(Translation - Lang: ${msg.language || '??'})`; 
                                }
                            } else if (msg.language) {
                                // Original message with language
                                metaText = `(Lang: ${msg.language})`;
                            }

                            // Combine time and meta text
                            const fullMeta = `${formattedTime} ${metaText}`.trim();

                            return (
                                <MessageGroup key={msg.id || index} $isSender={msg.sender === "user"}>
                                    <Bubble $isSender={msg.sender === "user"} $type={msg.sender === "error" ? "error" : msg.sender === "system" ? "system" : undefined}>
                                        {msg.text}
                                    </Bubble>
                                    {/* Message Meta: Timestamp and Language/Translation Info */}
                                    <MessageMeta>{fullMeta}</MessageMeta>
                                </MessageGroup>
                            );
                        })}
                         {/* +++ Add Processing Status Indicator +++ */} 
                        {processingStatus !== 'idle' && (
                            <MessageGroup key="processing-status" $isSender={false}> {/* Align left */} 
                                <Bubble $type="system"> 
                                    <i>
                                        {processingStatus === 'transcribing' && 'Transcribing...'}
                                        {processingStatus === 'translating' && 'Translating...'}
                                        {/* Add more states here if needed */} 
                                    </i>
                            </Bubble>
                        </MessageGroup>
                        )}
                        {/* +++ End Indicator +++ */} 
                </MessageArea>
                )}
                
                {/* Show SummaryArea only if conversation selected AND summary tab is active */} 
                {(selectedConversationId && activeTab === 'summary') && (
                    <SummaryArea>
                        {(() => {
                            console.log(`[Render SummaryArea] Rendering summary. currentSummary:`, currentSummary);
                            return currentSummary || 'Summary not available.';
                        })()}
                    </SummaryArea>
                )}
            </ContentArea>

                <ControlsArea>
                {!isSessionActive ? (
                    <NoSessionText>No active session.</NoSessionText>
                ) : (
                    <>
                        {/* Conditionally render Pause/Resume buttons */} 
                        {(status === 'connected' && !hookIsPaused) ? (
                            <button onClick={pauseRecording}>
                                Pause Mic ⏸️
                            </button>
                        ) : null}
                        {(status === 'connected' && hookIsPaused) ? (
                            <button onClick={resumeRecording}>
                                Resume Mic ▶️
                            </button>
                        ) : null}

                        {/* End Session Button */}
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
