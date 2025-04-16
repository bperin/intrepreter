import { Message } from '../../generated/prisma'; // Corrected import path for custom Prisma output

export interface IMessageService {
  /**
   * Creates and saves a new message to the database.
   * @param conversationId The ID of the conversation the message belongs to.
   * @param text The content of the message.
   * @param sender A string identifying the sender (e.g., 'clinician', 'patient', 'assistant', 'translation').
   * @param language The detected language code of the message text (e.g., 'en', 'es').
   * @param originalMessageId Optional. The ID of the original message this message is derived from (e.g., a translation).
   * @returns A promise resolving to the newly created Message object.
   */
  createMessage(
    conversationId: string,
    text: string,
    sender: string,
    language: string,
    originalMessageId?: string | null
  ): Promise<Message>;

  /**
   * Retrieves all messages for a given conversation, ordered by timestamp.
   * @param conversationId The ID of the conversation.
   * @returns A promise resolving to an array of Message objects.
   */
  getMessagesByConversationId(conversationId: string): Promise<Message[]>;
}

// Token for dependency injection
export const IMessageService = Symbol('IMessageService'); 