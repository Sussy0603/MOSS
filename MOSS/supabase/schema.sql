-- ============================================================
-- MOSS database schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run once on a fresh project.
--
-- BEFORE RUNNING: replace YOUR_EMAIL@gmail.com (just below)
-- with the Google account you will log in with.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The owner lock
-- Only this email can read or write anything, even if someone
-- else manages to create an account.
-- ------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql stable
as $$
  select auth.uid() is not null
     and lower(coalesce(auth.jwt() ->> 'email', '')) = lower('YOUR_EMAIL@gmail.com');
$$;

-- ------------------------------------------------------------
-- 2. Tables
-- Every table has id, user_id, created_at, updated_at.
-- user_id fills itself in from the logged-in user.
-- ------------------------------------------------------------

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() unique references auth.users on delete cascade,
  business_name text default 'MOS',
  address text default '',
  email text default '',
  phone text default '',
  taxes_on boolean not null default false,
  gst_number text default '',
  qst_number text default '',
  gst_rate numeric not null default 5,
  qst_rate numeric not null default 9.975,
  language text not null default 'en' check (language in ('en','fr')),
  recent_logins jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  email text default '',
  phone text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  client_id uuid references public.clients on delete set null,
  url text default '',
  admin_url text default '',
  host text default '',
  price numeric,
  domain_renewal date,
  hosting_renewal date,
  last_check timestamptz,
  last_status text check (last_status in ('up','down')),
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text default '',
  notes text default '',
  repeat text not null default 'none' check (repeat in ('none','weekly','monthly')),
  google_event_id text unique,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  due_date date,
  done boolean not null default false,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  repeat text not null default 'none' check (repeat in ('none','weekly','monthly','yearly')),
  client_id uuid references public.clients on delete set null,
  site_id uuid references public.sites on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default '',
  body text not null default '',          -- cleaned HTML from the editor
  tags text[] not null default '{}',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roadmap (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  description text default '',
  status text not null default 'idea' check (status in ('idea','doing','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  number text not null,                   -- MOS-2026-001
  client_id uuid references public.clients on delete set null,
  issue_date date not null default current_date,
  due_date date,
  items jsonb not null default '[]'::jsonb, -- [{description, qty, price}]
  subtotal numeric not null default 0,
  gst numeric not null default 0,
  qst numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid','paid')),
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, number)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null default current_date,
  type text not null check (type in ('in','out')),
  amount numeric not null,                -- total, taxes included
  gst numeric not null default 0,
  qst numeric not null default 0,
  category text default '',
  description text default '',
  invoice_id uuid references public.invoices on delete set null,
  receipt_path text,                      -- file in the "receipts" storage bucket
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Google refresh token for Calendar sync.
-- NO policies on purpose: the browser can never read it.
-- Only the google-calendar-sync Edge Function (service role) can.
create table public.google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.google_tokens enable row level security;

-- ------------------------------------------------------------
-- 3. updated_at stamps itself on every change
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['settings','clients','sites','appointments','todos','notes','roadmap','invoices','transactions']
  loop
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
    -- Row Level Security: only the owner, only their own rows.
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy owner_all on public.%I for all
                     using (public.is_owner() and user_id = auth.uid())
                     with check (public.is_owner() and user_id = auth.uid())$p$, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4. Receipts storage (private bucket, 10 MB per file)
-- Files live under <user id>/<file name>.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

create policy receipts_owner on storage.objects for all
  using (bucket_id = 'receipts' and public.is_owner()
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and public.is_owner()
              and (storage.foldername(name))[1] = auth.uid()::text);
