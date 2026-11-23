# LinkedIn Data Scraping – ProfileDesk

React + Vite frontend and Node.js + Express backend for viewing and storing authorized LinkedIn profile data.

## Current workflow
1. Sign in with LinkedIn using the official OpenID Connect flow.
2. The app can read the signed-in member's basic profile (name, email, and profile photo when LinkedIn returns them).
3. Click **Save My Profile** to store that member's basic profile in the existing profile table.
4. Search saved records and open **View** to inspect available details.

The frontend does not show manual **Add Profile** or file **Import** controls.

## Role-based PIN login

The Lead List now uses three application roles: **Admin**, **Sub Admin**, and **Employee**. All three roles can sign in with a role and PIN and access the Lead List. Only Admin can create Sub Admin and Employee accounts.

### First-time Admin setup
1. In the backend folder, copy `.env.example` to `.env`.
2. Set `ADMIN_NAME`, `ADMIN_EMAIL`, and a private 4-8 digit `ADMIN_PIN`. Do not use the sample PIN.
3. Start the backend with `npm run dev`. If `backend/data/users.json` does not exist, the first Admin account is created automatically.
4. Sign in to ProfileDesk by selecting **Admin** and entering that PIN.
5. Use the **User Accounts** panel to create Employee and Sub Admin accounts. Each account needs a unique email and a PIN that is unique within its role.

PINs are stored as salted scrypt hashes, not plain text. The browser session uses an HttpOnly cookie and expires after 12 hours. Sessions are held in backend memory and are cleared when the backend restarts.

The existing `backend/data/profiles.json` profile store is not rewritten by account provisioning. The new `backend/data/users.json` file is local account data and is excluded from Git.

### API access notes
- `POST /api/auth/login` – role + PIN login
- `GET /api/auth/me` – current ProfileDesk account
- `POST /api/auth/logout` – end the ProfileDesk session
- `GET /api/admin/users` and `POST /api/admin/users` – Admin-only account listing and creation
- Profile list, detail, update, delete, and SignalHire APIs require an authenticated session. Bulk profile import additionally requires Admin.
- `POST /api/profiles` remains available without a ProfileDesk session for the existing browser extension profile-save integration. Keep this endpoint and its CORS exposure in mind when deploying.

The JSON-based user and profile stores and in-memory sessions are intended for local development. Before production or multi-user deployment, move account/profile storage to a persistent database and sessions to a shared persistent session store.

## Local development

Backend setup:
```bash
cd backend
npm install
```
Copy `.env.example` to `.env` and fill in the LinkedIn app credentials:
```env
PORT=5000
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:5000/auth/linkedin/callback
```
Start backend:
```bash
npm run dev
```

In a second terminal:
```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:5000

## LinkedIn Developer Portal
In the app's **Auth** tab, add this exact Authorized redirect URL:
```
http://localhost:5000/auth/linkedin/callback
```
The app must have **Sign In with LinkedIn using OpenID Connect** enabled. The login flow requests `openid profile email`.

## OAuth endpoints
- `GET /auth/linkedin` – starts the LinkedIn authorization-code flow.
- `GET /auth/linkedin/callback` – exchanges the authorization code and retrieves the signed-in member's OpenID Connect userinfo.
- `GET /api/auth/me` – returns the current signed-in member's basic profile.
- `POST /api/auth/save-my-profile` – saves the signed-in member's basic profile using existing normalization, duplicate detection, and JSON storage.
- `POST /api/auth/logout` – clears the local app session.

The access token stays on the backend and is not sent to the browser. Local sessions are held in server memory and will be cleared when the backend restarts; use a persistent session store before deploying this app.

## Important LinkedIn access limitation
OpenID Connect returns basic information about the member who signs in. It does **not** provide permission to retrieve other members' full profiles by pasting their profile URLs. Other-member Profile API access requires separate LinkedIn approval and is still subject to LinkedIn's member privacy and data-use restrictions. The URL extraction endpoint intentionally remains unavailable until a permitted provider/API is approved and configured. This app does not collect LinkedIn passwords or private `li_at` cookies and does not automate LinkedIn login or bypass access controls.

## API
- `GET /api/health` – health check
- `GET /api/profiles` – list saved profiles
- `GET /api/profiles/:id` – retrieve full profile details
- `POST /api/profiles/extract` – validates a LinkedIn URL and explains that an approved other-member data provider is required.
- `POST /api/profiles` – save an authorized structured profile payload. The LinkedIn extension can send the visible profile fields to this endpoint as JSON: `name`, `photoUrl`, `designation` (or `headline`), `companyName` (or `company`), `location`, `email`, `phoneNumber` (or `phone`), and `profileUrl`. Missing company, email, and phone values are stored as `Not Available`. Add the extension origin to `CORS_ORIGINS` in the backend environment if the browser blocks extension requests.
- `POST /api/profiles/import` – import structured profiles (API endpoint only).

## Storage
The current JSON file storage is for local development only. Typical serverless deployments do not guarantee persistent filesystem writes. Use a persistent database or object store before production or multi-user deployment.
