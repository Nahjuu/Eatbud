# Eatbud

A simple application for logging meals using natural language. The backend sends the food description to Groq, stores the nutritional breakdown in Supabase, and returns the user's daily total.

## Structure

* `frontend/`: React and Vite interface.
* `backend/`: Express API, Groq, and Supabase.
* `backend/schema.sql`: the only database schema required by the project.

## Initial Setup

1. In Supabase, open the **SQL Editor** and run [`backend/schema.sql`](backend/schema.sql). The script does not delete existing data.

2. Copy `backend/.env.example` to `backend/.env` and fill in the Supabase and Groq credentials. The `SUPABASE_SERVICE_ROLE_KEY` must remain on the backend only.

3. Install the dependencies from each project:

   ```bash
   npm install
   npm install --prefix backend
   npm install --prefix frontend
   ```

4. Start the frontend and backend together:

   ```bash
   npm run dev
   ```

Open `http://localhost:5173`.

## Confirmation emails

Account confirmation emails are sent by **Supabase Auth**, directly from the browser; they do not pass through `backend/`. In the Supabase dashboard, configure **Authentication → Email** with a verified custom SMTP provider before production. The built-in Supabase mail service is intended for testing and has tight rate limits and delivery restrictions. Also add the deployed frontend URL (and `http://localhost:5173` for local development) under **Authentication → URL Configuration → Redirect URLs**.

The sign-in screen includes a **Resend confirmation email** action. For existing accounts, use that action instead of registering again.

## Environment Variables

| Variable                    | Usage                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `PORT`                      | API port; defaults to `3000`.                                                                    |
| `FRONTEND_URL`              | Allowed CORS origin; defaults to `http://localhost:5173`.                                        |
| `SUPABASE_URL`              | Supabase project URL.                                                                            |
| `SUPABASE_SERVICE_ROLE_KEY` | Private key used only by the API.                                                                |
| `GROQ_API_KEY`              | Groq API key.                                                                                    |
| `GROQ_MODEL`                | Optional; defaults to `groq/compound-mini`.                                                      |
| `VITE_API_URL`              | Optional, in `frontend/.env`; public API URL when deploying the frontend and backend separately. |

`groq/compound-mini` allows Groq to decide whether it needs to search the web to resolve ambiguous products or preparations. The model returns JSON containing foods, calories, protein, carbohydrates, and fat; the API sums these values to generate the daily report.

## API

* `GET /api/health`: checks the connection to the `daily_logs` table.
* `GET /api/daily-summary`: returns the current day's meals and macros.
* `POST /api/logs`: receives `{ "foodText": "..." }`, analyzes it with Groq, saves it, and returns the updated daily summary.

## Deployment (Vercel)

The frontend and the backend are deployed as **two separate Vercel projects**:

* Frontend: `https://eatbud.vercel.app`
* Backend: `https://eatbudbackend.vercel.app`

Because they live on different domains, two environment variables must be set in the Vercel dashboard:

| Vercel project | Variable        | Value                                |
| -------------- | --------------- | ------------------------------------ |
| Frontend       | `VITE_API_URL`  | `https://eatbudbackend.vercel.app/api` |
| Backend        | `FRONTEND_URL`  | `https://eatbud.vercel.app`          |

`VITE_*` variables are baked in at build time, so **redeploy the frontend after setting `VITE_API_URL`** — otherwise the deployed bundle keeps calling `/api` on its own domain, which has no backend and returns `404`.

If neither variable is set, the frontend calls `/api` on its own domain and the backend only allows CORS requests from `http://localhost:5173`. `FRONTEND_URL` accepts a comma-separated list of origins to also allow Vercel preview deployments.

