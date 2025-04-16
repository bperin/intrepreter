import { injectable, inject } from "tsyringe";
import { OpenAI } from 'openai';
import { PrismaClient, Patient, MedicalHistory } from "../../generated/prisma";
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables (assuming .env is in the root)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

@injectable()
export class MedicalHistoryService {
    private readonly openai: OpenAI;
    private readonly apiKeyPresent: boolean;

    constructor(@inject("PrismaClient") private prisma: PrismaClient) {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            console.error('[MedicalHistoryService] OPENAI_API_KEY is not set! History generation will fail.');
            this.apiKeyPresent = false;
            this.openai = new OpenAI({ apiKey: 'dummy-key' }); // Provide dummy
        } else {
             this.openai = new OpenAI({ apiKey });
             this.apiKeyPresent = true;
        }
    }

    /**
     * Generates mock medical history using OpenAI SDK and saves it to the database.
     * @param conversationId The ID of the conversation to link the history to.
     * @param patient The patient object containing details for context.
     * @returns The created MedicalHistory object or null if generation/saving fails.
     */
    async generateAndSaveHistory(conversationId: string, patient: Patient): Promise<MedicalHistory | null> {
        console.log(`[MedicalHistoryService] Attempting to generate history for conversation ${conversationId}`);
        if (!this.apiKeyPresent) {
            console.error("[MedicalHistoryService] Cannot generate history: OpenAI API Key missing.");
            return null;
        }

        const prompt = this._createPrompt(patient);
        console.log(`[MedicalHistoryService] Generated prompt (first 100 chars): ${prompt.substring(0, 100)}...`);

        try {
            const generatedContent = await this._callOpenAIWithSDK(prompt);

            if (!generatedContent) {
                console.error("[MedicalHistoryService] Failed to generate content from OpenAI.");
                return null;
            }
            console.log(`[MedicalHistoryService] Content generated successfully (first 100 chars): ${generatedContent.substring(0, 100)}...`);

            const savedHistory = await this.prisma.medicalHistory.create({
                data: {
                    content: generatedContent,
                    conversation: {
                        connect: { id: conversationId }
                    }
                }
            });
            console.log(`[MedicalHistoryService] Medical history saved successfully with ID: ${savedHistory.id}`);
            return savedHistory;

        } catch (error) {
            console.error(`[MedicalHistoryService] Error during history generation/saving for conversation ${conversationId}:`, error);
            return null;
        }
    }

    /**
     * Retrieves the medical history for a given conversation.
     * @param conversationId The ID of the conversation.
     * @returns The MedicalHistory object or null if not found.
     */
    async getHistory(conversationId: string): Promise<MedicalHistory | null> {
        console.log(`[MedicalHistoryService] Fetching history for conversation ${conversationId}`);
        try {
            const history = await this.prisma.medicalHistory.findUnique({
                where: { conversationId }
            });
            if (history) {
                console.log(`[MedicalHistoryService] History found for conversation ${conversationId}`);
            } else {
                console.log(`[MedicalHistoryService] No history found for conversation ${conversationId}`);
            }
            return history;
        } catch (error) {
            console.error(`[MedicalHistoryService] Error fetching history for conversation ${conversationId}:`, error);
            return null;
        }
    }

    // --- Private Helper Methods ---

    private _createPrompt(patient: Patient): string {
        const birthYear = new Date(patient.dateOfBirth).getFullYear();
        const currentYear = new Date().getFullYear();
        const age = currentYear - birthYear;
        return `Generate a brief, mock medical history suitable for a primary care setting simulation for the following patient. Be realistic but concise. Include potential common allergies, current medications (if any), and 1-2 relevant past major medical conditions or surgeries. Do NOT include any real patient information or identifiers.

Patient Details:
Name: ${patient.firstName} ${patient.lastName}
Age: Approximately ${age}

Format the output as plain text sections (e.g., Allergies:, Current Medications:, Past Medical History:).`;
    }

    private async _callOpenAIWithSDK(prompt: string): Promise<string | null> {
        if (!this.apiKeyPresent) {
             console.error("[MedicalHistoryService] Cannot call OpenAI: API key not available.");
             return null;
        }
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 300,
                temperature: 0.6,
                n: 1,
                stream: false,
            });

            const content = response.choices[0]?.message?.content?.trim();
            if (content) {
                return content;
            } else {
                console.warn("[MedicalHistoryService] OpenAI SDK response missing expected content.", response);
                return null;
            }
        } catch (error: any) {
            console.error("[MedicalHistoryService] Error calling OpenAI SDK:");
             if (error instanceof OpenAI.APIError) {
                 console.error(`OpenAI API Error: Status=${error.status}, Type=${error.type}, Code=${error.code}, Message=${error.message}`);
            } else {
                 console.error('An unknown error occurred:', error?.message || String(error));
            }
            return null;
        }
    }
} 