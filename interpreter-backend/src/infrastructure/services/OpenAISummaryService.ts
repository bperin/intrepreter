import { injectable, inject } from 'tsyringe';
import { Conversation } from '../../generated/prisma';
import { IConversationRepository } from '../../domain/repositories/IConversationRepository';
import { ILanguageModelService } from '../../domain/services/ILanguageModelService';
import { ISummaryService } from '../../domain/services/ISummaryService';
import { Logger, createLogger } from '../../utils/Logger';

@injectable()
export class OpenAISummaryService implements ISummaryService {
    private logger: Logger;

    constructor(
        @inject("IConversationRepository") private conversationRepository: IConversationRepository,
        @inject("ILanguageModelService") private llmService: ILanguageModelService
    ) {
        this.logger = createLogger('OpenAISummaryService');
    }

    async updateSummary(conversationId: string): Promise<Conversation | void> {
        this.logger.log(`[${conversationId}] Starting summary update process.`);
        try {
            // 1. Fetch all messages for the conversation
            const messages = await this.conversationRepository.findMessagesByConversationId(conversationId);
            if (!messages || messages.length === 0) {
                this.logger.warn(`[${conversationId}] No messages found, cannot generate summary.`);
                return; // Or throw an error?
            }
            this.logger.log(`[${conversationId}] Fetched ${messages.length} messages.`);

            // 2. Format messages for the LLM prompt
            // Use senderType and originalText (assuming these are the correct properties)
            const promptContext = messages
                .map(msg => {
                    let senderLabel = 'System'; // Default
                    if (msg.senderType === 'user') senderLabel = 'Clinician';
                    else if (msg.senderType === 'patient') senderLabel = 'Patient';
                    else if (msg.senderType === 'translation') senderLabel = 'Translation'; // Or maybe skip translations?
                    // Use originalText assuming it contains the main content
                    return `${senderLabel}: ${msg.originalText}`;
                })
                .join('\n');
            
            const summaryPrompt = `Generate a concise clinical summary based on the following conversation transcript between a Clinician and a Patient. Focus on key symptoms, diagnoses discussed, treatment plans, and any follow-up actions mentioned. Format the summary appropriately for a medical record.

Transcript:
---
${promptContext}
---

Summary:`;

            this.logger.log(`[${conversationId}] Sending request to LLM for summary generation.`);

            // 3. Call the LLM service to generate the summary
            const generatedSummary = await this.llmService.generateResponse(conversationId, summaryPrompt);

            if (!generatedSummary || generatedSummary.trim() === '' || generatedSummary.includes("Sorry")) {
                this.logger.error(`[${conversationId}] Failed to generate a valid summary from LLM. Response: "${generatedSummary}"`);
                return; 
            }
            this.logger.log(`[${conversationId}] Summary generated successfully (first 100 chars): "${generatedSummary.substring(0, 100)}..."`);

            // 4. Update the conversation record using the generic update method and upsert for the summary relation
            const updatedConversation = await this.conversationRepository.update(
                conversationId,
                { 
                    summary: { 
                        upsert: { // Use upsert to create or update the related Summary record
                            create: { content: generatedSummary }, // Data if creating
                            update: { content: generatedSummary }  // Data if updating
                        }
                    }
                }
            );

            this.logger.log(`[${conversationId}] Successfully updated conversation summary in database.`);
            return updatedConversation; // Return the updated conversation object

        } catch (error) {
            this.logger.error(`[${conversationId}] Error during summary update process:`, error);
            // Optionally re-throw or handle differently
            // We don't return the conversation here as the update failed
        }
    }
} 