// Mirroring the backend AggregatedAction structure

// Define the possible specific data structures within the 'data' field
export interface NoteData {
    content: string;
}

export interface FollowUpData {
    duration: number;
    unit: string; // Keep as string, validation happens backend
    scheduledFor?: string | null; // Use string for ISO date format from JSON
    details?: string | null;
}

export interface PrescriptionData {
    medicationName: string;
    dosage: string;
    frequency: string;
    details?: string | null;
}

// Define the main AggregatedAction interface
export interface AggregatedAction {
    id: string;
    conversationId: string;
    type: 'note' | 'followup' | 'prescription'; 
    status: string; 
    createdAt: string; // Use string for ISO date format from JSON
    updatedAt: string; // Use string for ISO date format from JSON
    // Use a more specific union type for data based on 'type'
    data: NoteData | FollowUpData | PrescriptionData;
} 