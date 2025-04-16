# Use the official Node.js 18 image as a parent image
# Using the full image instead of slim to potentially resolve prisma generate issues
FROM node:18 AS builder

# Set the working directory in the container
WORKDIR /app

# Install system dependencies (like openssl for Prisma)
# Keep this even with the full image, as it's explicitly needed by Prisma
RUN apt-get update -y && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install dependencies using npm ci for consistency
# This will also install the 'openai' package if it's in package-lock.json
RUN npm ci

# Copy the Prisma schema
COPY prisma ./prisma/

# Copy the rest of the application code
COPY . .

# Generate Prisma Client (uses schema.prisma's output path)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# --- Runtime Stage ---
# Use a smaller base image for the final runtime stage
FROM node:18-slim AS runtime

WORKDIR /app

# Install runtime system dependencies (like openssl)
RUN apt-get update -y && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Copy only necessary files from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# IMPORTANT: Copy the generated Prisma client files
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Copy the Prisma schema file itself (needed for runtime migrations/queries? Check Prisma docs)
COPY --from=builder /app/prisma ./prisma

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run the app
CMD ["node", "dist/index.js"] 