import { container } from "tsyringe";
import { PrismaClient } from "../src/generated/prisma";

// Import Interfaces (Tokens)
import { IUserRepository } from "./domain/repositories/IUserRepository";
import { IConversationRepository } from "./domain/repositories/IConversationRepository";
import { IPatientRepository } from "./domain/repositories/IPatientRepository";
import { IActionRepository } from "./domain/repositories/IActionRepository";
import { IMessageRepository } from "./domain/repositories/IMessageRepository";
import { IMessageService } from "./domain/services/IMessageService";
import { IAuthService } from "./domain/services/IAuthService";
import { IConversationService } from "./domain/services/IConversationService";
import { IAudioProcessingService } from "./domain/services/IAudioProcessingService";
import { ITextToSpeechService } from "./domain/services/ITextToSpeechService";
import { IOpenAIClient } from "./domain/clients/IOpenAIClient";
import { IActionService } from "./domain/services/IActionService";
import { INotificationService } from "./domain/services/INotificationService";

// Import Implementations
import { PrismaUserRepository } from "./infrastructure/persistence/PrismaUserRepository";
import { PrismaConversationRepository } from "./infrastructure/persistence/PrismaConversationRepository";
import { PrismaPatientRepository } from "./infrastructure/persistence/PrismaPatientRepository";
import { PrismaActionRepository } from "./infrastructure/persistence/PrismaActionRepository";
import { PrismaMessageRepository } from "./infrastructure/persistence/PrismaMessageRepository";
import { JwtAuthService } from "./infrastructure/auth/JwtAuthService";
import { ConversationService } from "./infrastructure/services/ConversationService";
import { AudioProcessingService } from "./infrastructure/services/AudioProcessingService";
import { OpenAIClient } from "./infrastructure/openai/OpenAIClient";
import { TranscriptionService } from "./infrastructure/services/TranscriptionService";
import { MessageService } from "./infrastructure/services/MessageService";
import { TextToSpeechService } from "./infrastructure/services/TextToSpeechService";
import { VoiceCommandService } from "./infrastructure/services/VoiceCommandService";
import { ActionService } from "./infrastructure/services/ActionService";
import { WebSocketNotificationService } from "./infrastructure/services/WebSocketNotificationService";
import { MedicalHistoryService } from "./infrastructure/services/MedicalHistoryService";
import { CommandDetectionService } from "./infrastructure/services/CommandDetectionService";

// --- Configuration ---

// First, register PrismaClient as a singleton with string token
container.register("PrismaClient", { useValue: new PrismaClient() });

// Register repositories (usually singletons)
container.registerSingleton("IUserRepository", PrismaUserRepository);
container.registerSingleton("IPatientRepository", PrismaPatientRepository);
container.registerSingleton("IConversationRepository", PrismaConversationRepository);
container.registerSingleton("IActionRepository", PrismaActionRepository);
container.registerSingleton("IMessageRepository", PrismaMessageRepository);

// Register OpenAI client
container.register("IOpenAIClient", { useClass: OpenAIClient });

// Register core services
container.register("IAuthService", { useClass: JwtAuthService });
container.register("IConversationService", { useClass: ConversationService });
container.register("IAudioProcessingService", { useClass: AudioProcessingService });
container.register("IMessageService", { useClass: MessageService });
container.register("ITextToSpeechService", { useClass: TextToSpeechService });
container.register("IActionService", { useClass: ActionService });
container.register("INotificationService", { useClass: WebSocketNotificationService });

// Register services that might depend on others (ensure correct order or use singleton for automatic resolution)
container.registerSingleton(VoiceCommandService);
container.registerSingleton(MedicalHistoryService);
container.registerSingleton(CommandDetectionService);

// Finally register TranscriptionService (it depends on VoiceCommandService)
container.registerSingleton(TranscriptionService);

export { container };
