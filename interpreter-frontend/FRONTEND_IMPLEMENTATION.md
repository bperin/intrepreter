# Frontend Implementation Overview

This document provides an overview of the frontend implementation, focusing on how the application handles audio recording, speech-to-text transcription, and real-time communication with the backend.

## Core Technologies

- [x] **React & TypeScript**: The application is built using React with TypeScript for type safety.
- [x] **WebSocket**: Used for real-time bidirectional communication with the backend.
- [x] **Web Audio API**: Used for capturing and processing audio from the user's microphone.
- [x] **OpenAI API**: The application connects to OpenAI's API (via the backend proxy) for speech-to-text transcription.

## Project Structure

- [x] **`/src/components/`**: Contains React components for the UI.
- [x] **`/src/context/`**: Contains React context providers for state management.
- [x] **`/src/hooks/`**: Contains custom hooks for managing audio recording, WebSocket communication, and other functionality.
- [x] **`/src/pages/`**: Contains page components for different routes.
- [x] **`/src/utils/`**: Contains utility functions and helpers.
- [x] **`/src/types/`**: Contains TypeScript type definitions.

## Key Components

- [x] **`App.tsx`**: The main application component that sets up routing and global context providers.
- [x] **`LoginPage.tsx`**: Handles user authentication and registration.
- [x] **`ChatInterface.tsx`**: The main interface for audio conversations, displaying transcriptions and handling audio recording.
- [x] **`ConversationList.tsx`**: Displays a list of conversations and handles conversation selection.
- [x] **`MessageList.tsx`**: Displays messages within a conversation.
- [x] **`PatientModal.tsx`**: Allows the user to select or create a patient for a new conversation.

## Audio & Transcription Implementation

### Core Hooks

- [x] **`useAudioRecorder.ts`**: A custom hook that manages audio recording using the Web Audio API. Handles starting, stopping, and pausing recording, as well as processing audio data for transmission.
- [x] **`useSpeechToText.ts`**: Connects to the backend WebSocket server for streaming audio data and receiving transcriptions.
- [x] **`useWebSocket.ts`**: Manages WebSocket connections to the backend for control messages (session management, transcription broadcasting, etc.).

### Audio Processing Flow

- [x]   1. **Permission Request**: The application requests microphone permission when the user initiates a recording session.
- [x]   2. **Audio Capture**: Once permission is granted, the application begins capturing audio data from the user's microphone using the Web Audio API.
- [x]   3. **Audio Format Conversion**: The frontend converts the raw audio to mono PCM16 at 24kHz format using Web Audio API:
    - Creates an `AudioContext` with `sampleRate: 24000`
    - Uses a `ScriptProcessorNode` to access raw audio data
    - Converts Float32Array [-1,1] to Int16Array [-32768,32767] for PCM16 format
    - Base64 encodes the PCM16 data for WebSocket transmission
- [x]   4. **WebSocket Connection**: The frontend establishes a WebSocket connection to the backend's audio endpoint.
- [x]   5. **Audio Streaming**: The frontend streams the converted PCM16 audio data to the backend over the WebSocket connection.
- [x]   6. **Transcription Reception**: The frontend receives transcription results from the backend via the control WebSocket channel.
- [x]   7. **UI Update**: The application updates the UI to display the transcription results in real-time.

### WebSocket Communication

- [x] **Dual WebSocket Approach**:

    - **Control Channel**: Used for sending control messages (start/stop session) and receiving transcription results.
    - **Audio Channel**: Dedicated to streaming audio data to the backend.

- [x] **Message Types**:
    - `start_new_session`: Request to start a new conversation session.
    - `session_started`: Response indicating a session has started (includes conversation ID and OpenAI key).
    - `transcription`: Contains transcription results for a segment of audio.
    - `message_created`: Indicates a new message has been created in the conversation.
    - `error`: Contains error information if something goes wrong.

## Voice Command Integration

- [ ] **Command Display**: Voice commands are displayed in the UI as special message types or with distinctive styling.
- [ ] **Command Feedback**: The UI provides visual feedback when a voice command is detected and executed.
- [ ] **Command State Management**: The application maintains state to track the status of voice commands (pending, executed, failed).

## Error Handling

- [x] **Connection Errors**: The application handles WebSocket connection errors and attempts to reconnect when possible.
- [x] **Permission Errors**: The application gracefully handles cases where microphone permission is denied.
- [x] **Transcription Errors**: Errors in the transcription process are captured and displayed to the user.

## Performance Considerations

- [x] **Audio Buffering**: The application buffers audio data to ensure smooth transmission and processing.
- [x] **Throttling**: Transcription requests are throttled to manage API usage and ensure responsiveness.
- [x] **Memoization**: React components and hooks use memoization to prevent unnecessary re-renders.
- [x] **Resource Management**: Audio resources are properly cleaned up when no longer needed to prevent memory leaks.

## State Management

- [x] **React Context**: The application uses React Context for global state management.
- [x] **Conversation Context**: Manages the state of conversations, messages, and the active conversation.
- [x] **Authentication Context**: Manages the user's authentication state and tokens.
- [x] **Local Storage**: Used for persisting authentication tokens and user preferences.

## UI/UX Design

- [x] **Responsive Design**: The application is designed to work on various screen sizes.
- [x] **Audio Feedback**: Visual indicators for audio recording status (e.g., microphone icon, waveform visualization).
- [x] **Loading States**: The application displays loading indicators during async operations.
- [x] **Error Messages**: User-friendly error messages are displayed when issues occur.
- [x] **Accessibility**: The application includes accessibility features such as keyboard navigation and screen reader support.

## Security Considerations

- [x] **Authentication**: The application uses JWT for user authentication.
- [x] **Secure WebSocket**: WebSocket connections are secured and include authentication headers.
- [x] **API Key Management**: OpenAI API keys are managed securely, using ephemeral (short-lived) keys for each session.
- [x] **Data Encryption**: Sensitive data is encrypted during transmission using HTTPS/WSS.

## RTC Status Display

- [x] **Connection Status Indicator**: The UI includes a visual indicator showing the status of the WebRTC connection (idle, connecting, connected, error).
- [x] **Error Display**: When the WebRTC connection encounters an error, the error message is displayed to the user.
- [x] **Reconnection Logic**: The application attempts to reconnect the WebRTC connection if it is disconnected unexpectedly.

## Debugging and Testing

- [x] **Debug Mode**: The application includes a debug mode that provides additional logging and UI elements for debugging.
- [x] **Console Logging**: Key events and errors are logged to the console for debugging purposes.
- [x] **Unit Tests**: Components and hooks have unit tests to ensure proper functionality.
- [x] **Integration Tests**: The application includes integration tests for key workflows.

## Future Enhancements

- [ ] **Offline Support**: Add support for offline audio recording and transcription when the network is unavailable.
- [ ] **Custom Voice Commands**: Allow users to define custom voice commands for their workflow.
- [ ] **Multi-language Support**: Add support for transcription in multiple languages.
- [ ] **Advanced Visualization**: Enhance the visualization of audio data and transcription results.
- [ ] **Mobile Optimization**: Further optimize the application for mobile devices.
