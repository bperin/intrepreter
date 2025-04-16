import "reflect-metadata";
import express, { Request, Response, NextFunction, RequestHandler } from "express";
import dotenv from "dotenv";
import http from "http";
import WebSocket from "ws";
import cors from "cors";
import url from "url";
import { IAuthService, RefreshResult } from "./domain/services/IAuthService";
import { IConversationService, StartSessionInput } from "./domain/services/IConversationService";
import { IAudioProcessingService } from "./domain/services/IAudioProcessingService";
import { IConversationRepository } from "./domain/repositories/IConversationRepository";
import { Message } from "./generated/prisma";

import { container } from "./container";
import { authMiddleware } from "./infrastructure/auth/authMiddleware";

import { AuthApplicationService } from "./application/services/AuthApplicationService";
import { RegisterUserCommand } from "./application/commands/RegisterUserCommand";
import { LoginUserCommand } from "./application/commands/LoginUserCommand";
import { TranscriptionService } from './infrastructure/services/TranscriptionService';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(
    cors({
        origin: frontendUrl,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

const authAppService = container.resolve(AuthApplicationService);
const authService = container.resolve<IAuthService>("IAuthService");
const conversationService = container.resolve<IConversationService>("IConversationService");
const audioProcessingService = container.resolve<IAudioProcessingService>("IAudioProcessingService");
const conversationRepository = container.resolve<IConversationRepository>("IConversationRepository");
const transcriptionService = container.resolve<TranscriptionService>('TranscriptionService');

app.use(express.json());

app.post("/auth/register", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const command: RegisterUserCommand = req.body;
            if (!command.username || !command.password) {
                return res.status(400).json({ message: "Username and password are required" });
            }
            const result = await authAppService.registerUser(command);
            if (result.success) {
                res.status(201).json({ userId: result.userId });
            } else {
                res.status(400).json({ message: result.error || "Registration failed" });
            }
        } catch (error) {
            console.error("Registration Error:", error);
            if (error instanceof Error && error.message === "Username already exists") {
                return res.status(409).json({ message: error.message });
            }
            if (!res.headersSent) {
                res.status(500).json({ message: "Registration failed" });
            }
        }
    })();
});

app.post("/auth/login", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const command: LoginUserCommand = req.body;
            if (!command.username || !command.password) {
                return res.status(400).json({ message: "Username and password are required" });
            }
            const result = await authAppService.loginUser(command);
            if (result.success && result.token && result.refreshToken) {
                res.status(200).json({
                    accessToken: result.token,
                    refreshToken: result.refreshToken,
                });
            } else {
                res.status(401).json({ message: result.error || "Invalid username or password." });
            }
        } catch (error) {
            console.error("Login Error:", error);
            if (!res.headersSent) {
                res.status(500).json({ message: "Login failed" });
            }
        }
    })();
});

app.post("/auth/refresh", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken) {
                return res.status(400).json({ message: "Refresh token is required" });
            }

            const result: RefreshResult = await authAppService.refreshAccessToken(refreshToken);

            if (result.success && result.token) {
                res.status(200).json({
                    accessToken: result.token,
                });
            } else {
                res.status(403).json({ message: result.error || "Failed to refresh token" });
            }
        } catch (error) {
            console.error("Refresh Token Error:", error);
            if (!res.headersSent) {
                res.status(500).json({ message: "Token refresh failed" });
            }
        }
    })();
});

app.get("/conversations", authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user!.id; // if its undefined will have thrown error in middleware
        const conversations = await conversationRepository.findByUserId(userId);
        res.status(200).json(conversations);
    } catch (error) {
        console.error("Error fetching conversations:", error);
        next(error);
    }
});

app.get("/", (req: Request, res: Response) => {
    res.send("Interpreter Backend is running!");
});

const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    username?: string;
    currentConversationId?: string;
}

wss.on("connection", async (ws: AuthenticatedWebSocket, req: http.IncomingMessage) => {
    console.log("WebSocket: Client attempting to connect...");

    const parsedUrl = url.parse(req.url || "", true);
    const pathname = parsedUrl.pathname;
    const queryParams = parsedUrl.query;

    // Route based on path
    if (pathname === '/transcription') {
        // Handle Transcription Stream Connection
        console.log("[WebSocket Router] /transcription: Handling connection...");
        const conversationId = queryParams.conversationId;

        if (!conversationId || typeof conversationId !== 'string') {
            console.error('[WebSocket Router] /transcription: Missing or invalid conversationId parameter');
            ws.close(1008, 'Missing required parameter: conversationId');
            return;
        }

        console.log(`[WebSocket Router] /transcription: New connection for conversation: ${conversationId}`);

        try {
            // Hand off to the TranscriptionService (ensure TranscriptionService expects only ws, conversationId)
            console.log(`[WebSocket Router] /transcription: Calling transcriptionService.handleConnection for ${conversationId}`);
            transcriptionService.handleConnection(ws, conversationId);

            // Basic error/close handlers for transcription stream
            ws.on('close', (code, reason) => {
                console.log(`[WebSocket Router] /transcription: Connection closed for conversation ${conversationId}. Code: ${code}, Reason: ${reason?.toString()}`);
            });
            ws.on('error', (error) => {
                console.error(`[WebSocket Router] /transcription: Connection error for conversation ${conversationId}:`, error);
            });

        } catch (error) {
            console.error(`[WebSocket Router] /transcription: Error handling connection for ${conversationId}:`, error);
            ws.close(1011, 'Server error handling transcription connection');
        }

    } else {
        // Handle Control Channel Connection (Original Logic)
        console.log("[WebSocket Router] Handling control channel connection (path: ", pathname, ")...");
        const token = queryParams.token;

        if (!token || typeof token !== "string") {
            console.log("[WebSocket Router] Control Channel: Connection Rejected - Missing or invalid token format.");
            ws.close(4001, "Access token required");
            return;
        }

        try {
            const payload = await authService.verifyToken(token);
            if (!payload) {
                console.log("[WebSocket Router] Control Channel: Connection Rejected - Invalid or expired token.");
                ws.close(4001, "Invalid or expired token");
                return;
            }

            ws.userId = payload.id;
            ws.username = payload.username;
            console.log(`[WebSocket Router] Control Channel: Client connected and authenticated as ${ws.username} (ID: ${ws.userId})`);

            ws.send(JSON.stringify({ type: "system", text: "Welcome! You are connected via control channel." })); // Adjusted welcome message

        } catch (error) {
            console.error("[WebSocket Router] Control Channel: Authentication error during connection:", error);
            ws.close(5000, "Internal server error during authentication");
            return;
        }

        // Attach message, close, error handlers for the authenticated control channel
        ws.on("message", async (messageData: WebSocket.Data, isBinary: boolean) => {
            // Existing control channel message handling logic...
            // Ensure ws.userId check is still valid (it should be set above)
            if (!ws.userId) {
                 console.warn("[WebSocket Router] Control Channel: Message received but userId not set (should not happen).");
                 ws.close(4001, "Authentication state lost");
                 return;
            }

            let request: any = null;
            if (isBinary) {
                console.log(`[WebSocket Router] Control Channel: Received unexpected binary data from ${ws.username}. Ignoring.`);
                return; // Ignore binary data
            } else {
                const messageString = messageData.toString();
                console.log(`[WebSocket Router] Control Channel: Received JSON from ${ws.username}:`, messageString);
                try {
                    request = JSON.parse(messageString);
                } catch (e) {
                    console.error(`[WebSocket Router] Control Channel: Invalid JSON from ${ws.username}: ${messageString}`);
                    ws.send(JSON.stringify({ type: "error", text: "Invalid message format. Expected JSON." }));
                    return;
                }
            }

            console.log(`[WebSocket Router] Control Channel: Processing message type: ${request.type}`);

            if (!request) {
                console.error("[WebSocket Router] Control Channel: Logic error - message processing fall-through.");
                return;
            }

            // --- Start of existing switch statement for control channel messages ---
            switch (request.type) {
                case "start_new_session":
                    try {
                        const payload = request.payload;
                        if (!payload || !payload.firstName || !payload.lastName || !payload.dob) {
                            throw new Error("Missing required patient details (firstName, lastName, dob) in payload.");
                        }

                        const dobDate = new Date(payload.dob);
                        if (isNaN(dobDate.getTime())) {
                            throw new Error("Invalid Date of Birth format.");
                        }

                        const input: StartSessionInput = {
                            userId: ws.userId,
                            patientFirstName: payload.firstName,
                            patientLastName: payload.lastName,
                            patientDob: dobDate,
                        };

                        console.log(`[WebSocket Router] Control Channel: Starting new session for user ${ws.userId}...`);
                        const startSessionResult = await conversationService.startNewSession(input);
                        
                        console.log(`[WebSocket Router] Control Channel: New session started with Conversation ID: ${startSessionResult.conversation.id}`);
                        ws.currentConversationId = startSessionResult.conversation.id;

                        // REMOVE OpenAI Key logic here - The backend shouldn't send it anymore
                        console.log(`[WebSocket Router] Control Channel: Session started, sending confirmation (without key).`);
                        ws.send(JSON.stringify({
                            type: 'session_started',
                            payload: {
                                conversationId: startSessionResult.conversation.id,
                                patientId: startSessionResult.conversation.patientId,
                                startTime: startSessionResult.conversation.startTime,
                                // openaiKey: startSessionResult.conversation.openaiSessionKey || startSessionResult.openaiKey // REMOVED
                            }
                        }));

                        console.log(`[WebSocket Router] Control Channel: Fetching updated conversation list for ${ws.username}...`);
                        const updatedConversations = await conversationRepository.findByUserId(ws.userId!); // userId is guaranteed here
                        ws.send(JSON.stringify({ 
                            type: 'conversation_list', 
                            payload: updatedConversations 
                        }));
                        console.log(`[WebSocket Router] Control Channel: Sent updated conversation list (${updatedConversations.length} items) to ${ws.username}`);

                    } catch (error: any) {
                        console.error(`[WebSocket Router] Control Channel: Error processing start_new_session for ${ws.username}:`, error);
                        ws.send(JSON.stringify({ type: 'error', text: error.message || 'Failed to start new session' }));
                    }
                    break;

                case "select_conversation":
                    const conversationIdToSelect = request.payload?.conversationId;
                    if (conversationIdToSelect && typeof conversationIdToSelect === "string") {
                        try {
                            const conversation = await conversationRepository.findById(conversationIdToSelect);
                            
                            if (!conversation) {
                                throw new Error(`Conversation not found: ${conversationIdToSelect}`);
                            }
                            
                            if (conversation.userId !== ws.userId) {
                                throw new Error("You don't have permission to access this conversation");
                            }
                            
                            ws.currentConversationId = conversationIdToSelect;
                            console.log(`[WebSocket Router] Control Channel: User ${ws.username} selected conversation ${ws.currentConversationId}`);
                            
                            // REMOVE OpenAI Key logic here
                            const isActive = conversation.status === "active"; // Check status directly
                            console.log(`[WebSocket Router] Control Channel: Sending conversation selection confirmation (isActive: ${isActive})`);
                            ws.send(JSON.stringify({ 
                                type: 'conversation_selected', 
                                payload: { 
                                    conversationId: conversation.id,
                                    isActive: isActive
                                } 
                            }));

                        } catch (error: any) {
                            console.error(`[WebSocket Router] Control Channel: Error selecting conversation for ${ws.username}:`, error);
                            ws.send(JSON.stringify({ type: "error", text: error.message || "Failed to select conversation" }));
                        }
                    } else {
                        console.warn(`[WebSocket Router] Control Channel: Invalid select_conversation payload from ${ws.username}:`, request.payload);
                        ws.send(JSON.stringify({ type: "error", text: "Invalid payload for select_conversation" }));
                    }
                    break;

                case "get_messages":
                    // ... (existing get_messages logic - no key involved)
                    const conversationIdToGet = request.payload?.conversationId;
                    if (conversationIdToGet && typeof conversationIdToGet === "string") {
                        if (ws.currentConversationId !== conversationIdToGet) {
                            console.warn(`[WebSocket Router] Control Channel: User ${ws.username} requested messages for ${conversationIdToGet} but their active session is ${ws.currentConversationId}. Allowing for now.`);
                        }
                        try {
                            const messages: Message[] = await conversationRepository.findMessagesByConversationId(conversationIdToGet);
                            ws.send(
                                JSON.stringify({
                                    type: "message_list",
                                    payload: {
                                        conversationId: conversationIdToGet,
                                        messages: messages,
                                    },
                                })
                            );
                            console.log(`[WebSocket Router] Control Channel: Sent ${messages.length} messages for conversation ${conversationIdToGet} to ${ws.username}`);
                        } catch (error: any) {
                            console.error(`[WebSocket Router] Control Channel: Error fetching messages for ${ws.username} (conv: ${conversationIdToGet}):`, error);
                            ws.send(JSON.stringify({ type: "error", text: error.message || "Failed to fetch messages" }));
                        }
                    } else {
                        console.warn(`[WebSocket Router] Control Channel: Invalid get_messages payload from ${ws.username}:`, request.payload);
                        ws.send(JSON.stringify({ type: "error", text: "Invalid payload for get_messages" }));
                    }
                    break;

                case "get_conversations":
                    // ... (existing get_conversations logic - no key involved)
                     try {
                        console.log(`[WebSocket Router] Control Channel: Received get_conversations request from ${ws.username}`);
                        const conversations = await conversationRepository.findByUserId(ws.userId!); // userId is guaranteed here
                        ws.send(
                            JSON.stringify({
                                type: "conversation_list",
                                payload: conversations,
                            })
                        );
                    } catch (error: any) {
                        console.error(`[WebSocket Router] Control Channel: Error fetching conversations for ${ws.username}:`, error);
                        ws.send(JSON.stringify({ type: "error", text: error.message || "Failed to fetch conversations" }));
                    }
                    break;

                case "chat_message":
                    // ... (existing chat_message logic - no key involved)
                    if (!ws.currentConversationId) {
                        console.warn(`[WebSocket Router] Control Channel: Received chat_message from ${ws.username} but no active conversation set. Ignoring.`);
                        ws.send(JSON.stringify({ type: "error", text: "No active session to send message to." }));
                        return;
                    }
                    try {
                        const text = request.payload?.text;
                        if (!text || typeof text !== "string") {
                            throw new Error("Missing or invalid text payload in chat_message");
                        }
                        console.log(`[WebSocket Router] Control Channel: Processing chat_message with text: "${text.substring(0, 50)}..."`);
                        const response = {
                            type: "message_received",
                            id: Date.now().toString(),
                            text: text
                        };
                        ws.send(JSON.stringify(response));
                        
                    } catch (error: any) {
                        console.error(`[WebSocket Router] Control Channel: Error processing chat_message for ${ws.username}:`, error);
                        ws.send(JSON.stringify({ type: "error", text: error.message || "Failed to process chat message" }));
                    }
                    break;

                case "end_session":
                    // ... (existing end_session logic - no key involved)
                    if (!ws.currentConversationId) {
                        console.warn(`[WebSocket Router] Control Channel: Received end_session from ${ws.username} but no active conversation.`);
                        return;
                    }
                    console.log(`[WebSocket Router] Control Channel: Received end_session from ${ws.username} for conversation ${ws.currentConversationId}`);
                    try {
                        // Assuming finalizeStream does not rely on OpenAI Key
                        await audioProcessingService.finalizeStream(ws.currentConversationId, ws.userId!); 
                        await conversationRepository.update(ws.currentConversationId, {
                            status: "ENDED",
                            endTime: new Date(),
                        });
                        ws.send(JSON.stringify({ type: "session_ended", payload: { conversationId: ws.currentConversationId } }));
                        ws.currentConversationId = undefined; // Clear the active conversation ID for this connection
                    } catch (error: any) {
                        console.error(`[WebSocket Router] Control Channel: Error finalizing session for user ${ws.userId}:`, error);
                        ws.send(JSON.stringify({ type: "error", text: error.message || "Failed to end session properly" }));
                    }
                    break;

                default:
                    console.log(`[WebSocket Router] Control Channel: Received unknown message type from ${ws.username}:`, request.type);
                    ws.send(JSON.stringify({ type: "error", text: `Unknown message type: ${request.type}` }));
            }
            // --- End of switch statement ---
        });

        ws.on("close", () => {
            console.log(`[WebSocket Router] Control Channel: Client ${ws.username} disconnected`);
            // Perform any necessary cleanup for the control channel connection if needed
        });

        ws.on("error", (error) => {
            console.error(`[WebSocket Router] Control Channel: Error for ${ws.username}:`, error);
        });
    }
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
