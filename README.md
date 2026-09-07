# Eatbud

[svg](https://github.com/Nahjuu/Eatbud#eatbud)

A simple application for logging meals using natural language. The backend sends the food description to Groq, stores the nutritional breakdown in Supabase, and returns the user's daily total.

## Structure

[svg](https://github.com/Nahjuu/Eatbud#structure)

* `frontend/`: React and Vite interface.
* `backend/`: Express API, Groq, and Supabase.
* `backend/schema.sql`: database schema required by the project.

## Initial Setup

[svg](https://github.com/Nahjuu/Eatbud#initial-setup)

1. In Supabase, open the **SQL Editor** and run [`backend/schema.sql`](https://github.com/Nahjuu/Eatbud/blob/main/backend/schema.sql). The script does not delete existing data.

2. Copy `backend/.env.example` to `backend/.env` and fill in the Supabase and Groq credentials. The `SUPABASE_SERVICE_ROLE_KEY` must remain on the backend only.

3. Install the dependencies from each project:

   ```bash
   npm install
   npm install --prefix backend
   npm install --prefix frontend
   ```

   **svg**

4. Start the frontend and backend together:

   ```bash
   npm run dev
   ```

   **svg**

Open `http://localhost:5173`.

## Environment Variables

[svg](https://github.com/Nahjuu/Eatbud#environment-variables)

| **Variable**                | **Usage**                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`                      | API port; defaults to `3000`.                                                                        |
| `FRONTEND_URL`              | Allowed CORS origin; defaults to `http://localhost:5173`.                                            |
| `SUPABASE_URL`              | Supabase project URL.                                                                                |
| `SUPABASE_SERVICE_ROLE_KEY` | Private key used only by the API.                                                                    |
| `GROQ_API_KEY`              | Groq API key.                                                                                        |
| `GROQ_MODEL`                | Optional; defaults to `groq/compound-mini`.                                                          |
| `VITE_API_URL`              | Optional, in `frontend/.env`; the public API URL when deploying the frontend and backend separately. |

`groq/compound-mini` allows Groq to decide whether it needs to search the web to resolve ambiguous products or preparations. The model returns JSON containing foods, calories, protein, carbohydrates, and fat; the API sums these values to generate the daily report.

## API

[svg](https://github.com/Nahjuu/Eatbud#api)

* `GET /api/health`: checks the connection to the `daily_logs` table.
* `GET /api/daily-summary`: returns the current day's meals and macros.
* `POST /api/logs`: receives `{ "foodText": "..." }`, analyzes it with Groq, saves it, and returns the updated daily summary.
