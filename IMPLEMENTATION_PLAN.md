# Implementation Plan Overview (Reflecting Final Build)

## 1. Final Architecture Overview

- **Core Components:**
  - **Frontend:** React/TS application using Vite. Handles UI, audio capture (Web Audio API), and communication with the backend.
  - **Backend:** Node.js/TS/Express application. Provides REST API for auth/data management and a WebSocket interface for real-time audio processing and communication. Acts as a pipeline orchestrating FFmpeg and various OpenAI APIs.
  - **Database:** PostgreSQL (via Prisma ORM) storing user/conversation data.
  - **AI Services:** OpenAI APIs (Realtime STT via WebSocket, Chat Completions via SDK for translation/commands/language detection/summaries, TTS API via SDK).
- **Key Technologies:**
  - **Frontend:** React, TypeScript, Axios, Web Audio API, WebSocket API, React Context, Tailwind CSS.
  - **Backend:** Node.js, TypeScript, Express, `ws`, Prisma, OpenAI SDK, `tsyringe`, `fluent-ffmpeg`, JWT.
- **Communication:**
  - Frontend <-> Backend REST API (Auth, initial data).
  - Frontend <-> Backend WebSocket (Control messages, audio streaming input, receiving processed data/audio).
  - Backend -> OpenAI Realtime STT (Per-conversation WebSocket for audio).
  - Backend -> OpenAI APIs (SDK calls for other AI tasks).
- **Backend Structure:** Domain-Driven Design principles (Interfaces for Services/Repositories), Dependency Injection (`tsyringe`). `ConversationPipelineService` orchestrates the real-time flow.

## 2. Development Process Summary

The project was built iteratively through these major phases:

1.  **Foundation:** Setup separate frontend/backend projects, basic Node/Express server, React app, Prisma/DB connection, basic Docker setup.
2.  **Authentication:** Implemented JWT-based user login/registration (REST API, frontend UI, state management).
3.  **Core Real-time Pipeline:**
    - Established WebSocket communication.
    - Implemented frontend audio capture (`useAudioRecorder`) and streaming to backend.
    - Implemented backend `ConversationPipelineService` to receive audio, manage per-conversation FFmpeg (`FFmpegService`) and OpenAI Realtime STT WebSocket connections.
    - Integrated basic transcription saving (`MessageService`) and broadcasting (`WebSocketNotificationService`) back to frontend.
4.  **Core Features:** Added Language Detection, Translation, Text-to-Speech using respective services and OpenAI APIs.
5.  **Commands & Actions:** Implemented Command Detection (OpenAI tool calling), Command Execution logic, and related database models/services (Notes, Follow-ups, Prescriptions).
6.  **Additional Features:** Added Summarization and Mock Medical History generation.
7.  **Refactoring & Architecture:** Refactored services to use OpenAI SDK consistently, introduced domain interfaces for services, implemented dependency injection (`tsyringe`), renamed core services for clarity.
8.  **Debugging & Deployment:** Addressed numerous bugs across frontend/backend, resolved dependency/environment issues, finalized Dockerfiles, and deployed to Cloud Run.
