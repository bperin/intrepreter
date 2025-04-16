# Clara - AI Medical Interpreter

This project is a real-time medical interpretation application designed to facilitate communication between clinicians and patients speaking different languages. It leverages AI for transcription, translation, text-to-speech, command detection, and summarization.

---

## Summary / How it Works

The core goal is to provide seamless, real-time interpretation during medical consultations.

**Key Features:**

- **Real-time Transcription:** Captures audio from the microphone and transcribes it into text using OpenAI Whisper via a streaming WebSocket connection.
- **Automatic Language Detection:** Identifies the language spoken (e.g., English, Spanish) for each utterance.
- **Real-time Translation:** Translates utterances into the other participant's language using OpenAI.
- **Text-to-Speech (TTS):** Synthesizes the translated text into audible speech using OpenAI TTS, allowing participants to hear the interpretation.
- **Voice Command Detection:** Allows clinicians to issue specific commands (e.g., "Hey Clara, take a note...") using natural language, processed via OpenAI function/tool calling.
- **Session Management:** Supports multiple concurrent interpretation sessions.
- **Conversation History:** Stores original transcriptions and translations.
- **Action Tracking:** Detects and logs actionable items mentioned during the conversation (e.g., follow-ups, notes).
- **Summarization:** Generates a concise summary of the conversation upon completion.
- **Mock Medical History:** Automatically generates contextually relevant mock medical history at the start of a session, accessible via REST and WebSocket.

**Basic User Flow:**

1.  Clinician logs in.
2.  Clinician starts a new session, providing basic patient details.
3.  The system establishes WebSocket connections for audio streaming and control.
4.  Participants speak into their microphone.
5.  Audio is streamed to the backend, transcribed, and language is detected.
6.  The backend determines the speaker (clinician/patient) based on language.
7.  If the clinician speaks, the system checks for voice commands using OpenAI tool calling.
    - If a command is detected, the corresponding action is processed (e.g., saving a note).
    - If no command, or if the patient speaks, the utterance is processed as speech.
8.  The original utterance is saved and displayed in the chat interface with a language tag.
9.  If translation is needed (e.g., patient spoke Spanish, or clinician spoke English and patient language is Spanish), the text is translated.
10. The translation is saved and displayed (labeled as "System" or similar).
11. The appropriate text (original or translation) is sent to the TTS service for the _other_ participant to hear in their language.
12. Detected actions (notes, follow-ups) appear in the Action Stream.
13. Mock Medical History is generated and viewable in a dedicated tab.
14. At the end, the clinician can end the session, triggering summary generation.

---

## Technical Details / Architecture

This application follows best practices for structure and employs modern technologies.

**Architecture & Design:**

- **Domain-Driven Design (DDD):** The backend is structured around core domain concepts (Conversation, Patient, Message, Action, User) with clear separation between:
  - **Domain:** Contains core entities, value objects, interfaces for repositories and services.
  - **Application:** Orchestrates use cases, handles commands.
  - **Infrastructure:** Implements interfaces using specific technologies (Prisma, OpenAI, WebSockets, Express, etc.).
- **Separation of Concerns:** Services have distinct responsibilities (e.g., `TranscriptionService`, `CommandDetectionService`, `MedicalHistoryService`, `ConversationService`, `NotificationService`).
- **Dependency Injection:** Uses `tsyringe` for managing dependencies, promoting loose coupling and testability.
- **API Routing:** Backend uses Express.js. Most routes are defined without an `/api/` prefix (e.g., `/conversations`, `/auth/login`). Authentication is handled via JWT middleware.

**Technology Stack:**

- **Backend:**
  - Runtime: Node.js
  - Language: TypeScript
  - Framework: Express.js
  - ORM: Prisma
  - Database: PostgreSQL (Cloud SQL compatible)
  - WebSockets: `ws` library
  - DI Container: `tsyringe`
  - AI: OpenAI API (Whisper for Transcription, Chat Completions for Language Detection/Translation/Commands/Summarization/History, TTS)
- **Frontend:**
  - Library: React
  - Language: TypeScript
  - Styling: Styled Components
  - State Management: React Context API (potentially others like Zustand/Redux if needed later)
  - WebSockets: Native browser WebSocket API
  - API Client: Centralized Axios instance (`src/lib/api.ts`) handles base URL, request/response interception (auth tokens, automatic token refresh).

**Key Technical Implementations:**

- **WebSocket Architecture:** The backend manages two distinct WebSocket connection types:
  - `/transcription?token=<jwt>&conversationId=<id>`: Dedicated to streaming raw audio data for a specific conversation to the `TranscriptionService`. Requires a valid JWT and `conversationId`.
  - `/?token=<jwt>`: Serves as the main control channel for a client. Used for actions like selecting conversations, sending/receiving chat messages, fetching history/actions/summaries, and receiving real-time updates (like new messages or generated medical history). Requires a valid JWT.
  - The backend uses a `NotificationService` to manage client subscriptions to conversations and broadcast relevant updates (e.g., new messages, medical history) to all connected clients for a specific conversation.
- **Proxy WebSocket:** The frontend connects to the backend via WebSockets. The backend acts as a proxy, establishing its own secure connections to external services like OpenAI's real-time transcription API. This keeps API keys secure and allows backend processing.
- **FFmpeg Audio Conversion:** The frontend typically sends audio in WebM Opus format. The backend uses `ffmpeg` (via `fluent-ffmpeg` and `@ffmpeg-installer/ffmpeg`) to transcode this stream in real-time into the required format for OpenAI Whisper (PCM S16LE, mono, typically 16kHz or 24kHz - currently set to 24kHz).
- **Automatic Language Detection:** After receiving a transcription, the backend makes a separate API call to OpenAI (using `gpt-4o-mini`) with a specific prompt to identify the primary language of the transcribed text.
- **Parallel Processing / Async Operations:**
  - When the clinician speaks, the command detection via OpenAI runs asynchronously (`.then/.catch` pattern) _after_ the regular message processing (saving, translation, TTS) has already started. This avoids blocking the main chat flow while still allowing commands to be processed.
  - Medical history generation is also triggered asynchronously when a session starts.
- **Multi-User/Conversation Handling:** The backend manages multiple WebSocket connections. State related to specific conversations (like the OpenAI transcription session, FFmpeg process, connected clients) is managed in memory using Maps keyed by `conversationId` (e.g., `conversationStates` in `TranscriptionService`). Connections and resources are cleaned up when the last client for a conversation disconnects.
- **Function/Tool Calling for Commands:** Instead of relying on simple local regex or keyword matching, the system uses OpenAI's function/tool calling capability. When the clinician speaks, the text is sent to the Chat Completions API along with schemas defining available tools (`take_note`, `schedule_follow_up`, `write_prescription`). OpenAI determines if the utterance matches a tool's description and extracts the required parameters (like note content or medication details) into a structured JSON object, which the backend then processes.

---

## Deployment Instructions

Follow these steps to set up and run the application.

**Prerequisites:**

- Node.js (v18 or later recommended)
- npm or yarn
- Docker & Docker Compose
- Access to a PostgreSQL database
- OpenAI API Key

**1. Local Development Setup:**

- **Clone Repository:** `git clone ...`
- **Install Dependencies:**
  - `cd interpreter-backend && npm install`
  - `cd ../interpreter-frontend && npm install`
- **Environment Variables:**
  - Create `.env` file in the **root** project directory.
  - Create `.env` file in the `interpreter-backend` directory.
  - Populate both files with necessary variables:
    - `DATABASE_URL`: PostgreSQL connection string (e.g., `postgresql://user:password@host:port/database?schema=public`)
    - `OPENAI_API_KEY`: Your secret key from OpenAI.
    - `JWT_SECRET`: A strong, random string for signing authentication tokens.
    - `PORT`: (Optional) Port for the backend server (defaults to 8080).
    - `VITE_BACKEND_URL`: For the frontend (`interpreter-frontend/.env`), the _host-accessible_ URL of the backend (e.g., `http://localhost:8080` for local Docker setup). Make sure this matches the variable used in `src/lib/api.ts`.
- **Database Migration:**
  - Navigate to `interpreter-backend`.
  - Run `npx prisma migrate dev` to apply schema changes and create the database if it doesn't exist.
  - Run `npx prisma generate` to generate the Prisma Client.
- **Run Application:**
  - In one terminal, start the backend: `cd interpreter-backend && npm run dev`
  - In another terminal, start the frontend: `cd interpreter-frontend && npm run dev`
  - Access the frontend in your browser (usually `http://localhost:5173`).

**2. Docker Compose (Local):**

- Ensure your root `.env` and `interpreter-backend/.env` files are correctly populated (Docker Compose uses these).
- From the **root** project directory, run: `docker-compose up --build -d`
- This builds the images and starts the backend, frontend, and database containers.
- Access the frontend in your browser (usually `http://localhost:5174` or as configured in `docker-compose.yml`).
- View logs: `docker-compose logs backend`, `docker-compose logs frontend`.
- Stop: `docker-compose down`.

**3. Cloud Run Deployment (Conceptual):**

- **Prerequisites:** Google Cloud SDK (`gcloud`), Docker, GCP project with Cloud Run, Cloud SQL (PostgreSQL), and Secret Manager enabled.
- **Secrets:** Store sensitive variables (`DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`) in Google Secret Manager.
- **Environment Variables:** Configure Cloud Run service environment variables to:
  - Reference the secrets stored in Secret Manager.
  - Set `PORT` to `8080` (or the port your container listens on).
  - Set frontend's `VITE_BACKEND_URL` environment variable within the Cloud Run service configuration to the URL of the deployed backend service (e.g., using `--set-env-vars="VITE_BACKEND_URL=https://your-backend-service-url"`).
- **Dockerfile:** Ensure `Dockerfile` (for backend) and `interpreter-frontend/Dockerfile` correctly build production-ready images (install only production dependencies, run Prisma generate, build code).
- **Build & Push:** Build the Docker images (using the respective Dockerfiles in `interpreter-backend` and `interpreter-frontend`) and push them to Google Artifact Registry or your preferred registry. Example:
  - `gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/interpreter-backend:latest ./interpreter-backend`
  - `gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/interpreter-frontend:latest ./interpreter-frontend`
- **Deploy Backend:**
  - Use `gcloud run deploy interpreter-backend ...` command.
  - Specify the backend image URL.
  - Configure CPU/memory, concurrency.
  - Set environment variables referencing secrets.
  - Ensure network connectivity to the Cloud SQL database (using Cloud SQL proxy sidecar or direct VPC connection).
  - Allow unauthenticated access initially for testing, configure authentication later.
- **Deploy Frontend:**
  - Use `gcloud run deploy interpreter-frontend ...` command.
  - Specify the frontend image URL.
  - Set environment variables (specifically `VITE_BACKEND_URL` pointing to the deployed backend service URL using `--set-env-vars="VITE_BACKEND_URL=https://your-backend-service-url"`)
  - Allow unauthenticated access.
- **Deployment Scripts:** The `deploy-prod.sh` script provides a starting point for automating deployment to Cloud Run, handling environment variable injection (including `VITE_BACKEND_URL` for the frontend) and `gcloud` commands. Review and adapt it for your specific GCP setup.

---
