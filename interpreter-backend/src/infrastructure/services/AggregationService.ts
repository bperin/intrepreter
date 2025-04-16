import { injectable, inject } from "tsyringe";
import { INoteRepository } from "../../domain/repositories/INoteRepository";
import { IFollowUpRepository } from "../../domain/repositories/IFollowUpRepository";
import { IPrescriptionRepository } from "../../domain/repositories/IPrescriptionRepository";
import { IAggregationService } from "../../domain/services/IAggregationService";
import { AggregatedAction, ActionModel } from "../../domain/models/AggregatedAction";
import { Note, FollowUp, Prescription } from "../../generated/prisma";

@injectable()
export class AggregationService implements IAggregationService {
    constructor(
        @inject("INoteRepository") private noteRepository: INoteRepository,
        @inject("IFollowUpRepository") private followUpRepository: IFollowUpRepository,
        @inject("IPrescriptionRepository") private prescriptionRepository: IPrescriptionRepository
    ) {}

    async getAggregatedActionsByConversationId(conversationId: string): Promise<AggregatedAction[]> {
        console.log(`[AggregationService] Fetching actions for conversation: ${conversationId}`);
        
        // Fetch all action types in parallel
        const [notes, followUps, prescriptions] = await Promise.all([
            this.noteRepository.findByConversationId(conversationId),
            this.followUpRepository.findByConversationId(conversationId),
            this.prescriptionRepository.findByConversationId(conversationId)
        ]);

        // Map each type to the AggregatedAction structure
        const aggregatedNotes = notes.map(note => this.mapToAction(note, 'note'));
        const aggregatedFollowUps = followUps.map(followUp => this.mapToAction(followUp, 'followup'));
        const aggregatedPrescriptions = prescriptions.map(prescription => this.mapToAction(prescription, 'prescription'));

        // Combine and sort by createdAt date (newest first)
        const allActions = [
            ...aggregatedNotes,
            ...aggregatedFollowUps,
            ...aggregatedPrescriptions
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Descending sort

        console.log(`[AggregationService] Found ${allActions.length} total actions for conversation: ${conversationId}`);
        return allActions;
    }

    // Helper function to map specific models to the AggregatedAction structure
    private mapToAction(action: ActionModel, type: 'note' | 'followup' | 'prescription'): AggregatedAction {
        const baseAction = {
            id: action.id,
            conversationId: action.conversationId,
            type: type,
            status: action.status, // Assumes status field exists and is compatible
            createdAt: action.createdAt,
            updatedAt: action.updatedAt,
            data: {} as Record<string, any>
        };

        // Add type-specific data to the 'data' payload
        switch (type) {
            case 'note':
                const note = action as Note;
                baseAction.data = { content: note.content };
                break;
            case 'followup':
                const followup = action as FollowUp;
                baseAction.data = {
                    duration: followup.duration,
                    unit: followup.unit,
                    scheduledFor: followup.scheduledFor,
                    details: followup.details
                };
                break;
            case 'prescription':
                const prescription = action as Prescription;
                baseAction.data = {
                    medicationName: prescription.medicationName,
                    dosage: prescription.dosage,
                    frequency: prescription.frequency,
                    details: prescription.details
                };
                break;
        }

        return baseAction;
    }
} 