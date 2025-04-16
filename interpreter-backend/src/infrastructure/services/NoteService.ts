import { injectable, inject } from "tsyringe";
import { Note } from "../../generated/prisma";
import { INoteRepository } from "../../domain/repositories/INoteRepository";
import { INoteService } from "../../domain/services/INoteService";
import { INotificationService } from "../../domain/services/INotificationService"; // Assuming we notify on creation

@injectable()
export class NoteService implements INoteService {
    constructor(
        @inject("INoteRepository") private noteRepository: INoteRepository,
        // @inject("INotificationService") private notificationService: INotificationService // Temporarily remove injection
    ) {}

    async createNote(conversationId: string, content: string): Promise<Note> {
        console.log(`[NoteService] Creating note for conversation: ${conversationId}`);
        const note = await this.noteRepository.create({
            conversationId,
            content,
            // Status defaults to 'created'
        });
        console.log(`[NoteService] Created note: ${note.id}`);

        // Notify clients (adjust payload as needed)
        // TODO: Define a proper payload structure for notifications
        // this.notificationService.notifyGeneric(conversationId, 'note_created', note);
        // TODO: Reinstate notification with correct method/payload after refactoring INotificationService

        return note;
    }

    async getNotesByConversationId(conversationId: string): Promise<Note[]> {
        return this.noteRepository.findByConversationId(conversationId);
    }
} 