import { Conversation } from "../../generated/prisma";

// Input data structure for starting a new session
export interface StartSessionInput {
    userId: string; // ID of the clinician starting the session
    patientFirstName: string;
    patientLastName: string;
    patientDob: Date; // Date object for DOB
    clinicianPreferredLanguage?: string; // Optional override for clinician's output language
}

// Define the return type for starting a session, including the OpenAI key
export interface StartSessionResult {
    conversation: Conversation;
}

export interface IConversationService {
    /**
     * Starts a new conversation session.
     * Finds or creates the patient, creates a new conversation record,
     * and generates an ephemeral OpenAI key for the session.
     * @param input - The input data containing user ID and patient details.
     * @returns An object containing the new Conversation and the OpenAI ephemeral key.
     */
    startNewSession(input: StartSessionInput): Promise<StartSessionResult>;

    // Add other conversation-related methods if needed later
    // e.g., endSession(conversationId: string): Promise<Conversation>;
    // e.g., getConversationDetails(conversationId: string): Promise<Conversation | null>;
}
