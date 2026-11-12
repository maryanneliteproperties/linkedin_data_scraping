# LinkedIn Data Scraping – ProfileDesk

A React + Vite profile management interface with a Node.js + Express API and JSON-file storage for locally managed, user-provided profile data.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Local storage: `backend/data/profiles.json`

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

Optional frontend API base URL:
```bash
# frontend/.env
VITE_API_URL=http://localhost:5000
```

Optional backend CORS allowlist (comma-separated origins):
```bash
# backend/.env or deployment environment
CORS_ORIGINS=http://localhost:5173
```

## Features
- Search and view saved profiles.
- Add profile basics, summary, photo URL, skills, and structured experience, education, and volunteer records.
- Open a full profile details view.
- Import profile records from JSON or CSV.
- Duplicate detection by LinkedIn profile URL, or by name + company when URL is absent.
- Import validation with counts for added, duplicate, and invalid records.
- API responses update the React table without a full page reload.

## Import formats

JSON can be either an array or an object containing a `profiles` array:

```json
{
  "profiles": [
    {
      "name": "Alex Morgan",
      "headline": "Product Designer",
      "company": "Example Studio",
      "location": "Chennai, India",
      "profileUrl": "https://www.linkedin.com/in/example/",
      "description": "Product designer focused on user experience.",
      "skills": ["Figma", "Research"],
      "experiences": [
        {
          "title": "Senior Product Designer",
          "company": "Example Studio",
          "location": "Chennai",
          "dates": "2022 - Present",
          "duration": "4 years",
          "description": "Leads product design."
        }
      ],
      "educations": [
        {
          "school": "Example University",
          "degree": "B.Des",
          "field": "Communication Design",
          "dates": "2018 - 2022"
        }
      ],
      "volunteerExperience": [
        {
          "role": "Volunteer Mentor",
          "organization": "Design Community",
          "dates": "2023 - Present",
          "description": "Mentors early-career designers."
        }
      ]
    }
  ]
}
```

CSV supports headers such as `name`, `headline`, `company`, `location`, `profileUrl` and `skills`. Separate multiple skills with semicolons. JSON is recommended when importing structured experience, education, and volunteer details.

## API
- `GET /api/health` – API health check
- `GET /api/profiles` – list saved profiles
- `GET /api/profiles/:id` – get one profile
- `POST /api/profiles` – add one profile
- `POST /api/profiles/import` – bulk import up to 500 profiles

## Storage and deployment note
The JSON file is intended for local development and single-instance deployments with a persistent writable filesystem. Serverless platforms (including typical Vercel deployments) do not guarantee that filesystem writes persist between invocations. Use a persistent database or object store before deploying this API for production or multiple users.

## LinkedIn data access
This application stores profile information supplied by the user or obtained through an authorized integration. It does not automate LinkedIn login, use private session cookies, or bypass LinkedIn access controls. Never put LinkedIn passwords or session cookies in this project. A LinkedIn API or third-party provider integration requires its own approved access and credentials.
