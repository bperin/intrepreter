import { Note, Prisma } from "../../generated/prisma";

export interface INoteRepository {
    create(data: Prisma.NoteUncheckedCreateInput): Promise<Note>;
    findById(id: string): Promise<Note | null>;
    findByConversationId(conversationId: string): Promise<Note[]>;
    // Add other methods like update, delete if needed later
} 