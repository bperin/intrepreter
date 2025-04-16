import React, { createContext, useState, useContext, ReactNode, useMemo, useCallback, useEffect, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import api from "../lib/api";

// Reuse the Conversation type definition (ensure it's exported from where it's defined, or redefine/import)
// Assuming it might be defined elsewhere, let's redefine for clarity here.
// Ideally, share types from a common location.
interface Patient {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
}

// Interface matching the backend payload structure
interface BackendConversation {
    id: string;
    userId: string;
    patientId: string;
    startTime: string;
    endTime?: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
    patient: Patient; // Assuming Patient interface is defined correctly
    // openaiSessionKey?: string | null; // Key name from backend - REMOVED
    // Add any other fields received from the backend
}

// Frontend context state uses openaiKey - REMOVED comment
// REMOVE Omit and openaiKey property definition
// interface Conversation extends Omit<BackendConversation, 'openaiSessionKey'> {
//     openaiKey?: string | null; // Key name used in frontend state - REMOVED
// }
// Use BackendConversation directly, or rename it to Conversation if preferred
type Conversation = BackendConversation; // Simplification: Use the backend type directly now

interface ConversationContextType {
    conversations: Conversation[];
    conversationVersion: number;
    selectedConversationId: string | null;
    currentConversation: Conversation | null;
    selectConversation: (conversation: Conversation | null) => void; // Use simplified Conversation type
    // setCurrentConversationKey: (key: string | null) => void; // REMOVED
    // openaiKey: string | null; // REMOVED
    
    // Add missing properties identified earlier, if they belong here
    // Need to decide if isSessionActive, endCurrentSession, addMessageToConversation belong here
    // For now, let's assume they are managed elsewhere based on previous findings.
    isSessionActive: boolean; // Placeholder - Needs implementation logic
    endCurrentSession: () => void; // Placeholder - Needs implementation logic
    addMessageToConversation: (conversationId: string, message: any) => void; // Placeholder, adjust message type
    fetchConversations: () => Promise<void>;
    isLoading: boolean;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

interface ConversationProviderProps {
    children: ReactNode;
}

export const ConversationProvider: React.FC<ConversationProviderProps> = ({ children }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const { sendMessage } = useWebSocket();
    const initialListRequested = useRef(false);
    const [conversationVersion, setConversationVersion] = useState<number>(0);
    // Track the most recently created conversation ID to auto-select it
    const newSessionConversationId = useRef<string | null>(null);

    // Fetch conversations from REST API
    const fetchConversations = useCallback(async () => {
        try {
            setIsLoading(true);
            console.log("[ConversationContext] Fetching conversations from API");
            const response = await api.get('/api/conversations');
            
            if (response.data && Array.isArray(response.data)) {
                // Sort conversations by startTime (newest first)
                const sortedConversations = [...response.data].sort((a, b) =>
                    new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
                );
                
                setConversations(sortedConversations);
                console.log("[ConversationContext] Conversations updated from API:", sortedConversations.length);
                
                // Auto-select first conversation if none is selected
                if (!currentConversation && sortedConversations.length > 0) {
                    console.log("[ConversationContext] Auto-selecting first conversation after API fetch");
                    selectConversation(sortedConversations[0]);
                }
            }
        } catch (error) {
            console.error("[ConversationContext] Error fetching conversations:", error);
        } finally {
            setIsLoading(false);
        }
    }, [currentConversation]);

    // Fetch conversations on initial load
    useEffect(() => {
        fetchConversations();
        // Set up an interval to refresh conversations every 30 seconds
        const intervalId = setInterval(fetchConversations, 30000);
        return () => clearInterval(intervalId);
    }, [fetchConversations]);

    // Select conversation logic
    const selectConversation = useCallback((conversation: Conversation | null) => {
        if (conversation) {
            // Set local state
            setCurrentConversation(conversation);
            console.log("[ConversationContext] Selected Conversation:", conversation.id);
            
            // Still notify backend via WebSocket for message synchronization
            sendMessage({ type: 'select_conversation', payload: { conversationId: conversation.id } });
        } else {
            // Handle deselection
            setCurrentConversation(null);
            console.log("[ConversationContext] Deselected Conversation");
        }
    }, [sendMessage]);

    const selectedConversationId = useMemo(() => currentConversation?.id ?? null, [currentConversation]);

    // Session active logic
    const isSessionActive = useMemo(() => {
        const isActive = !!currentConversation && currentConversation.status?.toLowerCase() === 'active';
        console.log(`[ConversationContext] Calculating isSessionActive: ${isActive}`);
        return isActive;
    }, [currentConversation]);
    
    // End current session via REST API
    const endCurrentSession = useCallback(async () => {
        if (!currentConversation) return;
        
        try {
            console.log(`[ConversationContext] Ending session for ${currentConversation.id}`);
            // Optimistically update UI
            setCurrentConversation(prev => {
                if (!prev) return null;
                return { ...prev, status: 'ended' };
            });
            
            // Call REST API to end session
            await api.post(`/api/conversations/${currentConversation.id}/end`);
            
            // Refresh conversations to get updated status
            fetchConversations();
        } catch (error) {
            console.error("[ConversationContext] Error ending session:", error);
            // Revert optimistic update on error
            fetchConversations();
        }
    }, [currentConversation, fetchConversations]);
    
    // Placeholder for message handling - likely handled elsewhere
    const addMessageToConversation = useCallback((conversationId: string, message: any) => {
        console.log(`[ConversationContext] addMessageToConversation called for ${conversationId}`, message);
    }, []);

    // Add debug logging for the conversations state
    useEffect(() => {
        console.log("[ConversationContext] conversations updated:", conversations);
    }, [conversations]);

    const value = useMemo(() => ({
        conversations,
        conversationVersion,
        selectedConversationId,
        currentConversation,
        selectConversation,
        isSessionActive,
        endCurrentSession,
        addMessageToConversation,
        fetchConversations,
        isLoading
    }), [
        conversations, 
        conversationVersion, 
        selectedConversationId, 
        currentConversation, 
        selectConversation, 
        isSessionActive, 
        endCurrentSession, 
        addMessageToConversation,
        fetchConversations,
        isLoading
    ]);

    return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
};

export const useConversation = (): ConversationContextType => {
    const context = useContext(ConversationContext);
    if (context === undefined) {
        throw new Error("useConversation must be used within a ConversationProvider");
    }
    return context;
};
