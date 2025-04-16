import { User } from "../../generated/prisma";

export interface LoginResult {
    success: boolean;
    token?: string;
    refreshToken?: string;
    error?: string;
}

export interface RefreshResult {
    success: boolean;
    token?: string;
    refreshToken?: string;
    error?: string;
}

export interface IAuthService {
    generateToken(user: Pick<User, "id" | "username">): Promise<string>;
    verifyToken(token: string): Promise<Pick<User, "id" | "username"> | null>;
    hashPassword(password: string): Promise<string>;
    comparePassword(password: string, hash: string): Promise<boolean>;
    generateRefreshToken(user: Pick<User, "id">): Promise<string>;
    verifyRefreshToken(token: string): Promise<Pick<User, "id"> | null>;
    login(username: string, password: string): Promise<LoginResult>;
    refreshToken(token: string): Promise<RefreshResult>;
}
