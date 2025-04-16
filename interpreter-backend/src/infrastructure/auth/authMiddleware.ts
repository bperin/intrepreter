import { Request, Response, NextFunction } from "express";
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

// Modified to use a non-async wrapper with an IIFE inside
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Execute async work in an IIFE to avoid returning a Promise from the middleware
    (async () => {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

        if (!token) {
            res.status(401).json({ message: "Unauthorized: No token provided" });
            return; // Exit the async function, not the middleware
        }

        try {
            const authService = container.resolve<IAuthService>("IAuthService");
            const payload = await authService.verifyToken(token);

            if (!payload) {
                res.status(401).json({ message: "Unauthorized: Invalid or expired token" });
                return; // Exit the async function
            }

            // Attach user payload to the request object
            req.user = payload;
            next(); // Proceed to the next middleware or route handler
        } catch (error) {
            console.error("Auth Middleware Error:", error);
            // Don't send error details potentially, just unauthorized
            res.status(401).json({ message: "Unauthorized" });
        }
    })();
    // The middleware function itself returns undefined (void)
};
