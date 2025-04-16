import { Buffer } from "buffer";

// Define expected result from STT service
export interface TranscriptionResult {
    text: string;
    language?: string;
    isFinal: boolean; // Flag to indicate if this is a final transcription
}

export interface IAudioProcessingService {
    /**
     * Processes an incoming audio chunk for a specific conversation and speaker.
     * This method might buffer chunks internally before sending to STT.
     * @param conversationId - The ID of the active conversation.
     * @param userId - The ID of the user sending the audio (for speaker identification).
     * @param speakerType - Indicates if the speaker is 'clinician' or 'patient'.
     * @param audioChunk - The raw audio data chunk.
     */
    processAudioChunk(conversationId: string, userId: string, speakerType: "clinician" | "patient", audioChunk: Buffer): Promise<void>;

    /**
     * Signals the end of an audio stream for a speaker,
     * ensuring any remaining buffered audio is processed.
     * @param conversationId - The ID of the active conversation.
     * @param userId - The ID of the user whose stream ended.
     */
    finalizeStream(conversationId: string, userId: string): Promise<void>;
}
