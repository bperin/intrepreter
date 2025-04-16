import bcrypt from "bcrypt";
import jwt, { Secret } from "jsonwebtoken";
import dotenv from "dotenv";
import { injectable, inject } from "tsyringe";
import { IAuthService, LoginResult, RefreshResult } from "../../domain/services/IAuthService";
import { IUserRepository } from "../../domain/repositories/IUserRepository";
import { PrismaClient, User } from "../../generated/prisma";
import { randomBytes } from 'crypto';

dotenv.config();

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_DAYS = 7;

@injectable()
export class AuthService implements IAuthService {
    private jwtSecret: Secret;

    constructor(
        @inject("IUserRepository") private userRepository: IUserRepository,
        @inject("PrismaClient") private prisma: PrismaClient
    ) {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error("FATAL ERROR: JWT_SECRET is not defined");
            process.exit(1);
        }
        this.jwtSecret = secret;
    }

    /**
     * Hashes a plain text password.
     */
    async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, SALT_ROUNDS);
    }

    /**
     * Compares a plain text password with a hash.
     */
    async comparePassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    /**
     * Generates a JWT token for a user.
     */
    generateToken(userId: string, username: string): string {
        const payload: object = { id: userId, username: username };
        return jwt.sign(
            payload,
            this.jwtSecret,
            { expiresIn: JWT_EXPIRES_IN }
        );
    }

    /**
     * Verifies a JWT token and returns the decoded payload.
     * Throws an error if the token is invalid or expired.
     */
    async verifyToken(token: string): Promise<any> {
        try {
            return jwt.verify(token, this.jwtSecret);
        } catch (error) {
            console.error("JWT Verification Error:", error);
            return null;
        }
    }

    async login(username: string, passwordInput: string): Promise<LoginResult> {
        const user = await this.userRepository.findByUsername(username);
        if (!user) {
            return { success: false, error: "Invalid username or password." };
        }

        const isPasswordValid = await this.comparePassword(passwordInput, user.hashedPassword);
        if (!isPasswordValid) {
            return { success: false, error: "Invalid username or password." };
        }

        // Generate tokens and user info
        const accessToken = this.generateToken(user.id, user.username);
        const rawRefreshToken = randomBytes(64).toString('hex');

        // Store the *hashed* refresh token and expiry in DB
        const hashedRefreshToken = await bcrypt.hash(rawRefreshToken, 10);
        const refreshTokenExpiry = new Date();
        refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + REFRESH_TOKEN_DAYS);

        try {
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    refreshToken: hashedRefreshToken,
                    refreshTokenExpiresAt: refreshTokenExpiry
                }
            });
        } catch (dbError) {
            console.error("Failed to store refresh token during login:", dbError);
            return { success: false, error: "Login failed during token storage." };
        }

        return {
            success: true,
            token: accessToken,
            refreshToken: rawRefreshToken,
            userId: user.id,
            username: user.username
        };
    }

    async refreshToken(providedToken: string): Promise<RefreshResult> {
        // 1. Find potential users (already checked expiry in AuthService? No, check here)
        const potentialUsers = await this.prisma.user.findMany({
            where: {
                refreshToken: { not: null },
                refreshTokenExpiresAt: { gte: new Date() } 
            }
        });

        let user: User | null = null;
        for (const potentialUser of potentialUsers) {
            if (potentialUser.refreshToken && await bcrypt.compare(providedToken, potentialUser.refreshToken)) {
                user = potentialUser;
                break;
            }
        }

        if (!user) {
            return { success: false, error: "Invalid or expired refresh token." };
        }

        // 2. Generate new tokens
        const newAccessToken = this.generateToken(user.id, user.username);
        const newRawRefreshToken = randomBytes(64).toString('hex');

        // 3. Rotate: Store new hashed refresh token and expiry
        const newHashedRefreshToken = await bcrypt.hash(newRawRefreshToken, 10);
        const newRefreshTokenExpiry = new Date();
        newRefreshTokenExpiry.setDate(newRefreshTokenExpiry.getDate() + REFRESH_TOKEN_DAYS);

        try {
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    refreshToken: newHashedRefreshToken,
                    refreshTokenExpiresAt: newRefreshTokenExpiry
                }
            });
        } catch (dbError) {
            console.error("Failed to store rotated refresh token:", dbError);
            return { success: false, error: "Token refresh failed during storage." };
        }

        return {
            success: true,
            token: newAccessToken,
            refreshToken: newRawRefreshToken
        };
    }
}
