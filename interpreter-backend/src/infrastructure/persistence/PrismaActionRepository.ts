import { PrismaClient, Action, Prisma } from "../../generated/prisma";
import { IActionRepository } from "../../domain/repositories/IActionRepository";
import { injectable, inject } from "tsyringe";

@injectable()
export class PrismaActionRepository implements IActionRepository {
    private prisma: PrismaClient;

    constructor(@inject(PrismaClient) prismaClient: PrismaClient) {
        this.prisma = prismaClient;
    }

    async findById(id: string): Promise<Action | null> {
        return this.prisma.action.findUnique({
            where: { id },
        });
    }

    async findByConversationId(conversationId: string): Promise<Action[]> {
        return this.prisma.action.findMany({
            where: { conversationId },
            orderBy: { detectedAt: "asc" }, // Order by detection time
        });
    }

    async create(data: Prisma.ActionUncheckedCreateInput): Promise<Action> {
        return this.prisma.action.create({
            data,
        });
    }

    async updateStatus(id: string, status: string, executedAt?: Date): Promise<Action> {
        return this.prisma.action.update({
            where: { id },
            data: {
                status,
                executedAt: executedAt, // Only set if provided
            },
        });
    }
}
