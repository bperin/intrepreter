import { PrismaClient, User } from "../../generated/prisma";
import { IUserRepository } from "../../domain/repositories/IUserRepository";
import { injectable, inject } from "tsyringe";

@injectable()
export class PrismaUserRepository implements IUserRepository {
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {}

    async findById(id: string): Promise<User | null> {
        return this.prisma.user.findUnique({
            where: { id },
        });
    }

    async findByUsername(username: string): Promise<User | null> {
        return this.prisma.user.findUnique({
            where: { username },
        });
    }

    async create(data: Pick<User, "username" | "hashedPassword">): Promise<User> {
        return this.prisma.user.create({
            data,
        });
    }
}
