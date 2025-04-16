import { Request, Response, NextFunction, RequestHandler } from "express";
import { container } from "../../container"; // Correct path from infrastructure/auth
import { IAuthService } from "../../domain/services/IAuthService"; // Correct path from infrastructure/auth

// Extend Express Request type to include user payload
declare global {
    namespace Express {
        interface Request {
            user?: { id: string; username: string }; // Add user property
        }
    }
}

// Corrected Middleware Logic with explicit type
export const authMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!token) {
        // Send response then explicitly return void
        res.status(401).json({ message: "Unauthorized: No token provided" }); 
        return; 
    }

    try {
        const authService = container.resolve<IAuthService>("IAuthService");
        const payload = await authService.verifyToken(token);

        if (!payload || typeof payload.id !== 'string' || typeof payload.username !== 'string') {
             // Send response then explicitly return void
            res.status(401).json({ message: "Unauthorized: Invalid token payload" });
            return; 
        }

        // Attach user payload to the request object
        req.user = { id: payload.id, username: payload.username };
        
        // ONLY call next() on successful authentication
        next(); 

    } catch (error) {
        console.error("Auth Middleware Verification Error:", error);
        // Send response then explicitly return void
        res.status(401).json({ message: "Unauthorized: Token verification failed" });
        return; 
    }
};
