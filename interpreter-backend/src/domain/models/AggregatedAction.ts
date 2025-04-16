import { Note, FollowUp, Prescription } from "../../generated/prisma";

// Union type for the different action models
export type ActionModel = Note | FollowUp | Prescription;

// Define the structure for the aggregated action view
export interface AggregatedAction {
    id: string;
    conversationId: string;
    // Explicitly define the possible types
    type: 'note' | 'followup' | 'prescription'; 
    status: string; // Assuming all models have a status field
    createdAt: Date;
    updatedAt: Date;
    // Use a generic data payload or specific fields based on type
    data: Record<string, any>; // Simple approach: Put model-specific data here
    // Example of more specific data structure (optional):
    // data: {
    //     content?: string; // For Note
    //     duration?: number; // For FollowUp
    //     unit?: string; // For FollowUp
    //     scheduledFor?: Date | null; // For FollowUp
    //     medicationName?: string; // For Prescription
    //     dosage?: string; // For Prescription
    //     frequency?: string; // For Prescription
    //     details?: string | null; // Common optional field
    // };
} 