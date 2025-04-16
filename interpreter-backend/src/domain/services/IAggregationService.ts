import { AggregatedAction } from "../models/AggregatedAction";

export interface IAggregationService {
    /**
     * Retrieves Notes, FollowUps, and Prescriptions for a conversation,
     * maps them to a common structure, and returns them as a single,
     * sorted list.
     * @param conversationId The ID of the conversation.
     * @returns A promise resolving to an array of AggregatedAction objects, sorted by createdAt.
     */
    getAggregatedActionsByConversationId(conversationId: string): Promise<AggregatedAction[]>;
} 