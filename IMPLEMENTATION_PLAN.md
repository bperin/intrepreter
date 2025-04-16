# Detailed Implementation Plan: Interpreter Proof-of-Concept

## 1. Overall Architecture

The system will consist of:

1.  **ReactJS Frontend:** Captures user speech (indicating current speaker via UI buttons: Clinician/Patient), **connects directly to OpenAI's Realtime API via WebRTC using an ephemeral key obtained from the backend**, streams audio, receives interpreted text/audio (potentially directly from OpenAI or relayed by backend), displays conversation, summary, and **detected actions**. Handles user login/registration, text-to-speech playback, and **controls for clinician to approve/reject actions**. Uses a separate WebSocket connection for control messages with the backend.
2.  **Node.js/Express/TypeScript Backend:** Manages WebSocket connections (for control messages, not audio), handles user authentication (JWT), **generates ephemeral OpenAI API keys per conversation**, **acts as a second listener/participant in the OpenAI WebRTC session to receive transcriptions reliably**, orchestrates translation, TTS based on received transcriptions. Detects specific actions (`schedule_followup`, `send_lab_order`, `write_prescription`) in **clinician utterances only**, setting appropriate status. Handles action approval/rejection. Executes approved/detected actions via webhooks.
3.  **Database (SQLite / PostgreSQL):** Stores user credentials, conversation history (linking utterances to speaker type), participant details (type, preferred language), summaries, and detected **actions (including status)**. Prisma ORM. Local SQLite dev, Cloud SQL (PostgreSQL) prod.
4.  **External Services:**
    - **OpenAI Realtime API (WebRTC):** For low-latency STT, VAD, Language ID.
    - **OpenAI APIs:** Chat/Completion for Translation, Summary, Action Detection. TTS API.
    - Webhook endpoint (e.g., `webhook.site`) for simulating action execution.
5.  **Deployment:** Separate containerized applications (Frontend, Backend) deployed independently to Google Cloud Run.

## 2. Repository Structure

We'll use two separate Git repositories:

1.  `interpreter-backend`: Contains the Node.js/TypeScript application.
2.  `interpreter-frontend`: Contains the ReactJS application.

This facilitates independent development, testing, and deployment pipelines.

## 3. Backend Implementation Plan (Node.js/TypeScript/Express/WebSockets/DDD)

We'll structure the backend using DDD layers: Domain, Application, and Infrastructure.

**a. Domain Layer (`src/domain`)**

- **Entities:**
  - `User`: `id`, `username`, `hashedPassword`. Aggregate Root.
  - `Conversation`: `id`, `userId`, `participants` (Array of `Participant`), `startTime`, `endTime?`, `status` ('active', 'ended'), `language1?`, `language2?`. Aggregate Root.
  - `Participant`: `id`, `conversationId`, `type` ('clinician', 'patient'), `preferredLanguage`. **Type is crucial for speaker ID and action authorization.**
  - `Utterance`: `id`, `conversationId`, `participantId` **(Identified Speaker)**, `timestamp`, `originalLanguage` (Detected), `originalText`, `translatedLanguage` (Target), `translatedText`, `audioUrl?`.
  - `Action`: `id`, `conversationId`, `type` (`schedule_followup`, `send_lab_order`, `write_prescription`), `status` (`detected`, `pending_review`, `approved`, `executed`, `rejected`), `metadata`, `detectedAt`, `executedAt?`. **(Triggered by clinician utterances)**.
  - `Summary`: `id`, `conversationId`, `content`.
- **Value Objects:**
  - `LanguageCode`: Enum or type alias ('en', 'es').
- **Domain Services:**
  - `AuthService` (Conceptual): Logic related to password hashing/verification (often implemented directly in Infrastructure/Application for security libraries).
  - `InterpretationService`: Logic for determining target language based on participant. (Simple logic here, potentially more complex rules later).
  - `ActionDetectionService`: Analyzes clinician's transcribed text. Identifies predefined actions (`schedule_followup`, `send_lab_order`, `write_prescription`). Assigns initial status (`detected` or `pending_review` for prescription).
  - `SummaryService`: Logic to generate a conversation summary (could be a simple concatenation or an LLM call).
- **Domain Events (Optional but recommended for decoupling):**
  - `UtteranceAdded`: When a new utterance is processed and added.
  - `ActionDetected`: When an action is identified.
  - `ConversationEnded`: When a conversation is marked as ended.
- **Repositories (Interfaces):** Define interfaces for data access (`IUserRepository`, `IConversationRepository`, `IUtteranceRepository`, etc.).

**b. Application Layer (`src/application`)**

- **Use Cases / Commands & Queries:**
  - `RegisterUserCommand`: Input: `username`, `password`. Output: `userId`.
  - `LoginUserCommand`: Input: `username`, `password`. Output: JWT token.
  - `StartNewConversationCommand`: Input: `userId`, participant details. Creates `Conversation`, `Participant` records. **Generates ephemeral OpenAI API key.** Returns `conversationId`, initial state, **and the ephemeral key**.
  - `SetActiveConversationCommand`: Input: `userId`, `conversationId`, WebSocket context. Output: Confirmation or updated state. **Potentially triggers backend connection to OpenAI session.**
  - **`HandleTranscriptionResultCommand`:** (Replaces `ProcessAudioStreamCommand` and parts of `ProcessTranscriptionResultCommand`) Input: `conversationId`, `participantId` (derived from OpenAI event metadata if possible, or context), transcription text, detected language. Orchestrates Translation, Action Detection (checking speaker type), TTS, DB persistence, broadcasts `Utterance` and `Action` updates via WebSocket.
  - `ApproveActionCommand`: Input: `userId`, `actionId`. Verifies user is clinician for the conversation. Updates Action status to 'approved'. Triggers action execution if applicable.
  - `RejectActionCommand`: Input: `userId`, `actionId`. Verifies user is clinician. Updates Action status to 'rejected'.
  - `EndConversationCommand`: Input: `conversationId`. Disconnects backend listener from OpenAI session. Output: Final `Summary`, list of `Action`s.
  - `GetConversationDetailsQuery`: Input: `conversationId`, `userId`. Output: Full `Conversation` details (Utterances, Summary, etc.).
  - `ListConversationsQuery`: Input: `userId`. Output: List of `Conversation` metadata (ID, start time, participants, status, maybe last message snippet).
- **Application Services:**
  - Orchestrate the flow for each use case.
  - **Manage Ephemeral Key Generation:** Interface with OpenAI API to create short-lived keys for conversations.
  - **Manage Backend OpenAI Connection:** Initiate and manage the backend's WebRTC connection to the OpenAI session using the ephemeral key. Handle events (transcriptions, errors, disconnects).
  - **Process Transcriptions:** Trigger `HandleTranscriptionResultCommand` upon receiving transcriptions from the OpenAI session.
  - Determine Speaker `participantId` (May need correlation between OpenAI participant info and our internal participant IDs).
  - Trigger Action Detection only for clinician speaker type.
  - Set initial Action status based on type (`pending_review` for `write_prescription`).
  - Handle Action approval/rejection logic, updating status.
  - Trigger webhook execution for Actions with status `approved` or `detected` (if not needing review).
  - Determine target translation language: Find other participant(s) and use their `preferredLanguage`.
  - Manage communication with external services (OpenAI, Webhooks) via Infrastructure layer interfaces, ensuring context is tied to the correct `conversationId`.
  - Process WebSocket control messages (start, set active, end, approve, reject).
  - Handle JWT generation (on login) and validation (in middleware/guards).
- **DTOs (Data Transfer Objects):** Define specific data structures for API/WebSocket communication, separate from domain entities.

**c. Infrastructure Layer (`src/infrastructure`)**

- **API (Express):**
  - `POST /auth/register` Body: `{ "username": "...", "password": "..." }` Response: `201 Created` or error.
  - `POST /auth/login` Body: `{ "username": "...", "password": "..." }` Response: `200 OK` Body: `{ "token": "jwt.token.here" }` or error.
  - Add HTTP route for listing conversations: `GET /conversations` (protected by Auth middleware).
  - Add HTTP route for getting conversation details: `GET /conversations/:conversationId` (protected).
  - Add protected routes for action management: `POST /actions/:actionId/approve`, `POST /actions/:actionId/reject` (or handle via WebSocket messages).
  - Implement controllers calling Application Services for auth and conversation management.
- \*\*Authentication (`auth/`):
  - JWT generation and verification logic (using libraries like `jsonwebtoken`).
  - Password hashing logic (using `bcrypt`).
  - Auth middleware (for Express routes and potentially WebSocket connections) to verify JWTs and attach user context to requests/connections.
- **WebSockets (`websocket/`):**
  - Use `ws` library with Express for **control messages only**.
  - `WebSocketGateway`: Handles connection lifecycle, authentication. Manages connection state (`userId`, active `conversationId`). Handles control messages (`start_new`, `switch_active`, `approve_action`, `reject_action`, `end_conversation`, **`request_openai_key`**). Broadcasts `utterance`, `action_detected`, `action_updated`, `status`, `summary`, `error` events.
  - Requires JWT for initial connection/auth message.
- **OpenAI Integration (`openai/`):**
  - **`OpenAIRealtimeManager`:** (Replaces `OpenAIRealtimeService`) Manages the backend's WebRTC connection to OpenAI sessions using the OpenAI Realtime SDK. Handles connection logic, event listeners (transcriptions, errors), and potentially ephemeral key generation API calls. Passes transcription results to Application Services.
  - `OpenAIClient`: Wrapper for standard OpenAI APIs (Translation, Summary, TTS, Ephemeral Key Generation).
- **(Optional) Language Detection (`language/`):** If not reliably provided by OpenAI STT API.
- **Speaker Identification:** Primarily relies on frontend UI flag, but potentially correlated with OpenAI session participant info.
- **Persistence (`persistence/`):**
  - Implement Repository interfaces using Prisma.
  - Implement `IUserRepository` interface using Prisma.
  - Define Prisma schema (`prisma/schema.prisma`) - supports both PostgreSQL and SQLite (provider needs manual change for SQLite dev).
  - Migrations setup.
  - Include `Action.status` in Prisma schema.
- **Webhooks (`webhook/`):**
  - `WebhookService`: Simple client (using `axios` or `node-fetch`) to POST action data to the configured webhook URL.
- **Containerization:**
  - `Dockerfile`: Multi-stage build. Stage 1: Build TypeScript to JavaScript. Stage 2: Copy JS artifacts, `node_modules`, `prisma` client into a slim Node.js image. Expose necessary port.
  - `.dockerignore`: Exclude `node_modules`, `.git`, etc.
- **Configuration (`config/`, `.env` files):** Manage environment variables (API keys, Webhook URL, ports, **JWT_SECRET**, etc.). Use `.env` for production/default settings (e.g., Cloud SQL `DATABASE_URL`) and `.env.local` for local development overrides (defaulting to SQLite `DATABASE_URL`). The application loads `.env.local` if `NODE_ENV=development`. `.env.local` should be in `.gitignore`.

**d. API Design**

- **HTTP API:**
  - `POST /auth/register` Body: `{ "username": "...", "password": "..." }` Response: `201 Created` or error.
  - `POST /auth/login` Body: `{ "username": "...", "password": "..." }` Response: `200 OK` Body: `{ "token": "jwt.token.here" }` or error.
  - `GET /conversations` Response: `200 OK` Body: `[{ id: "...", startTime: "...", status: "..." }, ...]`
  - `GET /conversations/:conversationId` Response: `200 OK` Body: `{ ...Full Conversation DTO... }`
  - `POST /actions/:actionId/approve`
  - `POST /actions/:actionId/reject`
- **WebSockets (Control Channel):**
  - Client -> Server: `{"type": "auth", "payload": { "token": "..." }}`
  - Client -> Server: `{"type": "start_new_conversation", ...}`
  - Client -> Server: `{"type": "set_active_conversation", ...}`
  - **Client -> Server: `{"type": "request_openai_key", "payload": { "conversationId": "..." }}` (Alternative to returning key on start)**
  - **REMOVED:** `audio_chunk`, `end_audio_stream`
  - Client -> Server: `{"type": "approve_action", ...}`
  - Client -> Server: `{"type": "reject_action", ...}`
  - Client -> Server: `{"type": "end_conversation"}`
  - Server -> Client: `{"type": "conversation_started", "payload": { ..., "openai_key": "ephemeral_key_here" }}` (Return key here)
  - Server -> Client: `{"type": "active_conversation_set", ...}`
  - Server -> Client: `{"type": "utterance", ...}`
  - Server -> Client: `{"type": "action_detected", ...}`
  - Server -> Client: `{"type": "action_updated", ...}`
  - Server -> Client: `{"type": "status", ...}`
  - Server -> Client: `{"type": "summary", ...}`
  - Server -> Client: `{"type": "action", ...}`
  - Server -> Client: `{"type": "error", ...}`

## 4. Frontend Implementation Plan (ReactJS/DDD Principles/Best Practices)

**a. Domain Layer (Conceptual - `src/domain`)**

- **Models/Interfaces:** Define TypeScript interfaces for core data structures received from the backend.
  - `Utterance` (includes `originalLanguage`, `translatedLanguage`), `ConversationState`, `Summary`, `Action` (includes `status`), `Participant` (with `preferredLanguage`, `type`).
- **Value Objects:** `ThemeSettings` (if theme is switchable), `LanguageCode`.

**b. Application Layer (`src/application`)**

- **State Management (`store/` or `hooks/`):**
  - Use Zustand (simpler) or Redux Toolkit (more structured).
  - Define state slices/stores:
    - `authSlice`: Stores JWT token, user information (`userId`, `username`), authentication status (`isAuthenticated`, `isLoading`, `error`).
    - `conversationSlice`: Stores a list of conversation metadata (`conversationsList`), the currently active `activeConversationId`, details of the active conversation (`utterances`, `participants`, `status`, etc.), and loading/error states for fetching/managing conversations.
    - `summaryActionSlice`: Stores the final `summary` and list of `actions` (likely per `activeConversationId`).
- **API Client (`services/`):**
  - `AuthService`: Functions to call backend `/auth/login` and `/auth/register` endpoints. Store/remove token from local storage and update `authSlice`.
  - `ConversationService`: Functions to call backend `GET /conversations`, `GET /conversations/:id`. Functions to interact with WebSocket for `start_new_conversation`, `set_active_conversation`.
  - **`WebSocketService` (`useWebSocket`):** Manages WebSocket connection for **control messages**. Sends/receives messages like `start_new`, `set_active`, `approve/reject`, `request_openai_key`. **Does NOT handle audio.** Dispatches backend events (`utterance`, `action_detected`, etc.) to update state.
  - **`OpenAIRealtimeService` (`useOpenAIRealtime`):** New hook/service.
    - Takes ephemeral key (obtained via WebSocket from backend).
    - Uses OpenAI Realtime SDK to establish WebRTC connection.
    - Manages connection state (connecting, connected, error).
    - Provides methods to stream audio (`sendAudioChunk`).
    - Listens for transcription results from OpenAI (if not relying solely on backend relay).
- **Custom Hooks (`hooks/`):**
  - `useSpeechRecognition`: Interfaces with browser audio capture. **Provides audio chunks to `useOpenAIRealtime` for sending to OpenAI**, instead of sending via WebSocket. Still detects end of speech.
  - `useSpeechSynthesis`: Interface with the browser's Web Speech API (`speechSynthesis`) to play back translated text received from the backend. Manage voices, queueing.
  - `useConversationManager`: Facade hook to interact with conversation state (list, active details), start new conversations (passing participant `preferredLanguage` details), switch active conversations.

**c. Presentation Layer (UI - `src/components` & `src/pages`)**

- **Core Components:**
  - `App`: Main application component, sets up routing, global providers (state management, theme), and handles global auth state logic (e.g., redirecting if not logged in).
  - `LoginPage`: Form for username/password input, calls `AuthService.login`.
  - `RegisterPage`: Form for username/password input, calls `AuthService.register`.
  - `ProtectedRoute`: Wrapper component to check `authSlice.isAuthenticated` and redirect to `/login` if necessary.
  - `MainLayout` (Used by protected routes): Might include a persistent element like a sidebar for conversation management.
  - `ConversationSidebar` (Inside `MainLayout`?): Displays list of conversations fetched via `useConversationManager`. Allows selecting a conversation or starting a new one. **Starting a new one should prompt for participant roles and preferred languages.**
  - `ConversationPage` (Displays the active conversation): Main view container (wrapped by `ProtectedRoute`, uses `useConversationManager` to get active data).
    - Obtains ephemeral key for the active conversation (likely stored in conversation context).
    - Uses `useOpenAIRealtime` to connect to OpenAI session.
    - Uses `useSpeechRecognition` to get audio and send it via `useOpenAIRealtime`.
    - `StatusBar`: Shows OpenAI connection status from `useOpenAIRealtime`.
    - `UtteranceList`: Renders utterances received via WebSocket from backend.
    - `UtteranceItem`: Displays a single utterance (original + translation, speaker). **May indicate detected source language.**
  - **(If using UI method) Speaker Selection:** Buttons or toggle in `ConversationPage` to indicate if the Clinician or Patient is about to speak. This state determines the `speakerType` sent with audio messages.
  - `MicInput`: Controls starting/stopping audio capture via `useSpeechRecognition`. Links with Speaker Selection UI.
  - `SummaryDisplay`: ...
  - `ActionList`: Shows detected actions. **Highlights actions with `status: pending_review`. Provides Approve/Reject buttons for clinician.**
- **Routing (`react-router-dom`):**
  - Define public routes (`/login`, `/register`) and protected routes (`/`, `/conversation/:conversationId`). The root `/` might show the main layout with the conversation list, and potentially the most recent active conversation.
- **Styling:**
  - Use CSS Modules or Styled Components.
  - Implement a dark, minimalistic theme using a consistent color palette, typography, and spacing. Ensure accessibility (contrast ratios).
- **Structure:** Follow a clear component hierarchy (e.g., `pages/`, `components/common/`, `components/conversation/`).

**d. Infrastructure Layer**

- HTTP client library (e.g., `axios`, `fetch`).
- Local Storage API (for storing JWT).
- WebSocket client library (for control channel).
- **OpenAI Realtime SDK (JavaScript):** For WebRTC connection.
- Browser Web Audio API / `getUserMedia`.
- Browser Web Speech API.

## 5. Database Choice

- **Recommendation:** PostgreSQL with Prisma.
- **Schema:** Define models in `schema.prisma` matching the Domain entities (`User`, `Conversation`, etc.). Include relations. Schema is written for PostgreSQL but compatible with SQLite (requires provider change in schema file for local SQLite use).

## 6. Deployment Plan

1.  **Prerequisites:** Google Cloud Project setup, `gcloud` CLI installed, Docker installed. Enable Cloud Run API, Artifact Registry API, **Secret Manager API**.
2.  **Backend:**

    - Create Artifact Registry repository (e.g., `gcr.io/YOUR_PROJECT_ID/interpreter-backend`).
    - Configure `cloudbuild.yaml` (or use manual Docker commands) to build the image using `Dockerfile` and push to Artifact Registry.
    - Deploy to Cloud Run:

      ```bash
      # Store sensitive secrets (JWT_SECRET, Production DB Password/URL components, OPENAI_API_KEY) in Secret Manager first.
      # Example for JWT Secret:
      # echo -n "YOUR_SUPER_SECRET_JWT_KEY" | gcloud secrets create jwt-secret --data-file=-

      # Example for DB URL (using Secret Manager for password):
      # DB_PASSWORD_SECRET_NAME="interpreter-db-prod-password"
      # echo -n "YOUR_PROD_DB_PASSWORD" | gcloud secrets create $DB_PASSWORD_SECRET_NAME --data-file=-

      # Construct DB URL securely in Cloud Run env vars or build step if needed,
      # or pass components separately and construct in app config loader.

      gcloud run deploy interpreter-backend \
        --image=gcr.io/YOUR_PROJECT_ID/interpreter-backend:latest \
        --platform=managed \
        --region=YOUR_REGION \
        # --allow-unauthenticated # Keep protected unless specific need
        # Mount secrets as environment variables
        --set-secrets=JWT_SECRET=jwt-secret:latest,DATABASE_PASSWORD=$DB_PASSWORD_SECRET_NAME:latest,OPENAI_API_KEY=openai-api-key-secret:latest \
        # Set non-sensitive or constructed environment variables
        --set-env-vars="NODE_ENV=production,DATABASE_URL=postgresql://USER:\$(DATABASE_PASSWORD)@HOST:PORT/DB?schema=public,WEBHOOK_URL=..." \
        # ^^^ Note: Construct DATABASE_URL carefully here or within the application based on provided components.
        # Alternative: Pass components like DB_USER, DB_HOST, DB_NAME separately.
        # --set-env-vars="NODE_ENV=production,DB_USER=...,DB_HOST=...,DB_NAME=...,DB_PORT=5432,..." \
        --port=8080 # Or the port exposed in Dockerfile
      ```

    - Set up VPC Connector if connecting to a private Cloud SQL instance.

3.  **Frontend:**
    - Create Artifact Registry repository (e.g., `

## 7. Development Process & Milestones

1.  **Setup:** [-] Initialize repos, setup Node/TypeScript/Prisma backend (SQLite for local), setup React/TypeScript frontend. Basic Dockerfiles.
2.  **Authentication:** [-] Implement User model, backend auth routes (register/login), JWT logic, password hashing. Implement frontend login/register pages, auth state management, protected routes, local storage persistence.
3.  **Core WebSocket (Control) & Initial Session Setup:** [-] Implement WebSocket for control messages. Implement backend/frontend logic for `StartNewConversationCommand`, **including generating/returning ephemeral key**. Basic display of conversation.
4.  **Session Management:** [-] Implement backend `ListConversationsQuery`, `GetConversationDetailsQuery`, related HTTP endpoints. Implement backend `SetActiveConversationCommand` and WebSocket message handling. Implement frontend UI (e.g., sidebar) to list conversations, start new ones (with language preference and type input), and switch the active view. Fetch and display history for selected conversations.
5.  **OpenAI Realtime Integration (Backend Listener):** [-] Implement backend `OpenAIRealtimeManager` to connect to OpenAI session using the ephemeral key upon conversation start/activation. Handle receiving transcription events.
6.  **OpenAI Realtime Integration (Frontend):** [-] Implement frontend `useOpenAIRealtime` hook. Get key via WebSocket. Connect to OpenAI.
7.  **Speech Input & WebRTC Streaming:** [-] Implement frontend audio capture (`useSpeechRecognition`). Stream audio chunks **to OpenAI via `useOpenAIRealtime`**.
8.  **Transcription Processing (Backend):** [-] Implement backend `HandleTranscriptionResultCommand` to process transcriptions received from its OpenAI listener.
9.  **Dynamic Translation:** [-] Add translation step in backend based on received transcriptions.
10. **TTS Output:** [-] Integrate basic TTS for the translated text in the target language.
11. **Database Persistence:** [-] Implement Prisma schema updates (`Action.status`), repositories, and save/load utterances and actions linked to conversations.
12. **Action Detection & Review Flow:** [-] Implement backend logic (using OpenAI) to detect actions (`schedule_followup`, `send_lab_order`, `write_prescription`) from clinician utterances. Set initial status (`detected` or `pending_review`). Implement Approve/Reject logic. Update frontend to display actions and review controls for clinician.
13. **Action Execution:** [-] Implement webhook call for actions transitioned to `approved` or initially `detected` (if no review needed).
14. **Conversation Summary:** [-] Implement backend logic (using OpenAI) to generate summary at conversation end. Display summary in UI.
15. **Refinement:** [-] Improve UI/UX, error handling, add "repeat" functionality, enhance real-time feel.
16. **Containerization & Deployment:** [-] Finalize Dockerfiles (ensure `postgresql` provider), set up Cloud Run, configure CI/CD. Ensure OpenAI SDKs are included.
