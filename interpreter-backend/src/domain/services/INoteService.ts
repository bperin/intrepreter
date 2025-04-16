import { Note } from "../../generated/prisma";

export interface INoteService {
    createNote(conversationId: string, content: string): Promise<Note>;
    getNotesByConversationId(conversationId: string): Promise<Note[]>;
    // Add other service methods if needed
} 