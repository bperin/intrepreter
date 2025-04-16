import { User } from "../../generated/prisma";

export interface IUserRepository {
    findById(id: string): Promise<User | null>;
    findByUsername(username: string): Promise<User | null>;
    create(data: Pick<User, "username" | "hashedPassword">): Promise<User>;
    // Add other methods as needed (e.g., update, delete)
}
