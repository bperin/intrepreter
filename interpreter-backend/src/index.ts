import "reflect-metadata";
import express, { Request, Response, NextFunction, RequestHandler } from "express";
import http from "http";
import WebSocket from "ws";
import cors from "cors";
import url from "url";
import { IAuthService, RefreshResult } from "./domain/services/IAuthService";
import { IConversationService, StartSessionInput } from "./domain/services/IConversationService";
import { IAudioProcessingService } from "./domain/services/IAudioProcessingService";
import { IConversationRepository } from "./domain/repositories/IConversationRepository";
import { PrismaClient } from "./generated/prisma";
import { Message } from "./generated/prisma";

import { container } from "./container";
import { authMiddleware } from "./infrastructure/auth/authMiddleware";

import { AuthApplicationService } from "./application/services/AuthApplicationService";
import { RegisterUserCommand } from "./application/commands/RegisterUserCommand";
import { LoginUserCommand } from "./application/commands/LoginUserCommand";
import { TranscriptionService } from './infrastructure/services/TranscriptionService';
import { IMessageService, IMessageService as IMessageServiceToken } from "./domain/services/IMessageService";
import { MessageService } from "./infrastructure/services/MessageService";
import { ITextToSpeechService, ITextToSpeechService as ITextToSpeechServiceToken } from "./domain/services/ITextToSpeechService";
import { TextToSpeechService } from "./infrastructure/services/TextToSpeechService";
import { INotificationService } from "./domain/services/INotificationService";
import { WebSocketNotificationService } from "./infrastructure/services/WebSocketNotificationService";
import { MedicalHistoryService } from "./infrastructure/services/MedicalHistoryService";
import { IPatientRepository } from "./domain/repositories/IPatientRepository";
import { INoteRepository } from "./domain/repositories/INoteRepository";
import { IFollowUpRepository } from "./domain/repositories/IFollowUpRepository";
import { IPrescriptionRepository } from "./domain/repositories/IPrescriptionRepository";
import { IMessageRepository } from "./domain/repositories/IMessageRepository";
import { IOpenAIClient } from "./domain/clients/IOpenAIClient";
import { INoteService } from "./domain/services/INoteService";
import { IFollowUpService } from "./domain/services/IFollowUpService";
import { IPrescriptionService } from "./domain/services/IPrescriptionService";
import { IAggregationService } from "./domain/services/IAggregationService";
import { IUserRepository } from "./domain/repositories/IUserRepository";
import { SummaryService } from './infrastructure/services/SummaryService';

// --- Initialize Express App ---
const app = express();
const port = process.env.PORT || 8080;

// --- Dependency Injection Container Setup ---
// Register MessageService implementation for IMessageService
container.register<IMessageService>(IMessageServiceToken, { useClass: MessageService });

// Register TextToSpeechService implementation for ITextToSpeechService
container.register<ITextToSpeechService>(ITextToSpeechServiceToken, { useClass: TextToSpeechService });
container.register("SummaryService", { useClass: SummaryService });

const authAppService = container.resolve(AuthApplicationService);
const authService = container.resolve<IAuthService>("IAuthService");
const conversationService = container.resolve<IConversationService>("IConversationService");
const conversationRepository = container.resolve<IConversationRepository>("IConversationRepository");
const transcriptionService = container.resolve(TranscriptionService);
const notificationService = container.resolve<INotificationService>("INotificationService");
const medicalHistoryService = container.resolve(MedicalHistoryService);
const aggregationService = container.resolve<IAggregationService>("IAggregationService");
const prisma = container.resolve<PrismaClient>("PrismaClient");

// --- Global Middleware --- 
// CORS
const allowedOrigins = [
    'https://interpreter-frontend-service-rc7cuwbtwa-uc.a.run.app', // Deployed frontend
    'http://localhost:5173', // Local frontend dev server (Vite default)
    'http://localhost:3000'  // Local frontend dev server (CRA default)
];
console.log(`[CORS] Configuring allowed origins:`, allowedOrigins);
const corsOptions: cors.CorsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            console.log(`[CORS] Allowed origin: ${origin}`);
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// JSON Body Parser
app.use(express.json());

// --- Public / Unauthenticated Routes ---
app.get('/api/v1/health', (req, res) => {
    res.status(200).send('OK');
});

app.get("/api/v1/", (req: Request, res: Response) => {
    res.send("Interpreter Backend is running!");
});

app.post("/api/v1/auth/register", (req: Request, res: Response, next: NextFunction) => {
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

app.post("/api/v1/auth/login", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const command: LoginUserCommand = req.body;
            if (!command.username || !command.password) {
                return res.status(400).json({ message: "Username and password are required" });
            }
            const result = await authAppService.loginUser(command);
            if (result.success && result.token && result.refreshToken) {
                // --- DEBUG LOG --- 
                console.log("[DEBUG /auth/login] Result object before sending response:", result);
                // -----------------
                
                // Ensure userId and username are included in the response
                res.status(200).json({
                    accessToken: result.token,
                    refreshToken: result.refreshToken,
                    userId: result.userId,      // Include userId
                    username: result.username   // Include username
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

app.post("/api/v1/auth/refresh", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken) {
                return res.status(400).json({ message: "Refresh token is required" });
            }

            const result = await authAppService.refreshAccessToken(refreshToken);

            if (result.success && result.token) {
                res.status(200).json({
                    accessToken: result.token,
                    ...(result.refreshToken && { refreshToken: result.refreshToken })
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

// --- Authentication Middleware (applied to all routes below) ---
app.use('/api/v1', authMiddleware);

// --- Protected / Authenticated Routes ---

// Get authenticated user profile
app.get("/api/v1/auth/me", async (req, res, next) => {
    try {
        // authMiddleware has already verified the token and attached the user payload
        const userPayload = req.user; 
        console.log(`[Route /auth/me] Request received for user:`, userPayload);

        if (userPayload && userPayload.id && userPayload.username) {
             // Return the necessary info directly from the token payload
            res.status(200).json({
                id: userPayload.id,
                username: userPayload.username
            });
        } else {
            // This case indicates an issue with the token payload or middleware
            console.error("[Route /auth/me] Missing user information in request after authMiddleware.");
            res.status(401).json({ message: "Invalid authentication token data." });
        }
    } catch (error) {
        console.error("Error processing /auth/me:", error);
        next(error); // Pass error to the default error handler
    }
});

// Get actions for a specific conversation
app.get("/api/v1/conversations/:conversationId/actions", async (req, res, next): Promise<void> => {
    try {
        const userId = req.user!.id; 
        const { conversationId } = req.params;
        
        console.log(`[Route /actions] Request received for conversation ID: ${conversationId} by user ID: ${userId}`);

        // 1. Verify conversation exists and user has access
        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
            console.warn(`[Route /actions] Conversation ${conversationId} not found.`);
            res.status(404).json({ message: "Conversation not found." });
            return;
        }
        if (conversation.userId !== userId) {
            console.warn(`[Route /actions] User ${userId} does not own conversation ${conversationId}.`);
            res.status(403).json({ message: "Forbidden: You do not have access to this conversation." });
            return;
        }

        // 2. Fetch aggregated actions using the AggregationService
        console.log(`[Route /actions] Fetching aggregated actions for conversation ${conversationId}...`);
        const actions = await aggregationService.getAggregatedActionsByConversationId(conversationId);
        console.log(`[Route /actions] Found ${actions.length} aggregated actions.`);
        
        res.status(200).json(actions);

    } catch (error) {
        console.error(`Error fetching aggregated actions for conversation ${req.params.conversationId}:`, error);
        next(error); // Pass error to the default error handler
    }
});

// Add back GET /conversations route
app.get("/api/v1/conversations", async (req, res, next) => {
    try {
        const userId = req.user!.id;
        console.log(`[REST API] Fetching conversations for user ${userId}`);
        const conversations = await conversationRepository.findByUserId(userId);
        res.status(200).json(conversations);
        // No return needed here, response is sent
    } catch (error) {
        console.error("[REST API] Error fetching conversations:", error);
        next(error); // Pass error to default handler
    }
});

// Create a new conversation
app.post("/api/v1/conversations", async (req, res, next) => {
    console.log(`[${new Date().toISOString()}] POST /conversations request received`);
    try {
        const userId = req.user!.id;
        const { firstName, lastName, dob, patientLanguage = "es" } = req.body;
        
        if (!firstName || !lastName || !dob) {
            res.status(400).json({ message: "Missing required patient information" });
            return;
        }
        
        console.log(`[REST API] Creating new conversation for user ${userId} with patient ${firstName} ${lastName}`);
        
        const startSessionResult = await conversationService.startNewSession({
            userId,
            patientFirstName: firstName,
            patientLastName: lastName,
            patientDob: new Date(dob),
            clinicianPreferredLanguage: patientLanguage
        });
        
        res.status(201).json(startSessionResult.conversation);
        return;
    } catch (error) {
        console.error("[REST API] Error creating conversation:", error);
        next(error);
    }
});

// Get medical history for a specific conversation
app.get("/api/v1/conversations/:id/medical-history", async (req, res, next) => {
    console.log(`[${new Date().toISOString()}] GET /conversations/:id/medical-history request for ID: ${req.params.id}`);
    try {
        const userId = req.user!.id;
        const conversationId = req.params.id;
        
        console.log(`[REST API] Fetching medical history for conversation ${conversationId}`);
        
        // Verify ownership
        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
            res.status(404).json({ message: "Conversation not found" });
            return;
        }
        
        if (conversation.userId !== userId) {
            res.status(403).json({ message: "Forbidden: You don't have access to this conversation" });
            return;
        }
        
        const history = await medicalHistoryService.getHistory(conversationId);
        res.status(200).json(history);
        return;
    } catch (error) {
        console.error(`[REST API] Error fetching medical history for conversation ${req.params.id}:`, error);
        next(error);
    }
});

// --- Add back POST /conversations/:id/end route ---
app.post("/api/v1/conversations/:id/end", async (req, res, next) => {
    console.log(`[${new Date().toISOString()}] POST /api/v1/conversations/:id/end request for ID: ${req.params.id}`);
    try {
        const userId = req.user!.id;
        const conversationId = req.params.id;
        
        console.log(`[REST API] Ending conversation ${conversationId} for user ${userId}`);
        
        // Verify ownership first (important!)
        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
            res.status(404).json({ message: "Conversation not found" });
            return;
        }
        if (conversation.userId !== userId) {
            res.status(403).json({ message: "Forbidden: You don't have access to this conversation" });
            return;
        }
        
        // End and summarize the conversation using the service
        // Assuming conversationService has an appropriate method like endAndSummarizeConversation
        const updatedConversation = await conversationService.endAndSummarizeConversation(conversationId);
        
        res.status(200).json(updatedConversation); // Send back the updated conversation with summary
        // No return needed
    } catch (error) {
        console.error(`[REST API] Error ending conversation ${req.params.id}:`, error);
        next(error); // Pass error to default handler
    }
});
// --- End Add back ---

// --- Create HTTP Server (needed for WebSocket upgrade) ---
const server = http.createServer(app);

// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ server });

interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    username?: string;
    currentConversationId?: string;
}

wss.on("connection", async (ws: AuthenticatedWebSocket, req: http.IncomingMessage) => {
    console.log("WebSocket: Client attempting to connect...");

    // Parse URL and query parameters
    const parsedUrl = url.parse(req.url || "", true);
    const pathname = parsedUrl.pathname;
    const queryParams = parsedUrl.query;
    console.debug("[DEBUG] WebSocket connection parsed parameters:", { pathname, tokenPresent: !!queryParams.token, conversationId: queryParams.conversationId || null });

    // Verify token for ALL WebSocket connections
    const token = queryParams.token;
    if (!token || typeof token !== "string") {
        console.error("[WebSocket Router] Missing or invalid token in WebSocket connection.");
        ws.close(4001, "Access token required");
        return;
    }
    try {
        const payload = await authService.verifyToken(token);
        console.debug("[DEBUG] Token verification successful. Payload:", { id: payload.id, username: payload.username });
        if (typeof payload === 'object' && payload !== null && payload.id && payload.username) {
            ws.userId = payload.id;
            ws.username = payload.username as string;
        } else {
            console.error("[WebSocket Router] Invalid token payload:", payload);
            ws.close(4001, "Invalid token payload");
            return;
        }
    } catch (error) {
        console.error("[WebSocket Router] Token verification error:", error);
        ws.close(4001, "Invalid token");
        return;
    }

    // Handle connection based on pathname
    if (pathname === '/transcription') {
        console.log("[DEBUG] Handling transcription connection for conversation:", queryParams.conversationId);
        // Handle Transcription Stream Connection (token already verified above)
        console.log("[WebSocket Router] /transcription: Handling connection...");
        const conversationId = queryParams.conversationId;
        if (!conversationId || typeof conversationId !== 'string') {
            console.error('[WebSocket Router] /transcription: Missing or invalid conversationId parameter');
            ws.close(1008, 'Missing required parameter: conversationId');
            return;
        }
        console.log(`[WebSocket Router] /transcription: New connection for conversation: ${conversationId}`);
        try {
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
        // Handle Control Channel Connection
        console.log("[DEBUG] Handling control channel connection. Client authenticated as:", { username: ws.username, userId: ws.userId });
        ws.send(JSON.stringify({ type: "system", text: "Welcome! You are connected via control channel." }));

        ws.on("message", async (messageData: WebSocket.Data, isBinary: boolean) => {
            // Existing control channel message handling logic...
            if (!ws.userId) {
                 console.warn("[WebSocket Router] Control Channel: Message received but userId not set (should not happen).");
                 ws.close(4001, "Authentication state lost");
                 return;
            }

            let request: any = null;
            let wsIdentifier = ws.username || 'unknown_user'; // Get identifier

            if (isBinary) {
                console.log(`[WebSocket Router] Control Channel: Received unexpected binary data from ${wsIdentifier}. Ignoring.`);
                return; // Ignore binary data
            } 
            
            const messageString = messageData.toString();
            try {
                request = JSON.parse(messageString);
            } catch (e) {
                console.error(`[WebSocket Router] Control Channel: Invalid JSON from ${wsIdentifier}: ${messageString}`);
                ws.send(JSON.stringify({ type: "error", text: "Invalid message format. Expected JSON." }));
                return;
            }
            
            console.log(`[WebSocket Router] Control Channel: Received message from ${wsIdentifier}:`, messageString); // Log full message once parsed

            console.log(`[WebSocket Router] Control Channel: Processing message type: ${request.type}`);

            if (!request || !request.type) {
                console.error(`[WebSocket Router] Control Channel: Invalid request format (missing type) from ${wsIdentifier}.`);
                ws.send(JSON.stringify({ type: "error", text: "Invalid message format: type is missing." }));
                return;
            }

            // --- Start of switch statement for control channel messages ---
            switch (request.type) {
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
                            
                            // Use the notification service to register the client
                            notificationService.registerClient(ws as any, conversationIdToSelect);
                            
                            console.log(`[WebSocket Router] Control Channel: User ${ws.username} selected conversation ${conversationIdToSelect}`);
                            
                            ws.send(JSON.stringify({
                                type: 'conversation_selected',
                                payload: {
                                    conversationId: conversation.id,
                                    isActive: conversation.status === "active",
                                    status: conversation.status,
                                    summary: conversation.summary,
                                    patientLanguage: conversation.patientLanguage
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
                            console.log(`[WebSocket Router] Control Channel: Sent ${messages.length} messages for conversation ${conversationIdToGet} to ${wsIdentifier}`);
                        } catch (error: any) {
                            console.error(`[WebSocket Router] Control Channel: Error fetching messages for ${wsIdentifier} (conv: ${conversationIdToGet}):`, error);
                            ws.send(JSON.stringify({ type: "error", text: error.message || "Failed to fetch messages" }));
                        }
                    } else {
                        console.warn(`[WebSocket Router] Control Channel: Invalid get_messages payload from ${wsIdentifier}:`, request.payload);
                        ws.send(JSON.stringify({ type: "error", text: "Invalid payload for get_messages" }));
                    }
                    break;

                // +++ Update get_actions Case +++
                case "get_actions":
                    console.log('[WebSocket Router] Control Channel: Entered get_actions case.');
                    const conversationIdForActions = request.payload?.conversationId;
                    console.log(`[WebSocket Router] Control Channel: Fetching actions for conversation: ${conversationIdForActions}`);

                    if (conversationIdForActions && typeof conversationIdForActions === 'string') {
                        try {
                            // Verify user access (important for WebSocket too)
                            const conversation = await conversationRepository.findById(conversationIdForActions);
                            if (!conversation || conversation.userId !== ws.userId) {
                                throw new Error("Access denied or conversation not found.");
                            }
                            
                            // Use the AggregationService to fetch actions
                            const actions = await aggregationService.getAggregatedActionsByConversationId(conversationIdForActions);
                            
                            console.log(`[WebSocket Router] Control Channel: Found ${actions.length} aggregated actions for conversation ${conversationIdForActions}`);
                            
                            // Send the actions back to the client
                            ws.send(JSON.stringify({
                                type: 'action_list',
                                payload: {
                                    conversationId: conversationIdForActions,
                                    actions: actions
                                }
                            }));

                        } catch (error) {
                            console.error(`[WebSocket Router] Control Channel: Error fetching aggregated actions for ${conversationIdForActions}:`, error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: `Failed to fetch actions: ${error instanceof Error ? error.message : String(error)}`
                            }));
                        }
                    } else {
                        console.error(`[WebSocket Router] Control Channel: Received get_actions without valid conversationId from ${wsIdentifier}`);
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: 'Invalid get_actions message: missing conversationId.' 
                        }));
                    }
                    break;
                // +++ End get_actions Case +++

                case "chat_message":
                    // --- ADDED check here --- 
                    if (!ws.currentConversationId) {
                        console.warn(`[WebSocket Router] Control Channel: Received chat_message from ${wsIdentifier} but no active conversation set on this connection. Ignoring.`);
                        ws.send(JSON.stringify({ type: "error", text: "No active session selected to send message to." }));
                        break; // Use break instead of return to allow ws.on('close') etc.
                    }
                    // -------------------------
                    try {
                        const text = request.payload?.text;
                        if (!text || typeof text !== "string") {
                            throw new Error("Missing or invalid text payload in chat_message");
                        }
                        console.log(`[WebSocket Router] Control Channel: Processing chat_message for active conv ${ws.currentConversationId}: "${text.substring(0, 50)}..."`);
                        // TODO: Forward message to appropriate service/handler if needed, 
                        // or just echo back for simple chat testing
                        const response = {
                            type: "message_received", // Or maybe broadcast this?
                            id: Date.now().toString(), 
                            text: text
                        };
                        ws.send(JSON.stringify(response));
                        
                    } catch (error: any) {
                        console.error(`[WebSocket Router] Control Channel: Error processing chat_message for ${wsIdentifier}:`, error);
                        ws.send(JSON.stringify({ type: "error", text: error.message || "Failed to process chat message" }));
                    }
                    break;

                case "get_summary":
                    console.log('[WebSocket Router] Control Channel: Entered get_summary case.');
                    const conversationIdToSummarize = request.payload?.conversationId;
                    console.log(`[WebSocket Router] Control Channel: Extracted conversationId: ${conversationIdToSummarize}`);

                    if (conversationIdToSummarize && typeof conversationIdToSummarize === 'string') {
                        try {
                            // Find the conversation
                            const conversation = await conversationRepository.findById(conversationIdToSummarize);
                            
                            if (!conversation) {
                                throw new Error(`Conversation not found: ${conversationIdToSummarize}`);
                            }
                            // Optional: Check user access again if needed
                            if (conversation.userId !== ws.userId) {
                                 throw new Error("Access denied to this conversation summary.");
                            }
                            
                            console.log(`[WebSocket Router] Control Channel: Found conversation ${conversationIdToSummarize}. Status: ${conversation.status}, Summary Exists: ${!!conversation.summary}`);
                            
                            // Send back the summary data (even if null/empty)
                            ws.send(JSON.stringify({
                                type: 'summary_data',
                                payload: {
                                    conversationId: conversation.id,
                                    summary: conversation.summary?.content || null
                                }
                            }));

                        } catch (error) {
                            console.error(`[WebSocket Router] Control Channel: Error processing get_summary for ${conversationIdToSummarize}:`, error);
                            ws.send(JSON.stringify({
                                 type: 'error',
                                 message: `Failed to get summary for ${conversationIdToSummarize}: ${error instanceof Error ? error.message : String(error)}`
                             }));
                        }
                    } else {
                        console.error(`[WebSocket Router] Control Channel: Received get_summary message from ${wsIdentifier} without valid conversationId.`);
                         ws.send(JSON.stringify({ type: 'error', message: 'Invalid get_summary message: missing conversationId.' }));
                    }
                    break;
                // +++ End get_summary Case +++

                // +++ Add get_medical_history Case +++
                case "get_medical_history":
                    console.log('[WebSocket Router] Control Channel: Entered get_medical_history case.');
                    const conversationIdForHistory = request.payload?.conversationId;
                    console.log(`[WebSocket Router] Control Channel: Fetching history for conversation: ${conversationIdForHistory}`);

                    if (conversationIdForHistory && typeof conversationIdForHistory === 'string') {
                        try {
                            // Optional: Verify user has access to this conversation if needed
                            const conversation = await conversationRepository.findById(conversationIdForHistory); // Re-use existing repo
                            if (!conversation) {
                                throw new Error(`Conversation not found: ${conversationIdForHistory}`);
                            }
                            if (conversation.userId !== ws.userId) {
                                throw new Error(`Access denied to medical history for conversation ${conversationIdForHistory}`);
                            }

                            // Fetch history using the service
                            const history = await medicalHistoryService.getHistory(conversationIdForHistory);
                            
                            console.log(`[WebSocket Router] Control Channel: Medical history fetched for ${conversationIdForHistory}. Found: ${!!history}`);
                            if (!history) {
                                console.log(`[WebSocket Router] Medical history not found for conversation ${conversationIdForHistory}. It should be generated now.`);
                            } else {
                                console.log(`[WebSocket Router] Medical history generated for conversation ${conversationIdForHistory} with content: ${history.content}`);
                            }
                            
                            // Broadcast the medical history data to all clients for this conversation using the notification service
                            notificationService.broadcastMessage(conversationIdForHistory, {
                                type: 'medical_history_data',
                                payload: {
                                    conversationId: conversationIdForHistory,
                                    history: history ? history.content : null
                                }
                            });

                        } catch (error) {
                            console.error(`[WebSocket Router] Control Channel: Error fetching medical history for ${conversationIdForHistory}:`, error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: `Failed to fetch medical history: ${error instanceof Error ? error.message : String(error)}`
                            }));
                        }
                    } else {
                        console.error(`[WebSocket Router] Control Channel: Received get_medical_history without valid conversationId from ${wsIdentifier}`);
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: 'Invalid get_medical_history message: missing conversationId.' 
                        }));
                    }
                    break;
                // +++ End get_medical_history Case +++

                default:
                    console.log(`[WebSocket Router] Control Channel: Received unknown message type from ${wsIdentifier}:`, request.type);
                    ws.send(JSON.stringify({ type: "error", text: `Unknown message type: ${request.type}` }));
            }
            // --- End of switch statement ---
        });

        ws.on("close", (code: number, reason: Buffer) => {
            console.log(`[WebSocket Router] Control Channel: Client ${ws.username} disconnected`);
            // Use the notification service to remove the client
            notificationService.removeClient(ws as any);
        });

        ws.on("error", (error: Error) => {
            console.error(`[WebSocket Router] Control Channel: Error for ${ws.username}:`, error);
        });
    }
});

// --- Database Connection Check ---
async function checkDbConnection() {
    console.log("Attempting to connect to database...");
    try {
        await prisma.$connect();
        console.log("✅ Database connection established successfully.");
    } catch (error) {
        console.error("❌ Failed to establish database connection:", error);
        // Optionally exit if connection is crucial for startup
        // process.exit(1);
    }
}

// --- Start Server ---
checkDbConnection().then(() => {
    server.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}).catch(err => {
    console.error("Database connection check failed, server not started.", err);
    // process.exit(1); // Exit if DB check promise itself fails
});

// --- Global Error Handlers (Must be defined LAST) ---
process.on('uncaughtException', (error) => {
  console.error('--- UNCAUGHT EXCEPTION ---');
  console.error('Caught exception:', error.message);
  console.error('Stack Trace:', error.stack);
  console.error('--------------------------');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('--- UNHANDLED REJECTION ---');
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  console.error('---------------------------');
});
// ---------------------------------------------------------
