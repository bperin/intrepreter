// Structure for the result of command execution
export interface CommandExecutionResult {
    status: 'success' | 'error' | 'not_found';
    name: string; // Name of the command attempted
    message?: string; // User-facing message (e.g., "Note saved.", "Follow-up scheduled.", "Error: ...")
    data?: any; // Optional additional data (e.g., the created note ID)
}

export interface ICommandExecutionService {
    /**
     * Executes a detected command based on its name and arguments.
     * @param conversationId The ID of the current conversation.
     * @param commandName The name of the command to execute (e.g., 'take_note', 'schedule_follow_up').
     * @param args The arguments for the command, parsed from the LLM response.
     * @returns A promise resolving to a CommandExecutionResult indicating the outcome.
     */
    executeCommand(conversationId: string, commandName: string, args: Record<string, any>): Promise<CommandExecutionResult>;
} 