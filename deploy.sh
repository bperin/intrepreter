#!/bin/bash

# Generic deployment script for Google Cloud Run.
# EXPECTS secrets (DATABASE_URL, JWT_SECRET, OPENAI_API_KEY) to be set as ENVIRONMENT VARIABLES.
# Does NOT load secrets from a file.

set -e # Exit immediately if a command exits with a non-zero status.

echo "--- Generic Deployment Script Started ---"

# --- Verify Required Environment Variables --- 
if [[ -z "$DATABASE_URL" || -z "$JWT_SECRET" || -z "$OPENAI_API_KEY" || -z "$PROJECT_ID" || -z "$REGION" || -z "$REPO" ]]; then
    echo "Error: One or more required environment variables are missing."
    echo "Required: PROJECT_ID, REGION, REPO, DATABASE_URL, JWT_SECRET, OPENAI_API_KEY"
    exit 1
fi

# --- Optional Configuration --- (Uses defaults if not set externally)
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-interpreter-backend-service}"
FRONTEND_SERVICE_NAME="${FRONTEND_SERVICE_NAME:-interpreter-frontend-service}"
BACKEND_IMAGE_NAME="${BACKEND_IMAGE_NAME:-interpreter-backend}"
FRONTEND_IMAGE_NAME="${FRONTEND_IMAGE_NAME:-interpreter-frontend}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
JWT_ISSUER="${JWT_ISSUER:-interpreter-backend-issuer}"

# --- Derived Variables ---
ARTIFACT_REGISTRY_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
BACKEND_IMAGE_URI="${ARTIFACT_REGISTRY_BASE}/${BACKEND_IMAGE_NAME}:${IMAGE_TAG}"
FRONTEND_IMAGE_URI="${ARTIFACT_REGISTRY_BASE}/${FRONTEND_IMAGE_NAME}:${IMAGE_TAG}"

# --- Prerequisites Check --- 
echo "Checking prerequisites (gcloud, docker)..."
# Add checks if needed, omitted for brevity in generic script

echo "Ensure Docker is configured for Artifact Registry: gcloud auth configure-docker ${REGION}-docker.pkg.dev"
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
# Secrets are passed via environment variables set *before* running this script.
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
  --quiet

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
  --port=80 \
  --quiet

echo "[Frontend] Deployment submitted."

# --- Final URLs --- 
echo "--- Deployment Summary ---"
echo "Backend Service (${BACKEND_SERVICE_NAME}) URL: $(gcloud run services describe "${BACKEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')"
echo "Frontend Service (${FRONTEND_SERVICE_NAME}) URL: $(gcloud run services describe "${FRONTEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')"
echo "---------------------------"
echo "Generic deployment script finished." 