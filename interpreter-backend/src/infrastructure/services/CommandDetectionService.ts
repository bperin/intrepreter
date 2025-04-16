import { injectable, inject } from "tsyringe";
import axios from "axios";

// Define the structure for a tool call result
interface ToolCallResult {
    toolName: string;
    arguments: any; // Arguments parsed from OpenAI response (typically an object)
}

// Interface for OpenAI Chat Completion response structure (focus on tool calls)
interface OpenAIChatCompletionResponseWithTools {
    choices?: [
        {
            message?: {
                tool_calls?: [
                    {
                        id: string;
                        type: 'function'; // OpenAI uses 'function' for tool calls
                        function: {
                            name: string;
                            arguments: string; // Arguments are initially a JSON string
                        };
                    }
                ];
                content?: string | null; // May still have content
            };
            finish_reason?: string;
        }
    ];
}

@injectable()
export class CommandDetectionService {
    private readonly openaiApiKey: string;
    private readonly openaiUrl = "https://api.openai.com/v1/chat/completions";
    private readonly model = "gpt-4o-mini"; // Use mini for potentially faster/cheaper detection

    // Define the tools for OpenAI function/tool calling
    private readonly tools = [
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
        },
    ];

    constructor(/* No Prisma needed here if just calling OpenAI */) {
        this.openaiApiKey = process.env.OPENAI_API_KEY || "";
        if (!this.openaiApiKey) {
            console.error("[CommandDetectionService] CRITICAL: OPENAI_API_KEY is not set. Command detection will fail.");
        }
    }

    /**
     * Calls OpenAI Chat Completions to detect if the input text matches a defined tool/command.
     * @param text The input text from the user (clinician).
     * @returns A ToolCallResult object if a command is detected, otherwise null.
     */
    async detectCommand(text: string): Promise<ToolCallResult | null> {
        if (!this.openaiApiKey) {
            console.error("[CommandDetectionService] Cannot detect command: OpenAI API Key missing.");
            return null;
        }
        if (!text || text.trim().length === 0) {
            return null; // No command in empty text
        }

        console.log(`[CommandDetectionService] Checking text for commands: "${text.substring(0, 100)}..."`);

        try {
            const response = await axios.post<OpenAIChatCompletionResponseWithTools>(
                this.openaiUrl,
                {
                    model: this.model,
                    messages: [{ role: "user", content: text }],
                    tools: this.tools,
                    tool_choice: "auto", // Let the model decide if a tool should be called
                    temperature: 0.1, // Low temperature for deterministic tool calling
                },
                {
                    headers: {
                        "Authorization": `Bearer ${this.openaiApiKey}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 10000 // Shorter timeout for command detection (e.g., 10 seconds)
                }
            );

            const toolCalls = response.data?.choices?.[0]?.message?.tool_calls;

            if (toolCalls && toolCalls.length > 0) {
                // For simplicity, handle only the first tool call if multiple are returned
                const firstToolCall = toolCalls[0].function;
                console.log(`[CommandDetectionService] Detected tool call: ${firstToolCall.name}`);
                
                try {
                    const parsedArgs = JSON.parse(firstToolCall.arguments);
                    return {
                        toolName: firstToolCall.name,
                        arguments: parsedArgs,
                    };
                } catch (parseError) {
                    console.error(`[CommandDetectionService] Failed to parse arguments for tool ${firstToolCall.name}:`, firstToolCall.arguments, parseError);
                    return null; // Treat as no command if args are invalid
                }
            } else {
                // No tool call detected by the model
                console.log(`[CommandDetectionService] No command detected in text.`);
                return null;
            }

        } catch (error: unknown) {
            console.error("[CommandDetectionService] Error calling OpenAI API for command detection:");
             // Check if it looks like an Axios error
             if (typeof error === 'object' && error !== null && 'isAxiosError' in error && error.isAxiosError) {
                 const axiosError = error as { response?: { status?: number; data?: any } }; 
                 console.error('Status:', axiosError.response?.status);
                 console.error('Data:', axiosError.response?.data);
             } else if (error instanceof Error) {
                 console.error('Message:', error.message);
             } else {
                 console.error('An unknown error occurred:', String(error));
             }
            return null; // Failure to call API means no command detected
        }
    }
} 