import WebSocket from "ws";
import { AggregatedAction } from "../models/AggregatedAction"; // Import new aggregated type

interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    username?: string;
    currentConversationId?: string;
}

export const INotificationService = Symbol("INotificationService");

export interface INotificationService {
    // Modify this method to accept AggregatedAction
    notifyActionCreated(conversationId: string, action: AggregatedAction): void;
    registerClient(ws: AuthenticatedWebSocket, conversationId: string): void;
    removeClient(ws: AuthenticatedWebSocket): void;
    broadcastMessage(conversationId: string, message: any): void;
} 