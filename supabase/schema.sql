-- MERIDIAN Remote Access — Supabase PostgreSQL Schema
-- Run this migration in your Supabase SQL Editor to provision production tables and RLS policies.

create extension if not exists "pgcrypto";

-- 1. Admin profiles linked 1:1 with Supabase Auth users
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

alter table public.admin_profiles enable row level security;

create policy "Admins can view their own profile"
  on public.admin_profiles
  for select
  using (auth.uid() = id);

create policy "Admins can update their own profile"
  on public.admin_profiles
  for update
  using (auth.uid() = id);

-- 2. Remote support invitation & consent sessions
create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  admin_id uuid not null references auth.users(id) on delete cascade,
  admin_email text not null,
  recipient_label text not null,
  platform text not null check (platform in ('windows', 'android')),
  access_scope text not null default 'assisted_control' check (access_scope in ('view_only', 'assisted_control')),
  status text not null default 'pending_consent' check (
    status in ('pending_consent', 'approved', 'rejected', 'ended', 'expired')
  ),
  ttl_minutes integer not null check (ttl_minutes > 0 and ttl_minutes <= 1440),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  ended_at timestamptz,
  ended_by text,
  consent_note text,
  rustdesk_peer_id text,
  handshake_manifest jsonb
);

create index if not exists idx_support_sessions_admin_id on public.support_sessions(admin_id);
create index if not exists idx_support_sessions_token on public.support_sessions(token);
create index if not exists idx_support_sessions_status on public.support_sessions(status);
create index if not exists idx_support_sessions_created_at on public.support_sessions(created_at desc);

alter table public.support_sessions enable row level security;

create policy "Authenticated admins can manage their sessions"
  on public.support_sessions
  for all
  using (auth.uid() = admin_id)
  with check (auth.uid() = admin_id);

-- Note: Public recipient consent endpoints (/api/consent/:token) run through server-side
-- Functions/Express with SUPABASE_SERVICE_ROLE_KEY so unauthenticated recipients never gain
-- direct table scan permissions.

-- 3. Immutable session audit trail
create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.support_sessions(id) on delete cascade,
  event_type text not null,
  actor text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_events_session_id on public.session_events(session_id, created_at asc);

alter table public.session_events enable row level security;

create policy "Admins can read events for their sessions"
  on public.session_events
  for select
  using (
    exists (
      select 1 from public.support_sessions s
      where s.id = session_events.session_id and s.admin_id = auth.uid()
    )
  );

-- 4. RustDesk self-hosted / Pro relay configuration (public metadata; API keys live in server env)
create table if not exists public.rustdesk_configs (
  id text primary key default 'default',
  hbbs_host text not null default '',
  hbbr_host text not null default '',
  public_key text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.rustdesk_configs enable row level security;

create policy "Authenticated admins can read RustDesk public config"
  on public.rustdesk_configs
  for select
  using (
    exists (
      select 1 from public.admin_profiles p where p.id = auth.uid()
    )
  );
