# Stage 1: Build the React application
FROM node:18-alpine AS builder

# Declare build argument
ARG VITE_APP_BACKEND_URL

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
# Use npm ci for clean installs in CI/build environments
RUN npm ci 

# Copy the rest of the application code
COPY . .

# Also copy nginx config to builder stage
COPY nginx.conf /app/nginx.conf

# Make the build arg available as an env var for the build step
ENV VITE_APP_BACKEND_URL=$VITE_APP_BACKEND_URL

# Build the application using Vite
# Pass build-time env vars here if needed, e.g.:
# ARG VITE_BACKEND_WS_HOST
# ENV VITE_BACKEND_WS_HOST=$VITE_BACKEND_WS_HOST
RUN npm run build

# Stage 2: Serve the static files with Nginx
FROM nginx:stable-alpine

# Copy built assets from the builder stage to Nginx html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration from the builder stage
COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 for Nginx
EXPOSE 80

# Nginx image already has a CMD to start the server
# CMD ["nginx", "-g", "daemon off;"] 