import { Prescription, Prisma } from "../../generated/prisma";

export interface IPrescriptionRepository {
    create(data: Prisma.PrescriptionUncheckedCreateInput): Promise<Prescription>;
    findById(id: string): Promise<Prescription | null>;
    findByConversationId(conversationId: string): Promise<Prescription[]>;
    // Add other methods like update, delete if needed later
} 