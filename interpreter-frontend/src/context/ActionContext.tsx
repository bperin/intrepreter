import React, { createContext, useContext, useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useConversation } from './ConversationContext';

export interface Action {
    id: string;
    type: 'note' | 'followup';
    content?: string;
    duration?: number;
    unit?: string;
    createdAt: string;
    conversationId: string;
}

interface ActionContextType {
    actions: Action[];
    loading: boolean;
    error: string | null;
}

const ActionContext = createContext<ActionContextType | undefined>(undefined);

export const ActionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [actions, setActions] = useState<Action[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { isConnected, sendMessage, lastMessage } = useWebSocket();
    const { currentConversation } = useConversation();

    // Effect to send initial request for actions
    useEffect(() => {
        if (!isConnected || !currentConversation) return;

        // Reset state when conversation changes
        setActions([]);
        setLoading(true);
        setError(null);

        // Request actions for the current conversation
        sendMessage({
            type: 'get_actions',
            payload: { conversationId: currentConversation.id }
        });
    }, [isConnected, currentConversation, sendMessage]);

    // Effect to handle incoming messages
    useEffect(() => {
        if (!lastMessage || !currentConversation) return;

        const data = lastMessage;
        switch (data.type) {
            case 'action_list':
                if (data.payload.conversationId === currentConversation.id) {
                    setActions(data.payload.actions);
                    setLoading(false);
                }
                break;
                
            case 'action_created':
                if (data.payload.conversationId === currentConversation.id) {
                    setActions(prev => [...prev, data.payload.action]);
                }
                break;

            case 'error':
                if (data.message.includes('actions')) {
                    setError(data.message);
                    setLoading(false);
                }
                break;
        }
    }, [lastMessage, currentConversation]);

    return (
        <ActionContext.Provider value={{ actions, loading, error }}>
            {children}
        </ActionContext.Provider>
    );
};

export const useActions = () => {
    const context = useContext(ActionContext);
    if (context === undefined) {
        throw new Error('useActions must be used within an ActionProvider');
    }
    return context;
}; 