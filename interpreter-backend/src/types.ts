export const TYPES = {
  // Repositories
  ConversationRepository: Symbol.for('ConversationRepository'),
  UserRepository: Symbol.for('UserRepository'),
  PatientRepository: Symbol.for('PatientRepository'),

  // Services
  AuthService: Symbol.for('AuthService'),
  ConversationService: Symbol.for('ConversationService'),
  OpenAIService: Symbol.for('OpenAIService'),
  TranslationService: Symbol.for('TranslationService'),
  TranscriptionService: Symbol.for('TranscriptionService'), // Add this for our new service
}; 