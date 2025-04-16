export interface ITranslationService {
    /**
     * Translates text from a source language to a target language using the OpenAI SDK stream.
     * @param text The text to translate.
     * @param sourceLang ISO 639-1 code of the source language.
     * @param targetLang ISO 639-1 code of the target language (defaults to 'en').
     * @returns An async generator yielding translated text chunks, or throws an error on failure.
     */
    translateTextStream(text: string, sourceLang: string, targetLang?: string): AsyncGenerator<string, void, undefined>;

    /**
     * Translates text from a source language to a target language using OpenAI (non-streaming).
     * @param text The text to translate.
     * @param sourceLang ISO 639-1 code of the source language.
     * @param targetLang ISO 639-1 code of the target language (defaults to 'en').
     * @returns A promise resolving to the translated text or null if translation fails.
     */
    translateText(text: string, sourceLang: string, targetLang?: string): Promise<string | null>;
} 