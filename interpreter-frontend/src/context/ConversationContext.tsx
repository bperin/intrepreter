import React, { createContext, useState, useContext, ReactNode, useMemo, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

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
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

interface ConversationProviderProps {
    children: ReactNode;
}

export const ConversationProvider: React.FC<ConversationProviderProps> = ({ children }) => {
    const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
    const { sendMessage } = useWebSocket();

    // Update selectConversation logic to send message
    const selectConversation = useCallback((conversation: Conversation | null) => {
        if (conversation) {
            // Set local state
            setCurrentConversation(conversation);
            console.log("[Context] Selected Conversation:", conversation.id);
            
            // Send message to backend
            sendMessage({ type: 'select_conversation', payload: { conversationId: conversation.id } });
            console.log("[Context] Sent select_conversation message to backend for ID:", conversation.id);

        } else {
            // Handle deselection
            setCurrentConversation(null);
            console.log("[Context] Deselected Conversation");
            // Optionally send a deselection message? Depends on backend logic.
            // sendMessage({ type: 'deselect_conversation' }); 
        }
    }, [sendMessage]);

    const selectedConversationId = useMemo(() => currentConversation?.id ?? null, [currentConversation]);

    // Placeholder logic for new properties - This needs proper implementation!
    const isSessionActive = useMemo(() => {
        const isActive = !!currentConversation && currentConversation.status?.toLowerCase() === 'active';
        console.log(`[Context] Calculating isSessionActive: Conversation exists: ${!!currentConversation}, Status: ${currentConversation?.status}, Result: ${isActive}`);
        return isActive;
    }, [currentConversation]);
    const endCurrentSession = useCallback(() => {
        console.log("endCurrentSession called in context - Placeholder");
        // This likely needs to interact with WebSocket or parent state
        setCurrentConversation(null); // Simple example: deselect conversation
    }, []);
    const addMessageToConversation = useCallback((conversationId: string, message: any) => {
        console.log(`addMessageToConversation called in context for ${conversationId} - Placeholder`, message);
        // This likely needs to update a list of messages stored elsewhere or trigger a fetch
    }, []);


    const value = useMemo(
        () => ({
            selectedConversationId,
            currentConversation,
            selectConversation,
            isSessionActive,
            endCurrentSession,
            addMessageToConversation
        }),
        [selectedConversationId, currentConversation, selectConversation, isSessionActive, endCurrentSession, addMessageToConversation]
    );

    return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
};

export const useConversation = (): ConversationContextType => {
    const context = useContext(ConversationContext);
    if (context === undefined) {
        throw new Error("useConversation must be used within a ConversationProvider");
    }
    return context;
};
