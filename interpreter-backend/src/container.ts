import { container } from "tsyringe";
import { PrismaClient } from "./generated/prisma";

// Import Interfaces (Tokens)
import { IUserRepository } from "./domain/repositories/IUserRepository";
import { IConversationRepository } from "./domain/repositories/IConversationRepository";
import { IPatientRepository } from "./domain/repositories/IPatientRepository";
import { IActionRepository } from "./domain/repositories/IActionRepository";
import { IMessageRepository } from "./domain/repositories/IMessageRepository";
import { IAuthService } from "./domain/services/IAuthService";
import { IConversationService } from "./domain/services/IConversationService";
import { IAudioProcessingService } from "./domain/services/IAudioProcessingService";
import { IOpenAIClient } from "./domain/clients/IOpenAIClient";

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

// --- Configuration ---

// Prisma Client (Singleton)
container.register<PrismaClient>("PrismaClient", { useValue: new PrismaClient() });

// Infrastructure Services (Singletons)
container.register("IAuthService", { useClass: JwtAuthService });
container.register("IConversationService", { useClass: ConversationService });
container.register("IAudioProcessingService", { useClass: AudioProcessingService });
container.register("TranscriptionService", { useClass: TranscriptionService });

// Register the OpenAIClient implementation against the IOpenAIClient interface token
container.register("IOpenAIClient", { useClass: OpenAIClient });

// Repositories (Singletons)
container.register("IUserRepository", { useClass: PrismaUserRepository });
container.register("IConversationRepository", { useClass: PrismaConversationRepository });
container.register("IPatientRepository", { useClass: PrismaPatientRepository });
container.register("IActionRepository", { useClass: PrismaActionRepository });
container.register("IMessageRepository", { useClass: PrismaMessageRepository });

// --- Application Services ---
// Application services using constructor injection with @injectable will be resolved automatically

export { container };
