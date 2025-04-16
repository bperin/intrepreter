import { injectable, inject } from "tsyringe";
import { INoteService } from "../../domain/services/INoteService";
import { IFollowUpService, FollowUpUnit } from "../../domain/services/IFollowUpService";
import { IPrescriptionService } from "../../domain/services/IPrescriptionService";

export interface CommandExecutionResult {
    status: 'success' | 'error';
    name: string; // The name of the command that was executed
    payload?: any; // Optional data to send back (e.g., created entity ID)
    message?: string; // Error message if status is 'error'
}

@injectable()
export class CommandExecutionService {

    constructor(
        @inject('INoteService') private noteService: INoteService,
        @inject('IFollowUpService') private followUpService: IFollowUpService,
        @inject('IPrescriptionService') private prescriptionService: IPrescriptionService
    ) {}

    async executeCommand(conversationId: string, toolName: string, args: any): Promise<CommandExecutionResult> {
        console.log(`[CommandExecutor][${conversationId}] Attempting execution: ${toolName} with args:`, args);

        try {
            switch (toolName) {
                case 'take_note':
                    if (!args || typeof args.note_content !== 'string' || args.note_content.trim() === '') {
                        throw new Error(`Missing or invalid 'note_content' for take_note`);
                    }
                    const note = await this.noteService.createNote(conversationId, args.note_content);
                    console.log(`[CommandExecutor][${conversationId}] Note created successfully (ID: ${note.id}).`);
                    return { status: 'success', name: toolName, payload: note };

                case 'schedule_follow_up':
                    if (args?.duration === undefined || typeof args.duration !== 'number' || args.duration <= 0) {
                        throw new Error(`Missing or invalid 'duration' for schedule_follow_up`);
                    }
                    const validUnits: FollowUpUnit[] = ['day', 'week', 'month'];
                    if (!args.unit || !validUnits.includes(args.unit)) {
                        throw new Error(`Missing or invalid 'unit' (${args.unit}) for schedule_follow_up. Must be one of: ${validUnits.join(', ')}`);
                    }
                    const details = (typeof args.details === 'string') ? args.details : undefined;

                    const followUp = await this.followUpService.createFollowUp(
                        conversationId,
                        args.duration,
                        args.unit as FollowUpUnit,
                        details
                    );
                    console.log(`[CommandExecutor][${conversationId}] Follow-up scheduled successfully for ${followUp.scheduledFor?.toISOString()} (ID: ${followUp.id}).`);
                    return { status: 'success', name: toolName, payload: followUp };

                case 'write_prescription':
                    if (!args?.medication_name || typeof args.medication_name !== 'string') {
                        throw new Error(`Missing or invalid 'medication_name' for write_prescription`);
                    }
                    if (!args.dosage || typeof args.dosage !== 'string') {
                        throw new Error(`Missing or invalid 'dosage' for write_prescription`);
                    }
                    if (!args.frequency || typeof args.frequency !== 'string') {
                        throw new Error(`Missing or invalid 'frequency' for write_prescription`);
                    }
                    const presDetails = (typeof args.details === 'string') ? args.details : undefined;

                    const prescription = await this.prescriptionService.createPrescription(
                        conversationId,
                        args.medication_name,
                        args.dosage,
                        args.frequency,
                        presDetails
                    );
                    console.log(`[CommandExecutor][${conversationId}] Prescription created successfully (ID: ${prescription.id}).`);
                    return { status: 'success', name: toolName, payload: prescription };

                default:
                    console.warn(`[CommandExecutor][${conversationId}] Attempted to execute unhandled command: ${toolName}`);
                    throw new Error(`Unhandled command type: ${toolName}`);
            }
        } catch (error: unknown) {
            console.error(`[CommandExecutor][${conversationId}] Error executing command ${toolName}:`, error);
            let errorMessage = 'Failed to execute command.';
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            return { status: 'error', name: toolName, message: errorMessage };
        }
    }
} 