import { FollowUp } from "../../generated/prisma";

// Type definition for allowed units
export type FollowUpUnit = "day" | "week" | "month";

export interface IFollowUpService {
    createFollowUp(conversationId: string, duration: number, unit: FollowUpUnit, details?: string): Promise<FollowUp>;
    getFollowUpsByConversationId(conversationId: string): Promise<FollowUp[]>;
    // Add other service methods if needed
} 