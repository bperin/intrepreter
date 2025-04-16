import bcrypt from "bcrypt";
import jwt, { Secret } from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config(); // Load .env file to get JWT_SECRET

const SALT_ROUNDS = 10; // Standard salt rounds for bcrypt

export class AuthService {
    private jwtSecret: Secret;

    constructor() {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error("FATAL ERROR: JWT_SECRET is not defined in environment variables.");
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
        const payload = {
            sub: userId, // Standard JWT subject claim
            username: username,
            // Add other claims as needed (e.g., roles, permissions)
        };
        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: "1h", // Token expires in 1 hour (adjust as needed)
            // Consider adding issuer (iss) and audience (aud) for more security
        });
    }

    /**
     * Verifies a JWT token and returns the decoded payload.
     * Throws an error if the token is invalid or expired.
     */
    verifyToken(token: string): Record<string, any> | string {
        // jwt.verify can return string or object
        try {
            return jwt.verify(token, this.jwtSecret);
        } catch (error) {
            console.error("JWT Verification Error:", error);
            throw new Error("Invalid or expired token"); // Re-throw a generic error
        }
    }
}
