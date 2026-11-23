# Supabase setup (backend)

This project stores LinkedIn profiles and application user accounts in Supabase. The Supabase secret/service-role key is server-only: never put it in frontend variables, commit it, or share it in chat.

## 1. Create the database tables

1. Open the Supabase project: https://supabase.com/dashboard/project/nhqxbnuprbrwcpfluvyh
2. Open **SQL Editor**.
3. Run the complete SQL in `backend/supabase-schema.sql`.

The schema enables Row Level Security and intentionally creates no public/anon policies. The Express backend accesses the tables using its server-side secret key.

## 2. Configure the backend environment

In the local `backend/.env` file, add these values. Get the secret key from Supabase Dashboard > Project Settings > API Keys. Do not commit this file.

```env
SUPABASE_URL=https://nhqxbnuprbrwcpfluvyh.supabase.co
SUPABASE_SECRET_KEY=PASTE_YOUR_SUPABASE_SECRET_KEY_HERE
```

Keep your existing `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PIN`, SignalHire, and LinkedIn environment variables in the same file.

## 3. Install and migrate existing JSON data

Run these commands from the backend directory:

```bash
npm install
npm run migrate:supabase
```

Run the migration **before starting the backend for the first time with Supabase configured**. It imports `data/users.json` and `data/profiles.json` when present. It also recovers the stashed JSON array from the repository's historical `profiles-conflict-backup.json` file and adds any profile IDs not already present. It refuses to run if either Supabase table already has rows, preventing accidental overwrites. Admin usernames are migrated as null; Sub Admin and Employee usernames are preserved. PIN salt/hash values are copied without changing the existing PINs.

Keep the original JSON files as a backup until the migration reports success and you verify the record counts in Supabase. Do not manually delete them before that verification.

## 4. Start the backend

```bash
npm run dev
```

If the users table is empty, the backend provisions the initial Admin from the existing `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PIN` environment values. Admin login uses Role + PIN. Sub Admin and Employee login use Role + Username + PIN.

## Data layout

- `public.profiles`: one row per profile; the existing profile object is stored in the `data` JSONB column so the current API response format remains unchanged.
- `public.users`: account details and the existing scrypt PIN salt/hash. PIN hashes are never returned by the API.
- Browser extension profile-save endpoint `POST /api/profiles` remains public for extension compatibility; it writes to Supabase through the backend.
- Login sessions remain in backend memory and expire after 12 hours. They are not profile/account records.
