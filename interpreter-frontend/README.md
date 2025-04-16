# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
    extends: [
        // Remove ...tseslint.configs.recommended and replace with this
        ...tseslint.configs.recommendedTypeChecked,
        // Alternatively, use this for stricter rules
        ...tseslint.configs.strictTypeChecked,
        // Optionally, add this for stylistic rules
        ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
        // other options...
        parserOptions: {
            project: ["./tsconfig.node.json", "./tsconfig.app.json"],
            tsconfigRootDir: import.meta.dirname,
        },
    },
});
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from "eslint-plugin-react-x";
import reactDom from "eslint-plugin-react-dom";

export default tseslint.config({
    plugins: {
        // Add the react-x and react-dom plugins
        "react-x": reactX,
        "react-dom": reactDom,
    },
    rules: {
        // other rules...
        // Enable its recommended typescript rules
        ...reactX.configs["recommended-typescript"].rules,
        ...reactDom.configs.recommended.rules,
    },
});
```

---

# Interpreter Frontend Implementation Details

This frontend provides the user interface for the real-time medical interpretation application.

## Core Technologies

- **React:** UI library.
- **TypeScript:** Static typing.
- **Vite:** Build tool and development server.
- **Styled Components:** CSS-in-JS for styling.
- **React Router:** Client-side routing.
- **Axios:** HTTP client for REST API calls (e.g., authentication).
- **Web Audio API:** Used for audio capture and PCM16 conversion.

## Audio Format Handling

The application processes audio in a specific format required by OpenAI's Realtime API:

- **Format:** PCM16 (16-bit signed PCM)
- **Sample Rate:** 24kHz
- **Channels:** Mono (single channel)

The frontend handles the conversion from raw audio to this format:

1. **Audio Capture:** Uses `navigator.mediaDevices.getUserMedia()` to access the microphone.
2. **Audio Processing:**
    - Creates an `AudioContext` with `sampleRate: 24000`
    - Uses `ScriptProcessorNode` to access raw audio data as Float32Array
    - Converts Float32Array [-1,1] to Int16Array [-32768,32767] for PCM16 format
    - Batches audio chunks for efficient transmission
3. **Transmission:** Base64-encodes the PCM16 data and sends it to the backend via WebSocket

This approach ensures that audio data is in the exact format required by OpenAI's Realtime API, improving transcription quality and reliability.

## Key Components & Logic

- **`App.tsx`:** Sets up main routing (`BrowserRouter`), global providers (`ThemeProvider`, `AuthProvider`, `ErrorProvider`), and basic page layout.
- **`pages/DashboardPage.tsx`:** Protected route displaying the main application interface after login. Uses `DashboardLayout`.
- **`components/DashboardLayout.tsx`:** Defines the multi-column layout (Conversations, Chat, Actions).
- **`components/ChatInterface.tsx`:** The central component for real-time interaction:
    - **WebSocket Connection:** Managed by the `hooks/useWebSocket.tsx` hook. Connects to the backend's `/ws` endpoint upon component mount, handling authentication via a token passed as a query parameter.
    - **Audio Capture:** Uses the `MediaRecorder` API (`navigator.mediaDevices.getUserMedia`) to capture microphone audio.
    - **Audio Sending:** When recording, sends audio chunks (`Blob` data) directly over the established WebSocket connection.
    - **Transcription Handling:** Listens for incoming WebSocket messages. Parses messages with `{ type: 'transcription', ... }`, determines the sender based on the `speaker` field (`clinician` -> `user`, `patient` -> `other`), and updates the message list state.
    - **TTS Audio Playback:** Listens for incoming WebSocket messages with `{ type: 'audio_data', payload: <Base64 Data URL> }`. Decodes the Base64 audio data into an `AudioBuffer` using `AudioContext` and plays it back.
    - **UI:** Displays the conversation transcript, connection status, and recording controls.
- **`hooks/useWebSocket.tsx`:** Custom hook encapsulating WebSocket logic:
    - Establishes connection using token from `AuthContext`.
    - Handles message sending (including `Blob` data).
    - Manages connection state (`isConnected`), errors (`error`), and received messages (`lastMessage`).
    - Includes basic reconnect logic with exponential backoff.
- **`context/AuthContext.tsx`:** Manages user authentication state (token, user info) and provides login/logout functions.
- **`context/ErrorContext.tsx`:** Global error handling mechanism.
- **`theme.ts`:** Defines the application's visual theme (colors, fonts, spacing) used by Styled Components.
- **`components/common/Button.tsx`:** (Currently experiencing import issues) A reusable button component.

## Communication Flow (Real-time)

1.  `ChatInterface` mounts, `useWebSocket` hook establishes authenticated WebSocket connection.
2.  User clicks "Start Recording".
3.  `ChatInterface` uses `MediaRecorder` to capture audio.
4.  `ondataavailable` event fires periodically, sending audio `Blob` via `useWebSocket` -> Backend.
5.  Backend processes audio (transcription, potentially TTS).
6.  Backend sends messages back via WebSocket:
    - `{ type: 'transcription', text: '...', speaker: '...' }`
    - `{ type: 'audio_data', payload: '...' }` (Base64 TTS audio)
7.  `useWebSocket` receives messages, updating `lastMessage`.
8.  `ChatInterface` `useEffect` hook processes `lastMessage`:
    - Adds transcriptions to the display.
    - Decodes and plays audio data.

## Setup & Running

1.  Ensure the backend server is running.
2.  Install dependencies: `npm install`
3.  Run the development server: `npm run dev`
4.  Access the application via the URL provided by Vite (usually `http://localhost:5173`).
