# Vercel deployment

This repository is a monorepo with a Vite frontend and an Express API. Deploy it as one Vercel project from the repository root.

## Before the first deployment

1. Merge or select the `feature/vercel-deployment` branch in Vercel. Do not deploy `main` yet.
2. In Supabase Dashboard > SQL Editor, run the updated complete `backend/supabase-schema.sql`. This creates the persistent `sessions` table in addition to the existing `users` and `profiles` tables. Existing profile and user rows are not dropped or overwritten by this schema.
3. Confirm the existing `users` and `profiles` tables and records are still present. Do not run the JSON migration again if those tables already contain data.

## Vercel project settings

- Framework Preset: Other (or let Vercel detect the repository configuration)
- Root Directory: `.` (repository root; do not set it to `frontend`)
- Build and output settings are defined in the root `vercel.json`.
- Production Branch: keep the existing production branch unchanged until the preview deployment has been tested.

The Vercel configuration installs the backend and frontend dependencies, builds the Vite app into `frontend/dist`, routes `/api/*` to the Express catch-all function, and sends other client-side routes to the Vite `index.html`.

## Environment variables

Add these in Vercel Project Settings > Environment Variables. Apply them to Preview and Production as appropriate.

| Variable | Required | Value |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Existing Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Supabase server-side secret key (or the existing `SUPABASE_SERVICE_ROLE_KEY` fallback). Never use a frontend variable. |
| `ADMIN_NAME` | Only if users table is empty | Initial Admin display name |
| `ADMIN_EMAIL` | Only if users table is empty | Initial Admin email |
| `ADMIN_PIN` | Only if users table is empty | Private 4-8 digit initial Admin PIN |
| `FRONTEND_URL` | Yes | Exact deployed frontend origin, for example `https://your-project.vercel.app` |
| `CORS_ORIGINS` | If needed | Comma-separated extra allowed origins, such as a trusted browser-extension origin |
| `SIGNALHIRE_API_KEY` | If using SignalHire | Existing SignalHire API key |
| `COOKIE_CROSS_SITE` | Normally no | Leave unset for the same-origin deployment. Set to `true` only if the frontend and API are hosted on different sites and cross-site cookies are required. |

Do not add the Supabase secret, Admin PIN, or SignalHire key as `VITE_*` variables. Do not commit any `.env` file.

The frontend uses the same-origin `/api` path by default. Leave `VITE_API_URL` unset for this single-domain deployment.

## Preview verification checklist

After the first Preview deployment, verify these before promoting it to Production:

1. Open `/api/health` and confirm it returns a healthy response.
2. Sign in with the existing Admin account.
3. Refresh the page and confirm the session remains signed in.
4. Open the profile list and verify existing profile records are visible.
5. Open a profile, then test save/edit/delete only with a safe test record.
6. Test a Sub Admin and Employee login, including their role restrictions.
7. Test the browser extension against the Preview origin if it is part of this release.
8. Test SignalHire only if its key is configured.

Do not delete the legacy JSON backup files until the Supabase data has been verified independently. Do not change the Production branch or merge into `main` until the Preview checks pass.

## Current scope note

The Express server currently exposes the ProfileDesk `/api/*` routes. The README describes LinkedIn OAuth endpoints, but those `/auth/linkedin` route handlers are not present in the current `backend/server.js`. This deployment work does not invent or silently add an OAuth implementation; LinkedIn OAuth needs a separate code-level verification before it can be claimed as working on Vercel.
