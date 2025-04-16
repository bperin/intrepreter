// Input data for registering a user
export interface RegisterUserCommand {
    username: string;
    password: string;
}

// Result of the registration process
export interface RegisterUserResult {
    success: boolean;
    userId?: string; // User ID if successful
    error?: string; // Error message if failed
}
