export interface ITextToSpeechService {
  /**
   * Synthesizes speech from the provided text using a TTS provider.
   * @param text The text to synthesize.
   * @param voice Optional voice selection (provider-specific).
   * @returns A Promise resolving to a Buffer containing the audio data (e.g., MP3).
   * @throws Error if synthesis fails.
   */
  synthesizeSpeech(text: string, voice?: string): Promise<Buffer>;
}

// Token for dependency injection
export const ITextToSpeechService = Symbol('ITextToSpeechService'); 