import { injectable, inject } from "tsyringe";
import { PrismaClient, Note, Prisma } from "../../generated/prisma";
import { INoteRepository } from "../../domain/repositories/INoteRepository";

@injectable()
export class PrismaNoteRepository implements INoteRepository {
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {}

    async create(data: Prisma.NoteUncheckedCreateInput): Promise<Note> {
        return this.prisma.note.create({ data });
    }

    async findById(id: string): Promise<Note | null> {
        return this.prisma.note.findUnique({ where: { id } });
    }

    async findByConversationId(conversationId: string): Promise<Note[]> {
        return this.prisma.note.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }, // Order by creation time
        });
    }
} 