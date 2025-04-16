import { injectable } from 'tsyringe';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { ILanguageDetectionService } from '../../domain/services/ILanguageDetectionService';

// Load environment variables if needed (adjust path as necessary)
// dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); 
// Assuming OPENAI_API_KEY is loaded globally or via parent service environment

// Interface for the expected OpenAI Chat Completion response structure
interface OpenAIChatCompletionResponse {
    choices?: [
        {
            message?: {
                content?: string;
            };
        }
    ];
}

@injectable()
export class LanguageDetectionService implements ILanguageDetectionService {
    private readonly openaiApiKey: string;

    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY || '';
        if (!this.openaiApiKey) {
            console.warn('[LanguageDetectionService] OPENAI_API_KEY is not set!');
        }
    }

    /**
     * Detects the language of a given text using the OpenAI API.
     * @param text The text to detect the language for.
     * @returns A promise resolving to the ISO 639-1 language code (e.g., 'en', 'es') or 'unknown'.
     */
    async detectLanguage(text: string): Promise<string> {
        if (!this.openaiApiKey) {
            console.warn('[LanguageDetectionService] Cannot detect language: OPENAI_API_KEY not set.');
            return 'unknown';
        }
        if (!text || text.trim().length === 0) {
            return 'unknown'; // No text to detect
        }

        const languageDetectionUrl = 'https://api.openai.com/v1/chat/completions';
        const prompt = `Identify the predominant language of the following text and return only its two-letter ISO 639-1 code (e.g., en, es, fr, ja). Text: "${text}"`;

        console.log(`[LanguageDetectionService] Detecting language for text (first 50 chars): "${text.substring(0, 50)}..."`);

        try {
            const response = await axios.post<OpenAIChatCompletionResponse>(
                languageDetectionUrl,
                {
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 5,
                    temperature: 0.1,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            const detectedLang = response.data?.choices?.[0]?.message?.content?.trim().toLowerCase();
            
            if (detectedLang && /^[a-z]{2}$/.test(detectedLang)) {
                 console.log(`[LanguageDetectionService] Detected language: ${detectedLang}`);
                 return detectedLang;
            } else {
                 console.warn(`[LanguageDetectionService] Language detection returned unexpected result: '${detectedLang}'. Defaulting to 'unknown'. Full response:`, JSON.stringify(response.data));
                 return 'unknown'; 
            }

        } catch (error) {
            console.error('[LanguageDetectionService] Error calling OpenAI Language Detection API:');
            if (error && typeof error === 'object' && 'isAxiosError' in error && error.isAxiosError) {
                const axiosError = error as { response?: { status?: number; data?: any } }; 
                console.error('Status:', axiosError.response?.status);
                if (axiosError.response?.data) {
                    try {
                        console.error('Data:', JSON.stringify(axiosError.response.data)); 
                    } catch { console.error('Data (raw):', axiosError.response.data); }
                } else { console.error('No response data received.'); }
            } else if (error instanceof Error) { console.error(error.message); }
            else { console.error('An unknown error occurred:', String(error)); }
            return 'unknown'; // Default on error
        }
    }
} 