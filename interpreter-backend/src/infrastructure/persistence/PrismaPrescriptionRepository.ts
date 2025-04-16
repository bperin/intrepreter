import { injectable, inject } from "tsyringe";
import { PrismaClient, Prescription, Prisma } from "../../generated/prisma";
import { IPrescriptionRepository } from "../../domain/repositories/IPrescriptionRepository";

@injectable()
export class PrismaPrescriptionRepository implements IPrescriptionRepository {
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {}

    async create(data: Prisma.PrescriptionUncheckedCreateInput): Promise<Prescription> {
        return this.prisma.prescription.create({ data });
    }

    async findById(id: string): Promise<Prescription | null> {
        return this.prisma.prescription.findUnique({ where: { id } });
    }

    async findByConversationId(conversationId: string): Promise<Prescription[]> {
        return this.prisma.prescription.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }, // Order by creation time
        });
    }
} 