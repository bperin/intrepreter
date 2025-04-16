import { Conversation } from '../../generated/prisma'; // Assuming Conversation type is needed

export interface ISummaryService {
    /**
     * Generates or updates the summary for a given conversation.
     * This might fetch messages, call an LLM, and save the result.
     * @param conversationId The ID of the conversation to summarize.
     * @returns A promise resolving to the updated Conversation object (or just void/boolean indicating success).
     */
    updateSummary(conversationId: string): Promise<Conversation | void>; 
} 