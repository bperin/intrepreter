import { FollowUp, Prisma } from "../../generated/prisma";

export interface IFollowUpRepository {
    create(data: Prisma.FollowUpUncheckedCreateInput): Promise<FollowUp>;
    findById(id: string): Promise<FollowUp | null>;
    findByConversationId(conversationId: string): Promise<FollowUp[]>;
    // Add other methods like update, delete if needed later
} 