import { injectable, inject } from "tsyringe";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto"; // For generating refresh tokens
import { User, PrismaClient } from "../../generated/prisma";
import { IAuthService, LoginResult, RefreshResult } from "../../domain/services/IAuthService";

// TODO: Load salt rounds and JWT secret/options from config/env
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-key-replace-me";
const JWT_EXPIRES_IN = "1h"; // Access token expiry
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

@injectable()
export class JwtAuthService implements IAuthService {
    // Inject PrismaClient to update user refresh tokens
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {
        if (JWT_SECRET === "fallback-secret-key-replace-me") {
            console.warn("WARNING: Using fallback JWT secret. Please set JWT_SECRET environment variable.");
        }
    }

    async generateToken(user: Pick<User, "id" | "username">): Promise<string> {
        return new Promise((resolve, reject) => {
            jwt.sign(
                { id: user.id, username: user.username },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN },
                (err, token) => {
                    if (err || !token) {
                        return reject(err || new Error("Access token generation failed"));
                    }
                    resolve(token);
                }
            );
        });
    }

    async verifyToken(token: string): Promise<Pick<User, "id" | "username"> | null> {
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

        const accessToken = await this.generateToken(user);
        const refreshToken = await this.generateRefreshToken(user);

        return { success: true, token: accessToken, refreshToken: refreshToken };
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

        const newAccessToken = await this.generateToken(user);

        return { success: true, token: newAccessToken };
    }
}
