import { Action, Prisma } from "../../generated/prisma";

export interface IActionRepository {
    findById(id: string): Promise<Action | null>;
    findByConversationId(conversationId: string): Promise<Action[]>;
    create(data: Prisma.ActionUncheckedCreateInput): Promise<Action>;
    updateStatus(id: string, status: string, executedAt?: Date): Promise<Action>;
    // Add other methods as needed
}
