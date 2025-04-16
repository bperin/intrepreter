# Implementation Plan: Interpreter Proof-of-Concept (Reflecting Final Build)

## 1. Overall Architecture

The system consists of:

1.  **ReactJS Frontend:** Captures user speech, sends audio chunks via WebSocket to the backend, receives processed results (transcriptions, translations, TTS audio, command results) via WebSocket, displays conversation, summary, and actions. Handles user login/registration via REST API. Manages state using React Context.
2.  **Node.js/Express/TypeScript Backend:** Manages WebSocket connections (audio streaming input on `/transcription`, control/data broadcast on `/`), handles user authentication (JWT). Acts as a pipeline: receives audio, uses FFmpeg for conversion, sends to OpenAI Realtime STT API (WebSocket per conversation), receives transcriptions, orchestrates language detection, translation, command detection (using OpenAI SDKs), TTS synthesis, database persistence (Prisma), and broadcasting results back to the frontend.
3.  **Database (PostgreSQL):** Stores users, patients, conversations (including `patientLanguage`), messages, notes, follow-ups, prescriptions, summaries, medical histories. Prisma ORM used. Deployed on Cloud SQL.
4.  **External Services:**
    - **OpenAI Realtime API (WebSocket):** For low-latency STT, VAD.
    - **OpenAI APIs (SDK):** Chat/Completion for Translation, Summary, Language Detection, Command Detection. TTS API.
5.  **Deployment:** Separate containerized applications (Frontend, Backend) deployed independently to Google Cloud Run.

## 2. Repository Structure

Two separate Git repositories were used:

1.  `interpreter-backend`: Contains the Node.js/TypeScript application.
2.  `interpreter-frontend`: Contains the ReactJS application.

## 3. Backend Implementation (Node.js/TypeScript/Express/WebSockets/DDD Principles)

Structured using DDD principles with Domain, Application (implicit), and Infrastructure layers.

**a. Domain Layer (`src/domain`)**

- **Entities/Models (via Prisma):** `User`, `Patient`, `Conversation`, `Message`, `Note`, `FollowUp`, `Prescription`, `Summary`, `MedicalHistory`.
- **Domain Services (Interfaces):** Defined contracts for core business logic decoupled from infrastructure.
  - `IAuthService`, `IConversationService`, `IMessageService`, `ITextToSpeechService`, `ILanguageDetectionService`, `ITranslationService`, `ICommandDetectionService`, `ICommandExecutionService`, `ILanguageModelService`, `ISummaryService`, `INotificationService`, `INoteService`, `IFollowUpService`, `IPrescriptionService`, `IAggregationService`.
- **Repositories (Interfaces):** Defined contracts for data access (`IUserRepository`, `IConversationRepository`, `IMessageRepository`, etc.).

**b. Application Layer (Implicit within Services/`index.ts`)**

- Logic is primarily orchestrated within Infrastructure services, especially `ConversationPipelineService` and the route/WebSocket handlers in `index.ts`.
- Core flows like starting sessions, handling transcriptions, detecting/executing commands, generating summaries are managed here, coordinating calls to domain services.

**c. Infrastructure Layer (`src/infrastructure`)**

- **API (Express in `index.ts`):**
  - REST endpoints for `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/me`, `/conversations`, `/conversations/:id/medical-history`, `/conversations/:id/end`, `/conversations/:conversationId/actions`.
  - Auth handled by `JwtAuthService` and `authMiddleware`.
- **WebSockets (`index.ts`, `WebSocketNotificationService`, `ConversationPipelineService`):**
  - Uses `ws` library integrated with Express HTTP server.
  - Handles connection auth via token in query params.
  - Routes connections based on path (`/` for control/broadcast, `/transcription` for audio input).
  - `WebSocketNotificationService` manages broadcasting messages to clients subscribed to specific conversations.
  - `ConversationPipelineService` manages the per-conversation audio pipeline (FFmpeg, OpenAI STT connection).
- **OpenAI Integration (`services/` using SDK):**
  - `ConversationPipelineService`: Manages Realtime STT WebSocket connection per conversation.
  - `OpenAILanguageModelService`, `OpenAISummaryService`, `TranslationService`, `LanguageDetectionService`, `TextToSpeechService`, `MedicalHistoryService`, `CommandDetectionService`: Utilize the OpenAI Node.js SDK (`openai` package) for various API calls (Chat Completions, TTS).
- **Audio Processing (`FFmpegService`):** Wraps `fluent-ffmpeg` to convert audio streams.
- **Persistence (`persistence/`):** Implemented Repository interfaces using Prisma Client.
- **Dependency Injection (`container.ts`):** Used `tsyringe` to manage dependencies, registering implementations against interface tokens.
- **Containerization:** `Dockerfile` for building and running the Node.js application.
- **Configuration:** `.env` files for environment variables (API keys, DB URL, etc.).

**d. API/WebSocket Design**

- **HTTP API:** As listed above.
- **WebSockets:**
  - **Connection:** `/?token=...` (Control/Broadcast), `/transcription?conversationId=...&token=...` (Audio Input)
  - **Client -> Server:** `auth` (implicit via token), `select_conversation`, `get_messages`, `get_actions`, `get_summary`, `get_medical_history`, `input_audio_buffer.append`, `input_audio_buffer.finalize`, `input_audio_buffer.pause`, `input_audio_buffer.resume`.
  - **Server -> Client:** `connection_ack`, `backend_connected`, `openai_connected`, `openai_disconnected`, `new_message`, `tts_audio`, `command_executed`, `message_list`, `action_list`, `summary_data`, `medical_history_data`, `error`.

## 4. Frontend Implementation (ReactJS/Context/Hooks)

**a. Domain Layer (Conceptual - `src/types`)**

- TypeScript interfaces defined for data structures received from backend (`Conversation`, `Message`, `CommandExecutionResult`, etc.).

**b. Application Layer (`src/context`, `src/hooks`, `src/lib`)**

- **State Management (`context/`):**
  - React Context API used (`AuthContext`, `ConversationContext`).
  - `AuthContext`: Manages JWT token, user info, auth status.
  - `ConversationContext`: Manages conversation list, active conversation ID, messages for active conversation, loading/error states.
- **API Client (`lib/api.ts`):**
  - Axios instance configured with base URL and interceptors (e.g., adding auth token).
  - Functions for specific REST API calls (login, register, get conversations, get medical history, etc.).
- **WebSocket Client (`hooks/useWebSocket.ts`):**
  - Manages the single persistent WebSocket connection.
  - Handles sending audio chunks (forwarded from `useAudioRecorder`) and control messages.
  - Processes incoming messages from the backend, updating state via Context setters.
- **Audio Recorder (`hooks/useAudioRecorder.ts`):**
  - Uses Web Audio API (`getUserMedia`, `AudioContext`, etc.) to capture microphone input.
  - Processes audio into chunks, encodes as Base64.
  - Provides chunks to `useWebSocket` for sending.
  - Manages recording state (recording, paused, inactive).
- **Text-to-Speech (`hooks/useSynthesizedSpeechPlayer.ts`):** Decodes Base64 audio received via WebSocket (`tts_audio` message) and plays it using browser audio capabilities.

**c. Presentation Layer (UI - `src/components`)**

- **Core Components:** `App`, `LoginPage`, `ChatInterface`, `ConversationList`, `MessageList`, `NewSessionModal`, etc.
- **UI Logic:** Components interact with Context for state and API/WebSocket hooks for communication.
- **Styling:** Tailwind CSS used for styling.

**d. Infrastructure Layer**

- HTTP client (`axios`).
- Browser WebSocket API.
- Browser Web Audio API / `getUserMedia`.
- Browser Audio playback APIs.
- Local Storage API (for JWT).

## 5. Database Choice

- PostgreSQL used via Prisma ORM.
- Schema defined in `prisma/schema.prisma`.

## 6. Deployment

- Backend and Frontend deployed as separate services on Google Cloud Run using Docker containers built via `Dockerfile`s.
- Environment variables and secrets managed via Cloud Run service settings and Google Secret Manager.

## 7. Development Process & Milestones (Reflecting Actual Build)

1.  **Setup:** Initialized separate Frontend (React/TS/Vite) and Backend (Node/TS/Express) repositories. Basic Docker setup.
2.  **Backend Foundation:** Setup Express, basic WebSocket (`ws`), Prisma (connecting to DB), initial DI container (`tsyringe`).
3.  **Authentication:** Implemented User model, JWT auth (login/register REST endpoints, middleware) on backend. Frontend login page, API calls, AuthContext.
4.  **Basic Conversation Flow:** Implemented Conversation/Patient models. Backend REST endpoint to create conversations. Frontend UI to list/select/create conversations (`ConversationList`, `NewSessionModal`, `ConversationContext`). WebSocket connection established with auth.
5.  **Audio Streaming & STT Pipeline:**
    - Frontend: `useAudioRecorder` implemented to capture, encode, and send audio chunks via `useWebSocket`.
    - Backend: `ConversationPipelineService` created to handle `/transcription` WebSocket connections. `FFmpegService` implemented for audio conversion. Pipeline service manages per-conversation connection to OpenAI Realtime STT API and forwards audio.
    - Backend receives `completed` transcriptions from OpenAI.
6.  **Basic Message Handling:** Backend saves received transcriptions via `MessageService`/`Repository`. `WebSocketNotificationService` created to broadcast `new_message` events. Frontend displays messages via `MessageList` updated from `ConversationContext` / `useWebSocket`.
7.  **Language Detection & Translation:** `LanguageDetectionService` and `TranslationService` implemented (using OpenAI SDK). Pipeline service calls detection, determines sender/translation need, calls translation service, saves translated message, broadcasts via `new_message`.
8.  **Text-to-Speech:** `TextToSpeechService` implemented (using OpenAI SDK). Pipeline service calls TTS for appropriate text. Backend broadcasts `tts_audio` message. Frontend `useSynthesizedSpeechPlayer` hook created to decode and play received audio.
9.  **Command Detection & Execution:**
    - `ICommandDetectionService` / `CommandDetectionService` implemented using OpenAI SDK tool calling.
    - `ICommandExecutionService` / `CommandExecutionService` implemented with switch logic calling `NoteService`, `FollowUpService`, `PrescriptionService`.
    - Pipeline service integrates calls to detection/execution services for `sender === 'user'`. Broadcasts `command_executed` results.
10. **Medical History & Summary:** `MedicalHistoryService` and `OpenAISummaryService` + `OpenAILanguageModelService` implemented using OpenAI SDK. REST/WebSocket endpoints added for triggering/retrieving.
11. **Refactoring & DI:** Services refactored to use OpenAI SDK consistently. Domain interfaces defined (`ITranslationService`, `ICommandDetectionService`, etc.). DI container updated to register implementations against interfaces. `TranscriptionService` renamed to `ConversationPipelineService`.
12. **Debugging & Stabilization:** Addressed various bugs, linter errors, DI registration issues, environment variable loading problems, deployment configuration issues.
13. **Containerization & Deployment:** Finalized Dockerfiles, deployed to Cloud Run, configured environment variables and secrets.
