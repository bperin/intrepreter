import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import styled, { css } from "styled-components";
import { Theme } from "../theme";
import { useWebSocket } from "../hooks/useWebSocket";
import { useError } from "../context/ErrorContext";
import { useConversation } from "../context/ConversationContext";
// import useSpeechToText, { SttStatus } from "../hooks/useSpeechToText";
import useSpeechToTextBackend from "../hooks/useSpeechToTextBackend";
// import useTranslation from "../hooks/useTranslation";
import { useAuth } from '../context/AuthContext'; // <-- Import useAuth
// import Button from './common/Button'; // TODO: Fix Button import path issue
import { getSummaryKey } from '../helpers/summaryKey';
import api, { getMedicalHistory } from '../lib/api'; // <-- Ensure api (default export) is imported if needed elsewhere

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

const SenderLabel = styled.div<{ $isSender?: boolean } & ThemedProps>`
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    color: ${({ theme }) => theme.colors.text.secondary};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    margin-bottom: ${({ theme }) => theme.spacing.xs}; // Use xs instead of xxs
    text-align: ${({ $isSender }) => ($isSender ? "right" : "left")};
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

const BaseButton = styled.button<ThemedProps>`
    padding: 10px 20px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 15px;
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${({ theme }) => theme.spacing.xs};

    &:disabled {
        background-color: ${({ theme }) => theme.colors.text.secondary}30;
        border-color: ${({ theme }) => theme.colors.text.secondary}30;
        color: ${({ theme }) => theme.colors.text.secondary};
        cursor: not-allowed;
    }
`;

const EndSessionButton = styled(BaseButton)<ThemedProps>`
    background-color: ${({ theme }) => theme.colors.status.error}B3;
    color: white;
    border: 1px solid ${({ theme }) => theme.colors.status.error};

    &:hover:not(:disabled) {
        background-color: ${({ theme }) => theme.colors.status.error};
        border-color: ${({ theme }) => theme.colors.status.error};
    }
`;

// New Styled Mic Buttons
const MicControlButton = styled(BaseButton)<ThemedProps>`
    background-color: transparent;
    color: ${({ theme }) => theme.colors.text.primary};
    border: 1px solid ${({ theme }) => theme.colors.text.primary};

    &:hover:not(:disabled) {
        background-color: ${({ theme }) => theme.colors.text.primary};
        color: ${({ theme }) => theme.colors.background.primary};
        transform: translateY(-1px);
    }
     &:active:not(:disabled) {
        transform: translateY(0);
        opacity: 0.8;
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
    backendSenderType: string; // Store the original sender type (CLINICIAN, PATIENT, SYSTEM etc.)
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
        backendSenderType: msg.senderType,
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
    padding: ${({ theme }) => theme.spacing.md};
    overflow-y: auto;
    flex: 1;
    background-color: ${({ theme }) => theme.colors.background.primary};
    border-radius: ${({ theme }) => theme.borderRadius.md};
    line-height: 1.5;
    white-space: pre-wrap; // Preserve whitespace and newlines in summary
    
    /* Add animation for refreshing state to help with auto-updates */
    &.refreshing {
        animation: refresh-fade 0.5s ease;
    }
    
    @keyframes refresh-fade {
        0% { opacity: 0.7; }
        100% { opacity: 1; }
    }
`;

const MedicalHistoryArea = styled(SummaryArea)``; // Reuse SummaryArea styling for now

// --- End Tabs ---

const ChatInterface: React.FC = () => {
    console.log('[ChatInterface] Component Rendered.');
    const { user } = useAuth();
    const { showError } = useError();
    const { 
        selectedConversationId, 
        currentConversation,
        isSessionActive,
        endCurrentSession
    } = useConversation();
    const [messages, setMessages] = useState<DisplayMessage[]>([]);
    const [activeTab, setActiveTab] = useState<'chat' | 'summary' | 'history'>('chat');
    const [summaryContent, setSummaryContent] = useState<string | null>(null);
    const [medicalHistoryContent, setMedicalHistoryContent] = useState<string | null>(null);
    const [actions, setActions] = useState<any[]>([]);
    const [summaryRenderKey, setSummaryRenderKey] = useState<string>(getSummaryKey());
    const messageAreaRef = useRef<HTMLDivElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const summaryCacheKey = useMemo(() => getSummaryKey(), []);
    const clinicianUsername = useMemo(() => user?.username || 'Clinician', [user]);
    const patientName = useMemo(() => currentConversation?.patient?.firstName || 'Patient', [currentConversation]);

    const { sendMessage, lastMessage, isConnected, error } = useWebSocket();

    const handleNewMessage = useCallback((messageData: Message) => {
        console.log('🔵 [ChatInterface] STT handleNewMessage called with data:', JSON.stringify(messageData, null, 2));
        const displayMsg = convertToDisplayMessage(messageData);
        if (displayMsg) {
            setMessages(prev => [...prev, displayMsg]);
        }
    }, []);

    const playAudio = useCallback(async (audioData: ArrayBuffer) => {
        console.log('[PlayAudio] Attempting to play audio buffer, size:', audioData.byteLength);
        const context = getAudioContext();
        if (!context) {
            console.error('[PlayAudio] Cannot play audio, AudioContext not available.');
            showError("Audio context not available for playback.", "error");
            return;
        }
        // ... rest of playAudio logic ...
    }, [showError]);

    const getAudioContext = (): AudioContext | null => {
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch (e) {
                showError("Audio playback not supported.", "error"); return null;
            }
        }
        if (audioContextRef.current.state === "suspended") {
            audioContextRef.current.resume();
        }
        return audioContextRef.current;
    };

    const { 
        status: sttStatus, 
        error: sttError, 
        startRecording, 
        stopRecording, 
        pauseRecording, 
        resumeRecording, 
        isPaused: hookIsPaused 
    } = useSpeechToTextBackend(selectedConversationId);

    const scrollToBottom = useCallback(() => {
        if (messageAreaRef.current) {
            messageAreaRef.current.scrollTop = messageAreaRef.current.scrollHeight;
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    useEffect(() => {
        if (sttError) {
            console.error("[ChatInterface] STT Error:", sttError);
            showError(`Speech-to-text error: ${sttError.message}`, "error");
            const sttErrorMsg: DisplayMessage = {
                id: `stt-error-${Date.now()}`,
                sender: 'error',
                text: `STT Error: ${sttError.message}`,
                timestamp: new Date().toISOString(),
                backendSenderType: 'SYSTEM',
            };
            setMessages(prev => [...prev, sttErrorMsg]);
        }
    }, [sttError, showError]);

    useEffect(() => {
        console.log("[ChatInterface] STT Status:", sttStatus);
    }, [sttStatus]);

    useEffect(() => {
        console.log('[Effect Summary Content] Summary changed:', summaryContent);
        setSummaryRenderKey(getSummaryKey());
    }, [summaryContent]);

    useEffect(() => {
        if (selectedConversationId) {
            if (activeTab === 'summary') {
                console.log(`[ChatInterface] Summary tab active. Requesting summary for ${selectedConversationId}`);
                sendMessage(JSON.stringify({
                    type: 'get_summary',
                    payload: { conversationId: selectedConversationId }
                }));
            } else if (activeTab === 'history') {
                console.log(`[ChatInterface] History tab active. Fetching history for ${selectedConversationId}`);
                getMedicalHistory(selectedConversationId)
                    .then(data => {
                        console.log(`[ChatInterface] REST Received medical history:`, data);
                        setMedicalHistoryContent(data.content);
                    })
                    .catch(error => {
                        console.error(`[ChatInterface] Error fetching REST medical history:`, error);
                        sendMessage(JSON.stringify({
                            type: 'get_medical_history',
                            payload: { conversationId: selectedConversationId }
                        }));
                    });
            } else if (activeTab === 'chat') {
                // Maybe refetch messages if needed when switching back to chat?
                // sendMessage(JSON.stringify({ type: 'get_messages', payload: { conversationId: selectedConversationId } }));
            }
        }
    }, [activeTab, selectedConversationId, sendMessage]);

    useEffect(() => {
        console.log(`[Effect Auto Mic] Running. SelectedID: ${selectedConversationId}, SessionActive: ${isSessionActive}, STT Status: ${sttStatus}, IsPaused: ${hookIsPaused}`);
        if (selectedConversationId && isSessionActive) {
            if (summaryContent && summaryContent !== "Generating...") {
                console.log(`[Effect Auto Mic] Conversation ${selectedConversationId} appears finished. Preventing auto-start.`);
                if (sttStatus === 'connected' || sttStatus === 'connecting') {
                    stopRecording();
                }
                return;
            }

            if ((sttStatus === 'idle' || sttStatus === 'closed') && !hookIsPaused) {
                console.log(`[Effect Auto Mic] Session active (${selectedConversationId}), auto-starting STT recording...`);
                startRecording();
            } else {
                console.log(`[Effect Auto Mic] Session active but STT status is ${sttStatus} or recording is paused. No start action.`);
            }
        } else {
            if (sttStatus === 'connected' || sttStatus === 'connecting') { 
                console.log(`[Effect Auto Mic] Session inactive or deselected, stopping STT recording.`);
                stopRecording();
            }
        }
    }, [selectedConversationId, isSessionActive, sttStatus, startRecording, stopRecording, hookIsPaused, summaryContent]);

    useEffect(() => {
        if (selectedConversationId) {
            console.log(`🚀 [ChatInterface] useEffect[selectedConversationId] - RUNNING for ID: ${selectedConversationId}.`);
            console.log('🧹 [ChatInterface] Clearing previous state.');
            setMessages([]); 
            setSummaryContent(null);
            setMedicalHistoryContent(null);
            setActions([]);
            
            console.log('📤 [ChatInterface] Sending initial WS requests (messages, actions, history trigger).');
            sendMessage(JSON.stringify({
                type: 'get_messages',
                payload: { conversationId: selectedConversationId }
            }));
            sendMessage(JSON.stringify({ 
                type: 'get_actions',
                payload: { conversationId: selectedConversationId }
            }));
            const fetchAndTriggerHistory = async () => {
                 try {
                    const historyData = await getMedicalHistory(selectedConversationId);
                    console.log("[ChatInterface] Initial REST fetch medical history successful:", historyData);
                    setMedicalHistoryContent(historyData.content); 
                } catch (error) {
                    console.error("[ChatInterface] Initial error fetching medical history via REST:", error);
                } finally {
                     sendMessage(JSON.stringify({ type: "get_medical_history", payload: { conversationId: selectedConversationId } }));
                }
            };
            fetchAndTriggerHistory();

            setActiveTab('chat');
        } else {
            console.log('🧹 [ChatInterface] useEffect[selectedConversationId] - RUNNING for null ID. Clearing state.');
            setMessages([]); 
            setSummaryContent(null);
            setMedicalHistoryContent(null);
            setActions([]);
            setActiveTab('chat');
        }
    }, [selectedConversationId, sendMessage]);

    useEffect(() => {
        console.log('[WS Effect] Running. SelectedID:', selectedConversationId, 'lastMessage:', JSON.stringify(lastMessage)); 
        if (lastMessage && isBackendMessage(lastMessage)) {
            const message = lastMessage;
            console.log('[WS Effect] Processing type:', message.type);

            if (message.payload?.conversationId !== selectedConversationId) {
                 console.log(`[WS Effect] Ignoring message for different conversation (${message.payload?.conversationId})`);
                 return;
            }

            if (message.type === 'message_list' && message.payload?.messages) {
                console.log(`[WS Effect] Received message_list with ${message.payload.messages.length} messages.`);
                 const newDisplayMessages = message.payload.messages
                    .map(convertToDisplayMessage)
                    .filter((m: DisplayMessage | null): m is DisplayMessage => m !== null);
                 setMessages(newDisplayMessages); 
            } 
            else if (message.type === 'new_message' && message.payload) {
                 console.log('[WS Effect] Received new_message');
                 handleNewMessage(message.payload as Message);
            }
            else if (message.type === 'summary_data' && message.payload) {
                 console.log('[WS Effect] Received summary_data');
                 setSummaryContent(message.payload.summary);
            } 
            else if (message.type === 'action_list' && message.payload?.actions) {
                console.log('[WS Effect] Received action_list');
                setActions(message.payload.actions);
            }
            else if (message.type === 'medical_history_data' && message.payload) {
                 console.log('[WS Effect] Received medical_history_data');
                 setMedicalHistoryContent(message.payload.history);
            }
            else if ((message.type === 'system' || message.type === 'error') && message.text) {
                 const systemMsg: DisplayMessage = {
                     id: `sys-${Date.now()}`,
                     text: message.text,
                     sender: message.type === 'error' ? 'error' : 'system',
                     timestamp: new Date().toISOString(),
                     backendSenderType: 'SYSTEM',
                 };
                 setMessages(prev => [...prev, systemMsg]);
            }
            else if (message.type === 'interim_transcript' && message.payload) {
                 console.log('[WS Effect] Received interim_transcript');
                 // Example: update a temporary "typing" message or replace last interim
            }
             else if (message.type === 'final_transcript' && message.payload) {
                 console.log('[WS Effect] Received final_transcript');
                 handleNewMessage(message.payload as Message); 
            }
             else if (message.type === 'translation' && message.payload) {
                 console.log('[WS Effect] Received translation');
                 handleNewMessage(message.payload as Message); 
            }
             else if (message.type === 'conversation_selected') {
                  console.log('[WS Effect] Received conversation_selected confirmation');
                  // Update local state based on payload if needed (e.g., status)
             }
            else {
                 console.log(`[WS Effect] Received unhandled message type or invalid payload for known type: ${message.type}`);
            }
        } 
    }, [lastMessage, selectedConversationId, handleNewMessage]);

    const handleEndSession = async () => {
        console.log("[ChatInterface] handleEndSession called");
        if (selectedConversationId) {
            if (sttStatus === 'connected') {
                console.log('[ChatInterface] Stopping STT before ending session');
                stopRecording();
            }
            console.log('[ChatInterface] Ending session via context for:', selectedConversationId);
            await endCurrentSession();
            
            console.log('[ChatInterface] Switching to summary tab');
            setActiveTab('summary');
            
            setTimeout(() => {
                console.log('[ChatInterface] Requesting summary after end session timeout');
                sendMessage(JSON.stringify({
                    type: 'get_summary',
                    payload: { conversationId: selectedConversationId }
                }));
            }, 2000); 
        }
    };

    const renderContent = () => {
        if (!selectedConversationId) {
            return (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                    <NoSessionText>Select a conversation to view its messages</NoSessionText>
                </div>
            );
        }

        switch (activeTab) {
            case 'chat':
                return (
                    <MessageArea ref={messageAreaRef}>
                        {messages.map((msg, index) => (
                            <MessageGroup key={`${msg.id}-${index}`} $isSender={msg.sender === 'user'}>
                                <SenderLabel $isSender={msg.sender === 'user'}>
                                    {msg.sender === 'user' ? clinicianUsername : patientName}
                                </SenderLabel>
                                <Bubble $isSender={msg.sender === 'user'} $type={msg.sender === 'error' ? 'error' : undefined}>
                                    {msg.text}
                                </Bubble>
                                <MessageMeta>
                                    {new Date(msg.timestamp).toLocaleTimeString()} • {msg.language || 'unknown'}
                                </MessageMeta>
                            </MessageGroup>
                        ))}
                    </MessageArea>
                );
            case 'summary':
                return (
                    <SummaryArea key={summaryRenderKey}>
                        {summaryContent || "No summary available yet. End the session to generate a summary."}
                    </SummaryArea>
                );
            case 'history':
                return (
                    <MedicalHistoryArea>
                        {medicalHistoryContent || "No medical history available."}
                    </MedicalHistoryArea>
                );
            default:
                return <div>Unknown tab</div>;
        }
    };

    return (
        <ChatContainer>
            <TabContainer>
                <TabButton 
                    $isActive={activeTab === 'chat'} 
                    onClick={() => setActiveTab('chat')}>
                    Conversation
                </TabButton>
                <TabButton 
                    $isActive={activeTab === 'summary'} 
                    onClick={() => setActiveTab('summary')}>
                    Summary
                </TabButton>
                <TabButton 
                    $isActive={activeTab === 'history'} 
                    onClick={() => setActiveTab('history')}>
                    Medical History
                </TabButton>
            </TabContainer>

            <ContentArea>
                {renderContent()}
            </ContentArea>

            <ControlsArea>
                {selectedConversationId && isSessionActive && (
                    <>
                        {sttStatus === 'connected' ? (
                            <MicControlButton onClick={pauseRecording}>
                                Pause Mic
                            </MicControlButton>
                        ) : hookIsPaused ? (
                            <MicControlButton onClick={resumeRecording}>
                                Resume Mic
                            </MicControlButton>
                        ) : sttStatus !== 'connecting' && (
                            <MicControlButton onClick={startRecording}>
                                Start Mic
                            </MicControlButton>
                        )}
                        <EndSessionButton onClick={handleEndSession} disabled={!isSessionActive}>
                            End Session
                        </EndSessionButton>
                    </>
                )}
                {!selectedConversationId && (
                    <NoSessionText>Start or select a conversation to begin.</NoSessionText>
                )}
            </ControlsArea>

            <TopStatusContainer>
                {selectedConversationId && (
                    <SttStatusDisplay $status={sttStatus}>
                        {sttStatus === 'connected' ? 'Recording' : 
                         sttStatus === 'connecting' ? 'Connecting...' : 
                         sttStatus === 'error' || sttStatus === 'failed' ? 'Error' : 
                         hookIsPaused ? 'Paused' :
                         'Not Recording'}
                    </SttStatusDisplay>
                )}
                <SttStatusDisplay $status={isConnected ? 'connected' : 'disconnected'}>
                    {isConnected ? 'Server Connected' : 'Server Disconnected'}
                </SttStatusDisplay>
            </TopStatusContainer>
        </ChatContainer>
    );
};

export default ChatInterface;