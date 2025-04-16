// Basic Logger Utility

export class Logger {
    private context: string;

    constructor(context: string) {
        this.context = context;
    }

    private getTimestamp(): string {
        return new Date().toISOString();
    }

    log(...args: any[]): void {
        console.log(`[${this.getTimestamp()}] [${this.context}] [INFO]`, ...args);
    }

    warn(...args: any[]): void {
        console.warn(`[${this.getTimestamp()}] [${this.context}] [WARN]`, ...args);
    }

    error(...args: any[]): void {
        console.error(`[${this.getTimestamp()}] [${this.context}] [ERROR]`, ...args);
    }

    debug(...args: any[]): void {
        // Optionally add more complex debug level checking
        if (process.env.NODE_ENV === 'development') {
            console.debug(`[${this.getTimestamp()}] [${this.context}] [DEBUG]`, ...args);
        }
    }
}

// Factory function for convenience
export function createLogger(context: string): Logger {
    return new Logger(context);
} 