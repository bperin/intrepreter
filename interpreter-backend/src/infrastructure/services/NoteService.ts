import { injectable, inject } from "tsyringe";
import { Note } from "../../generated/prisma";
import { INoteRepository } from "../../domain/repositories/INoteRepository";
import { INoteService } from "../../domain/services/INoteService";
import { INotificationService } from "../../domain/services/INotificationService";
import { AggregatedAction } from "../../domain/models/AggregatedAction"; // Import AggregatedAction

@injectable()
export class NoteService implements INoteService {
    constructor(
        @inject("INoteRepository") private noteRepository: INoteRepository,
        @inject("INotificationService") private notificationService: INotificationService // Reinject notification service
    ) {}

    async createNote(conversationId: string, content: string): Promise<Note> {
        console.log(`[NoteService] Creating note for conversation: ${conversationId}`);
        const note = await this.noteRepository.create({
            conversationId,
            content,
            // Status defaults to 'created'
        });
        console.log(`[NoteService] Created note: ${note.id}`);

        // Map to AggregatedAction and notify
        const aggregatedAction = this.mapToAggregatedAction(note);
        this.notificationService.notifyActionCreated(conversationId, aggregatedAction);

        return note;
    }

    async getNotesByConversationId(conversationId: string): Promise<Note[]> {
        return this.noteRepository.findByConversationId(conversationId);
    }

    // Private helper to map Note to AggregatedAction
    private mapToAggregatedAction(note: Note): AggregatedAction {
        return {
            id: note.id,
            conversationId: note.conversationId,
            type: 'note',
            status: note.status,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            data: { 
                content: note.content
            }
        };
    }
} 