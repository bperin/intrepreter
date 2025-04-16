import { injectable, inject } from 'tsyringe';
import { Action } from '../../generated/prisma';
import { IActionRepository } from '../../domain/repositories/IActionRepository';
import { IActionService } from '../../domain/services/IActionService';
import { INotificationService } from '../../domain/services/INotificationService';

@injectable()
export class ActionService implements IActionService {
    constructor(
        @inject("IActionRepository") private actionRepository: IActionRepository,
        @inject("INotificationService") private notificationService: INotificationService
    ) {}

    async getActionsByConversationId(conversationId: string): Promise<Action[]> {
        console.log(`[ActionService] Fetching actions for conversation: ${conversationId}`);
        const actions = await this.actionRepository.findByConversationId(conversationId);
        console.log(`[ActionService] Found ${actions.length} actions`);
        return actions;
    }

    async createNoteAction(conversationId: string, content: string): Promise<Action> {
        console.log(`[ActionService] Creating note action for conversation: ${conversationId}`);
        const action = await this.actionRepository.createNoteAction(conversationId, content);
        console.log(`[ActionService] Created note action: ${action.id}`);
        
        // Notify clients about the new action
        this.notificationService.notifyActionCreated(conversationId, {
            id: action.id,
            conversationId: action.conversationId,
            type: action.type,
            data: action.metadata,
            createdAt: action.detectedAt,
            userId: action.conversationId // TODO: Add userId to action schema
        });

        return action;
    }

    async createFollowUpAction(conversationId: string, duration: number, unit: string): Promise<Action> {
        console.log(`[ActionService] Creating follow-up action for conversation: ${conversationId}`);
        const action = await this.actionRepository.createFollowUpAction(conversationId, duration, unit);
        console.log(`[ActionService] Created follow-up action: ${action.id}`);

        // Notify clients about the new action
        this.notificationService.notifyActionCreated(conversationId, {
            id: action.id,
            conversationId: action.conversationId,
            type: action.type,
            data: action.metadata,
            createdAt: action.detectedAt,
            userId: action.conversationId // TODO: Add userId to action schema
        });

        return action;
    }
} 