# Interpreter App

This application provides real-time transcription and potential action item detection during conversations, aimed initially at clinician-patient interactions involving different languages.

## Architecture

The application follows principles inspired by **Domain-Driven Design (DDD)**, separating concerns into distinct layers (Domain, Application, Infrastructure). It consists of two main services deployed on Google Cloud Run:

1.  **Backend (`interpreter-backend`):** A Node.js/Express application using Prisma to interact with a PostgreSQL database (Google Cloud SQL). It handles:
    - User authentication (registration, login, token refresh) using JWT.
    - Managing conversation sessions and patient data (Domain entities).
    - WebSocket connections for real-time communication (control channel and transcription stream), enabling **concurrent processing** of multiple client interactions via Node.js's event loop.
    - Proxying audio streams to OpenAI for transcription and **language detection** (via `TranscriptionService`).
    - Processing specific **voice commands** (e.g., "C take a note") using regex matching (via `VoiceCommandService`).
    - Storing messages and detected actions (Repositories pattern).
    - Generating conversation summaries (potentially).
    - Dependency Injection managed by `tsyringe`.
2.  **Frontend (`interpreter-frontend`):** A React/Vite application served by Nginx. It provides the user interface for:
    - Login/Registration.
    - Starting new sessions and selecting existing ones.
    - Displaying conversation transcripts and messages in real-time.
    - Capturing audio via the browser's MediaRecorder API.
    - Interacting with the backend via HTTP API calls (Axios) and WebSockets.

**Supporting Infrastructure:**

- **Database:** Google Cloud SQL (PostgreSQL)
- **Container Registry:** Google Artifact Registry (Docker format)
- **Containerization:** Docker (`Dockerfile` for each service)
- **Deployment:** Google Cloud Run, managed via a deployment script (`deploy.sh`).

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Axios, Styled Components (or similar CSS solution)
- **Backend:** Node.js, Express, TypeScript, Prisma, **tsyringe (DI)**, OpenAI API, **DDD concepts (Services, Repositories)**
- **Database:** PostgreSQL (specifically Google Cloud SQL)
- **WebSockets:** `ws` library (backend), native browser API (frontend)
- **Containerization:** Docker, Docker Compose (for local dev)
- **Deployment:** Google Cloud Run, Google Artifact Registry, Google Cloud Build (optional for automation), Bash (`deploy.sh`)
- **Linting/Formatting:** ESLint, Prettier

## Prerequisites

- Node.js (LTS version recommended, for local tooling)
- Docker & Docker Compose
- Google Cloud SDK (`gcloud`) installed and configured
- Access to a Google Cloud Project with necessary APIs enabled (Cloud Run, Artifact Registry, Cloud SQL, Secret Manager - even if not used directly by script)

## Local Development Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd intrepreter
    ```
2.  **Configure Backend Environment:**
    - Copy `.env.example` to `.env` in the `interpreter-backend` directory (if an example file exists) or create `.env`.
    - Set the required variables:
      - `DATABASE_URL`: Connection string for your **local** PostgreSQL or SQLite database (e.g., `postgresql://user:password@localhost:5432/interpreter_dev_local` or `file:./prisma/dev.db`). If using Postgres locally, ensure it's running.
      - `JWT_SECRET`: A secure random string.
      - `JWT_ISSUER`: An identifier string (e.g., `interpreter-backend-local`).
      - `OPENAI_API_KEY`: Your OpenAI API key.
3.  **Configure Frontend Environment:**
    - The frontend relies on `VITE_APP_BACKEND_URL` being set at build time. For local development using Docker Compose, the URL used inside the build step within compose (`http://localhost:8080`) should work correctly as configured in `docker-compose.yml` and the frontend Dockerfile.
4.  **Run Docker Compose:**
    ```bash
    docker-compose up --build -d
    ```
    - This will build the images, start the backend, frontend (Nginx), and potentially a local database container (if configured in `docker-compose.yml`).
    - The backend command within `docker-compose.yml` handles Prisma generation and schema push (`db push`).
5.  **Access the application:** Open your browser to `http://localhost` (or the port mapped for the frontend service in `docker-compose.yml`).

## Deployment to Google Cloud Run

The deployment is handled by the `deploy.sh` script located in the root directory. This script automates building images, pushing them to Google Artifact Registry, and deploying both services to Cloud Run.

**Prerequisites for Deployment:**

1.  **Google Cloud SDK (`gcloud`):** Ensure it's installed, authenticated (`gcloud auth login`), and configured for your target project (`gcloud config set project YOUR_PROJECT_ID`).
2.  **Docker:** Ensure Docker Desktop (or daemon) is running.
3.  **Artifact Registry API Enabled:** In your GCP project.
4.  **Cloud Run API Enabled:** In your GCP project.
5.  **Artifact Registry Repository:** Create a **Docker** repository in Artifact Registry within your target region and project.
6.  **Docker Authentication for Artifact Registry:** Configure Docker to authenticate with your registry:
    ```bash
    gcloud auth configure-docker YOUR_GCP_REGION-docker.pkg.dev
    ```
    (Replace `YOUR_GCP_REGION` with the region of your repository, e.g., `us-central1`).
7.  **Database:** Ensure your Cloud SQL (PostgreSQL) instance is created and accessible. Obtain its connection string.

**Deployment Steps:**

1.  **Configure `deploy.sh`:**
    - Open the `deploy.sh` script in the root directory.
    - **Crucially, replace the placeholder values** (`YOUR_..._HERE`) for `PROJECT_ID`, `REGION`, `REPO`, `DATABASE_URL`, `JWT_SECRET`, `JWT_ISSUER`, and `OPENAI_API_KEY` with your actual configuration.
    - **SECURITY WARNING:** Do **NOT** commit this file with your real secrets hardcoded. Use environment variables or Google Secret Manager for production workflows.
2.  **Make Script Executable:**
    ```bash
    chmod +x deploy.sh
    ```
3.  **Run the Deployment Script:**

    ```bash
    ./deploy.sh
    ```

    - The script will perform the following:
      - Build the backend image for `linux/amd64`.
      - Push the backend image to Artifact Registry.
      - Deploy the backend service to Cloud Run, setting environment variables (including secrets) and configuring the startup command (`prisma generate`, `prisma db push`, `node dist/index.js`).
      - Fetch the public HTTPS URL of the deployed backend service.
      - Build the frontend image for `linux/amd64`, injecting the backend's public URL as the `VITE_APP_BACKEND_URL` build argument.
      - Push the frontend image to Artifact Registry.
      - Deploy the frontend service (Nginx) to Cloud Run.
      - Print the final public URLs for both services.

4.  **Access the Deployed Application:** Use the Frontend Service URL printed by the script.

## Environment Variables

- **Backend (`.env` / Cloud Run):**
  - `DATABASE_URL`: PostgreSQL connection string.
  - `JWT_SECRET`: Secret for signing JWTs.
  - `JWT_ISSUER`: Issuer name for JWTs.
  - `OPENAI_API_KEY`: API Key for OpenAI services.
  - `PORT`: (Set automatically by Cloud Run, used by the application).
- **Frontend (`Dockerfile` build arg / Vite):**
  - `VITE_APP_BACKEND_URL`: The **publicly accessible base URL** of the deployed backend service (e.g., `https://your-backend-service-xyz.a.run.app`). This is set automatically during the `deploy.sh` process.

## TODO / Future Improvements

- Implement robust error handling and user feedback on the frontend.
- Secure secrets using Google Secret Manager instead of hardcoding or direct environment variables in `deploy.sh`.
- Refine CORS policy on the backend to be more restrictive than `*` for production.
- Implement proper database migration workflow (`prisma migrate dev/deploy`) instead of relying solely on `db push` for deployment.
- Add more comprehensive tests (unit, integration, e2e).
- Set up CI/CD using Google Cloud Build triggers for automated deployments.
- Fix the missing `vite.svg` issue in the frontend build/deployment.
- Improve WebSocket error handling and reconnection logic.
