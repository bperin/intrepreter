# Backend Implementation Overview (Transcription Proxy Architecture)

This document provides an overview of the backend implementation, focusing on how the backend processes audio data and forwards it to OpenAI's API for transcription.

## Core Flow: Transcription & Processing

- [x]   1.  **Session Initiation (Frontend -> Backend via HTTP/REST initially)**: Frontend authenticates and potentially requests to start/join a conversation via standard HTTP requests, receiving a `conversationId`.
- [x]   2.  **Frontend WS Connection (Frontend -> Backend WebSocket)**: Frontend establishes a WebSocket connection to the backend's transcription endpoint (e.g., `/transcription`) using the obtained `conversationId`.
- [x]   3.  **Backend WS Handling (Backend)**: The backend's `TranscriptionService` accepts the connection, associating the WebSocket with the `conversationId`.
- [x]   4.  **Shared OpenAI Connection (Backend)**: The `TranscriptionService` ensures a _single, shared_ WebSocket connection to OpenAI's Realtime API is active (or establishes it if needed), authenticated with the `OPENAI_API_KEY`.
- [x]   5.  **Shared FFmpeg Process (Backend)**: The `TranscriptionService` ensures a _single, shared_ FFmpeg process is running to handle audio conversion.
- [x]   6.  **Audio Streaming (Frontend -> Backend via WebSocket)**: The frontend captures audio (e.g., WebM/Opus) and sends chunks over its dedicated WebSocket connection to the backend.
- [x]   7.  **Audio Pipelining (Backend)**: The `TranscriptionService` receives the WebM/Opus chunk and writes it to the stdin of the persistent FFmpeg process.
- [x]   8.  **Audio Conversion (Backend - FFmpeg)**: FFmpeg converts the incoming audio chunk to PCM 16-bit, 24kHz, mono format and outputs it via stdout.
- [x]   9.  **Audio Forwarding (Backend -> OpenAI via WebSocket)**: The `TranscriptionService` reads the PCM chunk from FFmpeg's stdout, encodes it (e.g., Base64), and sends it over the _shared_ WebSocket connection to OpenAI.
- [x]   10. **Transcription Results (OpenAI -> Backend via WebSocket)**: OpenAI sends transcription results (deltas, final segments) back over the shared WebSocket.
- [x]   11. **Result Routing & Broadcasting (Backend -> Frontend via WebSocket)**: The `TranscriptionService` receives the results from OpenAI and broadcasts them to the specific frontend client WebSocket associated with the correct `conversationId`.
- [ ]   12. **Command Detection (Backend)**: The backend examines transcriptions to identify potential voice commands (e.g., "Sully write prescription").
- [ ]   13. **Action Execution (Backend)**: When voice commands are detected, the backend executes the corresponding actions and broadcasts relevant updates to the frontend.

## Key Components

- [x] **`TranscriptionService.ts`**: Central component. Manages client WebSocket connections per `conversationId`. Handles the lifecycle of the shared OpenAI WebSocket connection and the persistent FFmpeg process. Routes incoming audio from clients to FFmpeg, reads PCM from FFmpeg, forwards to OpenAI, receives results from OpenAI, and broadcasts back to the correct client.
- [x] **`WebSocketServer` (in `index.ts` or similar)**: Sets up the WebSocket server listening on the `/transcription` endpoint. Passes new connections and messages to the `TranscriptionService`.
- [ ] **`CommandParser.ts`**: Analyzes transcription text to identify predefined voice commands patterns and triggers appropriate actions.
- [x] **`ConversationService.ts` / Authentication Logic**: Handles initial authentication and association of users/patients with conversations (likely via HTTP/REST before WebSocket connection).
- [x] **Application Services**: Contain the core business logic for handling transcriptions (saving, translating, detecting actions) and managing conversation lifecycle.

## Voice Command Processing

- [ ] **Pattern Recognition**: The backend uses regex patterns or other parsing techniques to identify voice commands in transcribed text.
- [ ] **Command Execution**: When a command is recognized, the backend executes the corresponding action (e.g., adding a prescription, recording a note).
- [ ] **Frontend Notification**: The backend notifies the frontend of command execution via WebSocket, allowing the UI to update accordingly.

## Current Limitations & TODOs

- [ ] **Audio Quality**: Ensuring optimal audio quality from the client and robust handling of FFmpeg conversion.
- [x] **OpenAI Realtime API Format**: Handled by the backend using FFmpeg for conversion to PCM16@24kHz.
- [ ] **Error Handling**: Robust handling of client WebSocket disconnections, FFmpeg process errors/crashes, OpenAI API errors/disconnects, and ensuring proper cleanup of shared resources.
- [ ] **Shared Resource Management**: Careful management of the single OpenAI connection and single FFmpeg process, including locking or queueing if concurrent operations become an issue (though current design seems mostly stream-based).
- [ ] **Command Recognition Accuracy**: Improving the accuracy of voice command recognition, potentially using NLP techniques.
- [ ] **Resource Management**: Ensuring WebSocket connections and audio buffers are properly managed to avoid resource leaks, especially on shared resource errors.
- [ ] **Scaling**: The shared FFmpeg process and OpenAI connection represent potential bottlenecks for horizontal scaling. Scaling might require multiple backend instances each managing their own shared resources or a more complex distributed architecture.
- [ ] **Voice Command Customization**: Allowing for customization of voice commands per user or organization.
- [ ] **Voice Recognition and Diarization**: Implementing speaker identification to differentiate between clinician and patient.

## Debug Logging

The backend includes extensive logging to help troubleshoot issues in the audio processing pipeline:

- Audio chunk reception logging
- Buffer status and size tracking
- Transcription timing and completion events
- Error propagation for API calls and internal processing

## WebSocket Route Implementation

The backend implements one primary WebSocket route for transcription:

1. **Transcription Channel** (`/transcription?conversationId=...`): Handles client connections for a specific conversation. Receives audio chunks (e.g., WebM/Opus) from the client and sends back transcription results received from OpenAI.

(Initial session setup and authentication likely occur over standard HTTP/REST endpoints before the WebSocket connection is established).

## Database Integration

- Conversations, messages, and actions are stored in a PostgreSQL database via Prisma ORM
- The schema includes tables for Users, Patients, Conversations, Messages, and Actions
- Relationships between these entities allow for efficient querying and data retrieval
