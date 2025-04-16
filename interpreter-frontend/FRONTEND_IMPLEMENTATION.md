# Frontend Implementation Overview

This document provides an overview of the frontend implementation, focusing on how the application handles audio recording, communication with the backend pipeline, and displaying results.

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
    - **Client -> Server**: `auth`, `select_conversation`, `input_audio_buffer.append`, `input_audio_buffer.finalize`, `input_audio_buffer.pause`, `input_audio_buffer.resume`, `get_messages`, `get_actions`, `get_summary`, `get_medical_history`.
    - **Server -> Client**: `connection_ack`, `openai_connected`, `openai_disconnected`, `backend_connected`, `new_message`, `tts_audio`, `message_list`, `action_list`, `summary_data`, `medical_history_data`, `command_executed`, `error`.

## Voice Command Integration

- **Display**: Detected commands and their execution results (`command_executed` message) are typically displayed as system messages or updates within the chat interface.
- **Feedback**: No specific UI feedback implemented beyond displaying the results broadcast by the backend.

## Error Handling

- Handles WebSocket connection errors and attempts reconnection.
- Handles microphone permission errors.
- Displays error messages received from the backend via the WebSocket.

## Performance Considerations

- Audio buffering in `useAudioRecorder` ensures smooth transmission.
- React Context and component memoization help manage re-renders.
- WebSocket connection is managed efficiently.

## State Management

- **React Context**: Used for global and conversation-specific state (`AuthContext`, `ConversationContext`).
- **Context Providers**: Wrap relevant parts of the application.
- **Local Storage**: Used for persisting authentication tokens.

## UI/UX Design

- Responsive design for various screen sizes.
- Visual indicators for audio recording status.
- Loading indicators for asynchronous operations (e.g., fetching conversations).
- User-friendly error messages.

## Security Considerations

- Uses JWT for user authentication via backend API.
- WebSocket connection requires token for authentication.
- API keys are managed solely by the backend.
- Communication uses HTTPS/WSS.

## Connection Status Display

- UI includes indicators for WebSocket connection status (`useWebSocket` state).

## Debugging and Testing

- Extensive console logging for key events, state changes, and WebSocket messages.
- Standard React testing approaches can be used.

## Future Enhancements

- [ ] **Offline Support**: Add support for offline audio recording and transcription when the network is unavailable.
- [ ] **Custom Voice Commands**: Allow users to define custom voice commands for their workflow.
- [ ] **Multi-language Support**: Add support for transcription in multiple languages.
- [ ] **Advanced Visualization**: Enhance the visualization of audio data and transcription results.
- [ ] **Mobile Optimization**: Further optimize the application for mobile devices.
