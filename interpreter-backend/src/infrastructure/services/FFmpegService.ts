import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export class FFmpegService extends EventEmitter {
    private ffmpegProcess: ChildProcessWithoutNullStreams | null = null;
    private stdinEnded: boolean = false;
    private conversationId: string; // Keep track for logging

    constructor(conversationId: string) {
        super();
        this.conversationId = conversationId;
        console.log(`[FFmpegService][${this.conversationId}] Instance created.`);
    }

    public start(): void {
        if (this.ffmpegProcess) {
            console.warn(`[FFmpegService][${this.conversationId}] Start called, but process already exists.`);
            return;
        }
        console.log(`[FFmpegService][${this.conversationId}] Starting FFmpeg process...`);
        this.stdinEnded = false;

        const ffmpegPath = ffmpegInstaller.path;
        // Input format is assumed to be webm/opus pipe, output is s16le PCM pipe
        const ffmpegArgs = [
            '-i', 'pipe:0',          // Input from stdin
            '-f', 's16le',           // Output format: signed 16-bit little-endian PCM
            '-acodec', 'pcm_s16le',   // Audio codec: PCM signed 16-bit little-endian
            '-ar', '24000',          // Audio sample rate: 24kHz (required by OpenAI Realtime)
            '-ac', '1',              // Audio channels: 1 (mono)
            'pipe:1'                 // Output to stdout
        ];

        try {
            this.ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
            console.log(`[FFmpegService][${this.conversationId}] FFmpeg process spawned with PID: ${this.ffmpegProcess.pid}`);

            this.ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
                // Emit the raw PCM chunk
                this.emit('data', chunk);
            });

            this.ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
                // Log stderr for debugging, but don't treat as fatal error unless needed
                // console.error(`[FFmpegService][${this.conversationId}] FFmpeg stderr: ${chunk.toString()}`);
            });

            this.ffmpegProcess.on('error', (error) => {
                console.error(`[FFmpegService][${this.conversationId}] FFmpeg process error:`, error);
                this.emit('error', error); // Emit error event
                this.stop(); // Ensure cleanup on error
            });

            this.ffmpegProcess.on('close', (code, signal) => {
                console.log(`[FFmpegService][${this.conversationId}] FFmpeg process exited with code ${code}, signal ${signal}. Stdin ended flag: ${this.stdinEnded}`);
                // Emit 'finished' only if stdin was ended gracefully AND exit code is 0
                if (this.stdinEnded && code === 0) {
                    console.log(`[FFmpegService][${this.conversationId}] Emitting 'finished' event.`);
                    this.emit('finished');
                } else if (code !== 0 && code !== null) {
                    console.error(`[FFmpegService][${this.conversationId}] FFmpeg exited unexpectedly (code: ${code}, signal: ${signal}). Emitting error.`);
                     this.emit('error', new Error(`FFmpeg exited unexpectedly with code ${code}`));
                }
                // Ensure process handle is cleared regardless of exit code
                 this.ffmpegProcess = null; 
            });

            this.ffmpegProcess.stdin.on('error', (error: NodeJS.ErrnoException) => {
                console.error(`[FFmpegService][${this.conversationId}] FFmpeg stdin error:`, error);
                this.emit('error', error); // Emit error event
                this.stop(); // Ensure cleanup on stdin error
            });

        } catch (spawnError) {
            console.error(`[FFmpegService][${this.conversationId}] Failed to spawn FFmpeg process:`, spawnError);
            this.ffmpegProcess = null;
            this.emit('error', spawnError); // Emit error event
        }
    }

    public writeChunk(chunk: Buffer): void {
        if (!this.ffmpegProcess || !this.ffmpegProcess.stdin || this.ffmpegProcess.stdin.destroyed) {
            console.warn(`[FFmpegService][${this.conversationId}] Cannot write chunk: FFmpeg stdin not ready.`);
            return;
        }
        try {
            this.ffmpegProcess.stdin.write(chunk, (error) => {
                if (error) {
                    console.error(`[FFmpegService][${this.conversationId}] Error writing chunk to FFmpeg stdin:`, error);
                     // Consider emitting an error event here as well
                     this.emit('error', error);
                }
            });
        } catch (writeError) {
             console.error(`[FFmpegService][${this.conversationId}] Exception writing chunk to FFmpeg stdin:`, writeError);
             this.emit('error', writeError);
        }
    }

    public finalizeInput(): void {
        if (!this.ffmpegProcess || !this.ffmpegProcess.stdin || this.ffmpegProcess.stdin.destroyed) {
            console.warn(`[FFmpegService][${this.conversationId}] Cannot finalize input: FFmpeg stdin not ready.`);
            return;
        }
        if (this.stdinEnded) {
            console.warn(`[FFmpegService][${this.conversationId}] finalizeInput called, but stdin already ended.`);
            return;
        }
        console.log(`[FFmpegService][${this.conversationId}] Finalizing FFmpeg stdin stream.`);
        try {
            this.stdinEnded = true; // Set flag before ending
            this.ffmpegProcess.stdin.end();
        } catch (finalizeError) {
            console.error(`[FFmpegService][${this.conversationId}] Error ending FFmpeg stdin stream:`, finalizeError);
            this.emit('error', finalizeError);
        }
    }

    public stop(): void {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            console.log(`[FFmpegService][${this.conversationId}] Stopping FFmpeg process (PID: ${this.ffmpegProcess.pid})...`);
            // Remove listeners before killing to prevent potential race conditions on close/error
            this.ffmpegProcess.stdout.removeAllListeners();
            this.ffmpegProcess.stderr.removeAllListeners();
            this.ffmpegProcess.removeAllListeners();
            this.ffmpegProcess.stdin.removeAllListeners();
            
            this.ffmpegProcess.kill('SIGTERM'); // Use SIGTERM first
            // Consider adding a timeout and SIGKILL if SIGTERM doesn't work
        }
         // Ensure handle is cleared
        this.ffmpegProcess = null;
        this.stdinEnded = false;
    }

    // Optional helper
    public isReadyForData(): boolean {
        return !!(this.ffmpegProcess && this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed && !this.stdinEnded);
    }
} 