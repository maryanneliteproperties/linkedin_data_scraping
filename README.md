# LinkedIn Data Scraping – Profile Viewer

A small React + Vite frontend and Node.js + Express backend for storing profile records as JSON and displaying them in a searchable table.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Storage: `backend/data/profiles.json`

## Requirements
- Node.js 20+ recommended
- npm

## Run locally

### 1. Start the backend
```bash
cd backend
npm install
npm run dev
```
Backend: http://localhost:5000

### 2. Start the frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
```
Frontend: http://localhost:5173

## API
- `GET /api/profiles` – list all saved profiles
- `POST /api/profiles` – add a profile record
- `GET /api/health` – API health check

## Important
This starter stores profile records supplied by the user. It does not automate access to LinkedIn or bypass login/access controls. Use data you have permission to collect, and use official/authorized sources for LinkedIn data. Never put LinkedIn session cookies or credentials in this project.
