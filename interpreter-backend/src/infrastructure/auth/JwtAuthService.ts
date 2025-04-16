import { injectable, inject } from "tsyringe";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto"; // For generating refresh tokens
import { User, PrismaClient } from "../../generated/prisma";
import { IAuthService, LoginResult, RefreshResult } from "../../domain/services/IAuthService";

// TODO: Load salt rounds and JWT secret/options from config/env
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-key-replace-me";
const JWT_EXPIRES_IN = "6h"; // Access token expiry
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

@injectable()
export class JwtAuthService implements IAuthService {
    // Inject PrismaClient to update user refresh tokens
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {
        if (JWT_SECRET === "fallback-secret-key-replace-me") {
            console.warn("WARNING: Using fallback JWT secret. Please set JWT_SECRET environment variable.");
        }
    }

    // Corrected signature and implementation to be synchronous and match interface
    generateToken(userId: string, username: string): string {
        // Ensure JWT_SECRET is defined before proceeding
        if (!JWT_SECRET) {
            console.error("CRITICAL: JWT_SECRET is not defined. Check environment variables.");
            throw new Error("JWT secret is missing, cannot generate token.");
        }

        try {
            const token = jwt.sign(
                { id: userId, username: username }, // Use userId and username directly
                JWT_SECRET, // TypeScript knows JWT_SECRET is a string here
                { expiresIn: JWT_EXPIRES_IN } 
            );
            return token;
        } catch (err) {
            // Handle potential errors during signing (e.g., invalid secret)
            console.error("Failed to generate JWT token:", err);
            // Throwing an error here might be appropriate depending on how you want to handle failures
            throw new Error("Access token generation failed"); 
        }
    }

    async verifyToken(token: string): Promise<Pick<User, "id" | "username"> | null> {
        // Ensure JWT_SECRET is defined for verification too
        if (!JWT_SECRET) {
             console.error("CRITICAL: JWT_SECRET is not defined. Cannot verify token.");
             // Return null or throw, depending on desired behavior
             return null; 
        }
        return new Promise((resolve) => {
            jwt.verify(token, JWT_SECRET, (err, decoded) => {
                if (err || !decoded || typeof decoded !== "object" || !decoded.id || !decoded.username) {
                    return resolve(null);
                }
                resolve({ id: decoded.id, username: decoded.username });
            });
        });
    }

    // Generate a secure random string for the refresh token
    async generateRefreshToken(user: Pick<User, "id">): Promise<string> {
        const refreshToken = crypto.randomBytes(64).toString("hex");
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

        // Store the token and its expiry date in the database
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                refreshToken: refreshToken,
                refreshTokenExpiresAt: expiryDate,
            },
        });

        return refreshToken;
    }

    // Verify a refresh token by checking the database
    async verifyRefreshToken(token: string): Promise<Pick<User, "id"> | null> {
        if (!token) {
            return null;
        }

        const user = await this.prisma.user.findUnique({
            where: { refreshToken: token },
            select: { id: true, refreshTokenExpiresAt: true }, // Select only needed fields
        });

        if (!user || !user.refreshTokenExpiresAt) {
            // Token not found
            return null;
        }

        if (new Date() > user.refreshTokenExpiresAt) {
            // Token expired, clear it from DB (optional but good practice)
            await this.prisma.user.update({
                where: { id: user.id },
                data: { refreshToken: null, refreshTokenExpiresAt: null },
            });
            return null;
        }

        return { id: user.id }; // Token is valid
    }

    async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, SALT_ROUNDS);
    }

    async comparePassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    async login(username: string, password: string): Promise<LoginResult> {
        const user = await this.prisma.user.findUnique({ where: { username } });
        if (!user) {
            return { success: false, error: "Invalid username or password." };
        }

        const isPasswordValid = await this.comparePassword(password, user.hashedPassword);
        if (!isPasswordValid) {
            return { success: false, error: "Invalid username or password." };
        }

        // Pass userId and username to the corrected generateToken
        const accessToken = this.generateToken(user.id, user.username);
        const refreshToken = await this.generateRefreshToken(user);

        // Add userId and username to the return object
        return {
            success: true, 
            token: accessToken, 
            refreshToken: refreshToken,
            userId: user.id,         // Add userId
            username: user.username  // Add username
        };
    }

    async refreshToken(token: string): Promise<RefreshResult> {
        const payload = await this.verifyRefreshToken(token);
        if (!payload) {
            return { success: false, error: "Invalid or expired refresh token" };
        }

        const user = await this.prisma.user.findUnique({ where: { id: payload.id } });
        if (!user) {
            return { success: false, error: "User not found for refresh token" };
        }

        // Pass userId and username to the corrected generateToken
        const newAccessToken = this.generateToken(user.id, user.username);

        return { success: true, token: newAccessToken };
    }
}
