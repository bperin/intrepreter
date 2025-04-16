export interface ILanguageModelService {
    /**
     * Generates a response from the language model based on the conversation history or a specific prompt.
     * @param conversationId The ID of the conversation for context.
     * @param prompt The input prompt or latest message text.
     * @returns A promise resolving to the generated text response.
     */
    generateResponse(conversationId: string, prompt: string): Promise<string>;

    // Add other potential LLM methods if needed (e.g., specific function calling, embeddings)
} 