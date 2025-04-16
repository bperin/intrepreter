import { injectable, inject } from "tsyringe";
import { PrismaClient, FollowUp, Prisma } from "../../generated/prisma";
import { IFollowUpRepository } from "../../domain/repositories/IFollowUpRepository";

@injectable()
export class PrismaFollowUpRepository implements IFollowUpRepository {
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {}

    async create(data: Prisma.FollowUpUncheckedCreateInput): Promise<FollowUp> {
        return this.prisma.followUp.create({ data });
    }

    async findById(id: string): Promise<FollowUp | null> {
        return this.prisma.followUp.findUnique({ where: { id } });
    }

    async findByConversationId(conversationId: string): Promise<FollowUp[]> {
        return this.prisma.followUp.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }, // Order by creation time
        });
    }
} 