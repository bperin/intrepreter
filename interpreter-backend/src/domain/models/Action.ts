export interface ActionPayload {
    id: string;
    conversationId: string;
    type: string;
    data: any;
    createdAt: Date;
    userId: string;
} 