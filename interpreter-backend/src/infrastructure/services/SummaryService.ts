import axios from 'axios';

/* Add interface for OpenAI response */
interface OpenAIChatCompletionResponse {
  choices: { message: { content: string } }[];
}

export class SummaryService {
    private readonly openaiApiKey: string;

    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY || '';
        if (!this.openaiApiKey) {
            console.error('[SummaryService] OPENAI_API_KEY is not set! Summarization will fail.');
        }
    }

    async generateSummary(transcript: string): Promise<string | null> {
        if (!this.openaiApiKey) {
            console.warn('[SummaryService] Cannot generate summary: OPENAI_API_KEY not set.');
            return null;
        }
        if (!transcript || transcript.trim().length === 0) {
            console.warn('[SummaryService] Cannot generate summary: Empty transcript provided.');
            return "(No messages to summarize)";
        }

        const summarizationUrl = 'https://api.openai.com/v1/chat/completions';
        const prompt = `Summarize the following conversation between a clinician and a patient. Focus on key symptoms, diagnosis points, and any agreed-upon follow-ups. Keep the summary concise.\n\nConversation:\n${transcript}\n\nSummary:`;

        console.log(`[SummaryService] Requesting summary from OpenAI...`);

        try {
            const response = await axios.post<OpenAIChatCompletionResponse>(summarizationUrl, {
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 250,
                temperature: 0.5,
            }, {
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            const summary = response.data?.choices?.[0]?.message?.content?.trim();

            if (summary) {
                console.log(`[SummaryService] Summary generated successfully.`);
                return summary;
            } else {
                console.warn(`[SummaryService] OpenAI returned empty summary content. Response:`, JSON.stringify(response.data));
                return "(Summary generation failed)";
            }
        } catch (error) {
            console.error(`[SummaryService] Error calling OpenAI Summarization API:`, error);
            return null;
        }
    }
} 