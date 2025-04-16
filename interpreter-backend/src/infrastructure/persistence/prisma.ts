import { PrismaClient } from "../../generated/prisma/client";

// Instantiate Prisma Client
const prisma = new PrismaClient();

// Optional: Graceful shutdown
process.on("beforeExit", async () => {
    await prisma.$disconnect();
});

export default prisma;
