import { Message, Prisma } from "../../generated/prisma";

export interface IMessageRepository {
    /**
     * Creates a new message record in the database.
     * @param data - The data for the new message, including conversationId, senderType, originalText, language, etc.
     * @returns A Promise resolving to the newly created Message object.
     */
    create(data: Prisma.MessageUncheckedCreateInput): Promise<Message>;

    /**
     * Finds messages by conversation ID, typically ordered by timestamp.
     * @param conversationId - The ID of the conversation.
     * @returns A Promise resolving to an array of Message objects.
     */
    findByConversationId(conversationId: string): Promise<Message[]>;

    // Add other methods if needed, e.g., findById, update (for adding translation)
    update(id: string, data: Prisma.MessageUpdateInput): Promise<Message>;
}
