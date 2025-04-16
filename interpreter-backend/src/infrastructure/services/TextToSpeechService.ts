import { injectable } from 'tsyringe';
import axios from 'axios';
import { Buffer } from 'buffer'; // Ensure Buffer is imported
import { ITextToSpeechService } from '../../domain/services/ITextToSpeechService';

@injectable()
export class TextToSpeechService implements ITextToSpeechService {
    private readonly apiKey: string;
    private readonly ttsUrl = 'https://api.openai.com/v1/audio/speech';

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || '';
        if (!this.apiKey) {
            console.error('[TextToSpeechService] OPENAI_API_KEY environment variable is not set!');
            // Consider throwing an error here if TTS is critical
        }
    }

    async synthesizeSpeech(text: string, voice: string = 'nova'): Promise<Buffer> {
        if (!this.apiKey) {
            throw new Error('OpenAI API key is not configured for TTS.');
        }
        if (!text) {
             console.warn('[TextToSpeechService] synthesizeSpeech called with empty text. Skipping TTS.');
             return Buffer.alloc(0); // Return empty buffer for empty text
        }

        console.log(`[TextToSpeechService] Synthesizing speech for text (first 50 chars): "${text.substring(0, 50)}..." Voice: ${voice}`);

        try {
            const response = await axios.post(
                this.ttsUrl,
                {
                    model: 'tts-1', // Or 'tts-1-hd'
                    input: text,
                    voice: voice, // e.g., 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'
                    // response_format: 'mp3' // Default is mp3
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'arraybuffer', // Crucial for receiving binary audio data
                }
            );

            console.log(`[TextToSpeechService] Received audio buffer from OpenAI. Size: ${(response.data as ArrayBuffer).byteLength} bytes.`);
            // Convert ArrayBuffer to Node.js Buffer
            return Buffer.from(response.data as ArrayBuffer);

        } catch (error) {
            console.error('[TextToSpeechService] Error calling OpenAI TTS API:', error);
            
            // --- Temporary Workaround for isAxiosError issue --- 
            // Check for properties directly, less type-safe
            if (error && typeof error === 'object' && (error as any).response) {
                const axiosError = error as any; // Treat as any
                console.error('[TextToSpeechService] OpenAI TTS Error Response Status:', axiosError.response.status);
                try {
                    const errorBuffer = Buffer.from(axiosError.response.data as ArrayBuffer);
                    const errorData = JSON.parse(errorBuffer.toString('utf8'));
                    console.error('[TextToSpeechService] OpenAI TTS Error Response Data:', JSON.stringify(errorData, null, 2));
                } catch (parseError) {
                    const errorBuffer = Buffer.from(axiosError.response.data as ArrayBuffer);
                    console.error('[TextToSpeechService] OpenAI TTS Error Response Data (non-JSON):', errorBuffer.toString('utf8'));
                }
            } else if (error && typeof error === 'object' && (error as any).request) {
                console.error('[TextToSpeechService] OpenAI TTS No response received:', (error as any).request);
            } else if (error instanceof Error) {
                console.error('[TextToSpeechService] OpenAI TTS Error setting up request or other error:', error.message);
            }
            // --- End Workaround ---

            // Re-throw a generic error to be handled by the caller
            throw new Error(`Failed to synthesize speech: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 