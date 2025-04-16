#!/bin/bash

# Deploys both backend and frontend to Google Cloud Run.
# Requires gcloud, Docker, and necessary permissions/APIs enabled.
# Replace placeholder values below before running.

set -e # Exit immediately if a command exits with a non-zero status.
# set -u # Temporarily disable strict unset variable checking for optional vars

echo "--- Deployment Script Started ---"

# --- Configuration (Hardcoded - REPLACE PLACEHOLDERS) ---
PROJECT_ID="brian-test-454620" # e.g., my-gcp-project
REGION="us-central1"       # e.g., us-central1
REPO="interpreter-app" # e.g., my-app-repo

# !! SECURITY WARNING: Hardcoding secrets is insecure. Use Secret Manager for production. !!
DATABASE_URL="postgresql://db_user:C8D7gsHJiv5LXBL35kHsrQ==@34.46.226.55:5432/interpreter_db?schema=public"   # e.g., postgresql://user:pass@ip:port/db?schema=public
JWT_SECRET="k9+a+sPm9aw8BkdyMabTODJ3MVawLaIsvqQ98ZuSSZI="
OPENAI_API_KEY="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"
JWT_ISSUER="interpreter-backend-issuer"

# --- Optional Configuration --- (Uses defaults if not set externally)
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-interpreter-backend-service}"
FRONTEND_SERVICE_NAME="${FRONTEND_SERVICE_NAME:-interpreter-frontend-service}"
BACKEND_IMAGE_NAME="${BACKEND_IMAGE_NAME:-interpreter-backend}"
FRONTEND_IMAGE_NAME="${FRONTEND_IMAGE_NAME:-interpreter-frontend}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# --- Derived Variables ---
ARTIFACT_REGISTRY_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
BACKEND_IMAGE_URI="${ARTIFACT_REGISTRY_BASE}/${BACKEND_IMAGE_NAME}:${IMAGE_TAG}"
FRONTEND_IMAGE_URI="${ARTIFACT_REGISTRY_BASE}/${FRONTEND_IMAGE_NAME}:${IMAGE_TAG}"

# --- Prerequisites Check ---
echo "Checking prerequisites..."
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud command not found. Please install Google Cloud SDK."
    exit 1
fi
if ! command -v docker &> /dev/null; then
    echo "Error: docker command not found. Please install Docker."
    exit 1
fi
echo "Verifying gcloud authentication..."
gcloud auth list
echo "Verifying gcloud project (should match hardcoded value)..."
gcloud config set project "$PROJECT_ID" # Ensure gcloud context matches
gcloud config list project
echo "Ensure Docker is configured for Artifact Registry:"
echo " -> Run: gcloud auth configure-docker ${REGION}-docker.pkg.dev"
echo "Ensure APIs are enabled: Cloud Run, Artifact Registry, Cloud Build, Secret Manager"
echo "-------------------------------------"
read -p "Prerequisites seem okay? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Deployment aborted by user."
    exit 1
fi
echo "-------------------------------------"

# --- Build Backend ---
echo "[Backend] Building Docker image for linux/amd64..."
docker build --platform linux/amd64 -t "${BACKEND_IMAGE_URI}" ./interpreter-backend
echo "[Backend] Build complete."

# --- Push Backend ---
echo "[Backend] Pushing image to Artifact Registry..."
docker push "${BACKEND_IMAGE_URI}"
echo "[Backend] Push complete."

# --- Deploy Backend ---
echo "[Backend] Deploying to Cloud Run service: ${BACKEND_SERVICE_NAME}..."
# Note: Passing secrets directly as env vars is insecure. Use Secret Manager for production.
# Using --command and --args to override entrypoint and run prisma commands + start
gcloud run deploy "${BACKEND_SERVICE_NAME}" \
  --image "${BACKEND_IMAGE_URI}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=2 \
  --port=8080 \
  --set-env-vars="DATABASE_URL=${DATABASE_URL},JWT_SECRET=${JWT_SECRET},JWT_ISSUER=${JWT_ISSUER},OPENAI_API_KEY=${OPENAI_API_KEY}" \
  --command=sh \
  --args="-c,npx prisma generate && npx prisma db push --accept-data-loss && node dist/index.js" \
  --quiet # Suppress verbose output, show URL at the end

# --- Get Backend URL ---
echo "[Backend] Fetching deployed service URL..."
BACKEND_URL=$(gcloud run services describe "${BACKEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')
if [[ -z "$BACKEND_URL" ]]; then
    echo "Error: Failed to get deployed backend URL for service ${BACKEND_SERVICE_NAME}."
    exit 1
fi
echo "[Backend] Deployed URL: ${BACKEND_URL}"

# --- Build Frontend ---
echo "[Frontend] Building Docker image for linux/amd64 with backend URL: ${BACKEND_URL}..."
# Use the HTTPS backend URL directly for the build argument
FRONTEND_BACKEND_ARG_URL="${BACKEND_URL}" 
echo "[Frontend] Using build argument VITE_APP_BACKEND_URL=${FRONTEND_BACKEND_ARG_URL}"
docker build \
  --platform linux/amd64 \
  --build-arg VITE_APP_BACKEND_URL="${FRONTEND_BACKEND_ARG_URL}" \
  -t "${FRONTEND_IMAGE_URI}" \
  ./interpreter-frontend
echo "[Frontend] Build complete."

# --- Push Frontend ---
echo "[Frontend] Pushing image to Artifact Registry..."
docker push "${FRONTEND_IMAGE_URI}"
echo "[Frontend] Push complete."

# --- Deploy Frontend ---
echo "[Frontend] Deploying to Cloud Run service: ${FRONTEND_SERVICE_NAME}..."
gcloud run deploy "${FRONTEND_SERVICE_NAME}" \
  --image "${FRONTEND_IMAGE_URI}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --port=80 # Nginx default port
  # No env vars needed usually for simple Nginx static hosting

echo "[Frontend] Deployment submitted."

# --- Final URLs ---
echo "--- Deployment Summary ---"
echo "Backend Service (${BACKEND_SERVICE_NAME}) URL: $(gcloud run services describe "${BACKEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')"
echo "Frontend Service (${FRONTEND_SERVICE_NAME}) URL: $(gcloud run services describe "${FRONTEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')"
echo "---------------------------"
echo "Deployment script finished." 