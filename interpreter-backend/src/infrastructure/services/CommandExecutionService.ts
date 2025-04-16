import { injectable, inject } from "tsyringe";
import { INoteService } from "../../domain/services/INoteService";
import { IFollowUpService, FollowUpUnit } from "../../domain/services/IFollowUpService";
import { IPrescriptionService } from "../../domain/services/IPrescriptionService";
import { MedicalHistoryService } from './MedicalHistoryService'; // Assuming direct injection for now
import { ISummaryService } from '../../domain/services/ISummaryService'; // For requesting summary
import { ICommandExecutionService, CommandExecutionResult } from '../../domain/services/ICommandExecutionService'; // <-- Import interface
import { Logger, createLogger } from '../../utils/Logger';

@injectable()
export class CommandExecutionService implements ICommandExecutionService { // <-- Implement interface
    private logger: Logger;

    constructor(
        @inject('INoteService') private noteService: INoteService,
        @inject('IFollowUpService') private followUpService: IFollowUpService,
        @inject('IPrescriptionService') private prescriptionService: IPrescriptionService
    ) {
        this.logger = createLogger('CommandExecutionService');
    }

    async executeCommand(conversationId: string, toolName: string, args: any): Promise<CommandExecutionResult> {
        this.logger.log(`Executing command: ${toolName} for conversation ${conversationId} with args:`, args);

        try {
            switch (toolName) {
                case 'take_note':
                    if (!args.note_content) {
                        return { status: 'error', name: toolName, message: 'Missing required argument: note_content' };
                    }
                    const noteResult = await this.noteService.createNote(conversationId, args.note_content);
                    if (noteResult) {
                        return { 
                            status: 'success', 
                            name: toolName, 
                            message: 'Note saved successfully.', 
                            data: { note: noteResult } // Return the full note object
                        };
                    } else {
                         return { status: 'error', name: toolName, message: 'Failed to save note.' };
                    }
                
                case 'schedule_follow_up':
                    if (typeof args.duration !== 'number' || !args.unit || !['day', 'week', 'month'].includes(args.unit)) {
                        return { status: 'error', name: toolName, message: 'Missing or invalid arguments: duration (number) and unit (day/week/month) required.' };
                    }
                    const followUpResult = await this.followUpService.createFollowUp(conversationId, args.duration, args.unit as FollowUpUnit, args.details);
                     if (followUpResult) {
                        return { 
                            status: 'success', 
                            name: toolName, 
                            message: `Follow-up scheduled for ${args.duration} ${args.unit}(s).`, 
                            data: { followUp: followUpResult } // Return the full follow-up object
                        };
                    } else {
                         return { status: 'error', name: toolName, message: 'Failed to schedule follow-up.' };
                    }

                case 'write_prescription':
                     if (!args.medication_name || !args.dosage || !args.frequency) {
                        return { status: 'error', name: toolName, message: 'Missing required arguments: medication_name, dosage, frequency.' };
                    }
                    const prescriptionResult = await this.prescriptionService.createPrescription(conversationId, args.medication_name, args.dosage, args.frequency, args.details);
                    if (prescriptionResult) {
                        return { 
                            status: 'success', 
                            name: toolName, 
                            message: `Prescription for ${args.medication_name} recorded.`, 
                            data: { prescription: prescriptionResult } // Return the full prescription object
                        };
                    } else {
                        return { status: 'error', name: toolName, message: 'Failed to record prescription.' };
                    }

                // Add cases for request_summary and request_medical_history
                case 'request_summary':
                    // The actual summary generation might be triggered elsewhere or handled by this service
                    // For now, just acknowledge the request
                    this.logger.log(`Command acknowledged: ${toolName}`);
                    // TODO: Potentially trigger ISummaryService.updateSummary(conversationId) here?
                    // Or maybe this command just tells the *frontend* to request the summary via WebSocket?
                    return { status: 'success', name: toolName, message: 'Summary request acknowledged.' }; // No specific data

                case 'request_medical_history':
                    // Similar to summary, this might just be an acknowledgement
                    // The actual fetching might be done via WebSocket based on frontend request
                     this.logger.log(`Command acknowledged: ${toolName}`);
                     // TODO: Fetch history via MedicalHistoryService here?
                     // const history = await this.medicalHistoryService.getHistory(conversationId);
                     // return { status: 'success', name: toolName, message: 'Medical history retrieved.', data: { history: history?.content } };
                    return { status: 'success', name: toolName, message: 'Medical history request acknowledged.' }; // No specific data

                default:
                    this.logger.warn(`Command not found: ${toolName}`);
                    return { status: 'not_found', name: toolName, message: `Command "${toolName}" is not implemented.` };
            }
        } catch (error) {
            this.logger.error(`Error executing command ${toolName} for conversation ${conversationId}:`, error);
            return { 
                status: 'error', 
                name: toolName, 
                message: `An internal error occurred while executing the command: ${error instanceof Error ? error.message : String(error)}` 
            };
        }
    }
} 