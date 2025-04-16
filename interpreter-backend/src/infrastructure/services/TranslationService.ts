import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { injectable } from 'tsyringe';
import { OpenAI } from 'openai';
import { Readable } from 'stream';
import { ITranslationService } from '../../domain/services/ITranslationService';

// Load environment variables from .env file in the parent directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Interface for the expected OpenAI Chat Completion response structure
interface OpenAIChatCompletionResponse {
    choices?: [
        {
            message?: {
                content?: string;
            };
        }
    ];
    // other potential fields...
}

@injectable()
export class TranslationService implements ITranslationService {
    private readonly openai: OpenAI;
    private readonly apiKeyPresent: boolean;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            console.error('[TranslationService] OPENAI_API_KEY is not set! Translation will fail.');
            this.apiKeyPresent = false;
            this.openai = new OpenAI({ apiKey: 'dummy-key' });
        } else {
            this.openai = new OpenAI({ apiKey });
            this.apiKeyPresent = true;
        }
    }

    /**
     * Translates text from a source language to a target language using the OpenAI SDK stream.
     * @param text The text to translate.
     * @param sourceLang ISO 639-1 code of the source language.
     * @param targetLang ISO 639-1 code of the target language (defaults to 'en').
     * @returns An async generator yielding translated text chunks, or throws an error on failure.
     */
    public async *translateTextStream(text: string, sourceLang: string, targetLang: string = 'en'): AsyncGenerator<string, void, undefined> {
        if (!this.apiKeyPresent) {
            throw new Error('[TranslationService] Cannot translate text: OPENAI_API_KEY not set.');
        }
        if (!text || !sourceLang) {
            throw new Error('[TranslationService] Cannot translate text: Missing text or source language.');
        }

        const prompt = `Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translated text, without any introductory phrases or explanations. Text: "${text}"`;
        console.log(`[TranslationService] Streaming SDK translation from ${sourceLang} to ${targetLang}...`);

        try {
            const stream = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: Math.ceil(text.length * 1.5) + 10,
                temperature: 0.2,
                stream: true,
            });

            for await (const chunk of stream) {
                const contentDelta = chunk.choices[0]?.delta?.content;
                if (contentDelta) {
                    yield contentDelta;
                }
                if (chunk.choices[0]?.finish_reason) {
                    console.log(`[TranslationService] Stream finished via SDK. Reason: ${chunk.choices[0].finish_reason}`);
                    break;
                }
            }
            console.log(`[TranslationService] Finished iterating SDK stream.`);

        } catch (error: any) {
            console.error(`[TranslationService] Error calling OpenAI Translation SDK:`, error?.message || error);
            if (error instanceof OpenAI.APIError) {
                console.error(`[TranslationService] OpenAI API Error Details: Status=${error.status}, Type=${error.type}, Code=${error.code}`);
            }
            throw new Error(`Failed to get translation stream from OpenAI SDK: ${error?.message || 'Unknown error'}`);
        }
    }

    /**
     * Translates text from a source language to a target language using OpenAI.
     * @param text The text to translate.
     * @param sourceLang ISO 639-1 code of the source language.
     * @param targetLang ISO 639-1 code of the target language (defaults to 'en').
     * @returns A promise resolving to the translated text or null if translation fails.
     */
    public async translateText(text: string, sourceLang: string, targetLang: string = 'en'): Promise<string | null> {
        if (!this.apiKeyPresent) {
            console.warn('[TranslationService] Cannot translate text: OPENAI_API_KEY not set.');
            return null;
        }
        if (!text || !sourceLang) {
            console.warn('[TranslationService] Cannot translate text: Missing text or source language.');
            return null;
        }

        const prompt = `Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translated text, without any introductory phrases or explanations. Text: "${text}"`;
        console.log(`[TranslationService] Non-streaming translation from ${sourceLang} to ${targetLang}...`);

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: Math.ceil(text.length * 1.5) + 10,
                temperature: 0.2,
                stream: false,
            });
            const translatedContent = response.choices[0]?.message?.content?.trim().replace(/^"|"$/g, '');
            if (translatedContent) {
                return translatedContent;
            } else {
                return null;
            }
        } catch (error: any) {
            console.error(`[TranslationService] Error calling OpenAI Translation SDK (non-streaming):`, error?.message || error);
            return null;
        }
    }
} 