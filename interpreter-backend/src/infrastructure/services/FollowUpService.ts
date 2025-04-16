import { injectable, inject } from "tsyringe";
import { FollowUp } from "../../generated/prisma";
import { IFollowUpRepository } from "../../domain/repositories/IFollowUpRepository";
import { IFollowUpService, FollowUpUnit } from "../../domain/services/IFollowUpService";
import { INotificationService } from "../../domain/services/INotificationService";
import { AggregatedAction } from "../../domain/models/AggregatedAction";

@injectable()
export class FollowUpService implements IFollowUpService {
    constructor(
        @inject("IFollowUpRepository") private followUpRepository: IFollowUpRepository,
        @inject("INotificationService") private notificationService: INotificationService
    ) {}

    async createFollowUp(conversationId: string, duration: number, unit: FollowUpUnit, details?: string): Promise<FollowUp> {
        console.log(`[FollowUpService] Creating follow-up for conversation: ${conversationId}`);

        // Calculate the scheduledFor date
        const scheduledFor = this.calculateScheduledFor(duration, unit);

        const followUp = await this.followUpRepository.create({
            conversationId,
            duration,
            unit,
            scheduledFor,
            details,
            // Status defaults to 'scheduled'
        });
        console.log(`[FollowUpService] Created follow-up: ${followUp.id}, scheduled for: ${scheduledFor?.toISOString()}`);

        // Map to AggregatedAction and notify
        const aggregatedAction = this.mapToAggregatedAction(followUp);
        this.notificationService.notifyActionCreated(conversationId, aggregatedAction);

        return followUp;
    }

    async getFollowUpsByConversationId(conversationId: string): Promise<FollowUp[]> {
        return this.followUpRepository.findByConversationId(conversationId);
    }

    private calculateScheduledFor(duration: number, unit: FollowUpUnit): Date {
        const now = new Date();
        switch (unit) {
            case "day":
                now.setDate(now.getDate() + duration);
                break;
            case "week":
                now.setDate(now.getDate() + duration * 7);
                break;
            case "month":
                now.setMonth(now.getMonth() + duration);
                break;
            default:
                // Should not happen due to type checking, but handle defensively
                console.warn(`[FollowUpService] Unexpected unit: ${unit}. Defaulting to now.`);
                return new Date(); 
        }
        // Optionally, set to a specific time like start of day or end of day?
        // For now, keep the current time.
        return now;
    }

    // Private helper to map FollowUp to AggregatedAction
    private mapToAggregatedAction(followUp: FollowUp): AggregatedAction {
        return {
            id: followUp.id,
            conversationId: followUp.conversationId,
            type: 'followup',
            status: followUp.status,
            createdAt: followUp.createdAt,
            updatedAt: followUp.updatedAt,
            data: {
                duration: followUp.duration,
                unit: followUp.unit,
                scheduledFor: followUp.scheduledFor,
                details: followUp.details
            }
        };
    }
} 