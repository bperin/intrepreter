# Stage 1: Builder
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy prisma schema first for caching
COPY prisma ./prisma/

# Copy the rest of the application code
COPY . .

# Generate Prisma Client (uses schema.prisma's output path)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Optional: Prune dev dependencies (if needed, often handled by multi-stage)
# RUN npm prune --production

# Stage 2: Runner
FROM node:18-alpine

WORKDIR /app

# Copy necessary files from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma # Copy generated client
COPY package*.json ./

# Expose the application port (ensure it matches .env or default)
EXPOSE 8080

# Command to run the application
CMD ["node", "dist/index.js"] 