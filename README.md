# Eatbud

Eatbud is a nutrition-tracking application that turns natural-language meal descriptions into structured calorie and macronutrient logs. It supports text and mobile photo input, asks targeted follow-up questions before estimating ambiguous meals, and keeps daily and weekly summaries for each user.

## Highlights

- Natural-language meal logging with Groq-powered nutrition estimates
- Two-step meal flow: clarify only material unknowns, then calculate and save
- Sensible measurement defaults: meat and fish weights are raw; grains and legumes are dry unless stated otherwise
- Optional mobile camera input with in-memory image processing
- Supabase authentication, row-level security, and persistent daily logs
- Daily calorie goals plus daily and weekly progress views
- Production-ready frontend and API deployments on Vercel

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web app | React, Vite, Tailwind CSS | Authentication, meal entry, clarification dialog, summaries |
| API | Express | Validation, AI orchestration, nutrition analysis, summary aggregation |
| AI | Groq, optional DeepSeek fallback | Question generation and structured nutrition estimates |
| Data | Supabase | Auth, profile data, meal logs, daily summaries |

## Quick start

### Prerequisites

- Node.js 20+
- A Supabase project
- A Groq API key

### 1. Configure Supabase

Run [`backend/schema.sql`](backend/schema.sql) in the Supabase SQL Editor. The schema creates the application tables, indexes, and row-level-security policies.

### 2. Configure environment variables

Create `backend/.env` from [`backend/.env.example`](backend/.env.example):

```bash
Copy-Item backend/.env.example backend/.env
```

Set the required values:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GROQ_API_KEY=your-groq-api-key
```

`DEEPSEEK_API_KEY` is optional and is used only as a text-only fallback when Groq is unavailable.

### 3. Install and run

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` requests to the API at `http://localhost:3000`.

## Meal logging flow

1. The user describes a meal or attaches a photo.
2. `POST /api/logs/questions` identifies only the details that materially affect the estimate—such as skin or bone in a chicken portion, oil, sauces, or an ambiguous plate size.
3. The user answers the optional questions in the clarification dialog.
4. `POST /api/logs` receives the original meal and answers, produces the normalized nutrition object, stores it, and returns the updated daily summary.

Clear quantities are not needlessly questioned: for example, three eggs are directly estimable. Unless the user says otherwise, meats and fish use raw weights, while rice, pasta, oats, legumes, and cereals use dry weights.

## API overview

All endpoints except health require `Authorization: Bearer <Supabase access token>`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | API and database health check |
| `GET` | `/api/daily-summary` | Current day's entries and totals |
| `POST` | `/api/logs/questions` | Generate optional meal clarification questions without persisting data |
| `POST` | `/api/logs` | Analyze and save a meal, then return the updated summary |
| `PUT` | `/api/logs/:id` | Update a saved meal |
| `DELETE` | `/api/logs/:id` | Delete a saved meal |
| `GET` | `/api/history/days` | Historical daily summaries |
| `GET` | `/api/weekly-summary` | Weekly summary |

## Quality checks

```bash
npm run build
npm run lint
npm test
```

## Deployment

Deploy the frontend and backend as separate Vercel projects, with project roots `frontend` and `backend` respectively.

| Project | Required configuration |
| --- | --- |
| Frontend | Set `VITE_API_URL` to the deployed API URL with `/api` (for example, `https://your-api.vercel.app/api`) |
| Backend | Set all values from `backend/.env.example`; set `FRONTEND_URL` to the frontend origin |

The `VITE_API_URL` value is embedded during the frontend build, so redeploy the frontend after changing it. In Supabase, add both the local and deployed frontend URLs under **Authentication → URL Configuration → Redirect URLs**.

## Repository layout

```text
backend/                 Express API, Supabase schema, and integration tests
frontend/                React application
  src/components/        Meal entry, dashboard, profile, and summary views
  src/context/           Authentication state
  public/                PWA manifest, service worker, and application icons
```

## Security notes

- Keep `SUPABASE_SERVICE_ROLE_KEY`, Groq keys, and DeepSeek keys on the backend only.
- The client never receives AI-provider credentials.
- Uploaded meal photos are validated, processed in memory, and are not persisted.
- Supabase row-level security isolates user-owned records.

## License

Private and unlicensed.
