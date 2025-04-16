import { injectable, inject } from "tsyringe";
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { ICommandDetectionService, CommandDetectionResult } from '../../domain/services/ICommandDetectionService';
import { Logger, createLogger } from '../../utils/Logger';

// Load environment variables (adjust path if necessary)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Define the structure for a tool call result
interface ToolCallResponse {
    toolName: string;
    arguments: Record<string, any>;
}

// --- REMOVE OpenAIChatCompletionResponse interface --- 

@injectable()
export class CommandDetectionService implements ICommandDetectionService {
    private readonly openai: OpenAI;
    private readonly apiKeyPresent: boolean;
    private logger: Logger;
    private readonly model = "gpt-4o-mini"; // Or your preferred model

    // Define the tools for OpenAI function/tool calling
    private readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
            type: "function",
            function: {
                name: "request_summary",
                description: "Requests the generation of a clinical summary for the current conversation.",
                parameters: { type: "object", properties: {} } // No specific arguments needed
            }
        },
        {
            type: "function",
            function: {
                name: "request_medical_history",
                description: "Requests the display or retrieval of the patient's mock medical history.",
                parameters: { type: "object", properties: {} } // No specific arguments needed
            }
        },
        {
            type: "function",
            function: {
                name: "take_note",
                description: "Records a clinical note about the patient or the conversation context.",
                parameters: {
                    type: "object",
                    properties: {
                        note_content: {
                            type: "string",
                            description: "The full content of the note to be recorded.",
                        },
                    },
                    required: ["note_content"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "schedule_follow_up",
                description: "Schedules a follow-up task or appointment based on the conversation, specifying the timeframe.",
                parameters: {
                    type: "object",
                    properties: {
                        duration: {
                            type: "number",
                            description: "The numerical value for the follow-up timeframe (e.g., 1, 7, 2).",
                        },
                        unit: {
                            type: "string",
                            enum: ["day", "week", "month"],
                            description: "The unit of time for the follow-up (day, week, or month). Singular form.",
                        },
                        details: {
                            type: "string",
                            description: "Optional additional details or reason for the follow-up.",
                        },
                    },
                    required: ["duration", "unit"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "write_prescription",
                description: "Records the key details for a medication prescription based on the clinician's dictation.",
                parameters: {
                    type: "object",
                    properties: {
                        medication_name: {
                            type: "string",
                            description: "The name of the medication to prescribe.",
                        },
                        dosage: {
                            type: "string",
                            description: "The dosage of the medication (e.g., '10mg', '250mg/5ml').",
                        },
                        frequency: {
                            type: "string",
                            description: "How often the medication should be taken (e.g., 'once daily', 'twice a day', 'every 6 hours as needed').",
                        },
                        details: {
                            type: "string",
                            description: "Optional additional details like quantity, refills, or specific instructions.",
                        },
                    },
                    required: ["medication_name", "dosage", "frequency"],
                },
            },
        }
    ];

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY || '';
        this.logger = createLogger('CommandDetectionService');
        if (!apiKey) {
            this.logger.error("OPENAI_API_KEY is not set. Command detection will fail.");
            this.apiKeyPresent = false;
            this.openai = new OpenAI({ apiKey: 'dummy-key' });
        } else {
            this.openai = new OpenAI({ apiKey });
            this.apiKeyPresent = true;
        }
    }

    async detectCommand(text: string): Promise<CommandDetectionResult | null> {
        if (!this.apiKeyPresent) {
            this.logger.warn("Cannot detect command: OPENAI_API_KEY not set.");
            return null;
        }
        if (!text || text.trim().length < 5) { // Add a minimum length check
            // this.logger.log("Skipping command detection for short/empty text.");
            return null;
        }

        const systemPrompt = "Analyze the following user input. If it clearly matches one of the available function descriptions, call that function. Otherwise, respond normally (or indicate no command detected). Focus on explicit requests.";
        
        this.logger.log(`Attempting command detection for text: "${text.substring(0, 50)}..."`);

        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: text }
                ],
                tools: this.tools,
                tool_choice: "auto", // Let the model decide if a tool should be called
                max_tokens: 100, 
                temperature: 0.1 // Low temperature for command detection
            });

            const message = response.choices[0]?.message;

            if (message?.tool_calls && message.tool_calls.length > 0) {
                // Only consider the first tool call for simplicity in this example
                const toolCall = message.tool_calls[0]; 
                if (toolCall.type === 'function') {
                    const toolName = toolCall.function.name;
                    let args: Record<string, any> = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments || '{}');
                    } catch (e) {
                        this.logger.error(`Failed to parse tool arguments for ${toolName}:`, toolCall.function.arguments, e);
                        // Decide how to handle parsing errors - return null or proceed without args?
                        return null; 
                    }
                    this.logger.log(`Command detected: ${toolName} with arguments:`, args);
                    return { toolName, arguments: args };
                }
            }
            
            this.logger.log("No specific command detected by OpenAI.");
            return null; // No tool call was made by the model

        } catch (error: any) {
            this.logger.error("Error calling OpenAI for command detection:");
             if (error instanceof OpenAI.APIError) {
                 this.logger.error(`OpenAI API Error: Status=${error.status}, Type=${error.type}, Code=${error.code}, Message=${error.message}`);
            } else {
                 this.logger.error('An unknown error occurred:', error?.message || String(error));
            }
            return null; // Return null on error
        }
    }
} 