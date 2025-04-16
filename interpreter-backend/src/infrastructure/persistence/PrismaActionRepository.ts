import { PrismaClient, Action, Prisma } from "../../generated/prisma";
import { IActionRepository } from "../../domain/repositories/IActionRepository";
import { injectable, inject } from "tsyringe";

@injectable()
export class PrismaActionRepository implements IActionRepository {
    private prisma: PrismaClient;

    constructor(@inject("PrismaClient") prismaClient: PrismaClient) {
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

    // +++ Implement specific action creation methods +++
    async createNoteAction(conversationId: string, content: string): Promise<Action> {
        console.log(`[PrismaActionRepository] Creating NOTE action for conversation ${conversationId}`);
        return this.prisma.action.create({
            data: {
                conversationId: conversationId,
                type: 'NOTE', // Assuming 'NOTE' is a valid type in your schema
                status: 'PENDING', // Default status
                metadata: { content: content }, // Use 'metadata' field from schema
                detectedAt: new Date() // Add detection timestamp
            },
        });
    }

    async createFollowUpAction(conversationId: string, duration: number, unit: string): Promise<Action> {
        console.log(`[PrismaActionRepository] Creating FOLLOW_UP action for conversation ${conversationId}`);
        return this.prisma.action.create({
            data: {
                conversationId: conversationId,
                type: 'FOLLOW_UP', // Assuming 'FOLLOW_UP' is a valid type
                status: 'PENDING',
                metadata: { duration: duration, unit: unit }, // Use 'metadata' field from schema
                detectedAt: new Date()
            },
        });
    }
    // ++++++++++++++++++++++++++++++++++++++++++++++++
}
