// Placeholder for Transcription Result
export interface TranscriptionResult {
    text: string;
    language?: string; // Optional detected language
    // Add other relevant fields if needed (e.g., timestamps, confidence)
}

export interface ITranscriptionService {
    /**
     * Transcribes an audio source.
     * @param audioSource Path to the audio file or potentially a Buffer/Stream.
     * @returns A promise resolving to the transcription result.
     */
    transcribe(audioSource: string | Buffer): Promise<TranscriptionResult>;
} 