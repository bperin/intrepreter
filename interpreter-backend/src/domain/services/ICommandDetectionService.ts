// Structure for the result of command detection
export interface CommandDetectionResult {
    toolName: string;
    arguments: Record<string, any>; // Simple key-value pairs for arguments
}

export interface ICommandDetectionService {
    /**
     * Analyzes text to detect if it matches a predefined command.
     * @param text The input text to analyze.
     * @returns A promise resolving to a CommandDetectionResult if a command is detected, otherwise null.
     */
    detectCommand(text: string): Promise<CommandDetectionResult | null>;
} 