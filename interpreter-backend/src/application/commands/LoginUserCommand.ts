// Input data for logging in a user
export interface LoginUserCommand {
    username: string;
    password: string;
}

// Result type is now defined in IAuthService.ts
// export interface LoginUserResult {
//     success: boolean;
//     token?: string; // JWT token if successful
//     refreshToken?: string; // Optional refresh token
//     error?: string; // Error message if failed
// }
