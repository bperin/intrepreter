export interface EphemeralKeyResult {
    key: string;
    isMock?: boolean; // Flag to indicate if this is a mock key (not a real OpenAI key)
    // Potentially add expiration time, etc., if the API provides it
}

export interface TranslationResult {
    translatedText: string;
}

export interface IOpenAIClient {
    /**
     * Creates an ephemeral API key for a specific session.
     * @returns Promise resolving to the ephemeral key details.
     */
    createEphemeralKey(): Promise<EphemeralKeyResult>;

    /**
     * Translates text from a source language to a target language.
     * @param text - The text to translate.
     * @param targetLanguage - ISO 639-1 code of the target language.
     * @param sourceLanguage - ISO 639-1 code of the source language (optional).
     * @returns Promise resolving to the translation result.
     */
    translate(text: string, targetLanguage: string, sourceLanguage?: string): Promise<TranslationResult>;

    // Define other methods as needed: actionDetection, summarize, tts, etc.
} 