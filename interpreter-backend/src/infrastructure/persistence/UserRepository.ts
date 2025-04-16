import { PrismaClient, User } from "../../generated/prisma/client";
import { IUserRepository } from "../../domain/repositories/IUserRepository";
import prisma from "./prisma"; // Import the singleton instance

export class UserRepository implements IUserRepository {
    async findById(id: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { id },
        });
    }

    async findByUsername(username: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { username },
        });
    }

    async create(data: Pick<User, "username" | "hashedPassword">): Promise<User> {
        return prisma.user.create({
            data,
        });
    }
}
