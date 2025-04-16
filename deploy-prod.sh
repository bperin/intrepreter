#!/bin/bash

# PRODUCTION deployment script for Google Cloud Run.
# Loads secrets from deploy.secrets.env
# Requires gcloud, Docker, and necessary permissions/APIs enabled.

set -e # Exit immediately if a command exits with a non-zero status.

echo "--- PRODUCTION Deployment Script Started ---"

# --- Load Secrets --- 
SECRETS_FILE="./deploy.secrets.env"
if [[ -f "$SECRETS_FILE" ]]; then
    echo "Loading secrets from $SECRETS_FILE..."
    source "$SECRETS_FILE"
else
    echo "Error: Secrets file not found at $SECRETS_FILE! Create it with DATABASE_URL, JWT_SECRET, OPENAI_API_KEY."
    exit 1
fi

# --- Verify Secrets Loaded --- 
if [[ -z "$DATABASE_URL" || -z "$JWT_SECRET" || -z "$OPENAI_API_KEY" ]]; then
    echo "Error: One or more required secrets (DATABASE_URL, JWT_SECRET, OPENAI_API_KEY) not found in $SECRETS_FILE or environment."
    exit 1
fi

# --- Configuration (Project Specific - Non-Secret) --- 
PROJECT_ID="${PROJECT_ID:-brian-test-454620}" # Allow override via env var, default otherwise
REGION="${REGION:-us-central1}"
REPO="${REPO:-interpreter-app}"
JWT_ISSUER="${JWT_ISSUER:-interpreter-backend-issuer}"

# --- Optional Configuration --- (Uses defaults if not set externally)
BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-interpreter-backend-service}"
FRONTEND_SERVICE_NAME="${FRONTEND_SERVICE_NAME:-interpreter-frontend-service}"
BACKEND_IMAGE_NAME="${BACKEND_IMAGE_NAME:-interpreter-backend}"
FRONTEND_IMAGE_NAME="${FRONTEND_IMAGE_NAME:-interpreter-frontend}"

# --- Generate Unique Tag --- 
TIMESTAMP=$(date +%Y%m%d%H%M%S)
IMAGE_TAG="prod-${TIMESTAMP}"
echo "Generated unique image tag: ${IMAGE_TAG}"

# --- Derived Variables --- 
ARTIFACT_REGISTRY_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
BACKEND_IMAGE_URI="${ARTIFACT_REGISTRY_BASE}/${BACKEND_IMAGE_NAME}:${IMAGE_TAG}" # Use unique tag
FRONTEND_IMAGE_URI="${ARTIFACT_REGISTRY_BASE}/${FRONTEND_IMAGE_NAME}:${IMAGE_TAG}" # Use unique tag

# --- Artifact Registry Config (Keep specific variables if needed elsewhere) ---
GCP_PROJECT_ID="brian-test-454620"
ARTIFACT_REGISTRY_HOST="us-central1-docker.pkg.dev"
REPO_NAME="interpreter-app"

# --- Use Derived Variables for Image URIs ---
IMAGE_REPO_BACKEND="${BACKEND_IMAGE_URI}" # Use variable derived with unique tag
IMAGE_REPO_FRONTEND="${FRONTEND_IMAGE_URI}" # Use variable derived with unique tag

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
echo "Verifying gcloud project..."
gcloud config set project "$PROJECT_ID"
gcloud config list project
echo "Ensure Docker is configured for Artifact Registry: gcloud auth configure-docker ${REGION}-docker.pkg.dev"
echo "Ensure APIs are enabled: Cloud Run, Artifact Registry, Cloud Build, Secret Manager"
echo "-------------------------------------"

# --- Build Backend --- 
echo "[Backend] Building Docker image (${IMAGE_TAG}) for linux/amd64..."
docker buildx build --platform linux/amd64 -t "${IMAGE_REPO_BACKEND}" ./interpreter-backend # Build and tag with unique tag
echo "[Backend] Build complete."

# --- Push Backend --- 
echo "[Backend] Pushing image (${IMAGE_TAG}) to Artifact Registry..."
docker push "${IMAGE_REPO_BACKEND}"
echo "[Backend] Push complete."

# --- Deploy Backend --- 
echo "[Backend] Deploying image (${IMAGE_TAG}) to Cloud Run service: $BACKEND_SERVICE_NAME..."
gcloud run deploy "$BACKEND_SERVICE_NAME" \
    --image "${IMAGE_REPO_BACKEND}" \
    --platform managed \
    --region "$REGION" \
    --allow-unauthenticated \
    --project "$GCP_PROJECT_ID" \
    --set-env-vars="DATABASE_URL=$DATABASE_URL,JWT_SECRET=$JWT_SECRET,OPENAI_API_KEY=$OPENAI_API_KEY" \
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
echo "[Frontend] Building Docker image (${IMAGE_TAG}) for linux/amd64 with backend URL: ${BACKEND_URL}..."
FRONTEND_BACKEND_ARG_URL="${BACKEND_URL}" 
echo "[Frontend] Using build argument VITE_APP_BACKEND_URL=${FRONTEND_BACKEND_ARG_URL}" # Restore VITE_APP_ prefix
docker build \
  --platform linux/amd64 \
  --build-arg VITE_APP_BACKEND_URL="${FRONTEND_BACKEND_ARG_URL}" \
  -t "${IMAGE_REPO_FRONTEND}" \
  ./interpreter-frontend
echo "[Frontend] Build complete."

# --- Push Frontend --- 
echo "[Frontend] Pushing image (${IMAGE_TAG}) to Artifact Registry..."
docker push "${IMAGE_REPO_FRONTEND}"
echo "[Frontend] Push complete."

# --- Deploy Frontend --- 
echo "[Frontend] Deploying image (${IMAGE_TAG}) to Cloud Run service: $FRONTEND_SERVICE_NAME..."
gcloud run deploy "$FRONTEND_SERVICE_NAME" \
    --image "${IMAGE_REPO_FRONTEND}" \
    --platform managed \
    --region "$REGION" \
    --allow-unauthenticated \
    --project "$GCP_PROJECT_ID" \
    --set-env-vars="VITE_APP_BACKEND_URL=$BACKEND_URL" \
    --quiet

echo "[Frontend] Deployment submitted."

# --- Get Frontend URL --- 
echo "[Frontend] Fetching deployed service URL..."
FRONTEND_URL=$(gcloud run services describe "${FRONTEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')
if [[ -z "$FRONTEND_URL" ]]; then
    echo "Error: Failed to get deployed frontend URL for service ${FRONTEND_SERVICE_NAME}."
    exit 1
fi
echo "[Frontend] Deployed URL: ${FRONTEND_URL}"

# --- Redeploy Backend with FRONTEND_URL injected --- 
echo "[Backend] Redeploying image (${IMAGE_TAG}) to inject FRONTEND_URL into backend..."
gcloud run deploy "$BACKEND_SERVICE_NAME" \
    --image "${IMAGE_REPO_BACKEND}" \
    --platform managed \
    --region "$REGION" \
    --allow-unauthenticated \
    --project "$GCP_PROJECT_ID" \
    --set-env-vars="DATABASE_URL=$DATABASE_URL,JWT_SECRET=$JWT_SECRET,OPENAI_API_KEY=$OPENAI_API_KEY,FRONTEND_URL=${FRONTEND_URL}" \
    --quiet

# --- Final URLs --- 
echo "--- Deployment Summary ---"
echo "Backend Service (${BACKEND_SERVICE_NAME}) URL: $(gcloud run services describe "${BACKEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')" # Fetch again to be sure
echo "Frontend Service (${FRONTEND_SERVICE_NAME}) URL: $(gcloud run services describe "${FRONTEND_SERVICE_NAME}" --platform managed --region "${REGION}" --format='value(status.url)')"
echo "Image Tag Used: ${IMAGE_TAG}"
echo "---------------------------"
echo "PRODUCTION deployment script finished." 