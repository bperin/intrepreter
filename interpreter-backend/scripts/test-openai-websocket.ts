import WebSocket from 'ws';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file in the parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.OPENAI_API_KEY;
const openaiUrl = 'wss://api.openai.com/v1/realtime?intent=transcription';

if (!apiKey) {
  console.error('Error: OPENAI_API_KEY environment variable not set!');
  process.exit(1);
}

console.log('Attempting to connect to OpenAI WebSocket...');

const ws = new WebSocket(openaiUrl, {
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'OpenAI-Beta': 'realtime=v1' // Required header for the realtime API
  }
});

let currentSessionId: string | null = null;

ws.on('open', () => {
  console.log('WebSocket connection opened successfully.');
  console.log('Waiting for transcription_session.created message...');
  // Do NOT send any configuration immediately on open
});

ws.on('message', (data) => {
  const messageStr = data.toString();
  console.log('Received raw message from OpenAI:', messageStr);
  try {
    const message = JSON.parse(messageStr);
    console.log('Parsed OpenAI message:', JSON.stringify(message, null, 2));

    // When session is created, extract ID and send the specific update message
    if (message.type === 'transcription_session.created' && message.session?.id) {
      currentSessionId = message.session.id;
      console.log(`*** Session created! ID: ${currentSessionId}. Default format: ${message.session.input_audio_format} ***`);

      // Revert to the nested structure for updateConfig
      const updateConfig = {
        type: "transcription_session.update",
        session: { // Start of nested session object
          // id: currentSessionId, // Session ID inside the nested object
          // input_audio_format: "pcm16", // Cannot set format here
          input_audio_transcription: {
            model: "whisper-1", 
            language: "en",
            prompt: "Transcribe speech to text in English."
          },
          turn_detection: {
            type: "server_vad",
            silence_duration_ms: 500,
            prefix_padding_ms: 300,
            threshold: 0.5
          },
          include: [
            "item.input_audio_transcription.logprobs"
          ]
        } // End of nested session object
      };

      console.log('Sending transcription_session.update (Reverted Nested Structure):', JSON.stringify(updateConfig, null, 2));
      try {
        ws.send(JSON.stringify(updateConfig));
        console.log('Update configuration sent.');
      } catch (error) {
        console.error('Error sending update configuration:', error);
      }

    } else if (message.type === 'transcription_session.updated') {
         console.log('*** Received session.updated confirmation ***', JSON.stringify(message.session, null, 2));
    } else if (message.type === 'error') {
      console.error('>>> OpenAI returned an error message <<<');
      if (message.error) {
        console.error(`Error details: ${message.error.type} - ${message.error.message}`);
      }
    } 
    else {
        // Log other potentially interesting messages (like transcription results if they appear)
        console.log(`Received other message type: ${message.type}`);
    }
    
  } catch (error) {
    console.error('Error parsing message or non-JSON message received:', messageStr);
  }
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason?.toString()}`);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// Keep the script running for a bit to receive messages, then exit
setTimeout(() => {
  console.log('Closing WebSocket connection after timeout.');
  ws.close();
}, 30000); // Keep running for 30 seconds 