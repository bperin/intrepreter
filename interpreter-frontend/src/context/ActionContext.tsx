import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useConversation } from './ConversationContext';
import { AggregatedAction } from '../types/actions';

interface ActionContextType {
    actions: AggregatedAction[];
    loading: boolean;
    error: string | null;
    addAction: (newAction: AggregatedAction) => void;
}

const ActionContext = createContext<ActionContextType | undefined>(undefined);

export const ActionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [actions, setActions] = useState<AggregatedAction[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { isConnected, sendMessage, lastMessage } = useWebSocket();
    const { currentConversation } = useConversation();
    const currentConversationId = useMemo(() => currentConversation?.id, [currentConversation]);

    useEffect(() => {
        if (!isConnected || !currentConversationId) {
            setActions([]);
            setLoading(false);
            return;
        }

        console.log(`[ActionContext] Requesting actions for ${currentConversationId}`);
        setActions([]);
        setLoading(true);
        setError(null);

        sendMessage({
            type: 'get_actions',
            payload: { conversationId: currentConversationId }
        });

    }, [isConnected, currentConversationId, sendMessage]);

    useEffect(() => {
        if (!lastMessage || !currentConversationId) return;

        const data = lastMessage;

        switch (data.type) {
            case 'action_list':
                if (data.payload?.conversationId === currentConversationId && Array.isArray(data.payload?.actions)) {
                    console.log(`[ActionContext] Received action_list for current conversation ${currentConversationId}`);
                    setActions(data.payload.actions as AggregatedAction[]);
                    setLoading(false);
                    setError(null);
                } else {
                    console.log(`[ActionContext] Ignoring action_list for different conversation: ${data.payload?.conversationId}`);
                }
                break;
                
            case 'action_created':
                const newAction = data.payload as AggregatedAction;
                if (newAction?.conversationId === currentConversationId) {
                    console.log(`[ActionContext] Received action_created for current conversation: ${newAction.id} (${newAction.type})`);
                    setActions(prev => {
                        if (prev.some(a => a.id === newAction.id)) {
                            return prev;
                        }
                        return [...prev, newAction].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                    });
                } else {
                     console.log(`[ActionContext] Ignoring action_created for different conversation: ${newAction?.conversationId}`);
                }
                break;

            case 'error':
                 if (typeof data.message === 'string' && data.message.toLowerCase().includes('action')) {
                    console.error(`[ActionContext] Received error related to actions: ${data.message}`);
                    setError(data.message);
                    setLoading(false);
                 }
                break;
        }
    }, [lastMessage, currentConversationId]);

    const addAction = useCallback((newAction: AggregatedAction) => {
        if (newAction?.conversationId !== currentConversationId) {
            console.log(`[ActionContext] Ignoring addAction for different conversation: ${newAction?.conversationId}`);
            return;
        }
        
        console.log(`[ActionContext] addAction called for: ${newAction.id} (${newAction.type})`);
        setActions(prev => {
            if (prev.some(a => a.id === newAction.id)) {
                console.log(`[ActionContext] Duplicate action ID ${newAction.id}, skipping add.`);
                return prev;
            }
            const updatedActions = [...prev, newAction].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            console.log(`[ActionContext] Actions updated. Count: ${updatedActions.length}`);
            return updatedActions;
        });
    }, [currentConversationId]);

    return (
        <ActionContext.Provider value={{ actions, loading, error, addAction }}>
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