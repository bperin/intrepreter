import { injectable, inject } from "tsyringe";
import { Prescription } from "../../generated/prisma";
import { IPrescriptionRepository } from "../../domain/repositories/IPrescriptionRepository";
import { IPrescriptionService } from "../../domain/services/IPrescriptionService";
import { INotificationService } from "../../domain/services/INotificationService";

@injectable()
export class PrescriptionService implements IPrescriptionService {
    constructor(
        @inject("IPrescriptionRepository") private prescriptionRepository: IPrescriptionRepository,
        // @inject("INotificationService") private notificationService: INotificationService // Temporarily remove injection
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

        // TODO: Reinstate notification with correct method/payload after refactoring INotificationService
        // this.notificationService.notifyActionCreated(conversationId, ...);

        return prescription;
    }

    async getPrescriptionsByConversationId(conversationId: string): Promise<Prescription[]> {
        return this.prescriptionRepository.findByConversationId(conversationId);
    }
} 