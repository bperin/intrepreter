import { Conversation, Prisma, User, Patient, Message, Action, Summary, MedicalHistory } from "../../generated/prisma";

// Define a type that includes the relations we commonly need
export type ConversationWithRelations = Conversation & {
    user: { username: string }; // Example: Assuming we only need username from user
    patient: Patient;
    messages: Message[];
    actions: Action[];
    summary: Summary | null; // <-- Include Summary relation (nullable)
    medicalHistory: MedicalHistory | null; // <-- Include MedicalHistory relation (nullable)
};

export interface IConversationRepository {
    /**
     * Finds a conversation by its unique ID, including related entities.
     * @param id - The unique ID of the conversation.
     * @returns A Promise resolving to the Conversation with its relations, or null if not found.
     */
    findById(id: string): Promise<ConversationWithRelations | null>;

    /**
     * Finds all conversations associated with a specific user ID, including patient details.
     * @param userId - The ID of the user.
     * @returns A Promise resolving to an array of Conversation objects, each including the related Patient.
     */
    findByUserId(userId: string): Promise<(Conversation & { patient: Patient })[]>;

    /**
     * Finds all messages associated with a specific conversation ID.
     * @param conversationId - The ID of the conversation.
     * @returns A Promise resolving to an array of Message objects, ordered by timestamp.
     */
    findMessagesByConversationId(conversationId: string): Promise<Message[]>;

    /**
     * Creates a new conversation record.
     * @param data - The data for the new conversation, including userId and patientId.
     * @returns A Promise resolving to the newly created Conversation object.
     */
    create(data: Prisma.ConversationUncheckedCreateInput): Promise<Conversation>;

    /**
     * Updates an existing conversation record.
     * @param id - The ID of the conversation to update.
     * @param data - The data to update the conversation with.
     * @returns A Promise resolving to the updated Conversation object.
     */
    update(id: string, data: Prisma.ConversationUpdateInput): Promise<Conversation>;
}
