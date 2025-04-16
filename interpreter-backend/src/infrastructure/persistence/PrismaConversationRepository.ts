import { PrismaClient, Conversation, Patient, Prisma, Message } from "../../generated/prisma";
import { IConversationRepository, ConversationWithRelations } from "../../domain/repositories/IConversationRepository";
import { injectable, inject } from "tsyringe";

@injectable()
export class PrismaConversationRepository implements IConversationRepository {
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {}

    async findById(id: string): Promise<ConversationWithRelations | null> {
        return this.prisma.conversation.findUnique({
            where: { id },
            include: {
                user: true,
                patient: true,
                messages: true,
                actions: true,
                summary: true,
                medicalHistory: true
            },
        });
    }

    async findByUserId(userId: string): Promise<(Conversation & { patient: Patient })[]> {
        return this.prisma.conversation.findMany({
            where: { userId },
            include: {
                patient: true, // Include patient data
            },
            orderBy: {
                startTime: "desc", // Order by start time, newest first
            },
        });
    }

    async findMessagesByConversationId(conversationId: string): Promise<Message[]> {
        return this.prisma.message.findMany({
            where: { conversationId },
            orderBy: {
                timestamp: "asc", // Order messages chronologically
            },
        });
    }

    async create(data: Prisma.ConversationUncheckedCreateInput): Promise<Conversation> {
        return this.prisma.conversation.create({ data });
    }

    async update(id: string, data: Prisma.ConversationUpdateInput): Promise<Conversation> {
        return this.prisma.conversation.update({
            where: { id },
            data,
        });
    }
}
