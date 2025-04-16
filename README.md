# Clara - AI Medical Interpreter

Real-time medical interpretation using AI for transcription, translation, and text-to-speech, plus voice command handling.

---

## How it Works

- **Real-time Interpretation:** Transcribes speech (OpenAI Whisper via backend), detects language, translates (OpenAI), and synthesizes audio (OpenAI TTS).
- **Voice Commands:** Clinicians can issue commands ("take note", "schedule follow-up", "write prescription") processed via OpenAI tool calling.
- **Session Management:** Handles conversations, history, actions, summaries, and mock medical history.

**Basic Flow:** User speaks -> Frontend sends audio chunks via WebSocket -> Backend processes (FFmpeg, OpenAI STT, LangDetect, Translation, Command Detection, TTS) -> Backend broadcasts results (text, audio) via WebSocket -> Frontend displays/plays results.

---

## Technical Overview

- **Architecture:** Separate Frontend (React/TS) and Backend (Node/TS/Express). Backend acts as a processing pipeline.
- **Backend Tech:** Node.js, TypeScript, Express, `ws` (WebSockets), Prisma (PostgreSQL), `tsyringe` (DI), OpenAI SDK, `fluent-ffmpeg`.
- **Frontend Tech:** React, TypeScript, Web Audio API, WebSocket API, Axios, React Context, Tailwind CSS.
- **Key Backend Services:** `ConversationPipelineService` (orchestration), `FFmpegService`, `WebSocketNotificationService`, various domain services implementing interfaces (e.g., `ITranslationService`, `ICommandDetectionService`).
- **Key Frontend Hooks:** `useAudioRecorder`, `useWebSocket`.

**For more detailed information:**

- **[Backend Implementation](./interpreter-backend/BACKEND_IMPLEMENTATION.md)**
- **[Frontend Implementation](./interpreter-frontend/FRONTEND_IMPLEMENTATION.md)**
- **[Development Plan & Architecture](./IMPLEMENTATION_PLAN.md)**

---

## Setup & Deployment

**Local Development:**

1.  Clone repos, `npm install` in both `interpreter-backend` and `interpreter-frontend`.
2.  Configure `.env` files (Root & Backend) with `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`.
3.  Configure frontend `.env` with `VITE_BACKEND_URL`.
4.  Run `npx prisma migrate dev` & `npx prisma generate` in backend.
5.  Start backend (`npm run dev`) and frontend (`npm run dev`).

**Docker Compose:**

1.  Configure `.env` files as above.
2.  Run `docker-compose up --build` from the root directory.

**Cloud Run:**

1.  Use Dockerfiles to build images, push to a registry (e.g., Artifact Registry).
2.  Deploy services using `gcloud run deploy`, configuring environment variables and secrets (DB connection, API keys, JWT secret, `VITE_BACKEND_URL` for frontend). Refer to `deploy-prod.sh` for an example.

---
