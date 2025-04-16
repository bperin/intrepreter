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
    language: string // Add language parameter
  ): Promise<Message> {
    console.log(
      `[MessageService] Attempting to save message for conversation ${conversationId}. Sender: ${sender}, Lang: ${language}, Text: "${text.substring(0, 50)}..."`
    );
    try {
      // Map sender to senderType in the schema if needed, or adjust schema
      // For now, assuming sender directly maps to senderType
      const newMessage = await this.prisma.message.create({
        data: {
          conversationId: conversationId,
          originalText: text, // Assuming this field stores the primary text
          senderType: sender, // Assuming this field stores the sender
          language: language, // Use the provided language
          // translatedText: null, // Set if applicable
          // isFinal: true, // Mark as final since it comes from .completed event
        },
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
} 