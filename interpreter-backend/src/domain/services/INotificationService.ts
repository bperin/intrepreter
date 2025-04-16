import WebSocket from "ws";
import { ActionPayload } from "../models/Action";

interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    username?: string;
    currentConversationId?: string;
}

export const INotificationService = Symbol("INotificationService");

export interface INotificationService {
    notifyActionCreated(conversationId: string, action: ActionPayload): void;
    registerClient(ws: AuthenticatedWebSocket, conversationId: string): void;
    removeClient(ws: AuthenticatedWebSocket): void;
} 