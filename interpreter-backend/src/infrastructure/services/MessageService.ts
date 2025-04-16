import { injectable, inject } from 'tsyringe';
import { PrismaClient, Message } from '../../generated/prisma'; // Corrected import path
import {
  IMessageService,
  IMessageService as IMessageServiceToken,
} from '../../domain/services/IMessageService'; // Updated import path to domain/services

@injectable()
export class MessageService implements IMessageService {
  // Inject the PrismaClient instance (assuming it's registered in the container)
  constructor(@inject('PrismaClient') private prisma: PrismaClient) {}

  async createMessage(
    conversationId: string,
    text: string,
    sender: string, // Renamed from senderType for clarity matching interface
    language: string, // Add language parameter
    originalMessageId?: string | null // Add optional parameter to implementation
  ): Promise<Message> {
    console.log(
      `[MessageService] Attempting to save message. ConvID: ${conversationId}, Sender: ${sender}, Lang: ${language}, OrigMsgID: ${originalMessageId || 'N/A'}, Text: "${text.substring(0, 50)}..."`
    );
    try {
      // Prepare data for Prisma create
      const messageData: any = {
        conversationId: conversationId,
        originalText: text, // Assuming this field stores the primary text
        senderType: sender, // Assuming this field stores the sender
        language: language, // Use the provided language
        // translatedText: null, // Set if applicable
        // isFinal: true, // Mark as final since it comes from .completed event
      };

      // Add originalMessageId to data if provided
      if (originalMessageId) {
        messageData.originalMessageId = originalMessageId;
      }

      const newMessage = await this.prisma.message.create({
        data: messageData,
      });
      
      console.log(
        `[MessageService] Message saved successfully with ID: ${newMessage.id}`
      );
      return newMessage;
    } catch (error) {
      console.error(
        `[MessageService] Error saving message for conversation ${conversationId}:`,
        error
      );
      // Re-throw the error to be handled by the caller (TranscriptionService)
      throw error;
    }
  }

  // Implementation for getting messages
  async getMessagesByConversationId(conversationId: string): Promise<Message[]> {
    console.log(`[MessageService] Fetching messages for conversation ${conversationId}...`);
    try {
      const messages = await this.prisma.message.findMany({
        where: { conversationId: conversationId },
        orderBy: { timestamp: 'asc' }, // Order messages chronologically
      });
      console.log(`[MessageService] Found ${messages.length} messages for conversation ${conversationId}.`);
      return messages;
    } catch (error) {
      console.error(`[MessageService] Error fetching messages for conversation ${conversationId}:`, error);
      throw error; // Re-throw to be handled by caller
    }
  }
} 