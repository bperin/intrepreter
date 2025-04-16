# Backend Implementation Overview (Pipeline Architecture)

This document provides an overview of the backend implementation, focusing on its role as a central pipeline for processing audio, handling transcriptions, translations, commands, and text-to-speech synthesis.

## Core Flow: Audio Processing Pipeline

1.  **Session Initiation (Frontend -> Backend via HTTP/REST)**: Frontend authenticates and starts/joins a conversation via standard HTTP requests, receiving a `conversationId`.
2.  **WebSocket Connection (Frontend -> Backend)**: Frontend establishes a persistent WebSocket connection to the backend (e.g., `/transcription` for audio, general connection for control). Authentication is performed via a token in the connection query parameters.
3.  **Backend WebSocket Handling (Backend)**:
    - `index.ts`: Manages incoming WebSocket connections, authenticates them using `AuthService`, and routes them based on the connection path (`/transcription` or control).
    - `WebSocketNotificationService`: Manages client connections for broadcasting messages to specific conversations.
    - `ConversationPipelineService`: Handles connections specifically for the `/transcription` path, managing the audio processing for that conversation.
4.  **Audio Streaming (Frontend -> Backend via /transcription WebSocket)**: The frontend captures audio, Base64 encodes chunks, and sends them as JSON messages (`{ type: 'input_audio_buffer.append', audio: 'base64...' }`) over the WebSocket to the backend's `ConversationPipelineService`. `finalize`, `pause`, and `resume` messages control the stream.
5.  **Audio Conversion (Backend - `FFmpegService`)**: For each active `/transcription` connection, `ConversationPipelineService` creates an `FFmpegService` instance. This service receives Base64 audio chunks, decodes them, and uses an FFmpeg process to convert the audio stream to PCM 16-bit, 24kHz, mono format suitable for OpenAI.
6.  **OpenAI STT Connection (Backend - `ConversationPipelineService`)**: `ConversationPipelineService` establishes and manages a _separate_ WebSocket connection _per conversation_ to OpenAI's Realtime Transcription API (`wss://api.openai.com/v1/realtime?intent=transcription`), authenticated using the backend's `OPENAI_API_KEY`.
7.  **Audio Forwarding (Backend -> OpenAI via Realtime WebSocket)**: The `FFmpegService` emits PCM chunks. `ConversationPipelineService` receives these chunks, Base64 encodes them, and sends them over the corresponding conversation's OpenAI Realtime WebSocket connection.
8.  **Transcription Results (OpenAI -> Backend via Realtime WebSocket)**: OpenAI sends transcription results (currently only `conversation.item.input_audio_transcription.completed` is processed) back over the dedicated OpenAI WebSocket for that conversation.
9.  **Backend Processing Pipeline (Backend - `ConversationPipelineService`)**: Upon receiving a completed transcription:
    - Calls `ILanguageDetectionService` (using OpenAI SDK) to determine the language and sender (`user` or `patient`).
    - If `sender === 'user'`, asynchronously calls `ICommandDetectionService` (using OpenAI SDK with function/tool definitions) to check for commands.
    - Calls `IMessageService` to save the original transcription message.
    - If translation is needed (based on sender, detected language, and conversation's `patientLanguage`), calls `ITranslationService` (using OpenAI SDK) to get the translation. Saves the translated message via `IMessageService`.
    - Determines the appropriate text and language for Text-to-Speech (either original or translated).
    - Calls `ITextToSpeechService` (using OpenAI SDK) to synthesize audio.
    - If command was detected earlier, calls `ICommandExecutionService` to execute the command (e.g., saving notes, follow-ups, prescriptions via respective services).
10. **Broadcasting Results (Backend -> Frontend via Control WebSocket)**: The `ConversationPipelineService` (and `CommandExecutionService`) uses the `WebSocketNotificationService` to broadcast processed results back to all connected frontend clients for the specific `conversationId`. Message types include:
    - `new_message`: Contains saved original or translated messages.
    - `tts_audio`: Contains the Base64 encoded synthesized speech and the ID of the original message it corresponds to.
    - `command_executed`: Contains the result of a command execution attempt.
    - Other status/error messages.

## Key Components

- **`index.ts`**: Entry point, sets up Express server, WebSocket server (`ws`), DI container (`tsyringe`), middleware (CORS, JSON), REST routes, and WebSocket connection routing/authentication.
- **`container.ts`**: Configures dependency injection using `tsyringe`, mapping interfaces (e.g., `IMessageService`) to their concrete implementations (e.g., `MessageService`).
- **`ConversationPipelineService.ts`**: Orchestrates the real-time audio processing pipeline for a single conversation. Manages the OpenAI Realtime WebSocket connection and `FFmpegService` instance for that conversation. Calls various domain services for processing steps.
- **`FFmpegService.ts`**: Wraps the `fluent-ffmpeg` library to handle audio conversion from input format to PCM required by OpenAI. Manages the FFmpeg child process lifecycle.
- **`LanguageDetectionService.ts`**: Implements `ILanguageDetectionService` using the OpenAI SDK (`chat.completions.create`) to detect the language of a text snippet.
- **`TranslationService.ts`**: Implements `ITranslationService` using the OpenAI SDK for non-streaming translation.
- **`TextToSpeechService.ts`**: Implements `ITextToSpeechService` using the OpenAI SDK (`audio.speech.create`).
- **`CommandDetectionService.ts`**: Implements `ICommandDetectionService` using the OpenAI SDK (`chat.completions.create` with `tools`) to identify predefined commands in user text.
- **`CommandExecutionService.ts`**: Implements `ICommandExecutionService`, taking detected command details and calling appropriate services (`INoteService`, `IFollowUpService`, `IPrescriptionService`) to perform actions.
- **`MessageService.ts`**: Implements `IMessageService` interacting with `IMessageRepository` for saving/retrieving messages.
- **`NoteService.ts`, `FollowUpService.ts`, `PrescriptionService.ts`**: Implement respective domain interfaces for managing specific action-related data.
- **`OpenAISummaryService.ts`**: Implements `ISummaryService`, fetching messages and using `ILanguageModelService` to generate and save summaries.
- **`OpenAILanguageModelService.ts`**: Implements `ILanguageModelService` for general chat completion tasks (like generating summaries).
- **`MedicalHistoryService.ts`**: Generates mock medical history using OpenAI SDK and retrieves it.
- **`WebSocketNotificationService.ts`**: Manages connected WebSocket clients per conversation, allowing services to broadcast messages to the relevant frontend instances.
- **Domain Services (Interfaces)** (`src/domain/services/`): Define contracts for core functionalities (e.g., `IMessageService`, `ITranslationService`, `ICommandDetectionService`).
- **Repositories (Interfaces & Implementations)** (`src/domain/repositories/`, `src/infrastructure/persistence/`): Define data access contracts and implement them using Prisma (e.g., `IConversationRepository`, `PrismaConversationRepository`).
- **Authentication Logic (`JwtAuthService`, `authMiddleware`)**: Handles user authentication using JWT.

## Voice Command Processing

- **Detection**: `CommandDetectionService` uses OpenAI's tool-calling feature via the SDK. Tool definitions (for `request_summary`, `request_medical_history`, `take_note`, `schedule_follow_up`, `write_prescription`) are provided to the model.
- **Execution**: `CommandExecutionService` receives the detected tool name and arguments. It uses a switch statement to call the appropriate domain service (e.g., `INoteService.createNote`).
- **Notification**: The result (`CommandExecutionResult`) is broadcast back to the frontend via the `command_executed` WebSocket message.

## Database Integration

- Conversations, messages, users, patients, notes, follow-ups, prescriptions, summaries, and medical histories are stored in a PostgreSQL database via Prisma ORM.
- The schema (`schema.prisma`) defines models and relations.

## WebSocket Routes

- `/transcription?conversationId=...&token=...`: Accepts WebSocket connections specifically for streaming audio _to_ the backend for a given conversation. Handled by `ConversationPipelineService`.
- General WebSocket Connection (root path `/?token=...`): Used for control messages (selecting conversations, requesting actions) and receiving broadcasted results (`new_message`, `tts_audio`, `command_executed`, etc.). Handled by logic in `index.ts` and `WebSocketNotificationService`.

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
