import { injectable } from 'tsyringe';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { ILanguageModelService } from '../../domain/services/ILanguageModelService';

// Load environment variables (adjust path if necessary)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

@injectable()
export class OpenAILanguageModelService implements ILanguageModelService {
    private readonly openai: OpenAI;
    private readonly apiKeyPresent: boolean;

    constructor(/* Inject dependencies if needed, e.g., ConversationRepository */) {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            console.error('[OpenAILanguageModelService] OPENAI_API_KEY is not set! LLM calls will fail.');
            this.apiKeyPresent = false;
            this.openai = new OpenAI({ apiKey: 'dummy-key' });
        } else {
             this.openai = new OpenAI({ apiKey });
             this.apiKeyPresent = true;
        }
    }

    async generateResponse(conversationId: string, prompt: string): Promise<string> {
        if (!this.apiKeyPresent) {
            console.warn('[OpenAILanguageModelService] Cannot generate response: OPENAI_API_KEY not set.');
            // Return a default message or throw an error
            return "Sorry, I am currently unable to process your request due to a configuration issue."; 
        }
        if (!prompt) {
            console.warn('[OpenAILanguageModelService] Received empty prompt.');
            return "..."; // Or some other default empty response
        }

        // TODO: Potentially fetch conversation history here to provide more context to the LLM
        // const history = await this.conversationRepository.findMessagesByConversationId(conversationId);
        // const messagesForLLM = history.map(msg => ({ role: msg.sender === 'user' ? 'user' : 'assistant', content: msg.content }));
        
        console.log(`[OpenAILanguageModelService][${conversationId}] Generating response for prompt: "${prompt.substring(0, 100)}..."`);

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini', // Or your preferred model
                messages: [ 
                    // Add system prompt if desired
                    // { role: "system", content: "You are a helpful medical interpreter assistant." }, 
                    // Add conversation history here if fetched
                    // ...messagesForLLM,
                    { role: 'user', content: prompt } // Add the latest user prompt
                ],
                max_tokens: 150, // Adjust as needed
                temperature: 0.7, // Adjust creativity
                n: 1,
                stream: false,
            });

            const generatedText = response.choices[0]?.message?.content?.trim();

            if (generatedText) {
                console.log(`[OpenAILanguageModelService][${conversationId}] Received LLM response: "${generatedText.substring(0, 100)}..."`);
                return generatedText;
            } else {
                console.warn(`[OpenAILanguageModelService][${conversationId}] OpenAI LLM response missing expected content.`, response);
                return "Sorry, I could not generate a response."; // Fallback response
            }

        } catch (error: any) {
            console.error(`[OpenAILanguageModelService][${conversationId}] Error calling OpenAI LLM:`);
             if (error instanceof OpenAI.APIError) {
                 console.error(`OpenAI API Error: Status=${error.status}, Type=${error.type}, Code=${error.code}, Message=${error.message}`);
            } else {
                 console.error('An unknown error occurred:', error?.message || String(error));
            }
             // Fallback response on error
            return "Sorry, an error occurred while processing your request.";
        }
    }
} 