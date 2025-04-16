import { Action } from "../../generated/prisma";

export interface IActionService {
    /**
     * Retrieves all actions for a specific conversation
     */
    getActionsByConversationId(conversationId: string): Promise<Action[]>;

    /**
     * Creates a new note action
     */
    createNoteAction(conversationId: string, content: string): Promise<Action>;

    /**
     * Creates a new follow-up action
     */
    createFollowUpAction(conversationId: string, duration: number, unit: string): Promise<Action>;
} 