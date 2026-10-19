-- Radical Robinson AI Line: Supabase schema
-- Owner: Scott Townsend. Client: Aaron Robinson, REALTOR(R), Century 21 Masters.
-- All tables are locked down with RLS. Only the Netlify functions (service role key) read or write.
-- The browser admin page never talks to Supabase directly; it goes through /api/vip-admin with a PIN.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- VIP whitelist (editable by Aaron from the admin page, no code changes)
-- ---------------------------------------------------------------------------
create table if not exists vip_contacts (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,                 -- what the AI calls them, e.g. "Scott"
  full_name     text,
  relationship  text,                          -- family, business partner, lender, lawyer, etc.
  phone_e164    text not null unique,          -- +15872004953
  priority      text not null default 'high' check (priority in ('high','critical')),
  sync_to_crm   boolean not null default false,-- family and personal VIPs stay OUT of Follow Up Boss
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into vip_contacts (display_name, full_name, relationship, phone_e164, priority, sync_to_crm, notes)
values ('Scott', 'Scott Townsend', 'Business partner / AI line administrator', '+15872004953', 'high', false,
        'Seeded at build. Aaron can edit or remove from the admin page.')
on conflict (phone_e164) do nothing;

-- ---------------------------------------------------------------------------
-- Call log: one row per call handled by the AI
-- ---------------------------------------------------------------------------
create table if not exists call_logs (
  id                 uuid primary key default gen_random_uuid(),
  provider_call_id   text unique,
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_seconds   integer,
  caller_phone_e164  text,
  caller_name        text,
  caller_email       text,
  is_vip             boolean not null default false,
  vip_id             uuid references vip_contacts(id) on delete set null,
  intent             text,      -- buyer | seller | buyer_and_seller | landlord | tenant | investor | existing_client | vendor | personal | other
  urgency            text,      -- urgent | high | normal | low
  urgency_reason     text,
  property_or_area   text,
  timeline           text,
  preapproval_status text,      -- yes | no | in_progress | not_applicable | unknown
  best_time_to_call  text,
  after_hours        boolean not null default false,
  transfer_attempted boolean not null default false,
  transfer_result    text,
  appointment        jsonb,     -- {start, end, type, address} if booked
  summary            text,
  next_step          text,
  transcript         text,
  recording_url      text,
  recording_consent  text,      -- given | declined | unknown
  fub_person_id      bigint,
  fub_status         text,      -- created | matched | skipped_vip | skipped_no_phone | error
  fub_error          text,
  sms_status         text,
  email_status       text,
  raw_payload        jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists call_logs_phone_idx   on call_logs (caller_phone_e164);
create index if not exists call_logs_created_idx on call_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Settings (single row) and admin audit trail
-- ---------------------------------------------------------------------------
create table if not exists receptionist_settings (
  id                       int primary key default 1 check (id = 1),
  business_hours_tz        text not null default 'America/Edmonton',
  business_hours_start     time not null default '08:00',
  business_hours_end       time not null default '20:00',
  business_days            int[] not null default '{1,2,3,4,5,6}',  -- ISO weekday, 1 = Monday
  recording_retention_days int not null default 90,
  transcript_retention_days int not null default 730,
  updated_at               timestamptz not null default now()
);
insert into receptionist_settings (id) values (1) on conflict (id) do nothing;

create table if not exists admin_audit (
  id         bigserial primary key,
  action     text not null,
  detail     jsonb,
  actor_ip   text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lock everything down. Service role bypasses RLS; anon and authenticated get nothing.
-- ---------------------------------------------------------------------------
alter table vip_contacts          enable row level security;
alter table call_logs             enable row level security;
alter table receptionist_settings enable row level security;
alter table admin_audit           enable row level security;
revoke all on vip_contacts, call_logs, receptionist_settings, admin_audit from anon, authenticated;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists vip_touch on vip_contacts;
create trigger vip_touch before update on vip_contacts for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Retention (PIPA / PIPEDA: keep only as long as reasonably needed)
-- Recording links cleared after recording_retention_days, transcripts and raw payloads
-- cleared after transcript_retention_days. Summary metadata stays for the business record.
-- ---------------------------------------------------------------------------
create or replace function apply_call_retention() returns void language plpgsql security definer as $$
declare s receptionist_settings;
begin
  select * into s from receptionist_settings where id = 1;
  update call_logs set recording_url = null
   where recording_url is not null
     and created_at < now() - make_interval(days => s.recording_retention_days);
  update call_logs set transcript = null, raw_payload = null
   where (transcript is not null or raw_payload is not null)
     and created_at < now() - make_interval(days => s.transcript_retention_days);
  insert into admin_audit(action, detail) values ('retention_run', jsonb_build_object('at', now()));
end $$;

-- Deletion on request: wipes every call row for a phone number. Returns rows removed.
-- Follow Up Boss and Ulio.ai copies must be deleted separately (see docs/compliance-checklist.md).
create or replace function delete_caller_data(p_phone text) returns int language plpgsql security definer as $$
declare n int;
begin
  delete from call_logs where caller_phone_e164 = p_phone;
  get diagnostics n = row_count;
  insert into admin_audit(action, detail) values ('privacy_delete', jsonb_build_object('phone_last4', right(p_phone, 4), 'rows', n));
  return n;
end $$;

-- Schedule retention nightly at 03:15 Edmonton (09:15 UTC in winter, close enough year round).
-- Requires the pg_cron extension (Supabase Dashboard > Database > Extensions > pg_cron).
-- select cron.schedule('call-retention', '15 9 * * *', $$select apply_call_retention()$$);
