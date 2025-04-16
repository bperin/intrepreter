#!/bin/bash

# Configuration
DEFAULT_DB_USER="db_user"
# DEFAULT_DB_PASSWORD="db_password" # No longer needed for local fixed password
DEFAULT_DB_NAME="interpreter_db" # Database name
# LOCAL_DB_CONTAINER_NAME="local_postgres_db" # Removed Docker setup
GCP_PROJECT_ID=$(gcloud config get-value project)
GCP_REGION="us-central1" # Or your preferred region
# Prompt for Cloud SQL instance name or use a default/argument
CLOUD_SQL_INSTANCE_NAME="${1:-interpreter-cloudsql-instance}" # Default instance name, changeable via argument

# Function to generate random password for Cloud SQL
generate_password() {
  openssl rand -base64 16
}

# --- Local Database Setup (Instructions Only - Defaults to SQLite) ---
echo "--- Local Database Setup Notes ---"
echo "NOTE: Local database configuration defaults to SQLite in '.env.local'."
echo "If using SQLite, ensure you change the provider in 'prisma/schema.prisma' to 'sqlite' before migrating."
echo "See final instructions after Cloud SQL setup."
echo ""


# --- Google Cloud SQL Setup ---
echo "--- Setting up Google Cloud SQL Database (for Production Defaults) ---"
DB_USER_CLOUD=$DEFAULT_DB_USER # Use the same username for consistency
DB_PASSWORD_CLOUD=$(generate_password)
DB_NAME_CLOUD=$DEFAULT_DB_NAME

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud command not found. Please install Google Cloud SDK."
    exit 1
fi

# Check if project ID is set
if [ -z "$GCP_PROJECT_ID" ]; then
    echo "Error: Google Cloud project ID not configured. Use 'gcloud config set project YOUR_PROJECT_ID'."
    exit 1
fi

echo "Using Project ID: $GCP_PROJECT_ID"
echo "Using Region: $GCP_REGION"
echo "Using Cloud SQL Instance: $CLOUD_SQL_INSTANCE_NAME"

# Create Cloud SQL instance ONLY if it doesn't exist
echo "Checking for Cloud SQL instance '$CLOUD_SQL_INSTANCE_NAME'..."
if ! gcloud sql instances describe "$CLOUD_SQL_INSTANCE_NAME" --project="$GCP_PROJECT_ID" &>/dev/null; then
    echo "Creating Cloud SQL instance '$CLOUD_SQL_INSTANCE_NAME' (this may take several minutes)..."
    gcloud sql instances create "$CLOUD_SQL_INSTANCE_NAME" \
        --database-version=POSTGRES_16 \
        --edition=ENTERPRISE \
        --tier=db-custom-1-3840 \
        --region="$GCP_REGION" \
        --project="$GCP_PROJECT_ID" \
        --assign-ip # Add --assign-ip to enable public IP
    if [ $? -ne 0 ]; then
        echo "Error: Failed to create Cloud SQL instance."
        exit 1
    fi
    echo "Cloud SQL instance created."
else
    echo "Cloud SQL instance '$CLOUD_SQL_INSTANCE_NAME' already exists. Skipping creation."
    # Still ensure public IP is assigned if the instance exists but wasn't configured for it
    CURRENT_IP=$(gcloud sql instances describe "$CLOUD_SQL_INSTANCE_NAME" --project="$GCP_PROJECT_ID" --format='value(settings.ipConfiguration.ipv4Enabled)')
    if [ "$CURRENT_IP" != "True" ]; then
        echo "Patching instance to assign Public IP..."
        gcloud sql instances patch "$CLOUD_SQL_INSTANCE_NAME" --project="$GCP_PROJECT_ID" --assign-ip
        if [ $? -ne 0 ]; then
            echo "Error: Failed to assign Public IP to existing instance."
            # Consider exiting or just warning
        fi
        echo "Public IP enabled. Instance may restart."
        sleep 15 # Give time for potential restart
    else
        echo "Public IP already enabled."
    fi
fi

# Get Cloud SQL instance public IP address
DB_HOST_CLOUD=$(gcloud sql instances describe "$CLOUD_SQL_INSTANCE_NAME" --project="$GCP_PROJECT_ID" --format='value(ipAddresses[0].ipAddress)')
if [ -z "$DB_HOST_CLOUD" ]; then
    echo "Error: Could not retrieve Public IP address for Cloud SQL instance. Check instance status."
    exit 1
fi
echo "Cloud SQL Instance Public IP: $DB_HOST_CLOUD"

# Configure instance to allow public access (HIGHLY INSECURE)
echo "Configuring Authorized Network 'all-access' for 0.0.0.0/0..."
gcloud sql instances patch "$CLOUD_SQL_INSTANCE_NAME" \
    --project="$GCP_PROJECT_ID" \
    --authorized-networks="0.0.0.0/0" \
    --assign-ip # Ensure public IP is still assigned
if [ $? -ne 0 ]; then
    echo "Warning: Failed to set authorized networks. Connections might fail."
fi

# Create database if it doesn't exist
echo "Checking/Creating database '$DB_NAME_CLOUD' in Cloud SQL..."
gcloud sql databases create "$DB_NAME_CLOUD" \
    --instance="$CLOUD_SQL_INSTANCE_NAME" \
    --project="$GCP_PROJECT_ID" > /dev/null 2>&1 || echo "Database '$DB_NAME_CLOUD' already exists or failed to create."


# Create or Update database user
echo "Checking/Creating/Updating database user '$DB_USER_CLOUD' in Cloud SQL..."
# Check if user exists
if gcloud sql users list --instance="$CLOUD_SQL_INSTANCE_NAME" --project="$GCP_PROJECT_ID" --format='value(name)' | grep -q "^${DB_USER_CLOUD}$"; then
    echo "User '$DB_USER_CLOUD' exists. Updating password..."
    gcloud sql users set-password "$DB_USER_CLOUD" \
      --host='%' \
      --instance="$CLOUD_SQL_INSTANCE_NAME" \
      --project="$GCP_PROJECT_ID" \
      --password="$DB_PASSWORD_CLOUD"
    if [ $? -ne 0 ]; then echo "Error: Failed to update password for user '$DB_USER_CLOUD'."; fi
else
    echo "User '$DB_USER_CLOUD' does not exist. Creating user..."
    gcloud sql users create "$DB_USER_CLOUD" \
      --host='%' \
      --instance="$CLOUD_SQL_INSTANCE_NAME" \
      --project="$GCP_PROJECT_ID" \
      --password="$DB_PASSWORD_CLOUD"
    if [ $? -ne 0 ]; then echo "Error: Failed to create user '$DB_USER_CLOUD'."; fi
fi

echo "Cloud Database User: $DB_USER_CLOUD"
echo "Cloud Database Password: [Generated - Written to .env]"
CLOUD_DB_URL="postgresql://${DB_USER_CLOUD}:${DB_PASSWORD_CLOUD}@${DB_HOST_CLOUD}:5432/${DB_NAME_CLOUD}?schema=public"
echo "Cloud Database URL: $CLOUD_DB_URL"
echo "(Cloud setup complete)"
echo ""

# --- Update .env files ---
echo "--- Updating .env and .env.local files ---"
ENV_PROD_FILE=".env"
ENV_LOCAL_FILE=".env.local"

# Create/clear .env.local with SQLite as default
echo "# Local Development Environment Overrides" > "$ENV_LOCAL_FILE"
echo "# Generated by setup-databases.sh" >> "$ENV_LOCAL_FILE"
echo "" >> "$ENV_LOCAL_FILE"
echo "# Option 1: SQLite (Default - Recommended for simple local dev)" >> "$ENV_LOCAL_FILE"
echo "# If using SQLite, change the 'provider' in prisma/schema.prisma to \"sqlite\"" >> "$ENV_LOCAL_FILE"
echo "DATABASE_URL=\"file:./prisma/dev.db\"" >> "$ENV_LOCAL_FILE"
echo "" >> "$ENV_LOCAL_FILE"
echo "# Option 2: Local PostgreSQL (If you prefer, uncomment and configure below)" >> "$ENV_LOCAL_FILE"
echo "# Ensure your local PostgreSQL server is running and the specified database exists." >> "$ENV_LOCAL_FILE"
echo "# You may also need to create the user/role and grant permissions manually." >> "$ENV_LOCAL_FILE"
echo "# If using PostgreSQL, ensure the 'provider' in prisma/schema.prisma is \"postgresql\"" >> "$ENV_LOCAL_FILE"
echo "# DATABASE_URL=\"postgresql://YOUR_PG_USER:YOUR_PG_PASSWORD@localhost:5432/YOUR_DB_NAME?schema=public\"" >> "$ENV_LOCAL_FILE"
echo "" >> "$ENV_LOCAL_FILE"
echo "# You can add other local overrides here (e.g., different ports, JWT secrets)" >> "$ENV_LOCAL_FILE"

echo ".env.local created/updated. Defaulting to SQLite for local development."

# Update .env (for production defaults)
# Remove existing DATABASE_URL and specific comment lines first
sed -i.bak '/^DATABASE_URL=/d' "$ENV_PROD_FILE" 2>/dev/null
sed -i.bak '/^# Production Database URL (Cloud SQL - DO NOT COMMIT if sensitive)/d' "$ENV_PROD_FILE" 2>/dev/null
sed -i.bak '/^# Generated by setup-databases.sh. Prefer Cloud Run secrets\/env vars for actual deployment./d' "$ENV_PROD_FILE" 2>/dev/null
rm -f "$ENV_PROD_FILE.bak" 2>/dev/null

# Add cloud DB URL to .env
# Check if .env ends with a newline, if not, add one
if [ -s "$ENV_PROD_FILE" ] && [ "$(tail -c 1 "$ENV_PROD_FILE")" != "" ]; then
    echo "" >> "$ENV_PROD_FILE"
fi
echo "# Production Database URL (Cloud SQL - DO NOT COMMIT if sensitive)" >> "$ENV_PROD_FILE"
echo "# Generated by setup-databases.sh. Prefer Cloud Run secrets/env vars for actual deployment." >> "$ENV_PROD_FILE"
echo "DATABASE_URL=\"$CLOUD_DB_URL\"" >> "$ENV_PROD_FILE"
echo ".env updated with Cloud SQL DB URL (for reference/defaults)."

# --- Add .env.local to .gitignore ---
# This step remains the same, ensuring .env.local isn't committed
echo "--- Updating .gitignore ---"
GITIGNORE_FILE=".gitignore"
if ! grep -q "^\.env\.local$" "$GITIGNORE_FILE" 2>/dev/null; then
    echo "" >> "$GITIGNORE_FILE"
    echo "# Local environment overrides" >> "$GITIGNORE_FILE"
    echo ".env.local" >> "$GITIGNORE_FILE"
    echo ".gitignore updated to ignore .env.local"
else
    echo ".env.local already in .gitignore"
fi

echo ""
echo "Setup Script Finished."
echo "---------------------------"
echo "ACTION REQUIRED: Verify Local Setup" >> /dev/stderr
echo "---------------------------"
echo "1. Local development is now defaulted to use SQLite ('DATABASE_URL=file:./prisma/dev.db' in '.env.local')."
echo "2. IMPORTANT: Before running migrations locally, edit 'prisma/schema.prisma' and change the datasource provider to \"sqlite\" like this:"
# Escape backticks for the shell echo command
_prisma_provider_text='\`\`\`prisma
datasource db {
  provider = "sqlite" // <-- CHANGE THIS LINE
  url      = env("DATABASE_URL")
}
\`\`\`'
echo "$prisma_provider_text"
echo "3. After changing the provider, run 'npm run prisma:migrate' to create the SQLite database and apply the schema."
echo "4. (Optional) If you prefer local PostgreSQL, edit '.env.local' and configure the PostgreSQL DATABASE_URL instead. Ensure the provider in 'prisma/schema.prisma' is set to \"postgresql\"."
echo ""
echo "NOTE: For production deployment (Cloud Run), ensure the provider in 'prisma/schema.prisma' is set back to \"postgresql\" before building the Docker image."
echo "NOTE: Ensure DATABASE_URL environment variable is set correctly in Cloud Run (ideally via Secret Manager), overriding the value in .env."
echo "SECURITY WARNING: Your Cloud SQL instance '$CLOUD_SQL_INSTANCE_NAME' is configured for public access from ANY IP address (0.0.0.0/0). This is insecure. Please restrict access in a production environment." 