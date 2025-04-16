import { PrismaClient, Conversation, Message, Patient, MedicalHistory, Summary } from "../../generated/prisma";
import { IConversationService, StartSessionInput, StartSessionResult } from "../../domain/services/IConversationService";
import { IPatientRepository } from "../../domain/repositories/IPatientRepository";
import { IConversationRepository, ConversationWithRelations } from "../../domain/repositories/IConversationRepository";
import { injectable, inject } from "tsyringe";
import { IOpenAIClient } from "../../domain/clients/IOpenAIClient";
import axios from 'axios'; // Assuming axios is installed
import { IMessageService, IMessageService as IMessageServiceToken } from '../../domain/services/IMessageService';
import { MedicalHistoryService } from './MedicalHistoryService';
import { IAudioProcessingService } from "../../domain/services/IAudioProcessingService";
import { INotificationService } from "../../domain/services/INotificationService";

// Interface for the expected OpenAI Chat Completion response structure (can be shared)
interface OpenAIChatCompletionResponse {
    choices?: [
        {
            message?: {
                content?: string;
            };
        }
    ];
}

@injectable()
export class ConversationService implements IConversationService {
    private readonly openaiApiKey: string;

    constructor(
        @inject("PrismaClient") private prisma: PrismaClient,
        @inject("IPatientRepository") private patientRepository: IPatientRepository,
        @inject("IConversationRepository") private conversationRepository: IConversationRepository,
        @inject("IOpenAIClient") private openAIClient: IOpenAIClient,
        @inject(IMessageServiceToken) private messageService: IMessageService,
        @inject(MedicalHistoryService) private medicalHistoryService: MedicalHistoryService,
        @inject("IAudioProcessingService") private audioProcessingService: IAudioProcessingService,
        @inject("INotificationService") private notificationService: INotificationService
    ) {
        this.openaiApiKey = process.env.OPENAI_API_KEY || '';
        if (!this.openaiApiKey) {
            console.error('[ConversationService] OPENAI_API_KEY is not set! Summarization will fail.');
        }
    }

    async startNewSession(input: StartSessionInput): Promise<StartSessionResult> {
        const { userId, patientFirstName, patientLastName, patientDob, clinicianPreferredLanguage } = input;

        const dobDateOnly = new Date(Date.UTC(patientDob.getFullYear(), patientDob.getMonth(), patientDob.getDate()));

        const patient = await this.patientRepository.findOrCreate(patientFirstName, patientLastName, dobDateOnly);

        console.log("[ConversationService] Creating conversation record with default patient language 'es'.")
        const conversation = await this.conversationRepository.create({
            userId: input.userId,
            patientId: patient.id,
            status: "active",
            patientLanguage: "es", // Add default language
        });

        console.log(`[ConversationService] Session started, conversation ID: ${conversation.id}, patientLang: ${conversation.patientLanguage}`);

        // --- Trigger Medical History Generation (Async) ---
        console.log(`[ConversationService] Triggering async medical history generation for conversation ${conversation.id}`);
        // Pass the full patient object, not just the ID
        this.medicalHistoryService.generateAndSaveHistory(conversation.id, patient) 
            .then(history => {
                if (history) {
                    // Handle the result of generateAndSaveHistory
                }
            });

        return {
            conversation: conversation,
        };
    }

    /**
     * Generates a summary for a given conversation transcript using OpenAI.
     * @param transcript A string containing the formatted conversation messages.
     * @returns A promise resolving to the generated summary string or null if failed.
     */
    private async generateSummary(transcript: string): Promise<string | null> {
        if (!this.openaiApiKey) {
            console.warn('[ConversationService] Cannot generate summary: OPENAI_API_KEY not set.');
            return null;
        }
        if (!transcript || transcript.trim().length === 0) {
            console.warn('[ConversationService] Cannot generate summary: Empty transcript provided.');
            return "(No messages to summarize)"; // Return specific text for empty transcript
        }

        const summarizationUrl = 'https://api.openai.com/v1/chat/completions';
        // Simple prompt, adjust as needed for better results
        const prompt = `Summarize the following conversation between a clinician (user) and a patient. Focus on the key symptoms, diagnosis points, and any agreed-upon actions or follow-ups. Keep the summary concise.\n\nConversation:\n${transcript}\n\nSummary:`;

        console.log(`[ConversationService] Requesting summary from OpenAI...`);

        try {
            const response = await axios.post<OpenAIChatCompletionResponse>(
                summarizationUrl,
                {
                    model: 'gpt-4o-mini', // Can use gpt-4o for potentially better summaries
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 250, // Adjust token limit based on expected summary length
                    temperature: 0.5, // Moderate temperature for summarization
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 30000 // Add a timeout (e.g., 30 seconds)
                }
            );

            const summary = response.data?.choices?.[0]?.message?.content?.trim();

            if (summary) {
                console.log(`[ConversationService] Summary generated successfully.`);
                return summary;
            } else {
                console.warn(`[ConversationService] OpenAI returned empty summary content. Response:`, JSON.stringify(response.data));
                return "(Summary generation failed)";
            }

        } catch (error) {
            console.error(`[ConversationService] Error calling OpenAI Summarization API:`);
            if (error && typeof error === 'object' && 'isAxiosError' in error && error.isAxiosError) {
                const axiosError = error as { response?: { status?: number; data?: any } }; 
                console.error('Status:', axiosError.response?.status);
                if (axiosError.response?.data) {
                   try {
                       console.error('Data:', JSON.stringify(axiosError.response.data)); 
                   } catch { console.error('Data (raw):', axiosError.response.data); }
                } else { console.error('No response data received.'); }
            } else if (error instanceof Error) { console.error(error.message); }
            else { console.error('An unknown summarization error occurred:', String(error)); }
            return null; // Indicate failure with null
        }
    }

    /**
     * Formats messages into a simple string transcript.
     * @param messages Array of Message objects.
     * @returns A formatted string transcript.
     */
    private formatMessagesForTranscript(messages: Message[]): string {
        return messages.map(msg => {
            let prefix = `${msg.senderType} (${msg.language})`;
            if (msg.senderType === 'translation' && msg.originalMessageId) {
                 prefix += ` [transl. for ${msg.originalMessageId.substring(0, 4)}...]`;
            }
            // Use originalText for non-translations, translatedText for translations
            const textToShow = (msg.senderType === 'translation' && msg.translatedText) ? msg.translatedText : msg.originalText;
            return `${prefix}: ${textToShow}`; // Use textToShow
        }).join('\n');
    }

    /**
     * Formats Notes, Prescriptions, and FollowUps into a structured string.
     * @param notes Array of Note objects.
     * @param prescriptions Array of Prescription objects.
     * @param followUps Array of FollowUp objects.
     * @returns A formatted string containing the actions.
     */
    private formatActionsForTranscript(
        notes: { content: string }[],
        prescriptions: { medicationName: string; dosage: string; frequency: string; details?: string | null }[],
        followUps: { duration: number; unit: string; details?: string | null }[]
    ): string {
        let actionsText = "";

        if (notes.length > 0) {
            actionsText += "\n--- Notes ---\n";
            actionsText += notes.map(n => `- ${n.content}`).join("\n");
        }

        if (prescriptions.length > 0) {
            actionsText += "\n\n--- Prescriptions ---\n";
            actionsText += prescriptions.map(p =>
                `- ${p.medicationName} (${p.dosage}, ${p.frequency})${p.details ? ': ' + p.details : ''}`
            ).join("\n");
        }

        if (followUps.length > 0) {
            actionsText += "\n\n--- Follow Ups ---\n";
            actionsText += followUps.map(f =>
                `- Follow up in ${f.duration} ${f.unit}${f.details ? ': ' + f.details : ''}`
            ).join("\n");
        }

        return actionsText.trim(); // Remove leading/trailing whitespace
    }

    /**
     * Implementation for ending and summarizing a conversation.
     */
    async endAndSummarizeConversation(conversationId: string): Promise<ConversationWithRelations> {
        console.log(`[ConversationService] Attempting to end and summarize conversation: ${conversationId}`);

        // --- Step 1: Fetch all relevant data concurrently ---
        let messages: Message[];
        let notes: { content: string }[];
        let prescriptions: { medicationName: string; dosage: string; frequency: string; details?: string | null }[];
        let followUps: { duration: number; unit: string; details?: string | null }[];

        try {
            [messages, notes, prescriptions, followUps] = await Promise.all([
                this.messageService.getMessagesByConversationId(conversationId),
                this.prisma.note.findMany({
                    where: { conversationId },
                    select: { content: true }, // Select only needed fields
                    orderBy: { createdAt: 'asc' }
                }),
                this.prisma.prescription.findMany({
                    where: { conversationId },
                    select: { medicationName: true, dosage: true, frequency: true, details: true }, // Select only needed fields
                    orderBy: { createdAt: 'asc' }
                }),
                this.prisma.followUp.findMany({
                    where: { conversationId },
                    select: { duration: true, unit: true, details: true }, // Select only needed fields
                    orderBy: { createdAt: 'asc' }
                })
            ]);
            console.log(`[ConversationService] Fetched data for ${conversationId}: ${messages.length} messages, ${notes.length} notes, ${prescriptions.length} prescriptions, ${followUps.length} follow-ups.`);
        } catch (fetchError) {
            console.error(`[ConversationService] Error fetching data for conversation ${conversationId}:`, fetchError);
            throw new Error(`Failed to fetch data needed for summary for conversation ${conversationId}`);
        }

        // Handle case with no messages (but potentially actions)
        if (messages.length === 0) {
            console.warn(`[ConversationService] No messages found for conversation ${conversationId}. Checking for actions before deciding summary.`);
            // If there are no actions either, end normally without summary attempt
            if (notes.length === 0 && prescriptions.length === 0 && followUps.length === 0) {
                console.log(`[ConversationService] No messages or actions for ${conversationId}. Ending session without summary.`);
                 try {
                     const updatedConv = await this.prisma.conversation.update({
                        where: { id: conversationId },
                        data: { status: 'ended', endTime: new Date() },
                         include: { /* ... include necessary relations ... */ patient: true, summary: true, user: { select: { username: true } }, messages: true, notes: true, followUps: true, prescriptions: true, medicalHistory: true },
                    });
                    return updatedConv as ConversationWithRelations;
                 } catch (updateError) {
                     console.error(`[ConversationService] Error marking empty conversation ${conversationId} as ended:`, updateError);
                     throw new Error(`Failed to end empty conversation ${conversationId}`);
                 }
            }
            // If there are actions but no messages, we might still want a summary based on actions
            console.log(`[ConversationService] Actions found for ${conversationId} despite no messages. Proceeding with summary generation based on actions.`);
        }

        // --- Step 2: Format Transcript and Actions ---
        const transcriptText = this.formatMessagesForTranscript(messages);
        const actionsText = this.formatActionsForTranscript(notes, prescriptions, followUps);

        // Combine transcript and actions for the summary prompt
        let fullContext = transcriptText;
        if (actionsText) {
            fullContext += `\n\n--- Recorded Actions ---${actionsText}`; // actionsText already has leading newlines handled
        }

        // --- Step 3: Generate Summary ---
        console.log(`[ConversationService] Generating summary for ${conversationId} using full context (messages + actions)...`);
        const summaryText = await this.generateSummary(fullContext); // Pass the combined context

        if (summaryText === null || summaryText === "(Summary generation failed)") {
            console.error(`[ConversationService] Summary generation failed for ${conversationId}. Ending session with error status.`);
             try {
                 // Use the existing logic to end with 'ended_error' status
                 const updatedConv = await this.prisma.conversation.update({
                    where: { id: conversationId },
                    data: { status: 'ended_error', endTime: new Date() },
                     include: { /* ... include necessary relations ... */ patient: true, summary: true, user: { select: { username: true } }, messages: true, notes: true, followUps: true, prescriptions: true, medicalHistory: true },
                });
                 console.warn(`[ConversationService] Session ${conversationId} ended with error, summary generation failed.`);
                 return updatedConv as ConversationWithRelations;
             } catch (updateError) {
                 console.error(`[ConversationService] Error ending conversation ${conversationId} after summary failure:`, updateError);
                throw new Error(`Summary failed and failed to end conversation ${conversationId}`);
             }
        }

        // Handle the "(No messages to summarize)" case specifically if it comes from generateSummary
        const finalSummaryContent = summaryText === "(No messages to summarize)" ? "(No messages found, summary based on recorded actions)" : summaryText;

        // --- Step 4: Create Summary record and Update Conversation in DB ---
        try {
            console.log(`[ConversationService] Attempting DB transaction for conversation ${conversationId} with summary.`);
            const updatedConversation = await this.prisma.$transaction(async (tx) => {
                // Create or Update the summary linked to the conversation
                // Using upsert might be safer if somehow a summary record could pre-exist
                await tx.summary.upsert({
                    where: { conversationId: conversationId },
                    update: { content: finalSummaryContent },
                    create: {
                        content: finalSummaryContent,
                        conversation: { connect: { id: conversationId } }
                    }
                });
                console.log(`[ConversationService] Summary record created/updated for conversation ${conversationId}`);

                // Update the conversation status and end time
                const conv = await tx.conversation.update({
                    where: { id: conversationId },
                    data: {
                        status: 'summarized',
                        endTime: new Date(),
                    },
                     include: { /* ... include necessary relations ... */ patient: true, summary: true, user: { select: { username: true } }, messages: true, notes: true, followUps: true, prescriptions: true, medicalHistory: true },
                });
                console.log(`[ConversationService] Conversation ${conversationId} status updated to 'summarized'.`);
                return conv;
            });
            console.log(`[ConversationService] Transaction successful for conversation ${conversationId}.`);
            
            // Broadcast the summary update via WebSocket to ensure frontend clients receive it
            // This is crucial for REST API endpoints that won't automatically receive WebSocket updates
            try {
                // Get notification service from dependency injection container if needed
                // Get the actual summary content from the updated conversation
                const summaryContent = updatedConversation.summary?.content || null;
                
                // Use WebSocketNotificationService to broadcast the summary
                // This ensures the frontend receives the summary even if the session was ended via REST API
                this.broadcastSummaryUpdate(conversationId, summaryContent);
                
                console.log(`[ConversationService] Summary broadcast attempted for ${conversationId}`);
            } catch (broadcastError) {
                console.error(`[ConversationService] Error broadcasting summary update for ${conversationId}:`, broadcastError);
                // Don't throw here - the summary was saved successfully, broadcasting is secondary
            }
            
            return updatedConversation as ConversationWithRelations;

        } catch (error) {
            console.error(`[ConversationService] Error during summary saving transaction for ${conversationId}:`, error);
            // Attempt to mark conversation as ended with error if transaction fails
            try {
                 await this.prisma.conversation.update({
                    where: { id: conversationId },
                    data: { status: 'ended_error', endTime: new Date() },
                });
                 console.warn(`[ConversationService] Marked conversation ${conversationId} as 'ended_error' due to transaction failure during summary save.`);
            } catch (finalUpdateError) {
                 console.error(`[ConversationService] CRITICAL: Failed transaction AND failed to mark ${conversationId} as ended_error:`, finalUpdateError);
            }
            throw new Error(`Failed to save summary and update conversation ${conversationId} status.`);
        }
    }

    // Add a helper method to broadcast summary updates
    private broadcastSummaryUpdate(conversationId: string, summaryContent: string | null): void {
        try {
            // Since the WebSocketNotificationService class is what actually implements 
            // the INotificationService interface, we can expect it to have the broadcastToConversation method
            // even though it's not in the interface definition.
            const wsService = this.notificationService as any;
            
            if (wsService && typeof wsService.broadcastToConversation === 'function') {
                wsService.broadcastToConversation(conversationId, {
                    type: 'summary_data',
                    payload: {
                        conversationId: conversationId,
                        summary: summaryContent
                    }
                });
                console.log(`[ConversationService] Successfully broadcast summary via WebSocket`);
            } else {
                console.error(`[ConversationService] notificationService does not have broadcastToConversation method`);
            }
        } catch (error) {
            console.error(`[ConversationService] Failed to broadcast summary update for ${conversationId}:`, error);
        }
    }

    async endSession(conversationId: string): Promise<ConversationWithRelations> {
        console.log(`[ConversationService] Attempting to end session for conversation: ${conversationId}`);
        // Use prisma directly for update, then findById to get full relations
        await this.prisma.conversation.update({
            where: { id: conversationId },
            data: {
                endTime: new Date(),
                status: 'ended'
            }
        });
        const updatedConv = await this.conversationRepository.findById(conversationId);
        if (!updatedConv) {
             throw new Error(`Conversation ${conversationId} not found after update.`);
        }
        console.log(`[ConversationService] Session ended for conversation: ${conversationId}`);
        return updatedConv;
    }

    async summarizeConversation(conversationId: string): Promise<ConversationWithRelations> {
        console.log(`[ConversationService] Summarizing conversation: ${conversationId}`);
        const conversation = await this.conversationRepository.findById(conversationId);
        if (!conversation) {
            throw new Error("Conversation not found");
        }

        const messagesText = conversation.messages.map(m => `${m.senderType}: ${m.originalText}`).join('\n');
        const summaryContent = await this.generateSummary(messagesText);

        if (summaryContent === null || summaryContent === "Error generating summary." || summaryContent === "Summary generation failed.") {
             console.warn(`[ConversationService] Summary generation failed or returned null/error string for ${conversationId}. Skipping update.`);
        } else {
            await this.prisma.conversation.update({
                where: { id: conversationId },
                data: {
                    status: 'summarized',
                    summary: {
                        upsert: {
                            create: { content: summaryContent },
                            update: { content: summaryContent },
                        }
                    }
                }
            });
        }
        const updatedConv = await this.conversationRepository.findById(conversationId);
         if (!updatedConv) {
             throw new Error(`Conversation ${conversationId} not found after summary update.`);
         }
        return updatedConv;
    }

    async getConversationDetails(conversationId: string): Promise<ConversationWithRelations | null> {
        console.log(`[ConversationService] Getting details for conversation: ${conversationId}`);
        const conversation = await this.conversationRepository.findById(conversationId);
        if (!conversation) {
             console.warn(`[ConversationService] Conversation not found: ${conversationId}`);
        }
        return conversation;
    }

    async processAudioChunk(conversationId: string, userId: string, speakerType: "clinician" | "patient", audioChunk: Buffer): Promise<void> {
        console.log(`[ConversationService] Forwarding audio chunk for conversation ${conversationId} from ${speakerType} (${userId})`);
        // Delegate to AudioProcessingService
        await this.audioProcessingService.processAudioChunk(conversationId, userId, speakerType, audioChunk);
        console.log(`[ConversationService] Audio chunk processed for ${conversationId}`);
    }

    async finalizeAudioStream(conversationId: string, userId: string): Promise<void> {
        console.log(`[ConversationService] Finalizing audio stream for conversation ${conversationId}, user ${userId}`);
        // Delegate to AudioProcessingService
        await this.audioProcessingService.finalizeStream(conversationId, userId);
        console.log(`[ConversationService] Finalized audio stream for ${conversationId}, user ${userId}`);
    }

    // --- Medical History Handling ---
    async getMedicalHistory(conversationId: string): Promise<MedicalHistory | null> {
        console.log(`[ConversationService] Getting medical history for conversation: ${conversationId}`);
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { medicalHistory: true } // Only select history
        });
        return conversation?.medicalHistory ?? null;
    }

    async updateMedicalHistory(conversationId: string, content: string): Promise<ConversationWithRelations> {
         console.log(`[ConversationService] Updating medical history for conversation: ${conversationId}`);
         if (content === null) {
             throw new Error("Medical history content cannot be null.");
         }
         const updatedConversation = await this.prisma.conversation.update({
             where: { id: conversationId },
             data: {
                 medicalHistory: {
                     upsert: {
                         create: { content: content },
                         update: { content: content }
                     }
                 }
             }
         });
         const updatedConv = await this.conversationRepository.findById(conversationId);
          if (!updatedConv) {
              throw new Error(`Conversation ${conversationId} not found after medical history update.`);
          }
         return updatedConv;
     }

    // --- Summary Handling ---
    async getSummary(conversationId: string): Promise<Summary | null> {
        console.log(`[ConversationService] Getting summary for conversation: ${conversationId}`);
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { summary: true } // Only select summary
        });
        return conversation?.summary ?? null;
    }

    async updateSummary(conversationId: string, content: string): Promise<ConversationWithRelations> {
        console.log(`[ConversationService] Updating summary for conversation: ${conversationId}`);
        if (content === null) {
            throw new Error("Summary content cannot be null.");
        }
        const updatedConversation = await this.prisma.conversation.update({
            where: { id: conversationId },
            data: {
                summary: {
                    upsert: {
                        create: { content: content },
                        update: { content: content }
                    }
                }
            }
        });
        const updatedConv = await this.conversationRepository.findById(conversationId);
         if (!updatedConv) {
             throw new Error(`Conversation ${conversationId} not found after summary update.`);
         }
        
        // After updating the summary, broadcast it via WebSocket
        try {
            this.broadcastSummaryUpdate(conversationId, content);
        } catch (broadcastError) {
            console.error(`[ConversationService] Error broadcasting updated summary for ${conversationId}:`, broadcastError);
        }
        
        return updatedConv;
    }

    // Implement other IConversationService methods here later
}
