import React, { createContext, useState, useContext, ReactNode, useMemo, useCallback, useEffect, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import api from "../lib/api";
import { useAuth } from "./AuthContext"; // Import useAuth

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
    selectConversation: (conversation: Conversation | null) => void;
    isSessionActive: boolean;
    endCurrentSession: () => void;
    addMessageToConversation: (conversationId: string, message: any) => void;
    fetchConversations: () => Promise<void>;
    isLoading: boolean;
    isRefreshing: boolean;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

interface ConversationProviderProps {
    children: ReactNode;
}

export const ConversationProvider: React.FC<ConversationProviderProps> = ({ children }) => {
    const { isAuthenticated } = useAuth(); // Get auth status
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null); // <-- State for selected ID
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

    // Select conversation logic - uses state setter now
    const selectConversation = useCallback((conversation: Conversation | null) => {
        const newId = conversation ? conversation.id : null;
        // Only update if it's a different conversation ID
        if (selectedId !== newId) { 
            setSelectedId(newId); // <-- Update state
            setCurrentConversation(conversation);
            console.log(`[ConversationContext] Selected Conversation: ${newId}`);
            if (newId) {
                 sendMessage(JSON.stringify({ type: 'select_conversation', payload: { conversationId: newId } }));
            }
        } else {
            console.log("[ConversationContext] Conversation already selected:", newId);
        }
    }, [sendMessage, selectedId]); // Add selectedId dependency

    // Derive selectedConversationId from ref for stability
    const selectedConversationId = useMemo(() => selectedId, [selectedId]);

    // Session active logic (derives from state)
    const isSessionActive = useMemo(() => {
        const isActive = !!currentConversation && currentConversation.status?.toLowerCase() === 'active';
        console.log(`[ConversationContext] Calculating isSessionActive: ${isActive}`);
        isSessionActiveRef.current = isActive; // Update ref if still needed internally
        return isActive;
    }, [currentConversation]);

    // Fetch conversations from REST API
    const fetchConversations = useCallback(async (isRefresh = false) => {
        if (!isAuthenticated) {
            console.log("[ConversationContext] Skipping fetchConversations: User not authenticated.");
            setConversations([]); // Clear conversations if not authenticated
            setIsLoading(false);
            setIsRefreshing(false);
            return;
        }
        try {
            // Only set loading on initial load, not refreshes
            if (!isRefresh) {
                setIsLoading(true);
            } else {
                setIsRefreshing(true);
            }
            console.log("[ConversationContext] Fetching conversations from API");
            const response = await api.get<Conversation[]>('/conversations'); // Add type hint
            
            if (response.data && Array.isArray(response.data)) {
                // Sort conversations by startTime (newest first)
                const sortedConversations = [...response.data].sort((a, b) =>
                    new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
                );
                
                setConversations(sortedConversations);
                // Increment version only when conversations change
                setConversationVersion(v => v + 1);
                console.log("[ConversationContext] Conversations updated from API:", sortedConversations.length);
                
                // --- Auto-selection logic --- 
                const currentSelectedId = selectedId; // Read state for check
                const newestActiveSession = sortedConversations.find(c => 
                    c.status?.toLowerCase() === 'active' && 
                    new Date(c.startTime).getTime() > Date.now() - 10000 
                );
                
                if (newestActiveSession) {
                    console.log("[ConversationContext] Found newly created active session:", newestActiveSession.id);
                    selectConversation(newestActiveSession); 
                }
                // Auto-select first only if nothing is currently selected
                else if (!currentSelectedId && sortedConversations.length > 0) {
                    console.log("[ConversationContext] Auto-selecting first conversation after API fetch");
                    selectConversation(sortedConversations[0]);
                }
                // --- End Auto-selection --- 
            }
        } catch (error) {
            console.error("[ConversationContext] Error fetching conversations:", error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [isAuthenticated, selectConversation, selectedId]); // Add selectedId dependency here too

    // Fetch conversations on initial load *only if authenticated*
    useEffect(() => {
        if (isAuthenticated) {
            console.log("[ConversationContext] User authenticated, fetching conversations...");
            fetchConversations(); // Fetch immediately
            const intervalId = setInterval(() => fetchConversations(true), 30000); // Refresh every 30s
            return () => clearInterval(intervalId);
        } else {
            console.log("[ConversationContext] User not authenticated, clearing data and interval.");
            setConversations([]); // Ensure conversations are cleared if auth status changes to false
            setCurrentConversation(null);
            setSelectedId(null); // <-- FIX: Use state setter
        }
    }, [isAuthenticated, fetchConversations]);

    // Stable reference to functions
    const stableEndCurrentSession = useCallback(async () => {
        if (!selectedId) return; // Check state ID

        try {
            console.log(`[ConversationContext] Ending session for ${selectedId}`);
            // Optimistically update UI
            setCurrentConversation(prev => {
                if (!prev) return null; // <-- FIX: Add null check for prev
                return {
                    ...prev,
                    status: 'ended',
                };
            });
            
            // Call REST API to end session
            await api.post(`/conversations/${selectedId}/end`);
            
            // Refresh conversations to get updated status
            // The WebSocket should ideally push the summary/status update, 
            // but refresh ensures consistency.
            fetchConversations(true); // Use refresh mode
        } catch (error) {
            console.error("[ConversationContext] Error ending session:", error);
            // Optionally revert optimistic update or show error
        }
    }, [selectedId, fetchConversations]);
    
    // Stable no-op for addMessageToConversation
    const stableAddMessageToConversation = useCallback((conversationId: string, message: any) => {
        console.log(`[ConversationContext] addMessageToConversation called for ${conversationId}`, message);
    }, []);

    // Memoize the context value - Provide selectedId state
    const stableValue = useMemo(() => ({
        conversations,
        conversationVersion,
        selectedConversationId: selectedId, // <-- Provide state variable
        currentConversation,
        selectConversation,
        isSessionActive,
        endCurrentSession: stableEndCurrentSession, 
        addMessageToConversation: stableAddMessageToConversation,
        fetchConversations,
        isLoading,
        isRefreshing,
    }), [
        conversations, conversationVersion, selectedId, currentConversation, 
        selectConversation, isSessionActive, stableEndCurrentSession, 
        stableAddMessageToConversation, fetchConversations, isLoading, isRefreshing
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
