# Frontend Implementation Overview

This document provides a high-level overview of the frontend implementation.

## Core Flow & Communication

1.  **Authentication:** User logs in/registers via REST API calls (Axios).
2.  **WebSocket Connection:** Establishes a persistent WebSocket connection (`/?token=...`) managed by `useWebSocket` hook for control and receiving data.
3.  **Session Management:** Lists/selects conversations via REST API and WebSocket control messages.
4.  **Audio Capture:** `useAudioRecorder` hook captures microphone audio using Web Audio API.
5.  **Audio Streaming:** Audio chunks are Base64 encoded and sent via the main WebSocket connection (directed to backend's `/transcription` handler).
6.  **Receiving Data:** `useWebSocket` receives broadcast messages (`new_message`, `tts_audio`, `command_executed`, etc.) from the backend.
7.  **State Update:** React Context (`AuthContext`, `ConversationContext`) is updated based on received data, triggering UI updates.
8.  **TTS Playback:** `useSynthesizedSpeechPlayer` hook decodes and plays TTS audio received from the backend.

## Key Components & Technologies

- **Framework/Language:** React, TypeScript
- **State Management:** React Context API (`AuthContext`, `ConversationContext`)
- **API Client:** Axios (`lib/api.ts`) for REST calls.
- **WebSockets:** Native Browser WebSocket API (managed via `useWebSocket` hook).
- **Audio Handling:** Web Audio API (managed via `useAudioRecorder` hook), Browser Audio playback.
- **UI Components:**
    - `ChatInterface`: Main view, orchestrates hooks.
    - `ConversationList`: Lists/selects conversations.
    - `MessageList`: Displays messages.
    - `LoginPage`, `NewSessionModal`, etc.
- **Styling:** Tailwind CSS.

## Key Hooks

- **`useWebSocket`**: Manages WebSocket connection, message sending/receiving, state updates.
- **`useAudioRecorder`**: Handles microphone input, audio processing/encoding, provides chunks to `useWebSocket`.
- **`useSynthesizedSpeechPlayer`**: Handles playback of received TTS audio.

## Core Technologies

- [x] **React & TypeScript**: The application is built using React with TypeScript for type safety.
- [x] **WebSocket**: Used for real-time bidirectional communication with the backend for control messages, sending audio, and receiving processed results.
- [x] **Web Audio API**: Used for capturing and processing audio from the user's microphone.
- [x] **Axios**: Used for making HTTP requests to the backend REST API (e.g., for auth, fetching initial data).

## Project Structure

- [x] **`/src/components/`**: Contains React components for the UI.
- [x] **`/src/context/`**: Contains React context providers for state management (e.g., `AuthContext`, `ConversationContext`).
- [x] **`/src/hooks/`**: Contains custom hooks for managing audio recording (`useAudioRecorder`), WebSocket communication (`useWebSocket`), and other functionality.
- [x] **`/src/lib/`**: Contains library code, including the API client setup (`api.ts`).
- [x] **`/src/types/`**: Contains shared TypeScript type definitions.

## Key Components

- [x] **`App.tsx`**: The main application component that sets up routing and global context providers.
- [x] **`LoginPage.tsx`**: Handles user authentication and registration via API calls.
- [x] **`ChatInterface.tsx`**: The main interface for audio conversations, displaying messages, handling audio recording via `useAudioRecorder`, and interacting with the WebSocket via `useWebSocket`.
- [x] **`ConversationList.tsx`**: Displays a list of conversations (fetched via API) and handles conversation selection (sending `select_conversation` WebSocket message).
- [x] **`MessageList.tsx`**: Displays messages received via WebSocket within a conversation.
- [x] **`NewSessionModal.tsx`**: Allows the user to create a patient and start a new conversation via API call.

## Audio & Backend Communication Implementation

### Core Hooks

- [x] **`useAudioRecorder.ts`**: Manages audio recording using the Web Audio API. Handles starting, stopping, pausing, processing audio into chunks, and encoding them as Base64. It sends these chunks via the WebSocket connection managed by `useWebSocket`.
- [x] **`useWebSocket.ts`**: Manages the primary WebSocket connection to the backend. Handles connection/disconnection, authentication (sending token), sending audio chunks from `useAudioRecorder` (to the `/transcription` endpoint connection logic on backend), sending control messages (e.g., `select_conversation`), and receiving/processing broadcast messages from the backend (`new_message`, `tts_audio`, `command_executed`, `error`, etc.), updating relevant application state (usually via Context setters).

### Audio Processing & Communication Flow

1. **Permission Request**: Requests microphone permission when recording starts.
2. **Audio Capture**: Captures audio using the Web Audio API.
3. **Chunking & Encoding**: `useAudioRecorder` processes audio into chunks and encodes them as Base64 strings.
4. **WebSocket Connection**: `useWebSocket` establishes and maintains a persistent WebSocket connection to the backend (authenticating with JWT).
5. **Audio Streaming**: `useAudioRecorder` passes Base64 audio chunks to `useWebSocket`, which sends them as JSON messages (`{ type: 'input_audio_buffer.append', audio: 'base64...' }`) over the WebSocket connection directed towards the backend's `/transcription` path handling.
6. **Receiving Results**: `useWebSocket` listens for messages broadcast from the backend (e.g., `new_message` with transcriptions/translations, `tts_audio` with synthesized speech).
7. **State Update**: Received messages trigger updates to the relevant context (`ConversationContext`), causing the UI to re-render.
8. **TTS Playback**: When a `tts_audio` message is received, the Base64 audio is decoded, converted to a playable format (e.g., Blob URL), and played using the browser's audio capabilities.

### WebSocket Communication

- **Single WebSocket Connection**: Managed by `useWebSocket`, handling different message types for control, audio streaming (forwarded to backend `/transcription`), and receiving results.
- **Key Message Types (Simplified)**:
    - **Client -> Server**: `auth`, `select_conversation`, `input_audio_buffer.append`, `input_audio_buffer.finalize`, `input_audio_buffer.pause`, `
