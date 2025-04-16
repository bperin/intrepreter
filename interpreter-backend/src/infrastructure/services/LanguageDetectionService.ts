import { injectable } from 'tsyringe';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { ILanguageDetectionService } from '../../domain/services/ILanguageDetectionService';

// Load environment variables if needed (adjust path as necessary)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); 
// Assuming OPENAI_API_KEY is loaded globally or via parent service environment

@injectable()
export class LanguageDetectionService implements ILanguageDetectionService {
    private readonly openai: OpenAI;
    private readonly apiKeyPresent: boolean;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            console.error('[LanguageDetectionService] OPENAI_API_KEY is not set! Detection will fail.');
            this.apiKeyPresent = false;
            this.openai = new OpenAI({ apiKey: 'dummy-key' }); // Provide dummy
        } else {
             this.openai = new OpenAI({ apiKey });
             this.apiKeyPresent = true;
        }
    }

    /**
     * Detects the language of a given text using the OpenAI SDK.
     * @param text The text to detect the language for.
     * @returns A promise resolving to the ISO 639-1 language code (e.g., 'en', 'es') or 'unknown'.
     */
    async detectLanguage(text: string): Promise<string> {
        if (!this.apiKeyPresent) {
            console.warn('[LanguageDetectionService] Cannot detect language: OPENAI_API_KEY not set.');
            return 'unknown';
        }
        if (!text || text.trim().length === 0) {
            return 'unknown';
        }

        const prompt = `Identify the predominant language of the following text and return only its two-letter ISO 639-1 code (e.g., en, es, fr, ja). Text: "${text}"`;
        console.log(`[LanguageDetectionService] Detecting language for text (first 50 chars): "${text.substring(0, 50)}..."`);

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 5,  // Language code should be very short
                temperature: 0.1, // Low temperature for factual task
                n: 1, // Only need one completion
                stream: false, // Not streaming for this
            });

            const detectedLang = response.choices[0]?.message?.content?.trim().toLowerCase();

            // Validate if the result looks like a 2-letter code
            if (detectedLang && /^[a-z]{2}$/.test(detectedLang)) {
                 console.log(`[LanguageDetectionService] Detected language: ${detectedLang}`);
                 return detectedLang;
            } else {
                 console.warn(`[LanguageDetectionService] Language detection returned unexpected result: '${detectedLang}'. Defaulting to 'unknown'. Full response:`, response);
                 return 'unknown';
            }

        } catch (error: any) {
            console.error('[LanguageDetectionService] Error calling OpenAI Language Detection SDK:');
             if (error instanceof OpenAI.APIError) {
                 console.error(`OpenAI API Error: Status=${error.status}, Type=${error.type}, Code=${error.code}, Message=${error.message}`);
            } else {
                 console.error('An unknown error occurred:', error?.message || String(error));
            }
            return 'unknown'; // Default on error
        }
    }
} 