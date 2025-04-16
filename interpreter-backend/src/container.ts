import { container } from "tsyringe";
import { PrismaClient } from "../src/generated/prisma";

// Import Interfaces (Tokens)
import { IUserRepository } from "./domain/repositories/IUserRepository";
import { IConversationRepository } from "./domain/repositories/IConversationRepository";
import { IPatientRepository } from "./domain/repositories/IPatientRepository";
import { INoteRepository } from "./domain/repositories/INoteRepository";
import { IFollowUpRepository } from "./domain/repositories/IFollowUpRepository";
import { IPrescriptionRepository } from "./domain/repositories/IPrescriptionRepository";
import { IMessageRepository } from "./domain/repositories/IMessageRepository";
import { IMessageService } from "./domain/services/IMessageService";
import { IAuthService } from "./domain/services/IAuthService";
import { IConversationService } from "./domain/services/IConversationService";
import { IAudioProcessingService } from "./domain/services/IAudioProcessingService";
import { ITextToSpeechService } from "./domain/services/ITextToSpeechService";
import { IOpenAIClient } from "./domain/clients/IOpenAIClient";
import { INoteService } from "./domain/services/INoteService";
import { IFollowUpService } from "./domain/services/IFollowUpService";
import { IPrescriptionService } from "./domain/services/IPrescriptionService";
import { INotificationService } from "./domain/services/INotificationService";
import { IAggregationService } from "./domain/services/IAggregationService";
import { ILanguageDetectionService } from "./domain/services/ILanguageDetectionService";

// Import Implementations
import { PrismaUserRepository } from "./infrastructure/persistence/PrismaUserRepository";
import { PrismaConversationRepository } from "./infrastructure/persistence/PrismaConversationRepository";
import { PrismaPatientRepository } from "./infrastructure/persistence/PrismaPatientRepository";
import { PrismaNoteRepository } from "./infrastructure/persistence/PrismaNoteRepository";
import { PrismaFollowUpRepository } from "./infrastructure/persistence/PrismaFollowUpRepository";
import { PrismaPrescriptionRepository } from "./infrastructure/persistence/PrismaPrescriptionRepository";
import { PrismaMessageRepository } from "./infrastructure/persistence/PrismaMessageRepository";
import { JwtAuthService } from "./infrastructure/auth/JwtAuthService";
import { ConversationService } from "./infrastructure/services/ConversationService";
import { AudioProcessingService } from "./infrastructure/services/AudioProcessingService";
import { OpenAIClient } from "./infrastructure/openai/OpenAIClient";
import { TranscriptionService } from "./infrastructure/services/TranscriptionService";
import { MessageService } from "./infrastructure/services/MessageService";
import { TextToSpeechService } from "./infrastructure/services/TextToSpeechService";
import { NoteService } from "./infrastructure/services/NoteService";
import { FollowUpService } from "./infrastructure/services/FollowUpService";
import { PrescriptionService } from "./infrastructure/services/PrescriptionService";
import { WebSocketNotificationService } from "./infrastructure/services/WebSocketNotificationService";
import { MedicalHistoryService } from "./infrastructure/services/MedicalHistoryService";
import { CommandDetectionService } from "./infrastructure/services/CommandDetectionService";
import { AggregationService } from "./infrastructure/services/AggregationService";
import { CommandExecutionService } from "./infrastructure/services/CommandExecutionService";
import { LanguageDetectionService } from "./infrastructure/services/LanguageDetectionService";

// --- Configuration ---

// First, register PrismaClient as a singleton with string token
container.register("PrismaClient", { useValue: new PrismaClient() });

// Register repositories (usually singletons)
container.registerSingleton("IUserRepository", PrismaUserRepository);
container.registerSingleton("IPatientRepository", PrismaPatientRepository);
container.registerSingleton("IConversationRepository", PrismaConversationRepository);
container.registerSingleton("INoteRepository", PrismaNoteRepository);
container.registerSingleton("IFollowUpRepository", PrismaFollowUpRepository);
container.registerSingleton("IPrescriptionRepository", PrismaPrescriptionRepository);
container.registerSingleton("IMessageRepository", PrismaMessageRepository);

// Register OpenAI client
container.register("IOpenAIClient", { useClass: OpenAIClient });

// Register core services
container.register("IAuthService", { useClass: JwtAuthService });
container.register("IConversationService", { useClass: ConversationService });
container.register("IAudioProcessingService", { useClass: AudioProcessingService });
container.register("IMessageService", { useClass: MessageService });
container.register("ITextToSpeechService", { useClass: TextToSpeechService });
container.register("INoteService", { useClass: NoteService });
container.register("IFollowUpService", { useClass: FollowUpService });
container.register("IPrescriptionService", { useClass: PrescriptionService });
container.register("INotificationService", { useClass: WebSocketNotificationService });
container.register("IAggregationService", { useClass: AggregationService });
container.register<ILanguageDetectionService>('ILanguageDetectionService', { useClass: LanguageDetectionService });

// Register services that might depend on others (ensure correct order or use singleton for automatic resolution)
container.registerSingleton(MedicalHistoryService);
container.registerSingleton(CommandDetectionService);
container.registerSingleton(CommandExecutionService);

// Finally register TranscriptionService (it now depends on Note/FollowUp/Prescription services)
container.registerSingleton(TranscriptionService);

export { container };
