create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.endpoints (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  method text not null default 'GET',
  environment_group text not null default 'Production',
  timeout integer not null default 5000,
  expected_status integer not null default 200,
  slow_threshold integer not null default 900,
  headers_text text not null default '',
  body_text text not null default '',
  validation_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_id uuid not null references public.endpoints(id) on delete cascade,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  latency numeric not null,
  status text not null,
  validation_ok boolean not null default false,
  checked_by text not null default 'backend',
  message text not null default ''
);

create table if not exists public.incidents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_id uuid not null references public.endpoints(id) on delete cascade,
  endpoint_name text not null,
  environment_group text not null default 'Production',
  status text not null default 'open',
  started_at timestamptz not null,
  resolved_at timestamptz,
  message text not null default '',
  checks integer not null default 1
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'backend',
  theme text not null default 'light',
  alert_webhook_url text not null default '',
  alert_on_recovery boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.endpoints enable row level security;
alter table public.checks enable row level security;
alter table public.incidents enable row level security;
alter table public.settings enable row level security;

create policy "Users can read their own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can read their endpoints"
  on public.endpoints for select
  using (auth.uid() = user_id);

create policy "Users can read their checks"
  on public.checks for select
  using (auth.uid() = user_id);

create policy "Users can read their incidents"
  on public.incidents for select
  using (auth.uid() = user_id);

create policy "Users can read their settings"
  on public.settings for select
  using (auth.uid() = user_id);
