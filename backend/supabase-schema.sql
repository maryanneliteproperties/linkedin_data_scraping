-- ProfileDesk Supabase schema
-- Run this entire script in Supabase Dashboard > SQL Editor.
-- The backend uses the secret/service-role key. Do not expose that key in frontend code.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text null,
  name text not null,
  email text not null,
  role text not null check (role in ('Admin', 'Sub Admin', 'Employee')),
  pin_salt text not null,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  updated_at timestamptz null
);

create unique index if not exists users_email_lower_uidx on public.users (lower(email));
create unique index if not exists users_username_lower_uidx on public.users (lower(username)) where username is not null;
create index if not exists users_role_idx on public.users (role);

create table if not exists public.profiles (
  id bigint primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_data_gin_idx on public.profiles using gin (data);

alter table public.users enable row level security;
alter table public.profiles enable row level security;

-- Shared, persistent sessions for serverless instances.
-- Only SHA-256 token hashes are stored; raw bearer/cookie tokens never enter the database.
create table if not exists public.sessions (
  token_hash text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists sessions_expires_at_idx on public.sessions (expires_at);

alter table public.sessions enable row level security;


-- No anon/authenticated policies are created. Only the backend secret/service-role key accesses these tables.
