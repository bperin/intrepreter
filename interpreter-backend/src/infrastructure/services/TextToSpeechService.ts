import axios from 'axios';
import { injectable } from 'tsyringe';
import { Buffer } from 'buffer'; // Ensure Buffer is imported
import { ITextToSpeechService } from '../../domain/services/ITextToSpeechService';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Define valid OpenAI voice names
type OpenAiVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

@injectable()
export class TextToSpeechService implements ITextToSpeechService {
    private readonly apiKey: string;
    private readonly ttsUrl = 'https://api.openai.com/v1/audio/speech';

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || '';
        if (!this.apiKey) {
            console.error('[TextToSpeechService] Error: OPENAI_API_KEY environment variable not set.');
            // Consider throwing an error here to prevent service initialization?
        }
    }

    // Helper to map language code to a specific voice
    private getVoiceForLanguage(languageCode?: string | null): OpenAiVoice {
        const lang = languageCode?.toLowerCase() || 'en'; // Default to English if null/undefined
        switch (lang) {
            case 'es':
                return 'nova'; // Example voice for Spanish
            case 'fr':
                return 'shimmer'; // Example voice for French
            // Add mappings for other languages as needed
            case 'en':
            default:
                return 'alloy'; // Default/English voice
        }
    }

    async synthesizeSpeech(text: string, language?: string): Promise<Buffer> {
        if (!this.apiKey) {
            // Throw error if key wasn't found during construction
            throw new Error('OpenAI API key is not configured for TTS.');
        }
        if (!text) {
            console.warn('[TextToSpeechService] Synthesize speech called with empty text.');
            return Buffer.alloc(0); // Return empty buffer for empty text
        }

        const voice = this.getVoiceForLanguage(language);

        console.log(`[TextToSpeechService] Synthesizing speech for text (first 50 chars): "${text.substring(0, 50)}..." Voice: ${voice}`);

        try {
            const response = await axios.post(
                this.ttsUrl,
                {
                    model: 'tts-1', // Or 'tts-1-hd'
                    input: text,
                    voice: voice, // Use the mapped voice name
                    // response_format: 'mp3' // Default is mp3
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'arraybuffer',
                }
            );

            // Check if response.data is actually a buffer
            if (response.data instanceof Buffer) {
                console.log(`[TextToSpeechService] Received audio buffer, size: ${response.data.length}`);
                return response.data;
            } else {
                // If it's not a Buffer (or ArrayBuffer), log an error and return empty buffer
                console.error('[TextToSpeechService] Unexpected response data type received from TTS API. Type:', typeof response.data);
                // Optionally log the data itself if it's small/safe
                // console.error('[TextToSpeechService] Received data:', response.data);
                return Buffer.alloc(0); // Return empty buffer on unexpected type
            }

        } catch (error: any) { // Use standard error handling
            console.error('[TextToSpeechService] Error calling OpenAI TTS API:', error.message);
            if (error.response) {
                console.error('[TextToSpeechService] OpenAI TTS Error Response Status:', error.response.status);
                // Avoid parsing error.response.data directly here to prevent linter issues
                console.error('[TextToSpeechService] OpenAI TTS Error: Check API key, input text, and voice name.');
            } else if (error.request) {
                // Handle cases where the request was made but no response received
                console.error('[TextToSpeechService] OpenAI TTS No response received:', error.request);
            }
            // Re-throw a more specific error (or return empty buffer)
            // Returning empty buffer might be safer than throwing in some contexts
            console.error('Returning empty buffer due to TTS synthesis error.');
            return Buffer.alloc(0);
        }
    }
} 