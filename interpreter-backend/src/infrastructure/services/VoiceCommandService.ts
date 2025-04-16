import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { IActionService } from '../../domain/services/IActionService';

// Load environment variables relative to the backend root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); 

// Interface for the Chat Completion API response when using tools
interface OpenAIChatCompletionToolResponse {
    choices?: [
        {
            message?: {
                role: string;
                content: string | null; // Content might be null if a tool call is made
                tool_calls?: [
                    {
                        id: string;
                        type: 'function';
                        function: {
                            name: string;
                            arguments: string; // Arguments are initially a JSON string
                        };
                    }
                ];
            };
            finish_reason?: string;
        }
    ];
    // other potential fields...
}

// Command patterns for voice recognition
const COMMAND_PATTERNS = {
    NOTE: /^C\s*(?:note|take\s+(?:a\s+)?note)\s+(.+)$/i,
    FOLLOW_UP: /^C\s*(?:follow\s*up|schedule\s+follow\s*up)\s+(?:in\s+)?(\d+)\s*(day|week|month)s?$/i,
    // Add more command patterns here as needed
};

// --- Tool Schemas (following OpenAI specifications) ---

const takeNoteSchema = {
    type: 'function',
    function: {
        name: 'take_a_note',
        description: 'Records a clinical note associated with the current conversation based on the users dictation.',
        parameters: {
            type: 'object',
            properties: {
                note_content: {
                    type: 'string',
                    description: 'The full content of the note dictated by the user.',
                },
            },
            required: ['note_content'],
        },
    },
};

const scheduleFollowUpSchema = {
    type: 'function',
    function: {
        name: 'schedule_follow_up',
        description: 'Records the intent to schedule a follow-up appointment for the patient, including the timeframe.',
        parameters: {
            type: 'object',
            properties: {
                duration: {
                    type: 'number',
                    description: 'The numerical value for the follow-up timeframe (e.g., 2, 6).',
                },
                unit: {
                    type: 'string',
                    enum: ['days', 'weeks', 'months'],
                    description: 'The unit of time for the follow-up (days, weeks, or months).',
                },
            },
            required: ['duration', 'unit'],
        },
    },
};

// Add schemas for other complex commands from voice_commands.md here later
// e.g., write_prescription, send_lab_order, refer_patient, update_vital_signs


@injectable()
export class VoiceCommandService {
    private readonly openaiApiKey: string;
    private readonly tools: any[];

    constructor(
        @inject("IActionService") private actionService: IActionService
    ) {
        this.openaiApiKey = process.env.OPENAI_API_KEY || '';
        if (!this.openaiApiKey) {
            console.error('[VoiceCommandService] OPENAI_API_KEY is not set!');
        }
        this.tools = [takeNoteSchema, scheduleFollowUpSchema];
        console.log('[VoiceCommandService] Initialized with command patterns:', Object.keys(COMMAND_PATTERNS));
    }

    private matchCommand(text: string): { type: string; data: any } | null {
        console.log('[VoiceCommandService] Attempting to match command patterns for:', text);

        // Check for note command
        const noteMatch = text.match(COMMAND_PATTERNS.NOTE);
        if (noteMatch) {
            console.log('[VoiceCommandService] Matched NOTE pattern:', {
                fullMatch: noteMatch[0],
                content: noteMatch[1].trim()
            });
            return {
                type: 'take_a_note',
                data: { note_content: noteMatch[1].trim() }
            };
        }

        // Check for follow-up command
        const followUpMatch = text.match(COMMAND_PATTERNS.FOLLOW_UP);
        if (followUpMatch) {
            const duration = parseInt(followUpMatch[1]);
            let unit = followUpMatch[2].toLowerCase();
            unit = unit.endsWith('s') ? unit : unit + 's';
            
            console.log('[VoiceCommandService] Matched FOLLOW_UP pattern:', {
                fullMatch: followUpMatch[0],
                duration,
                unit
            });
            
            return {
                type: 'schedule_follow_up',
                data: { 
                    duration: duration,
                    unit: unit
                }
            };
        }

        console.log('[VoiceCommandService] No command pattern match found');
        return null;
    }

    public async processCommand(text: string, conversationId: string): Promise<void> {
        console.log('\n=== Voice Command Processing Started ===');
        console.log(`[VoiceCommandService][${conversationId}] Received text: "${text}"`);

        if (!text || text.trim() === '') {
            console.warn('[VoiceCommandService] ❌ Cannot process empty text.');
            return;
        }

        // Check if text starts with 'C' to quickly filter non-commands
        if (!text.trim().toUpperCase().startsWith('C')) {
            console.log('[VoiceCommandService] ⏭️ Text does not start with C, skipping command processing');
            return;
        }

        console.log(`[VoiceCommandService][${conversationId}] 🔍 Processing potential command...`);

        // First check if it matches our command patterns
        const commandMatch = this.matchCommand(text);
        if (commandMatch) {
            console.log(`[VoiceCommandService][${conversationId}] ✅ Matched command:`, {
                type: commandMatch.type,
                data: commandMatch.data
            });
            
            try {
                if (commandMatch.type === 'take_a_note') {
                    console.log(`[VoiceCommandService][${conversationId}] 📝 Creating note action...`);
                    const action = await this.actionService.createNoteAction(
                        conversationId,
                        commandMatch.data.note_content
                    );
                    console.log(`[VoiceCommandService][${conversationId}] ✅ Note action saved successfully:`, {
                        actionId: action.id,
                        content: commandMatch.data.note_content.substring(0, 50) + (commandMatch.data.note_content.length > 50 ? '...' : '')
                    });
                    return;
                }
                
                if (commandMatch.type === 'schedule_follow_up') {
                    console.log(`[VoiceCommandService][${conversationId}] 📅 Creating follow-up action...`);
                    const action = await this.actionService.createFollowUpAction(
                        conversationId,
                        commandMatch.data.duration,
                        commandMatch.data.unit
                    );
                    console.log(`[VoiceCommandService][${conversationId}] ✅ Follow-up action saved successfully:`, {
                        actionId: action.id,
                        duration: commandMatch.data.duration,
                        unit: commandMatch.data.unit
                    });
                    return;
                }
            } catch (error) {
                console.error(`[VoiceCommandService][${conversationId}] ❌ Error saving action:`, error);
                return;
            }
        }

        // If no direct command match, fall back to OpenAI processing
        if (!this.openaiApiKey) {
            console.error('[VoiceCommandService] ❌ Cannot process via OpenAI, API key missing.');
            return;
        }

        console.log(`[VoiceCommandService][${conversationId}] ⚡ No direct command match, trying OpenAI processing...`);

        const chatCompletionUrl = 'https://api.openai.com/v1/chat/completions';
        
        try {
            const response = await axios.post<OpenAIChatCompletionToolResponse>(
                chatCompletionUrl,
                {
                    model: 'gpt-4',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'You are an assistant helping a clinician manage patient interactions. Process the users command by calling the appropriate function.' 
                        },
                        { role: 'user', content: text }
                    ],
                    tools: this.tools,
                    tool_choice: "auto",
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            const message = response.data?.choices?.[0]?.message;

            if (message?.tool_calls) {
                console.log(`[VoiceCommandService][${conversationId}] OpenAI requested a tool call.`);
                for (const toolCall of message.tool_calls) {
                    const functionName = toolCall.function.name;
                    const functionArgs = JSON.parse(toolCall.function.arguments);

                    console.log(`[VoiceCommandService][${conversationId}] Function: ${functionName}, Args:`, functionArgs);

                    if (functionName === 'take_a_note') {
                        try {
                            console.log(`[VoiceCommandService][${conversationId}] Attempting to save note action...`);
                            const action = await this.actionService.createNoteAction(
                                conversationId, 
                                functionArgs.note_content
                            );
                            console.log(`[VoiceCommandService][${conversationId}] Note action saved successfully (ID: ${action.id}).`);
                        } catch (dbError) {
                            console.error(`[VoiceCommandService][${conversationId}] Failed to save note action:`, dbError);
                        }
                    } else if (functionName === 'schedule_follow_up') {
                        try {
                            console.log(`[VoiceCommandService][${conversationId}] Attempting to save follow-up action...`);
                            const action = await this.actionService.createFollowUpAction(
                                conversationId, 
                                functionArgs.duration,
                                functionArgs.unit
                            );
                            console.log(`[VoiceCommandService][${conversationId}] Follow-up action saved successfully (ID: ${action.id}).`);
                        } catch (dbError) {
                            console.error(`[VoiceCommandService][${conversationId}] Failed to save follow-up action:`, dbError);
                        }
                    } else {
                        console.warn(`[VoiceCommandService][${conversationId}] Received unhandled tool call: ${functionName}`);
                    }
                }
            } else {
                console.log(`[VoiceCommandService][${conversationId}] OpenAI did not identify a function call for the text.`);
            }

        } catch (error) {
            console.error(`[VoiceCommandService][${conversationId}] Error calling OpenAI Chat Completion API:`);
            if (error && typeof error === 'object' && 'isAxiosError' in error && error.isAxiosError) {
                const axiosError = error as { response?: { status?: number; data?: any } }; 
                console.error('Status:', axiosError.response?.status);
                if (axiosError.response?.data) {
                    try { console.error('Data:', JSON.stringify(axiosError.response.data)); } catch { console.error('Data (raw):', axiosError.response.data); }
                } else { console.error('No response data received.'); }
            } else if (error instanceof Error) { console.error(error.message); }
            else { console.error('An unknown error occurred during Chat Completion:', String(error)); }
        }
        
        console.log('=== Voice Command Processing Completed ===\n');
    }

    // TODO: Add methods to interact with database (likely needs repository injection)
    // e.g., savePendingNoteAction(conversationId: string, noteContent: string)
    // e.g., savePendingFollowUpAction(conversationId: string, duration: number, unit: string)
} 