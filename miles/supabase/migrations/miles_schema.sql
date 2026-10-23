-- Miles: personal AI receptionist for Scott Townsend (Ulio.ai)
-- Lives in the "UrFleet AI" Supabase project (ca-central-1) beside the Aria tables so it can reuse
-- the Ulio webhook pattern and the Microsoft 365 Graph mail secrets already configured there.
--
-- Privacy (Alberta PIPA / PIPEDA): every table here holds personal information. RLS is ON with NO
-- policies, so only the service role (the "miles" edge function) can read or write. The dashboard
-- never talks to these tables directly; it goes through the PIN-gated /miles/admin route.
--
-- Seed data (VIP names and numbers) is NOT kept in this file on purpose. It was loaded straight
-- into the database so personal phone numbers never land in git.

create extension if not exists pgcrypto with schema extensions;

-- VIP / known-contact list. Editable from the dashboard.
--   tier 1 = ring through / text Scott immediately (VIP, medical, vet)
--   tier 4 = friendly but non-urgent (message only, email summary)
create table if not exists public.miles_contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  relationship  text,
  contact_group text,                       -- Family, Team, Friend, Medical, Vet, Other
  line          text,                       -- Cell, Work, Home, Office, Main
  phone_e164    text unique check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  tier          smallint not null default 1 check (tier in (1, 4)),
  familiar      boolean not null default true,  -- true: Miles may say "Scott"; false: "Mr. Townsend"
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.miles_contacts is
  'Miles VIP and known-contact list for Scott Townsend. Personal information (Alberta PIPA). Service-role access only.';

-- One row per call handled by Miles. Case-study metrics are computed from this table.
create table if not exists public.miles_calls (
  id                uuid primary key default gen_random_uuid(),
  call_id           text unique,
  started_at        timestamptz not null default now(),
  caller_number     text,
  caller_name       text,
  organization      text,
  reference_number  text,
  callback_number   text,
  contact_id        uuid references public.miles_contacts(id) on delete set null,
  tier              smallint check (tier between 1 and 5),
  reason            text,
  action_taken      text,
  duration_seconds  integer,
  texted_scott      boolean not null default false,
  sarah_notified    boolean not null default false,
  email_status      text not null default 'pending',
  email_error       text,
  summary           text,
  transcript        text,
  payload           jsonb,
  test_mode         boolean not null default false,
  purged_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists miles_calls_started_at_idx on public.miles_calls (started_at desc);
create index if not exists miles_calls_caller_idx on public.miles_calls (caller_number);
comment on table public.miles_calls is
  'Miles call log (tier, action, notifications). Contains caller personal information (Alberta PIPA). Transcripts purged after retention_days. Service-role access only.';

-- Raw Ulio webhooks for Miles (call.started, call.ended, callback.requested, voicemail.received).
create table if not exists public.miles_events (
  id          uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  event       text,
  call_id     text,
  caller_number text,
  payload     jsonb not null
);
create index if not exists miles_events_received_idx on public.miles_events (received_at desc);
comment on table public.miles_events is 'Raw Ulio webhooks for Miles. Personal information (Alberta PIPA). Service-role access only.';

-- Every text Miles asked to send mid-call (notify_scott tool), with delivery result.
create table if not exists public.miles_notifications (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  call_id          text,
  tier             smallint not null check (tier in (1, 2)),
  caller_name      text,
  caller_number    text,
  callback_number  text,
  organization     text,
  reference_number text,
  reason           text,
  message          text not null,
  scott_status     text,
  sarah_status     text,
  error            text
);
create index if not exists miles_notifications_created_idx on public.miles_notifications (created_at desc);
comment on table public.miles_notifications is 'Texts sent by Miles to Scott and Sarah. Personal information (Alberta PIPA). Service-role access only.';

-- Key/value settings (webhook key, PIN hash, mobile numbers, SMS routes, retention).
create table if not exists public.miles_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
comment on table public.miles_settings is 'Miles configuration incl. webhook key and admin PIN hash. Service-role access only.';

-- Dashboard sessions and login attempts (PIN brute-force lockout).
create table if not exists public.miles_sessions (
  token      text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists public.miles_auth_attempts (
  id  bigint generated always as identity primary key,
  at  timestamptz not null default now(),
  ip  text,
  ok  boolean not null
);
create index if not exists miles_auth_attempts_at_idx on public.miles_auth_attempts (at desc);

alter table public.miles_contacts      enable row level security;
alter table public.miles_calls         enable row level security;
alter table public.miles_events        enable row level security;
alter table public.miles_notifications enable row level security;
alter table public.miles_settings      enable row level security;
alter table public.miles_sessions      enable row level security;
alter table public.miles_auth_attempts enable row level security;

revoke all on public.miles_contacts, public.miles_calls, public.miles_events, public.miles_notifications,
              public.miles_settings, public.miles_sessions, public.miles_auth_attempts
  from anon, authenticated;

-- Defaults. The webhook key and PIN salt are random per install; the PIN hash is set by the
-- edge function on first login from the default admin PIN, then can be changed in the dashboard.
insert into public.miles_settings (key, value) values
  ('webhook_key',               encode(extensions.gen_random_bytes(24), 'hex')),
  ('pin_salt',                  encode(extensions.gen_random_bytes(16), 'hex')),
  ('notify_email',              'primary@townsendestates.ca'),
  ('scott_mobile',              null),
  ('scott_sms_email',           null),
  ('sarah_mobile',              '+17809053571'),
  ('sarah_sms_email',           null),
  ('sarah_email',               null),
  ('retention_days',            '90'),
  ('minutes_per_interruption',  '10')
on conflict (key) do nothing;

-- Retention: purge transcripts and raw payloads after retention_days (default 90).
-- Call metadata (tier, duration, outcome) is kept for the case-study numbers.
create or replace function public.miles_purge_expired()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  days int := coalesce((select value::int from public.miles_settings where key = 'retention_days'), 90);
begin
  update public.miles_calls
     set transcript = null, payload = null, summary = null, purged_at = now()
   where purged_at is null and started_at < now() - make_interval(days => days);
  delete from public.miles_events        where received_at < now() - make_interval(days => days);
  delete from public.miles_notifications where created_at  < now() - make_interval(days => days);
  delete from public.miles_sessions      where expires_at  < now();
  delete from public.miles_auth_attempts where at          < now() - interval '7 days';
end;
$$;
revoke all on function public.miles_purge_expired() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('miles-retention', '15 9 * * *', 'select public.miles_purge_expired()');
