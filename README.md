## Running the Project

Follow these steps to get the interpreter application running locally.

### Prerequisites

- **Node.js:** Make sure you have Node.js installed (which includes npm). You can download it from [nodejs.org](https://nodejs.org/).
- **(Optional) Yarn:** You can use `yarn` instead of `npm` if you prefer.
- **OpenAI API Key:** You need an API key from OpenAI for transcription, translation, and TTS services.

### 1. Backend Setup

1.  **Navigate to the backend directory:**
    ```bash
    cd interpreter-backend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **Create Environment File:**

    - Create a file named `.env` in the `interpreter-backend` directory.
    - Add the following variables, replacing the placeholders with your actual values:

      ```dotenv
      # Example for local SQLite database
      DATABASE_URL="file:./prisma/dev.db"

      # Your OpenAI API Key
      OPENAI_API_KEY="sk-..."
      ```

      _Note: For production or different database types (like PostgreSQL), update `DATABASE_URL` accordingly and potentially modify the `provider` in `prisma/schema.prisma`._

4.  **Run Database Migrations:**
    This command will create the SQLite database file (if it doesn't exist) and apply the schema.
    ```bash
    npx prisma migrate dev
    ```
5.  **(Optional) Generate Prisma Client:** Usually `migrate dev` does this, but run explicitly if needed:
    ```bash
    npx prisma generate
    ```
6.  **(Optional) Build:** If your start script doesn't handle TypeScript compilation:
    ```bash
    npm run build
    # or
    yarn build
    ```

### 2. Frontend Setup

1.  **Navigate to the frontend directory:**
    ```bash
    cd ../interpreter-frontend
    # (Assuming you are in interpreter-backend)
    # Or navigate from the root: cd interpreter-frontend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **(Optional) Create Environment File:**
    - The frontend currently attempts to connect to the backend at `localhost:8080` (based on code review). If your backend runs elsewhere or you need to configure specific React environment variables, create a `.env` file in `interpreter-frontend`. Example:
      ```dotenv
      # REACT_APP_BACKEND_URL=http://your-backend-url.com
      ```

### 3. Running the Application

1.  **Start the Backend Server:**

    - Open a terminal in the `interpreter-backend` directory.
    - Run:
      ```bash
      npm start
      # or
      yarn start
      ```
    - Keep this terminal running. You should see logs indicating the server is listening (likely on port 8080).

2.  **Start the Frontend Development Server:**
    - Open a _separate_ terminal in the `interpreter-frontend` directory.
    - Run:
      ```bash
      npm start
      # or
      yarn start
      ```
    - This will usually open the application automatically in your default web browser (typically at `http://localhost:3000`). If not, open your browser and navigate to that address.

You should now be able to interact with the application.
