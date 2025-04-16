import OpenAI from 'openai';
import { injectable } from 'tsyringe';
import { IOpenAIClient, EphemeralKeyResult, TranslationResult } from '../../domain/clients/IOpenAIClient';

// Import fetch if not globally available (e.g., older Node versions)
// import fetch from 'node-fetch';

// Define the expected structure of the response from the /v1/realtime/sessions endpoint
interface OpenAISessionResponse {
    session_id: string;
    session_key: string;
    // Add other potential fields like expires_at if needed
}

@injectable()
export class OpenAIClient implements IOpenAIClient {
    private openai: OpenAI;
    private apiKey: string;

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY!;
        if (!this.apiKey) {
            throw new Error("OpenAI API key is missing. Please set the OPENAI_API_KEY environment variable.");
        }
        this.openai = new OpenAI({ apiKey: this.apiKey });
        console.log("[OpenAIClient] Initialized with API key from environment variable.");
    }

    /**
     * Creates an ephemeral API key for a specific session.
     * @param sessionName - A unique identifier for the session (e.g., conversation ID).
     * @returns The ephemeral key string.
     */
    async createEphemeralKey(): Promise<EphemeralKeyResult> {
        const sessionName = `session-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[OpenAIClient] Requesting ephemeral key for session: ${sessionName}`);
        const sessionUrl = "https://api.openai.com/v1/realtime/sessions";
        
        // Use the model specified in OpenAI's latest realtime documentation
        const model = "gpt-4o-transcribe"; 
        
        try {
            console.log(`[OpenAIClient] Making request to ${sessionUrl} with model ${model}`);
            
            // Set a reasonable timeout for the fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            try {
                const response = await fetch(sessionUrl, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${this.apiKey}`,
                        "Content-Type": "application/json",
                        "OpenAI-Beta": "realtime", // Add OpenAI-Beta header for realtime features
                    },
                    body: JSON.stringify({
                        model: model,
                        // We don't specify voice since this is for STT not TTS
                    }),
                    signal: controller.signal, // Add the abort signal
                });
                
                clearTimeout(timeoutId); // Clear the timeout
                
                // Log the raw response status for debugging
                console.log(`[OpenAIClient] Raw response status: ${response.status} ${response.statusText}`);

                // Get the raw text for debugging in case of issues
                const rawResponseText = await response.text();
                console.log(`[OpenAIClient] Raw response body: ${rawResponseText.substring(0, 1000)}`);

                if (!response.ok) {
                    throw new Error(`OpenAI API error (${response.status}): ${response.statusText}. ${rawResponseText}`);
                }

                // Parse the JSON (from the text we already got)
                let data;
                try {
                    data = JSON.parse(rawResponseText);
                    console.log("[OpenAIClient] Response parsed successfully:", 
                        JSON.stringify(data, (key, value) => 
                            key === 'session_key' ? "[REDACTED]" : value // Don't log the actual key
                        )
                    );
                } catch (parseError) {
                    throw new Error(`Failed to parse OpenAI response as JSON: ${rawResponseText.substring(0, 100)}...`);
                }

                // Check for various potential response structures
                let key: string | undefined;
                
                // Try the expected structure first
                if (typeof data === 'object' && data !== null) {
                    if (typeof data.session_key === 'string') {
                        key = data.session_key;
                    } else if (typeof data.key === 'string') {
                        key = data.key;
                    } else if (data.token && typeof data.token === 'string') {
                        key = data.token;
                    } else if (data.client_secret && typeof data.client_secret === 'object' && data.client_secret.value) {
                        // This is the actual format from the OpenAI API response
                        key = data.client_secret.value;
                        console.log(`[OpenAIClient] Found key in client_secret.value!`);
                    } else if (data.data && typeof data.data === 'object') {
                        // Try nested data structure
                        const nestedData = data.data;
                        if (typeof nestedData.session_key === 'string') {
                            key = nestedData.session_key;
                        } else if (typeof nestedData.key === 'string') {
                            key = nestedData.key;
                        } else if (nestedData.client_secret && typeof nestedData.client_secret === 'object' && nestedData.client_secret.value) {
                            key = nestedData.client_secret.value;
                        }
                    }
                }

                if (!key) {
                    throw new Error('Could not find session key in OpenAI response.');
                }

                console.log(`[OpenAIClient] Real ephemeral key generated successfully for session: ${sessionName}`);
                return { key };
                
            } catch (fetchError: any) {
                clearTimeout(timeoutId); // Clear the timeout if fetch fails
                throw fetchError; // Re-throw to be caught by the outer try/catch
            }

        } catch (error: any) {
            console.error(`[OpenAIClient] Error creating ephemeral key for session ${sessionName}:`, error);
            if (error.stack) {
                console.error("[OpenAIClient] Error stack:", error.stack);
            }
            
            // Re-throw the error for the caller to handle
            throw new Error(`Failed to create OpenAI ephemeral key: ${error.message || String(error)}`);
        }
    }

    /**
     * Translates text from a source language to a target language.
     * @param text - The text to translate.
     * @param sourceLanguage - ISO 639-1 code of the source language (optional).
     * @param targetLanguage - ISO 639-1 code of the target language.
     * @returns The translated text.
     */
    async translate(text: string, targetLanguage: string, sourceLanguage?: string): Promise<TranslationResult> {
        console.log(`[OpenAIClient] Requesting translation to ${targetLanguage} for text: "${text.substring(0, 50)}..."`);
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: `Translate the following text ${sourceLanguage ? `from ${sourceLanguage} ` : ''}to ${targetLanguage}. Only provide the translated text, nothing else.`
                    },
                    {
                        role: "user",
                        content: text
                    }
                ],
                temperature: 0.3,
                max_tokens: 1000,
            });

            const translatedText = completion.choices[0]?.message?.content?.trim();
            if (!translatedText) {
                throw new Error('Translation failed or returned empty content.');
            }
            console.log(`[OpenAIClient] Translation successful.`);
            return { translatedText: translatedText };
        } catch (error: any) {
            console.error(`[OpenAIClient] Error during translation:`, error);
            throw new Error(`Failed to translate text using OpenAI: ${error.message}`);
        }
    }

    // TODO: Add methods for Action Detection, Summary, TTS as needed
} 