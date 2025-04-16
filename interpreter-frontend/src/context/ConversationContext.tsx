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
    isRefreshing: boolean;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

interface ConversationProviderProps {
    children: ReactNode;
}

export const ConversationProvider: React.FC<ConversationProviderProps> = ({ children }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { sendMessage } = useWebSocket();
    const initialListRequested = useRef(false);
    const [conversationVersion, setConversationVersion] = useState<number>(0);
    // Track the most recently created conversation ID to auto-select it
    const newSessionConversationId = useRef<string | null>(null);
    
    // Use refs to avoid re-renders when these don't actually change
    const selectedConversationIdRef = useRef<string | null>(null);
    const isSessionActiveRef = useRef<boolean>(false);

    // Select conversation logic
    const selectConversation = useCallback((conversation: Conversation | null) => {
        if (conversation) {
            // Only update if it's a different conversation
            if (selectedConversationIdRef.current !== conversation.id) {
                // Update refs first to avoid unnecessary re-renders
                selectedConversationIdRef.current = conversation.id;
                
                // Set local state
                setCurrentConversation(conversation);
                console.log("[ConversationContext] Selected Conversation:", conversation.id);
                
                // Still notify backend via WebSocket for message synchronization
                sendMessage({ type: 'select_conversation', payload: { conversationId: conversation.id } });
            } else {
                console.log("[ConversationContext] Conversation already selected:", conversation.id);
            }
        } else {
            // Handle deselection
            selectedConversationIdRef.current = null;
            setCurrentConversation(null);
            console.log("[ConversationContext] Deselected Conversation");
        }
    }, [sendMessage]);

    // Derive selectedConversationId from ref for stability
    const selectedConversationId = useMemo(() => selectedConversationIdRef.current, []);

    // Session active logic - update ref but keep memo for API consistency
    const isSessionActive = useMemo(() => {
        const isActive = !!currentConversation && currentConversation.status?.toLowerCase() === 'active';
        console.log(`[ConversationContext] Calculating isSessionActive: ${isActive}`);
        isSessionActiveRef.current = isActive;
        return isActive;
    }, [currentConversation]);

    // Fetch conversations from REST API
    const fetchConversations = useCallback(async (isRefresh = false) => {
        try {
            // Only set loading on initial load, not refreshes
            if (!isRefresh) {
                setIsLoading(true);
            } else {
                setIsRefreshing(true);
            }
            console.log("[ConversationContext] Fetching conversations from API");
            const response = await api.get('/api/conversations');
            
            if (response.data && Array.isArray(response.data)) {
                // Sort conversations by startTime (newest first)
                const sortedConversations = [...response.data].sort((a, b) =>
                    new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
                );
                
                setConversations(sortedConversations);
                // Increment version only when conversations change
                setConversationVersion(v => v + 1);
                console.log("[ConversationContext] Conversations updated from API:", sortedConversations.length);
                
                // Check if there's a new active session that was just created
                const newestActiveSession = sortedConversations.find(c => 
                    c.status?.toLowerCase() === 'active' && 
                    new Date(c.startTime).getTime() > Date.now() - 10000 // Created in the last 10 seconds
                );
                
                if (newestActiveSession) {
                    console.log("[ConversationContext] Found newly created active session:", newestActiveSession.id);
                    selectConversation(newestActiveSession);
                }
                // Auto-select first conversation if none is selected
                else if (!selectedConversationIdRef.current && sortedConversations.length > 0) {
                    console.log("[ConversationContext] Auto-selecting first conversation after API fetch");
                    selectConversation(sortedConversations[0]);
                }
            }
        } catch (error) {
            console.error("[ConversationContext] Error fetching conversations:", error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [selectConversation]);

    // Fetch conversations on initial load
    useEffect(() => {
        fetchConversations(false); // Initial load
        // Set up an interval to refresh conversations every 30 seconds
        const intervalId = setInterval(() => fetchConversations(true), 30000); // Refresh
        return () => clearInterval(intervalId);
    }, [fetchConversations]);

    // Stable reference to functions
    const stableEndCurrentSession = useCallback(async () => {
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
            fetchConversations(true); // Use refresh mode
        } catch (error) {
            console.error("[ConversationContext] Error ending session:", error);
            // Revert optimistic update on error
            fetchConversations(true); // Use refresh mode
        }
    }, [currentConversation, fetchConversations]);
    
    // Stable no-op for addMessageToConversation
    const stableAddMessageToConversation = useCallback((conversationId: string, message: any) => {
        console.log(`[ConversationContext] addMessageToConversation called for ${conversationId}`, message);
    }, []);

    // Memoize the context value once to avoid unnecessary re-renders
    const stableValue = useMemo(() => ({
        conversations,
        conversationVersion,
        selectedConversationId: selectedConversationIdRef.current,
        currentConversation,
        selectConversation,
        isSessionActive: isSessionActiveRef.current,
        endCurrentSession: stableEndCurrentSession,
        addMessageToConversation: stableAddMessageToConversation,
        fetchConversations: (refresh = true) => fetchConversations(refresh),
        isLoading,
        isRefreshing
    }), [
        conversations,
        conversationVersion,
        currentConversation,
        selectConversation,
        stableEndCurrentSession,
        stableAddMessageToConversation,
        fetchConversations,
        isLoading,
        isRefreshing
    ]);

    return <ConversationContext.Provider value={stableValue}>{children}</ConversationContext.Provider>;
};

export const useConversation = (): ConversationContextType => {
    const context = useContext(ConversationContext);
    if (context === undefined) {
        throw new Error("useConversation must be used within a ConversationProvider");
    }
    return context;
};
