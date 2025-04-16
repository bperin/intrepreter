import { injectable, inject } from "tsyringe";
import { IUserRepository } from "../../domain/repositories/IUserRepository";
import { IAuthService, LoginResult, RefreshResult } from "../../domain/services/IAuthService";
import { RegisterUserCommand, RegisterUserResult } from "../commands/RegisterUserCommand";
import { LoginUserCommand } from "../commands/LoginUserCommand";
import * as bcrypt from 'bcrypt';

@injectable()
export class AuthApplicationService {
    constructor(
        @inject("IUserRepository") private userRepository: IUserRepository,
        @inject("IAuthService") private authService: IAuthService
    ) {}

    async registerUser(command: RegisterUserCommand): Promise<RegisterUserResult> {
        console.log(`[AuthService] Attempting to register user: ${command.username}`);
        try {
            console.log(`[AuthService] Checking if user ${command.username} exists...`);
            const existingUser = await this.userRepository.findByUsername(command.username);
            if (existingUser) {
                console.error(`[AuthService] Username ${command.username} already exists.`);
                throw new Error("Username already exists");
            }
            console.log(`[AuthService] User ${command.username} does not exist. Proceeding...`);

            console.log(`[AuthService] Hashing password for user ${command.username}...`);
            const hashedPassword = await bcrypt.hash(command.password, 10);
            console.log(`[AuthService] Password hashed successfully.`);

            const userData = { username: command.username, hashedPassword };
            console.log(`[AuthService] Attempting to create user in repository with data:`, userData);
            const user = await this.userRepository.create(userData);
            console.log(`[AuthService] User created successfully:`, user);
            
            return { success: true, userId: user.id };
        } catch (error: any) {
            console.error(`[AuthService] Error during registration for user ${command.username}:`, error);
            // Re-throw the error so the caller (e.g., the route handler) can handle it
            throw error;
        }
    }

    async loginUser(command: LoginUserCommand): Promise<LoginResult> {
        const user = await this.userRepository.findByUsername(command.username);
        if (!user) {
            return { success: false, error: "Invalid username or password." };
        }

        const isPasswordValid = await this.authService.comparePassword(command.password, user.hashedPassword);
        if (!isPasswordValid) {
            return { success: false, error: "Invalid username or password." };
        }

        return this.authService.login(command.username, command.password);
    }

    async refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
        try {
            // IAuthService.refreshToken returns RefreshResult { success, token?, refreshToken?, error? }
            const serviceResult = await this.authService.refreshToken(refreshToken);
            
            // Simply return the result from the service layer
            return serviceResult; 
            
        } catch (error: any) {
            console.error("Error during token refresh in AppService:", error);
            // Ensure the returned error format matches RefreshResult
            return { success: false, error: error.message || "Token refresh failed" };
        }
    }

    async getUserProfile(userId: string): Promise<{ id: string, username: string } | null> {
        console.log(`[AppService] Fetching profile for user ID: ${userId}`);
        const user = await this.userRepository.findById(userId);
        if (!user) {
            console.warn(`[AppService] User profile not found for ID: ${userId}`);
            return null;
        }
        // Return only necessary, non-sensitive info
        return { id: user.id, username: user.username };
    }
}

// --- Placeholder Command/Result Types (Move to application/commands) ---
// export interface RegisterUserCommand { username: string; password: string; }
// export interface RegisterUserResult { success: boolean; userId?: string; error?: string; }
// export interface LoginUserCommand { username: string; password: string; }
// export interface LoginUserResult { success: boolean; token?: string; error?: string; }
// ----------------------------------------------------------------------
