import { PrismaClient, Conversation, Message } from "../../generated/prisma";
import { IConversationService, StartSessionInput, StartSessionResult } from "../../domain/services/IConversationService";
import { IPatientRepository } from "../../domain/repositories/IPatientRepository";
import { IConversationRepository } from "../../domain/repositories/IConversationRepository";
import { injectable, inject } from "tsyringe";
import { IOpenAIClient } from "../../domain/clients/IOpenAIClient";
import axios from 'axios'; // Assuming axios is installed
import { IMessageService, IMessageService as IMessageServiceToken } from '../../domain/services/IMessageService';

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
        @inject(IMessageServiceToken) private messageService: IMessageService
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

        console.log("[ConversationService] Creating conversation record without openaiSessionKey.")
        const conversation = await this.conversationRepository.create({
            userId: input.userId,
            patientId: patient.id,
            status: "active",
        });

        console.log(`[ConversationService] Session started, conversation ID: ${conversation.id}`);

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
            // Include sender, language, and distinguish original/translation if needed
            let prefix = `${msg.senderType} (${msg.language})`;
            if (msg.senderType === 'translation' && msg.originalMessageId) {
                 prefix += ` [transl. for ${msg.originalMessageId.substring(0, 4)}...]`; 
            }
            return `${prefix}: ${msg.originalText}`;
        }).join('\n');
    }

    /**
     * Implementation for ending and summarizing a conversation.
     */
    async endAndSummarizeConversation(conversationId: string): Promise<Conversation> {
        console.log(`[ConversationService] Attempting to end and summarize conversation: ${conversationId}`);

        // 1. Fetch Messages
        const messages = await this.messageService.getMessagesByConversationId(conversationId);
        if (messages.length === 0) {
            console.warn(`[ConversationService] No messages found for conversation ${conversationId}. Skipping summary generation.`);
            // Still update status and end time
            try {
                 const updatedConv = await this.prisma.conversation.update({
                    where: { id: conversationId },
                    data: {
                        status: 'ended',
                        endTime: new Date(),
                        summary: '(No messages recorded)'
                    },
                });
                console.log(`[ConversationService] Conversation ${conversationId} marked as ended (no messages).`);
                return updatedConv;
            } catch (updateError) {
                console.error(`[ConversationService] Error marking empty conversation ${conversationId} as ended:`, updateError);
                throw new Error(`Failed to end empty conversation ${conversationId}`);
            }
        }

        // 2. Format Transcript
        const transcript = this.formatMessagesForTranscript(messages);

        // 3. Generate Summary
        const summary = await this.generateSummary(transcript);
        if (summary === null) {
            // Handle summarization failure - maybe still end the session?
            console.error(`[ConversationService] Summary generation failed for ${conversationId}. Ending session without summary.`);
             try {
                 const updatedConv = await this.prisma.conversation.update({
                    where: { id: conversationId },
                    data: {
                        status: 'ended_error', // Use a distinct status
                        endTime: new Date(),
                        summary: '(Summary generation failed)'
                    },
                });
                 return updatedConv;
             } catch (updateError) {
                 console.error(`[ConversationService] Error ending conversation ${conversationId} after summary failure:`, updateError);
                throw new Error(`Summary failed and failed to end conversation ${conversationId}`);
             }
        }

        // 4. Update Conversation in DB
        try {
            const updatedConversation = await this.prisma.conversation.update({
                where: { id: conversationId },
                data: {
                    status: 'summarized', // Or just 'ended' if summary is separate
                    endTime: new Date(),
                    summary: summary,
                },
            });
            console.log(`[ConversationService] Conversation ${conversationId} ended and summarized successfully.`);
            return updatedConversation;
        } catch (dbError) {
            console.error(`[ConversationService] Error updating conversation ${conversationId} in DB:`, dbError);
            throw new Error(`Failed to save summary/end conversation ${conversationId}`);
        }
    }

    // Implement other IConversationService methods here later
}
