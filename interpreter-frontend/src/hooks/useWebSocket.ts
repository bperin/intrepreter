import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws"; // Corrected default URL

interface WebSocketHook {
    isConnected: boolean;
    lastMessage: any | null; // Change type to allow parsed object
    sendMessage: (message: string | object | Blob) => void; // Allow sending Blob
    error: Error | null;
}

export const useWebSocket = (): WebSocketHook => {
    const { accessToken } = useAuth();
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<any | null>(null); // Change type
    const [error, setError] = useState<Error | null>(null);
    const webSocketRef = useRef<WebSocket | null>(null);
    // Use number for browser setTimeout/clearTimeout return type
    const connectTimeoutRef = useRef<number | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const reconnectAttemptsRef = useRef<number>(0);
    const maxReconnectAttempts = 5;
    const reconnectDelay = 5000; // 5 seconds

    const disconnectCleanup = useCallback((isIntentional = false) => {
        if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
        }
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (webSocketRef.current) {
            // Remove listeners before closing to prevent errors during cleanup
            webSocketRef.current.onopen = null;
            webSocketRef.current.onmessage = null;
            webSocketRef.current.onerror = null;
            webSocketRef.current.onclose = null;
            // Check state before closing
            if (webSocketRef.current.readyState === WebSocket.OPEN || webSocketRef.current.readyState === WebSocket.CONNECTING) {
                webSocketRef.current.close(isIntentional ? 1000 : 4000); // Normal closure or forced closure
            }
            webSocketRef.current = null;
        }
        setIsConnected(false);
    }, []);

    const connectWebSocket = useCallback(() => {
        // Don't cleanup if already connecting/open (avoids infinite loops on rapid calls)
        if (webSocketRef.current?.readyState === WebSocket.OPEN || webSocketRef.current?.readyState === WebSocket.CONNECTING) {
            return;
        }

        disconnectCleanup(); // Clean up previous state before attempting connection

        if (!accessToken) {
            console.log("WebSocket: No access token, connection aborted.");
            setError(new Error("Authentication token is missing."));
            setIsConnected(false);
            return;
        }

        console.log(`WebSocket: Attempting to connect to ${WS_URL}...`);
        const wsWithTokenUrl = `${WS_URL}?token=${accessToken}`;

        try {
            webSocketRef.current = new WebSocket(wsWithTokenUrl);
            webSocketRef.current.binaryType = "blob"; // Important for receiving audio
        } catch (err: any) {
            console.error("WebSocket: Failed to create WebSocket instance:", err);
            setError(new Error(`Failed to create WebSocket: ${err.message}`));
            setIsConnected(false);
            return;
        }

        connectTimeoutRef.current = window.setTimeout(() => {
            // Use window.setTimeout for clarity
            if (webSocketRef.current?.readyState !== WebSocket.OPEN) {
                console.error("WebSocket: Connection attempt timed out.");
                setError(new Error("WebSocket connection attempt timed out."));
                disconnectCleanup();
                // Consider triggering reconnect attempt here
                // scheduleReconnect();
            }
        }, 10000); // 10 second timeout

        webSocketRef.current.onopen = () => {
            console.log("WebSocket: Connection Established");
            if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
            setIsConnected(true);
            setError(null);
            reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
        };

        webSocketRef.current.onmessage = (event) => {
            // Handle both text and binary messages
            if (typeof event.data === "string") {
                console.log("WebSocket: Text Message Received:", event.data);
                try {
                    const parsedMessage = JSON.parse(event.data);
                    setLastMessage(parsedMessage);
                } catch (e) {
                    console.error("WebSocket: Failed to parse incoming JSON:", e, "Raw data:", event.data);
                    // Handle non-JSON text messages or parsing errors
                    // Option 1: Set raw string if needed for some messages
                    // setLastMessage(event.data); 
                    // Option 2: Set an error state or a specific error message object
                    setLastMessage({ type: 'error', payload: { message: 'Received invalid JSON from server.' } });
                    setError(new Error("Received invalid JSON message from server."));
                }
            } else if (event.data instanceof Blob) {
                console.log("WebSocket: Binary Message (Blob) Received, size:", event.data.size);
                // Convert Blob to Base64 or ArrayBuffer before setting state if needed
                // For now, pass the raw stringified blob info if parsing fails in component
                // Or better: Define a specific message structure for binary data
                const reader = new FileReader();
                reader.onload = () => {
                    // Example: Send structured message for audio
                    const audioMsg = JSON.stringify({ type: "audio_data", payload: reader.result });
                    setLastMessage(audioMsg);
                };
                reader.onerror = () => {
                    console.error("Failed to read Blob data");
                    // Send an error message back?
                    setLastMessage(JSON.stringify({ type: "error", text: "Failed to process received audio data" }));
                };
                reader.readAsDataURL(event.data); // Read as Base64 Data URL
            } else {
                console.warn("WebSocket: Received unexpected message type:", typeof event.data);
            }
        };

        webSocketRef.current.onerror = (event) => {
            console.error("WebSocket: Error event:", event);
            // This event doesn't carry much info, onclose provides more
            // We might set a generic error state here, but wait for onclose for reconnect logic
            setError(new Error("WebSocket error event occurred."));
        };

        webSocketRef.current.onclose = (event) => {
            console.log("WebSocket: Connection Closed:", event.code, event.reason, `Was Clean: ${event.wasClean}`);
            if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
            setIsConnected(false);
            webSocketRef.current = null;

            // Only attempt reconnect on unexpected closures
            // Codes: 1000 (Normal), 1001 (Going Away), 1005 (No Status Rcvd - often browser tab close)
            // Avoid reconnect if max attempts reached or if closure was expected/triggered by cleanup
            if (!event.wasClean && event.code !== 1000 && event.code !== 1001 && event.code !== 1005) {
                const reason = event.reason || "Unknown reason";
                const errMsg = `WebSocket closed unexpectedly (${event.code}): ${reason}`;
                console.error(errMsg);
                setError(new Error(errMsg));
                scheduleReconnect();
            }
        };
    }, [accessToken, disconnectCleanup]);

    const scheduleReconnect = useCallback(() => {
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            const delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1), 30000); // Exponential backoff up to 30s
            console.log(`WebSocket: Attempting reconnect (${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${delay / 1000}s...`);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = window.setTimeout(connectWebSocket, delay); // Use window.setTimeout
        } else {
            console.error("WebSocket: Max reconnect attempts reached.");
            setError(new Error("WebSocket connection failed after multiple attempts. Please check your connection or try refreshing."));
        }
    }, [connectWebSocket]);

    useEffect(() => {
        if (accessToken) {
            // Only attempt connection if token exists
            connectWebSocket();
        }
        return () => {
            console.log("WebSocket: Cleaning up connection on unmount/token change...");
            reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent reconnect attempts during cleanup
            disconnectCleanup(true); // Mark as intentional closure
        };
    }, [accessToken, connectWebSocket, disconnectCleanup]); // Rerun if token changes

    const sendMessage = useCallback((message: string | object | Blob) => {
        if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
            try {
                if (message instanceof Blob) {
                    console.log("WebSocket: Sending Blob, size:", message.size);
                    webSocketRef.current.send(message);
                } else {
                    const messageToSend = typeof message === "string" ? message : JSON.stringify(message);
                    console.log("WebSocket: Sending Text/JSON:", messageToSend);
                    webSocketRef.current.send(messageToSend);
                }
            } catch (err: any) {
                console.error("WebSocket: Error sending message:", err);
                setError(new Error(`Failed to send message: ${err.message}`));
                // Consider closing the connection if sending fails persistently
                // disconnectCleanup();
                // scheduleReconnect();
            }
        } else {
            const errorMsg = "WebSocket is not connected. Cannot send message.";
            console.error(errorMsg);
            setError(new Error(errorMsg));
        }
    }, []);

    return { isConnected, lastMessage, sendMessage, error };
};
