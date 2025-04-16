import { injectable, inject } from "tsyringe";
import axios from "axios";
import { PrismaClient, Patient, MedicalHistory } from "../../generated/prisma";
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables specifically for OpenAI API Key
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') }); // Adjust path as needed relative to compiled JS output

// Interface for OpenAI Chat Completion response (can be shared or defined locally)
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
export class MedicalHistoryService {
    private readonly openaiApiKey: string;
    private readonly openaiUrl = "https://api.openai.com/v1/chat/completions";

    constructor(@inject("PrismaClient") private prisma: PrismaClient) {
        this.openaiApiKey = process.env.OPENAI_API_KEY || "";
        if (!this.openaiApiKey) {
            console.error("[MedicalHistoryService] CRITICAL: OPENAI_API_KEY is not set. History generation will fail.");
        }
    }

    /**
     * Generates mock medical history using OpenAI and saves it to the database.
     * @param conversationId The ID of the conversation to link the history to.
     * @param patient The patient object containing details for context.
     * @returns The created MedicalHistory object or null if generation/saving fails.
     */
    async generateAndSaveHistory(conversationId: string, patient: Patient): Promise<MedicalHistory | null> {
        console.log(`[MedicalHistoryService] Attempting to generate history for conversation ${conversationId}`);
        if (!this.openaiApiKey) {
            console.error("[MedicalHistoryService] Cannot generate history: OpenAI API Key missing.");
            return null;
        }

        // TODO: Implement prompt crafting
        const prompt = this._createPrompt(patient);
        console.log(`[MedicalHistoryService] Generated prompt (first 100 chars): ${prompt.substring(0, 100)}...`);

        try {
            // TODO: Implement OpenAI API call
            const generatedContent = await this._callOpenAI(prompt);

            if (!generatedContent) {
                console.error("[MedicalHistoryService] Failed to generate content from OpenAI.");
                return null;
            }
            console.log(`[MedicalHistoryService] Content generated successfully (first 100 chars): ${generatedContent.substring(0, 100)}...`);

            // TODO: Implement Prisma save
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
        // Calculate age (simple approximation)
        const birthYear = new Date(patient.dateOfBirth).getFullYear();
        const currentYear = new Date().getFullYear();
        const age = currentYear - birthYear;

        // Basic prompt - can be refined significantly
        return `Generate a brief, mock medical history suitable for a primary care setting simulation for the following patient. Be realistic but concise. Include potential common allergies, current medications (if any), and 1-2 relevant past major medical conditions or surgeries. Do NOT include any real patient information or identifiers.

Patient Details:
Name: ${patient.firstName} ${patient.lastName}
Age: Approximately ${age}

Format the output as plain text sections (e.g., Allergies:, Current Medications:, Past Medical History:).`;
    }

    private async _callOpenAI(prompt: string): Promise<string | null> {
        try {
            const response = await axios.post<OpenAIChatCompletionResponse>(
                this.openaiUrl,
                {
                    // model: "gpt-4o", // Or use "gpt-4o-mini" for faster/cheaper generation
                    model: "gpt-4o-mini", 
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 300, // Adjust as needed for desired length
                    temperature: 0.6, // Moderate temperature for some variability but not too random
                    n: 1,
                },
                {
                    headers: {
                        "Authorization": `Bearer ${this.openaiApiKey}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            const content = response.data?.choices?.[0]?.message?.content?.trim();
            if (content) {
                return content;
            } else {
                console.warn("[MedicalHistoryService] OpenAI response missing expected content.", response.data);
                return null;
            }
        } catch (error: unknown) {
            console.error("[MedicalHistoryService] Error calling OpenAI API:");
            // Check if it looks like an Axios error
            if (typeof error === 'object' && error !== null && 'isAxiosError' in error && error.isAxiosError) {
                 // Now TypeScript knows it has AxiosError properties (potentially)
                 // We cast carefully or check for response existence
                 const axiosError = error as { response?: { status?: number; data?: any } }; 
                 console.error('Status:', axiosError.response?.status);
                 console.error('Data:', axiosError.response?.data);
            } else if (error instanceof Error) {
                 // Handle generic Error objects
                 console.error('Message:', error.message);
            } else {
                 // Handle other types of errors
                 console.error('An unknown error occurred:', String(error));
            }
            return null;
        }
    }
} 