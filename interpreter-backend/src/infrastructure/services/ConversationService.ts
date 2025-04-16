import { PrismaClient, Conversation } from "../../generated/prisma";
import { IConversationService, StartSessionInput, StartSessionResult } from "../../domain/services/IConversationService";
import { IPatientRepository } from "../../domain/repositories/IPatientRepository";
import { IConversationRepository } from "../../domain/repositories/IConversationRepository";
import { injectable, inject } from "tsyringe";
import { IOpenAIClient } from "../../domain/clients/IOpenAIClient";

@injectable()
export class ConversationService implements IConversationService {
    constructor(
        @inject("PrismaClient") private prisma: PrismaClient,
        @inject("IPatientRepository") private patientRepository: IPatientRepository,
        @inject("IConversationRepository") private conversationRepository: IConversationRepository,
        @inject("IOpenAIClient") private openAIClient: IOpenAIClient
    ) {}

    async startNewSession(input: StartSessionInput): Promise<StartSessionResult> {
        const { userId, patientFirstName, patientLastName, patientDob, clinicianPreferredLanguage } = input;

        const dobDateOnly = new Date(Date.UTC(patientDob.getFullYear(), patientDob.getMonth(), patientDob.getDate()));

        const patient = await this.patientRepository.findOrCreate(patientFirstName, patientLastName, dobDateOnly);

        console.log("[ConversationService] Creating conversation record without openaiSessionKey.")
        const conversation = await this.conversationRepository.create({
            userId: input.userId,
            patientId: patient.id,
            status: "active",
        });

        console.log(`[ConversationService] Session started, conversation ID: ${conversation.id}`);

        return {
            conversation: conversation,
        };
    }

    // Implement other IConversationService methods here later
}
