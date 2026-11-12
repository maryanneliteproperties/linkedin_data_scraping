# LinkedIn Data Scraping – ProfileDesk

React + Vite frontend and Node.js + Express backend for storing and viewing structured LinkedIn profile data.

## Current workflow
1. Paste a LinkedIn profile URL into the frontend.
2. Click **Extract Profile**.
3. An authorized LinkedIn data provider must return structured profile data.
4. The backend normalizes the result, checks for duplicates, and saves it.
5. Open **View** in the table to inspect profile, experience, education, volunteer experience, and skills.

The frontend no longer shows manual **Add Profile** or file **Import** controls.

## Local development
```bash
cd backend
npm install
npm run dev
``
In a second terminal:
```bash
cd frontend
npm install
npm run dev
``

Frontend: http://localhost:5173  
Backend: http://localhost:5000

Optional frontend API URL: `VITE_API_URL=http://localhost:5000`  
Optional backend CORS allowlist: `CORS_ORIGINS=http://localhost:5173`

## API
- `GET /api/health` – health check
- `GET /api/profiles` – list saved profiles
- `GET /api/profiles/:id` – retrieve full profile details
- `POST /api/profiles/extract` – validates a LinkedIn profile URL; returns a provider-not-configured response until an authorized provider is connected.

## Extraction integration status
The extraction provider is not configured yet. The endpoint deliberately does not pretend to scrape a profile. Connect an authorized LinkedIn API or data provider, then map its structured response into the existing profile schema and save it with duplicate detection.

Do not collect LinkedIn passwords or store private `li_at` session cookies in this app. Do not automate login or bypass LinkedIn access controls. Use an access method permitted by LinkedIn and the provider's terms.

## Storage
The current JSON file storage is for local development only. Typical serverless deployments do not guarantee persistent filesystem writes. Use a persistent database or object store before production or multi-user deployment.
