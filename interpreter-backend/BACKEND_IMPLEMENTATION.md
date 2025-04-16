# Backend Implementation Overview

This document provides a high-level overview of the backend implementation, focusing on its role as a central pipeline for processing audio and managing conversation state.

## Core Flow: Audio Processing Pipeline

1.  **Connection:** Frontend connects via WebSocket (`/` for control, `/transcription` for audio), authenticating with a JWT.
2.  **Audio Input:** Frontend sends Base64 audio chunks over the `/transcription` WebSocket.
3.  **Backend Handling:** `ConversationPipelineService` manages the connection for a specific `conversationId`.
4.  **Conversion:** An `FFmpegService` instance converts incoming audio to PCM format.
5.  **OpenAI STT:** The PCM audio is streamed to OpenAI's Realtime Transcription API via a dedicated WebSocket connection managed per conversation by `ConversationPipelineService`.
6.  **Transcription Received:** Backend receives completed transcription segments from OpenAI.
7.  **Processing Pipeline:** `ConversationPipelineService` orchestrates calls to:
    - `ILanguageDetectionService` (Determines speaker/language).
    - `ICommandDetectionService` (Checks for commands if speaker is 'user').
    - `IMessageService` (Saves original message).
    - `ITranslationService` (Translates if needed).
    - `IMessageService` (Saves translation).
    - `ITextToSpeechService` (Generates audio for the other participant).
    - `ICommandExecutionService` (Executes detected commands).
8.  **Broadcasting:** Processed results (`new_message`, `tts_audio`, `command_executed`) are broadcast to relevant frontend clients via `WebSocketNotificationService` over the control channel WebSocket.

## Key Components & Technologies

- **Runtime/Framework:** Node.js, TypeScript, Express.js
- **WebSockets:** `ws` library (handling `/` and `/transcription` paths)
- **Orchestration:** `ConversationPipelineService` (manages per-conversation pipeline)
- **Audio Conversion:** `FFmpegService` (using `fluent-ffmpeg`)
- **AI Services (using OpenAI SDK):**
    - Realtime STT (via WebSocket in `ConversationPipelineService`)
    - Language Detection (`LanguageDetectionService`)
    - Translation (`TranslationService`)
    - Command Detection (`CommandDetectionService` using tool calling)
    - TTS (`TextToSpeechService`)
    - Summarization (`OpenAISummaryService` via `ILanguageModelService`)
    - Mock History Generation (`MedicalHistoryService`)
- **Command Execution:** `CommandExecutionService` (calls `INoteService`, `IFollowUpService`, `IPrescriptionService`)
- **Persistence:** Prisma (PostgreSQL) implementing `IRepository` interfaces.
- **Notifications:** `WebSocketNotificationService` (broadcasts results).
- **Dependency Injection:** `tsyringe` (`container.ts`)
- **Authentication:** JWT (`JwtAuthService`, `authMiddleware`)

## Voice Command Processing

- Detected via OpenAI tool calling in `CommandDetectionService`.
- Executed by `CommandExecutionService`.
- Results broadcast via `command_executed` message.

## Database Integration

- PostgreSQL managed via Prisma ORM.
- Schema includes tables for users, patients, conversations, messages, actions (notes, followups, prescriptions), summaries, medical histories.

## WebSocket Routes

- `/transcription?conversationId=...&token=...`: Audio input streaming.
- `/?token=...`: Control messages and receiving broadcast results.

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
