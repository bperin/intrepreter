import { PrismaClient, Message, Prisma } from "../../generated/prisma";
import { IMessageRepository } from "../../domain/repositories/IMessageRepository";
import { injectable, inject } from "tsyringe";

@injectable()
export class PrismaMessageRepository implements IMessageRepository {
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {}

    async create(data: Prisma.MessageUncheckedCreateInput): Promise<Message> {
        return this.prisma.message.create({ data });
    }

    async findByConversationId(conversationId: string): Promise<Message[]> {
        return this.prisma.message.findMany({
            where: { conversationId },
            orderBy: { timestamp: "asc" },
        });
    }

    async update(id: string, data: Prisma.MessageUpdateInput): Promise<Message> {
        return this.prisma.message.update({
            where: { id },
            data,
        });
    }
}
