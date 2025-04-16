import { injectable, inject } from "tsyringe";
import { Prescription } from "../../generated/prisma";
import { IPrescriptionRepository } from "../../domain/repositories/IPrescriptionRepository";
import { IPrescriptionService } from "../../domain/services/IPrescriptionService";
import { INotificationService } from "../../domain/services/INotificationService";
import { AggregatedAction } from "../../domain/models/AggregatedAction";

@injectable()
export class PrescriptionService implements IPrescriptionService {
    constructor(
        @inject("IPrescriptionRepository") private prescriptionRepository: IPrescriptionRepository,
        @inject("INotificationService") private notificationService: INotificationService
    ) {}

    async createPrescription(conversationId: string, medicationName: string, dosage: string, frequency: string, details?: string): Promise<Prescription> {
        console.log(`[PrescriptionService] Creating prescription for conversation: ${conversationId}`);
        const prescription = await this.prescriptionRepository.create({
            conversationId,
            medicationName,
            dosage,
            frequency,
            details,
            // Status defaults to 'pending_review'
        });
        console.log(`[PrescriptionService] Created prescription: ${prescription.id}`);

        // Map to AggregatedAction and notify
        const aggregatedAction = this.mapToAggregatedAction(prescription);
        this.notificationService.notifyActionCreated(conversationId, aggregatedAction);

        return prescription;
    }

    async getPrescriptionsByConversationId(conversationId: string): Promise<Prescription[]> {
        return this.prescriptionRepository.findByConversationId(conversationId);
    }

    // Private helper to map Prescription to AggregatedAction
    private mapToAggregatedAction(prescription: Prescription): AggregatedAction {
        return {
            id: prescription.id,
            conversationId: prescription.conversationId,
            type: 'prescription',
            status: prescription.status,
            createdAt: prescription.createdAt,
            updatedAt: prescription.updatedAt,
            data: {
                medicationName: prescription.medicationName,
                dosage: prescription.dosage,
                frequency: prescription.frequency,
                details: prescription.details
            }
        };
    }
} 