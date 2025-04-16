import { PrismaClient, User, Conversation, Participant, Utterance } from "../../src/generated/prisma";

// Explicitly configure Prisma Client for testing
const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL, // Read from env vars set by test script
});

describe("Persistence Layer Integration Tests", () => {
    let testUser: User;
    let testConversation: Conversation;
    let clinicianParticipant: Participant;
    let patientParticipant: Participant;

    // Setup: Ensure clean database state and create initial user before tests run
    beforeAll(async () => {
        // It's often better to run migrations outside the test suite (e.g., via npm script)
        // But ensure the client is connected
        await prisma.$connect();

        // Clean up potential leftovers (optional, as migrate reset should handle this)
        await prisma.utterance.deleteMany();
        await prisma.participant.deleteMany();
        await prisma.action.deleteMany();
        await prisma.summary.deleteMany();
        await prisma.conversation.deleteMany();
        await prisma.user.deleteMany();

        // Create a test user
        testUser = await prisma.user.create({
            data: {
                username: "testuser@example.com",
                hashedPassword: "hashedpassword123",
            },
        });
    });

    // Teardown: Disconnect Prisma client after all tests
    afterAll(async () => {
        // Clean up test data
        await prisma.utterance.deleteMany();
        await prisma.participant.deleteMany();
        await prisma.action.deleteMany();
        await prisma.summary.deleteMany();
        await prisma.conversation.deleteMany();
        await prisma.user.deleteMany();

        await prisma.$disconnect();
    });

    it("should create a conversation linked to a user", async () => {
        testConversation = await prisma.conversation.create({
            data: {
                userId: testUser.id,
                status: "active",
                language1: "en",
                language2: "es",
            },
        });

        expect(testConversation).toBeDefined();
        expect(testConversation.userId).toBe(testUser.id);
        expect(testConversation.status).toBe("active");
        expect(testConversation.language1).toBe("en");

        // Verify relation from user side
        const userWithConversations = await prisma.user.findUnique({
            where: { id: testUser.id },
            include: { conversations: true },
        });
        expect(userWithConversations?.conversations).toHaveLength(1);
        expect(userWithConversations?.conversations[0].id).toBe(testConversation.id);
    });

    it("should create participants linked to the conversation", async () => {
        expect(testConversation).toBeDefined(); // Ensure conversation was created in previous test

        clinicianParticipant = await prisma.participant.create({
            data: {
                conversationId: testConversation.id,
                type: "clinician",
                preferredLanguage: "en",
            },
        });

        patientParticipant = await prisma.participant.create({
            data: {
                conversationId: testConversation.id,
                type: "patient",
                preferredLanguage: "es",
            },
        });

        expect(clinicianParticipant).toBeDefined();
        expect(clinicianParticipant.conversationId).toBe(testConversation.id);
        expect(clinicianParticipant.type).toBe("clinician");

        expect(patientParticipant).toBeDefined();
        expect(patientParticipant.conversationId).toBe(testConversation.id);
        expect(patientParticipant.type).toBe("patient");

        // Verify relation from conversation side
        const conversationWithParticipants = await prisma.conversation.findUnique({
            where: { id: testConversation.id },
            include: { participants: true },
        });
        expect(conversationWithParticipants?.participants).toHaveLength(2);
        // Check if both participant IDs are present (order might vary)
        expect(conversationWithParticipants?.participants.map((p) => p.id).sort()).toEqual([clinicianParticipant.id, patientParticipant.id].sort());
    });

    it("should create utterances linked to participants and conversation", async () => {
        expect(testConversation).toBeDefined();
        expect(clinicianParticipant).toBeDefined();
        expect(patientParticipant).toBeDefined();

        const utterance1: Utterance = await prisma.utterance.create({
            data: {
                conversationId: testConversation.id,
                participantId: clinicianParticipant.id,
                originalLanguage: "en",
                originalText: "Hello, how are you?",
                translatedLanguage: "es",
                translatedText: "Hola, como estas?",
            },
        });

        const utterance2: Utterance = await prisma.utterance.create({
            data: {
                conversationId: testConversation.id,
                participantId: patientParticipant.id,
                originalLanguage: "es",
                originalText: "Estoy bien, gracias.",
                translatedLanguage: "en",
                translatedText: "I am fine, thank you.",
            },
        });

        expect(utterance1).toBeDefined();
        expect(utterance1.conversationId).toBe(testConversation.id);
        expect(utterance1.participantId).toBe(clinicianParticipant.id);
        expect(utterance1.originalText).toBe("Hello, how are you?");

        expect(utterance2).toBeDefined();
        expect(utterance2.participantId).toBe(patientParticipant.id);
        expect(utterance2.originalText).toBe("Estoy bien, gracias.");

        // Verify relation from conversation side
        const conversationWithUtterances = await prisma.conversation.findUnique({
            where: { id: testConversation.id },
            include: { utterances: true },
        });
        expect(conversationWithUtterances?.utterances).toHaveLength(2);
        expect(conversationWithUtterances?.utterances.map((u) => u.id).sort()).toEqual([utterance1.id, utterance2.id].sort());

        // Verify relation from participant side
        const clinicianWithUtterances = await prisma.participant.findUnique({
            where: { id: clinicianParticipant.id },
            include: { utterances: true },
        });
        expect(clinicianWithUtterances?.utterances).toHaveLength(1);
        expect(clinicianWithUtterances?.utterances[0].id).toBe(utterance1.id);
    });

    it("should fetch conversation with all relations", async () => {
        const fetchedConversation = await prisma.conversation.findUnique({
            where: { id: testConversation.id },
            include: {
                user: true,
                participants: true,
                utterances: {
                    orderBy: { createdAt: "asc" }, // Ensure consistent order for checks
                    include: { participant: true }, // Include participant details in utterances
                },
                // actions: true, // Add later when testing actions
                // summary: true, // Add later when testing summary
            },
        });

        expect(fetchedConversation).toBeDefined();
        expect(fetchedConversation?.user?.id).toBe(testUser.id);
        expect(fetchedConversation?.participants).toHaveLength(2);
        expect(fetchedConversation?.utterances).toHaveLength(2);

        // Check details of nested relations
        expect(fetchedConversation?.utterances[0]?.participant?.id).toBe(clinicianParticipant.id);
        expect(fetchedConversation?.utterances[1]?.participant?.id).toBe(patientParticipant.id);
        expect(fetchedConversation?.participants?.find((p) => p.type === "clinician")?.id).toBe(clinicianParticipant.id);
    });
});
