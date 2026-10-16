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
| `FRONTEND_URL`              | Extra allowed CORS origins (comma-separated). `http://localhost:5173` and `https://eatbud.vercel.app` are always allowed. |
| `SUPABASE_URL`              | Supabase project URL.                                                                            |
| `SUPABASE_SERVICE_ROLE_KEY` | Private key used only by the API.                                                                |
| `GROQ_API_KEY`              | Groq API key.                                                                                    |
| `GROQ_MODEL`                | Optional; defaults to `openai/gpt-oss-120b`.                                                    |
| `GROQ_VISION_MODEL`         | Optional; defaults to `qwen/qwen3.8-27b`. Used only when a meal is sent with a photo.            |
| `DEEPSEEK_API_KEY`          | Optional fallback; DeepSeek API key, used only when Groq fails.                                  |
| `DEEPSEEK_MODEL`            | Optional; defaults to `deepseek-chat`.                                                          |
| `VITE_API_URL`              | Optional, in `frontend/.env`; public API URL when deploying the frontend and backend separately. |

The backend analyzes each food with Groq (`openai/gpt-oss-120b` by default) and returns JSON with foods, calories, protein, carbohydrates and fat; the API sums these values to generate the daily report. The model works **without web search**: it estimates each food from reference nutritional values (USDA per 100 g) and standard portion weights, which keeps every request at roughly 1.3k tokens. If Groq fails (token limit, outage or validation error), it automatically retries with DeepSeek (`deepseek-chat`) — text only, since DeepSeek does not accept images.

A meal can also be sent with a photo (`image`, a base64 data URL). The photo is optional and never stored: it is processed in memory and discarded. When a photo is present the request switches to a vision-capable model (`GROQ_VISION_MODEL`) and the text **and** the image are sent together in a single message, so the model interprets them as one meal and returns one nutritional breakdown. If the image request fails, no text-only fallback is used: the photo is never silently dropped or sent to a model without vision.

On mobile the photo is taken **at that moment with the device camera**: the file input uses `capture="environment"`, so the browser opens the rear camera instead of giving access to the gallery. The picker is mobile-only (`md:hidden`); on desktop the interface stays text-only. The browser shrinks the photo to 1024 px and re-encodes it as JPEG before sending it, so the request stays small.

The frontend also keeps the last known profile in `localStorage` under `eatbud:profile:<user id>`. On load, that cached profile is used to paint the app on the very first render (no waiting screen) while the API is revalidated in the background; the fresh response replaces it silently. The cache lives in `frontend/src/context/AuthContext.jsx`, is keyed by user id (a cached profile can never be shown to another account) and is removed when the server reports that the profile no longer exists.

**Summaries** (`frontend/src/components/Summaries.jsx`) compare the logged calories against the profile's daily calorie goal (`profile.daily_calorie_goal`) instead of showing a bare number. Each day in the daily list and in the weekly view shows `consumed / goal` (e.g. `2000 / 2451`), the day view adds the same comparison, a deficit/excess badge and a progress bar, and the weekly card compares the whole week against the goal **of the days that actually have meals** and states the deficit or excess in kcal.

The colour is a shared, progressive scale (`getGoalStatus`): **green** while the user stays within the goal (a brighter green once 90% is reached), **yellow → amber → orange** when the user goes over by up to 300 kcal, and **red → darker red** beyond 300 kcal.

The weekly comparison only counts days with logged meals: with a 2451 kcal goal and three logged days the week is measured against `2451 × 3 = 7353` kcal, and the 300 kcal tolerance scales the same way (`300 × 3`), so a week is never judged against days the user did not log. A week without meals shows no comparison at all, and when the goal has not been calculated yet the raw calories are shown as before. Days in the weekly list start collapsed and open on tap, with an expand/collapse-all shortcut.

## Installable app (PWA)

Eatbud can be installed on iOS and Android straight from the browser. Everything lives in `frontend/public/`, so no build plugin and no extra dependency were added:

* `frontend/public/manifest.webmanifest`: name and short name `Eatbud`, `id` and `start_url` `/`, `scope` `/`, `display: "standalone"`, theme and background `#07110f`, and the icon list.
* `frontend/public/icons/`: `icon-192.png` and `icon-512.png` (`purpose: "any"`, transparent rounded corners) plus `maskable-512.png` (`purpose: "maskable"`, full-bleed background with the glyph inside Android's safe zone). `frontend/public/favicon-32.png` is the tab icon referenced from `index.html`.
* `frontend/public/apple-touch-icon.png` (180×180) plus the iOS tags in `frontend/index.html` (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title` and `viewport-fit=cover`).
* Safe areas: because the iOS status bar is translucent when installed, the mobile header, the side drawer, the bottom bar (`frontend/src/components/Sidebar.jsx`) and the content padding (`frontend/src/App.jsx`) add `env(safe-area-inset-*)`, so nothing hides behind the notch or the home indicator.
* `frontend/public/sw.js` and `frontend/src/pwa.js`: a service worker registered **only in production builds** (in development it would cache the Vite dev server).

The icons are rasterised from the real brand logo by a dependency-free script (no image library, no extra dependency). Drop the logo as `frontend/scripts/icon-source.png` (a square PNG, ideally ≥ 512 px) and run:

```bash
node frontend/scripts/generate-icons.mjs
```

The script decodes the PNG by hand, removes the white background while keeping the anti-aliased edge (un-blending it with the artwork's own colour, so no light rim shows on dark backgrounds), crops to the drawing, and re-encodes the PNGs with block-average scaling:

* `icon-192.png` / `icon-512.png` / `favicon-32.png` keep the rounded corners transparent.
* `maskable-512.png` and `apple-touch-icon.png` are full-bleed: the outside of the drawing is filled with the nearest artwork colour (spreading inwards pixel by pixel), so Android's and iOS's rounded masks never reveal a border.
* It also warns if the glyph grows past Android's maskable safe zone, so the logo is never clipped.

### What the service worker caches (and what it never caches)

It exists for installability and offline start-up only, and it is deliberately conservative:

* It ignores anything that is not `GET`, anything cross-origin (Supabase auth and, in production, the backend on `https://eatbudbackend.vercel.app`) and any request carrying an `Authorization` header. **Sessions, profiles, meal logs, summaries and AI analyses are never stored in a cache**, so stale or private data cannot be served from it.
* It also ignores `/api/*` (the development proxy) and every other route.
* The app shell (`/index.html`, manifest, icons, favicon) is served **network-first**, so a new deployment is picked up on the next launch and the cached copy is only used when the device is offline.
* Only `/assets/*` (Vite's hashed, immutable files) and the icons/manifest are served cache-first.

### Testing the production build locally

```bash
npm run build --prefix frontend
npm run preview --prefix frontend
```

`/manifest.webmanifest` must answer `200 application/manifest+json`, `/sw.js` must answer `200`, and the browser DevTools → *Application* → *Manifest* / *Service Workers* panels should show no errors. In Lighthouse, the *Installable* audit should pass.

### Installing it

**iPhone / iPad (Safari):** open `https://eatbud.vercel.app` → **Share** → **Add to Home Screen** → **Add**. It opens full screen, with the Eatbud icon and the dark status bar. Sign in once inside the installed app: iOS gives home-screen apps their own storage, so the Safari session is not shared. Confirmation and password-reset emails open in Safari, not in the installed app, which is expected.

**Android (Chrome, Edge or Samsung Internet):** open `https://eatbud.vercel.app` → use the install banner or the ⋮ menu → **Install app / Add to Home screen**.

HTTPS is required and Vercel already provides it; the manifest, the icons and `sw.js` are static files copied into the build output (`dist/`), so they are served with the rest of the site and no additional deployment configuration is needed. `start_url` is `/` because the app switches views with state (there is no client-side router), so there are no deep links to configure.

## API

* `GET /api/health`: checks the connection to the `daily_logs` table.
* `GET /api/daily-summary`: returns the current day's meals and macros.
* `POST /api/logs`: receives `{ "foodText": "..." }`, an optional `{ "image": "data:image/jpeg;base64,..." }`, or both. Text-only, photo-only and combined requests are all accepted (a request with neither is rejected with `400`). The meal is analyzed once, saved once, and the updated daily summary is returned.

## Deployment (Vercel)

The frontend and the backend are deployed as **two separate Vercel projects**:

* Frontend: `https://eatbud.vercel.app`
* Backend: `https://eatbudbackend.vercel.app`

Because they live on different domains, the frontend needs to know the backend URL and the backend needs to allow the frontend origin. Both are handled in code:

* `frontend/src/apiUrl.js` uses `/api` in development (through the Vite proxy) and `https://eatbudbackend.vercel.app/api` in production.
* `backend/server.js` allows `http://localhost:5173` and `https://eatbud.vercel.app` by default.

Optional Vercel environment variables, only needed to override those defaults:

| Vercel project | Variable        | Value                                          |
| -------------- | --------------- | ---------------------------------------------- |
| Frontend       | `VITE_API_URL`  | `https://eatbudbackend.vercel.app/api`         |
| Backend        | `FRONTEND_URL`  | Extra origins, comma-separated (e.g. previews) |

`VITE_*` variables are baked in at build time, so **redeploy the frontend after setting `VITE_API_URL`**.

The backend runs as a single Vercel Function: `backend/server.js` exports the Express app as its default export and only calls `app.listen()` outside of Vercel, so the function never crashes on cold start.

