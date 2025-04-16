import { Message } from '@prisma/client'; // Reverted to standard import path

export interface IMessageService {
  /**
   * Creates and saves a new message to the database.
   * @param conversationId The ID of the conversation the message belongs to.
   * @param text The content of the message.
   * @param sender A string identifying the sender (e.g., 'clinician', 'patient', 'assistant').
   * @returns A promise resolving to the newly created Message object.
   */
  createMessage(
    conversationId: string,
    text: string,
    sender: string
  ): Promise<Message>;
}

// Token for dependency injection
export const IMessageService = Symbol('IMessageService'); 