import { User } from "../../generated/prisma";

export interface LoginResult {
    success: boolean;
    token?: string; // Access Token
    refreshToken?: string; // Raw Refresh Token (storage handled elsewhere)
    userId?: string; 
    username?: string;
    error?: string;
}

export interface RefreshResult {
    success: boolean;
    token?: string; // New Access Token
    refreshToken?: string; // Optional: New Raw Refresh Token (storage handled elsewhere)
    error?: string;
}

export interface IAuthService {
    // login validates credentials and generates tokens/user info
    login(username: string, passwordInput: string): Promise<LoginResult>; 
    // refreshToken validates old token, generates new tokens
    refreshToken(token: string): Promise<RefreshResult>; 
    
    // Core crypto operations
    generateToken(userId: string, username: string): string; // Changed return type to string
    hashPassword(password: string): Promise<string>;
    comparePassword(password: string, hash: string): Promise<boolean>;
    verifyToken(token: string): Promise<any>; // Keep for middleware
    // Removed generateRefreshToken and verifyRefreshToken if handled within login/refreshToken
}
