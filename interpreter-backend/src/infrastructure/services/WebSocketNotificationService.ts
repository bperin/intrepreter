import { injectable } from "tsyringe";
import { INotificationService } from "../../domain/services/INotificationService";
import { ActionPayload } from "../../domain/models/Action";
import WebSocket from "ws";

interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    username?: string;
    currentConversationId?: string;
}

@injectable()
export class WebSocketNotificationService implements INotificationService {
    private conversationClients: Map<string, Set<AuthenticatedWebSocket>>;

    constructor() {
        this.conversationClients = new Map();
    }

    public notifyActionCreated(conversationId: string, action: ActionPayload): void {
        this.broadcastToConversation(conversationId, {
            type: "action_created",
            payload: action
        });
    }

    public registerClient(ws: AuthenticatedWebSocket, conversationId: string): void {
        // Remove from old conversation if any
        if (ws.currentConversationId) {
            this.removeFromConversation(ws, ws.currentConversationId);
        }

        // Add to new conversation
        if (!this.conversationClients.has(conversationId)) {
            this.conversationClients.set(conversationId, new Set());
        }
        this.conversationClients.get(conversationId)?.add(ws);
        ws.currentConversationId = conversationId;

        console.log(`[WebSocketNotificationService] Registered client ${ws.username} to conversation ${conversationId}`);
    }

    public removeClient(ws: AuthenticatedWebSocket): void {
        if (ws.currentConversationId) {
            this.removeFromConversation(ws, ws.currentConversationId);
        }
    }

    private removeFromConversation(ws: AuthenticatedWebSocket, conversationId: string): void {
        const clients = this.conversationClients.get(conversationId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                this.conversationClients.delete(conversationId);
            }
        }
        ws.currentConversationId = undefined;
    }

    private broadcastToConversation(conversationId: string, message: any): void {
        const clients = this.conversationClients.get(conversationId);
        if (clients) {
            const messageStr = JSON.stringify(message);
            clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    try {
                        client.send(messageStr);
                        console.log(`[WebSocketNotificationService] Broadcasted message to client ${client.username} in conversation ${conversationId}`);
                    } catch (e) {
                        console.error(`[WebSocketNotificationService] Error broadcasting to client in conversation ${conversationId}:`, e);
                    }
                }
            });
        }
    }
} 