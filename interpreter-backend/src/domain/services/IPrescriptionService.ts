import { Prescription } from "../../generated/prisma";

export interface IPrescriptionService {
    createPrescription(conversationId: string, medicationName: string, dosage: string, frequency: string, details?: string): Promise<Prescription>;
    getPrescriptionsByConversationId(conversationId: string): Promise<Prescription[]>;
    // Add other service methods if needed
} 