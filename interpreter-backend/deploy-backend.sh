#!/bin/bash

# Script to deploy the interpreter-backend service to Google Cloud Run.
#
# Prerequisites:
# 1. Google Cloud SDK (gcloud) installed and authenticated.
# 2. Docker installed and configured to push to Artifact Registry (gcloud auth configure-docker REGION-docker.pkg.dev).
# 3. The Docker image must be built and pushed to Artifact Registry.
# 4. Database migrations must be run manually *before* executing this script:
#    export DATABASE_URL="YOUR_PRODUCTION_DB_URL" # Set temporarily for migration
#    npx prisma migrate deploy
#    unset DATABASE_URL
#
# Required Environment Variables:
#   GCP_PROJECT_ID: Your Google Cloud Project ID.
#   GCP_REGION: The Google Cloud region for Cloud Run and Artifact Registry (e.g., us-central1).
#   ARTIFACT_REGISTRY_REPO: The name of your Artifact Registry repository.
#   DATABASE_URL: The full connection string for your production database.
# Optional Environment Variables:
#   SERVICE_NAME: Name for the Cloud Run service (default: interpreter-backend-service).
#   IMAGE_NAME: Name of the Docker image (default: interpreter-backend).
#   IMAGE_TAG: Tag for the Docker image (default: latest).
#   CONTAINER_PORT: Port your application listens on (default: 8080).

set -e # Exit immediately if a command exits with a non-zero status.
set -u # Treat unset variables as an error.

# --- Configuration ---
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION}"
REPO="${ARTIFACT_REGISTRY_REPO}"
DB_URL="${DATABASE_URL}" # Make sure this is the correct production URL

SERVICE="${SERVICE_NAME:-interpreter-backend-service}"
IMAGE="${IMAGE_NAME:-interpreter-backend}"
TAG="${IMAGE_TAG:-latest}"
PORT="${CONTAINER_PORT:-8080}" # Cloud Run default is 8080

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE}:${TAG}"

# --- Deployment ---
echo "Deploying image: ${IMAGE_URI}"
echo "To service: ${SERVICE} in region ${REGION}"

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE_URI}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory=128Mi \
  --cpu=1 \
  --port="${PORT}" \
  --set-env-vars="DATABASE_URL=${DB_URL}" # Set the database URL

echo "Deployment submitted for service: ${SERVICE}" 