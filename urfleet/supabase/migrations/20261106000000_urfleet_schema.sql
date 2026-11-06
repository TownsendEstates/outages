-- =====================================================================
-- UrFleet Fleet Manager — core schema
-- Printanista-equivalent fleet management + billing (Xero / QBO) + HubSpot
-- Owner: Scott Townsend — 2668981 Alberta Incorporated (Inks N Stuff IT / UrFleet)
-- =====================================================================
-- Security model
--   * Staff sign in with a PIN via the `pin-login` edge function, which
--     issues a real Supabase Auth session. All tables below are protected
--     by RLS and are only reachable by authenticated, active staff.
--   * DCAs never talk to tables directly. They POST to the `dca-ingest`
--     edge function with a per-install key (stored here only as a SHA-256
--     hash). The function writes with the service role.
--   * OAuth tokens for Xero / QBO / HubSpot live in `integration_secrets`,
--     which has RLS enabled and NO policies => service role only.
-- =====================================================================

-- gen_random_uuid() is built in (Postgres 13+); no extension required.

-- ---------------------------------------------------------------------
-- Staff users & roles
-- ---------------------------------------------------------------------
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  name          text not null,
  email         text not null unique,
  role          text not null default 'tech'
                check (role in ('admin','manager','tech','sales','viewer')),
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

-- PIN hashes are low-entropy secrets: kept out of any table the browser can read.
create table if not exists app_user_secrets (
  user_id    uuid primary key references app_users(id) on delete cascade,
  pin_hash   text not null,               -- PBKDF2-SHA256, written by pin-login only
  pin_lookup text not null unique,        -- HMAC(pepper, pin) for O(1) lookup; PINs must be unique
  updated_at timestamptz not null default now()
);

create table if not exists login_attempts (
  id         bigint generated always as identity primary key,
  ip         text,
  success    boolean not null,
  user_id    uuid,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_ip_time on login_attempts (ip, created_at desc);

-- Helpers used by RLS policies
create or replace function current_app_user() returns app_users
language sql stable security definer set search_path = public as $$
  select * from app_users where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where auth_user_id = auth.uid() and active)
$$;

create or replace function staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from app_users where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(staff_role() in ('admin','manager','tech','sales'), false)
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(staff_role() in ('admin','manager'), false)
$$;

-- ---------------------------------------------------------------------
-- Accounts (clients) — hierarchical
-- ---------------------------------------------------------------------
create table if not exists accounts (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  parent_id          uuid references accounts(id) on delete set null,
  location           text,
  phone              text,
  industry           text,
  employees          int,
  address1           text,
  address2           text,
  city               text,
  province           text default 'AB',
  postal_code        text,
  country            text default 'Canada',
  website            text,
  billing_email      text,
  billing_contact    text,
  rdl_enabled        boolean not null default false,
  status             text not null default 'active' check (status in ('active','prospect','inactive')),
  hubspot_company_id text,
  xero_contact_id    text,
  qbo_customer_id    text,
  custom             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists accounts_parent on accounts(parent_id);

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  title       text,
  email       text,
  phone       text,
  is_billing  boolean not null default false,
  receives_alerts boolean not null default false,
  hubspot_contact_id text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- DCA installs (one per client site / collector host)
-- ---------------------------------------------------------------------
create table if not exists dca_installs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references accounts(id) on delete cascade,
  name           text not null,                  -- e.g. "Main office"
  host_name      text,
  os             text,
  version        text,
  key_hash       text not null,                  -- sha256 hex of the DCA key
  key_prefix     text not null,                  -- first 8 chars, for display
  config         jsonb not null default jsonb_build_object(
                    'ranges', jsonb_build_array(),
                    'communities', jsonb_build_array('public'),
                    'interval_minutes', 240,
                    'snmp_version', '2c'),
  config_version int not null default 1,
  last_reported  timestamptz,
  last_ip        text,
  last_device_count int,
  status         text not null default 'pending' check (status in ('pending','active','disabled')),
  created_at     timestamptz not null default now()
);
create index if not exists dca_account on dca_installs(account_id);

create table if not exists dca_commands (
  id           uuid primary key default gen_random_uuid(),
  dca_id       uuid not null references dca_installs(id) on delete cascade,
  command      text not null check (command in ('rescan','collect_now','ping','set_log_level','update_config')),
  args         jsonb not null default '{}'::jsonb,
  status       text not null default 'queued' check (status in ('queued','sent','done','failed')),
  result       jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------
-- Contracts (MPS agreements) — drive meter billing
-- ---------------------------------------------------------------------
create table if not exists contracts (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  name            text not null,
  tier            text not null default 'Professional' check (tier in ('Essential','Professional','Enterprise','Custom')),
  status          text not null default 'active' check (status in ('draft','active','expired','cancelled')),
  start_date      date not null default current_date,
  end_date        date,
  billing_cycle   text not null default 'monthly' check (billing_cycle in ('monthly','quarterly','annual')),
  base_fee        numeric(12,2) not null default 0,
  included_mono   int not null default 0,          -- pages included per cycle (pooled across contract devices)
  included_color  int not null default 0,
  mono_rate       numeric(12,5) not null default 0, -- $ per page over allowance
  color_rate      numeric(12,5) not null default 0,
  min_charge      numeric(12,2) not null default 0,
  pool_allowances boolean not null default true,
  invoice_detail  text not null default 'summary' check (invoice_detail in ('summary','per_device')),
  tax_code        text,                            -- overrides integration default
  payment_terms_days int not null default 30,
  po_number       text,
  hubspot_deal_id text,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists contracts_account on contracts(account_id);

-- ---------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------
create table if not exists devices (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references accounts(id) on delete cascade,
  dca_id         uuid references dca_installs(id) on delete set null,
  contract_id    uuid references contracts(id) on delete set null,
  serial         text not null,
  manufacturer   text,
  model          text,
  ip             text,
  mac            text,
  host_name      text,
  description    text,
  location       text,
  asset_no       text,
  erp_id         text,
  device_group   text,
  technology     text default 'Unknown',  -- Laser / InkJet / Thermal / Unknown
  is_color       boolean not null default false,
  is_managed     boolean not null default false,
  is_blocked     boolean not null default false,
  flagged        boolean not null default false,
  starred        boolean not null default false,
  status_code    text,                     -- hrPrinterStatus text
  error_state    text[],                   -- decoded hrPrinterDetectedErrorState
  first_audit    timestamptz,
  last_audit     timestamptz,
  meter_total    bigint,
  meter_mono     bigint,
  meter_color    bigint,
  meter_scans    bigint,
  amv_total      int,
  amv_mono       int,
  amv_color      int,
  install_date   date,
  purchase_cost  numeric(12,2),
  monthly_lease  numeric(12,2),
  custom         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (account_id, serial)
);
create index if not exists devices_account on devices(account_id);
create index if not exists devices_serial on devices(serial);

-- Meter readings (one row per audit)
create table if not exists meter_reads (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references devices(id) on delete cascade,
  read_at    timestamptz not null,
  total      bigint,
  mono       bigint,
  color      bigint,
  scans      bigint,
  copies     bigint,
  source     text not null default 'dca' check (source in ('dca','manual','import','estimate')),
  accepted   boolean not null default true,   -- Audits: reject bad values to exclude from billing
  raw        jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists meter_reads_device_time on meter_reads(device_id, read_at desc);

-- Current supplies (one row per device+supply) and history
create table if not exists device_supplies (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references devices(id) on delete cascade,
  name           text not null,
  supply_type    text,               -- toner, drum, waste, fuser, ink, other
  color          text,               -- black, cyan, magenta, yellow, ...
  level_pct      numeric(5,1),       -- null = unknown
  level_raw      int,
  max_capacity   int,
  part_no        text,
  yield_pages    int,
  coverage_pct   numeric(5,2) default 5,
  usage_pages    bigint,             -- pages since install of this cartridge
  est_empty_date date,
  installed_at   timestamptz,
  ref_level      numeric(5,1),       -- level when tracking window started (reset on replacement)
  ref_at         timestamptz,
  ref_meter      bigint,             -- device total meter at cartridge install
  first_reported timestamptz not null default now(),
  last_reported  timestamptz not null default now(),
  unique (device_id, name)
);

create table if not exists supply_reads (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references devices(id) on delete cascade,
  read_at    timestamptz not null,
  supplies   jsonb not null           -- [{name,type,color,level_pct,max,level_raw}]
);
create index if not exists supply_reads_device_time on supply_reads(device_id, read_at desc);

-- Device-reported service conditions (Printer-MIB alert table) => service tickets
create table if not exists service_events (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references devices(id) on delete cascade,
  ticket_no      text,
  code           text,
  severity       text default 'warning',
  description    text,
  status         text not null default 'open' check (status in ('open','in_progress','closed')),
  first_received timestamptz not null default now(),
  last_received  timestamptz not null default now(),
  report_count   int not null default 1,
  hubspot_ticket_id text,
  assigned_to    uuid,
  resolution     text,
  closed_at      timestamptz
);
create index if not exists service_events_device on service_events(device_id, status);

-- ---------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------
create table if not exists alert_definitions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null check (kind in ('supply_level','supply_days','service','no_data','dca_offline')),
  threshold     numeric not null default 10,    -- % for supply_level, business days for supply_days, days for no_data
  supply_match  text,                           -- regex/substring on supply name (null = all marker supplies)
  managed_only  boolean not null default true,
  account_id    uuid references accounts(id) on delete cascade,  -- null = all accounts
  severity      text not null default 'warning' check (severity in ('critical','warning','info')),
  recipients    text[] not null default '{}',
  create_hubspot_ticket boolean not null default false,
  enabled       boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create table if not exists alerts (
  id             uuid primary key default gen_random_uuid(),
  definition_id  uuid references alert_definitions(id) on delete set null,
  account_id     uuid references accounts(id) on delete cascade,
  device_id      uuid references devices(id) on delete cascade,
  dca_id         uuid references dca_installs(id) on delete cascade,
  kind           text not null,
  severity       text not null default 'warning',
  supply_name    text,
  level_pct      numeric(5,1),
  est_empty_date date,
  message        text,
  status         text not null default 'open' check (status in ('open','acknowledged','closed')),
  first_detected timestamptz not null default now(),
  last_detected  timestamptz not null default now(),
  closed_at      timestamptz,
  closed_reason  text,
  hubspot_ticket_id text,
  notified_at    timestamptz
);
create index if not exists alerts_status on alerts(status, last_detected desc);
create unique index if not exists alerts_open_unique
  on alerts (coalesce(device_id::text, dca_id::text), kind, coalesce(supply_name,''))
  where status <> 'closed';

-- ---------------------------------------------------------------------
-- Supplies: part catalogue, orders, costs (feeds per-asset P&L)
-- ---------------------------------------------------------------------
create table if not exists part_catalog (
  id            uuid primary key default gen_random_uuid(),
  manufacturer  text,
  model_match   text not null,       -- substring/regex matched against device model
  supply_match  text not null,       -- substring matched against supply name
  part_no       text not null,
  description   text,
  yield_pages   int,
  cost          numeric(12,2),       -- landed cost (TD Synnex / Ingram)
  price         numeric(12,2),
  vendor        text,
  created_at    timestamptz not null default now()
);

create table if not exists supply_orders (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid references devices(id) on delete set null,
  account_id  uuid references accounts(id) on delete cascade,
  alert_id    uuid references alerts(id) on delete set null,
  part_no     text,
  description text,
  qty         int not null default 1,
  unit_cost   numeric(12,2),
  status      text not null default 'requested' check (status in ('requested','ordered','shipped','delivered','installed','cancelled')),
  vendor      text,
  vendor_po   text,
  tracking    text,
  ordered_at  timestamptz,
  delivered_at timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists device_costs (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references devices(id) on delete cascade,
  cost_date   date not null default current_date,
  category    text not null check (category in ('supplies','labour','parts','lease','depreciation','other')),
  amount      numeric(12,2) not null,
  description text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists device_costs_device_date on device_costs(device_id, cost_date);

-- ---------------------------------------------------------------------
-- Billing runs (meter billing -> Xero / QBO)
-- ---------------------------------------------------------------------
create table if not exists billing_runs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'draft' check (status in ('draft','approved','exported','void')),
  invoice_date  date,
  target        text check (target in ('xero','qbo','csv')),
  subtotal      numeric(14,2) not null default 0,
  line_count    int not null default 0,
  flags         int not null default 0,
  created_by    uuid,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists billing_lines (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references billing_runs(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  contract_id   uuid references contracts(id) on delete set null,
  device_id     uuid references devices(id) on delete set null,
  line_type     text not null check (line_type in ('base','mono','color','minimum','adjustment','device')),
  description   text not null,
  start_mono    bigint, end_mono bigint,
  start_color   bigint, end_color bigint,
  start_read_at timestamptz, end_read_at timestamptz,
  pages         bigint,
  included      bigint,
  billable      numeric(14,2),
  rate          numeric(12,5),
  amount        numeric(14,2) not null default 0,
  item_code     text,
  account_code  text,
  tax_code      text,
  flag          text,           -- estimated / rollover / partial / stale_end
  allocated     numeric(14,2),  -- device lines: share of contract revenue (per-asset P&L)
  sort          int not null default 0
);
create index if not exists billing_lines_run on billing_lines(run_id, account_id);

create table if not exists invoice_exports (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references billing_runs(id) on delete cascade,
  account_id    uuid not null references accounts(id) on delete cascade,
  target        text not null check (target in ('xero','qbo','csv')),
  invoice_number text,
  external_id   text,
  status        text not null default 'pending' check (status in ('pending','sent','error')),
  total         numeric(14,2),
  error         text,
  response      jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------
create table if not exists integrations (
  provider      text primary key check (provider in ('xero','qbo','hubspot')),
  connected     boolean not null default false,
  tenant_id     text,          -- Xero tenantId / QBO realmId / HubSpot portalId
  tenant_name   text,
  settings      jsonb not null default '{}'::jsonb,
  connected_at  timestamptz,
  last_sync_at  timestamptz,
  last_error    text
);

-- Tokens: service role only (RLS on, no policies)
create table if not exists integration_secrets (
  provider       text primary key references integrations(provider) on delete cascade,
  access_token   text,
  refresh_token  text,
  expires_at     timestamptz,
  oauth_state    text,
  updated_at     timestamptz not null default now()
);

create table if not exists sync_log (
  id         bigint generated always as identity primary key,
  provider   text not null,
  action     text not null,
  entity     text,
  entity_id  text,
  ok         boolean not null,
  message    text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Notes, saved views, report schedules, settings, audit log
-- ---------------------------------------------------------------------
create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('account','device','alert','contract','dca')),
  entity_id   uuid not null,
  body        text not null,
  auto        boolean not null default false,
  author      text,
  created_at  timestamptz not null default now()
);
create index if not exists notes_entity on notes(entity_type, entity_id, created_at desc);

create table if not exists saved_views (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid,
  scope      text not null default 'devices',
  name       text not null,
  definition jsonb not null,
  shared     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists report_schedules (
  id          uuid primary key default gen_random_uuid(),
  report_key  text not null,
  params      jsonb not null default '{}'::jsonb,
  frequency   text not null check (frequency in ('daily','weekly','monthly')),
  recipients  text[] not null default '{}',
  enabled     boolean not null default true,
  last_run_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists app_settings (
  key   text primary key,
  value jsonb not null
);

create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  actor      text,
  action     text not null,
  entity     text,
  entity_id  text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Derived metrics
-- ---------------------------------------------------------------------
-- Recalculate AMV (Average Monthly Volume) from accepted reads in the last 90 days
create or replace function recalc_device_amv(p_device uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  f meter_reads; l meter_reads; days numeric;
begin
  select * into f from meter_reads
   where device_id = p_device and accepted and read_at >= now() - interval '90 days'
   order by read_at asc limit 1;
  select * into l from meter_reads
   where device_id = p_device and accepted
   order by read_at desc limit 1;
  if f.id is null or l.id is null or f.id = l.id then return; end if;
  days := greatest(extract(epoch from (l.read_at - f.read_at)) / 86400.0, 1);
  update devices set
    amv_total = greatest(round((coalesce(l.total,0) - coalesce(f.total,0)) / days * 30.4), 0),
    amv_mono  = greatest(round((coalesce(l.mono,0)  - coalesce(f.mono,0))  / days * 30.4), 0),
    amv_color = greatest(round((coalesce(l.color,0) - coalesce(f.color,0)) / days * 30.4), 0)
  where id = p_device;
end $$;

create or replace function recalc_amv_for(p_devices uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  foreach d in array p_devices loop perform recalc_device_amv(d); end loop;
end $$;

-- Reporting status view (Printanista "Reporting Status")
create or replace view v_device_monthly with (security_invoker = true) as
with m as (
  select device_id, date_trunc('month', read_at)::date as month,
         max(total) as total, max(mono) as mono, max(color) as color
    from meter_reads where accepted group by 1, 2)
select device_id, month,
       greatest(total - lag(total) over w, 0) as total_pages,
       greatest(mono  - lag(mono)  over w, 0) as mono_pages,
       greatest(color - lag(color) over w, 0) as color_pages
  from m window w as (partition by device_id order by month);

create or replace view v_device_status with (security_invoker = true) as
select d.*,
       a.name as account_name,
       case
         when d.is_blocked then 'blocked'
         when exists (select 1 from alerts x where x.device_id = d.id and x.status <> 'closed' and x.severity = 'critical') then 'critical'
         when d.flagged or exists (select 1 from alerts x where x.device_id = d.id and x.status <> 'closed' and x.severity = 'warning') then 'flagged'
         when exists (select 1 from alerts x where x.device_id = d.id and x.status <> 'closed') then 'informational'
         else 'healthy'
       end as health,
       (d.last_audit is null or d.last_audit < now() - interval '3 days') as stale
from devices d join accounts a on a.id = d.account_id;

-- DCA offline sweep (schedule with pg_cron: select cron.schedule('urfleet-dca-offline','0 * * * *','select sweep_dca_offline()');)
create or replace function sweep_dca_offline() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; def alert_definitions; r record;
begin
  for def in select * from alert_definitions where enabled and kind = 'dca_offline' loop
    for r in select * from dca_installs
              where status = 'active'
                and (def.account_id is null or account_id = def.account_id)
                and (last_reported is null or last_reported < now() - make_interval(days => def.threshold::int)) loop
      insert into alerts(definition_id, account_id, dca_id, kind, severity, message)
      values (def.id, r.account_id, r.id, 'dca_offline', def.severity,
              format('DCA "%s" has not reported since %s', r.name, coalesce(to_char(r.last_reported,'YYYY-MM-DD HH24:MI'),'never')))
      on conflict do nothing;
      n := n + 1;
    end loop;
    -- auto-close recovered
    update alerts al set status = 'closed', closed_at = now(), closed_reason = 'DCA reporting again'
      from dca_installs di
     where al.dca_id = di.id and al.kind = 'dca_offline' and al.status <> 'closed'
       and di.last_reported >= now() - make_interval(days => def.threshold::int);
  end loop;
  return n;
end $$;

-- updated_at triggers
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists accounts_touch on accounts;
create trigger accounts_touch before update on accounts for each row execute function touch_updated_at();
drop trigger if exists devices_touch on devices;
create trigger devices_touch before update on devices for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','contacts','dca_installs','dca_commands','contracts','devices','meter_reads',
    'device_supplies','supply_reads','service_events','alert_definitions','alerts','part_catalog',
    'supply_orders','device_costs','billing_runs','billing_lines','invoice_exports','notes',
    'saved_views','report_schedules','sync_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_read on %I', t);
    execute format('drop policy if exists staff_write on %I', t);
    execute format('create policy staff_read on %I for select to authenticated using (is_staff())', t);
    execute format('create policy staff_write on %I for all to authenticated using (can_write()) with check (can_write())', t);
  end loop;
end $$;

-- Admin-only tables
alter table app_users enable row level security;
drop policy if exists users_read on app_users;
drop policy if exists users_admin on app_users;
create policy users_read on app_users for select to authenticated using (is_staff());
create policy users_admin on app_users for all to authenticated using (is_admin()) with check (is_admin());

alter table integrations enable row level security;
drop policy if exists integ_read on integrations;
drop policy if exists integ_admin on integrations;
create policy integ_read on integrations for select to authenticated using (is_staff());
create policy integ_admin on integrations for all to authenticated using (is_admin()) with check (is_admin());

alter table app_settings enable row level security;
drop policy if exists settings_read on app_settings;
drop policy if exists settings_admin on app_settings;
create policy settings_read on app_settings for select to authenticated using (is_staff());
create policy settings_admin on app_settings for all to authenticated using (is_admin()) with check (is_admin());

alter table audit_log enable row level security;
drop policy if exists audit_read on audit_log;
drop policy if exists audit_insert on audit_log;
create policy audit_read on audit_log for select to authenticated using (is_admin());
create policy audit_insert on audit_log for insert to authenticated with check (is_staff());

alter table integration_secrets enable row level security;   -- no policies: service role only
alter table login_attempts enable row level security;        -- no policies: service role only
alter table app_user_secrets enable row level security;      -- no policies: service role only

-- Note: dca_installs.key_hash is a SHA-256 of a 256-bit random key, so it is not
-- reversible and is safe for staff to read. The plaintext key is shown once at creation.

-- ---------------------------------------------------------------------
-- Seed defaults
-- ---------------------------------------------------------------------
insert into integrations(provider) values ('xero'),('qbo'),('hubspot') on conflict do nothing;
insert into integration_secrets(provider) values ('xero'),('qbo'),('hubspot') on conflict do nothing;

insert into alert_definitions(name, kind, threshold, severity, managed_only)
select * from (values
  ('Marker supplies below 10%', 'supply_level', 10, 'warning', true),
  ('Supply empty within 10 business days', 'supply_days', 10, 'warning', true),
  ('Device service condition', 'service', 0, 'warning', true),
  ('Device not reporting (3 days)', 'no_data', 3, 'info', true),
  ('DCA offline (3 days)', 'dca_offline', 3, 'warning', false)
) v(name, kind, threshold, severity, managed_only)
where not exists (select 1 from alert_definitions);

insert into app_settings(key, value) values
  ('company', jsonb_build_object('name','UrFleet by Inks N Stuff IT','legal_name','2668981 Alberta Incorporated','owner','Scott Townsend','gst_rate',0.05,'currency','CAD')),
  ('billing', jsonb_build_object('invoice_prefix','MPS-','next_invoice_no',1001,'due_days',30,'default_target','xero','csv_date_format','YYYY-MM-DD','target_margin',35)),
  ('alerts',  jsonb_build_object('supply_days_threshold',10))
on conflict do nothing;
