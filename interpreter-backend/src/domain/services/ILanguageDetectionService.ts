export interface ILanguageDetectionService {
  /**
   * Detects the language of a given text using an external service (e.g., OpenAI).
   * @param text The text to detect the language for.
   * @returns A promise resolving to the ISO 639-1 language code (e.g., 'en', 'es') or 'unknown'.
   */
  detectLanguage(text: string): Promise<string>;
} 