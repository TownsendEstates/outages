-- =====================================================================
-- ShopStack: multi-tenant schema for Supabase (Postgres 15+)
-- Region: deploy the Supabase project in ca-central-1 (PIPA/PIPEDA).
--
-- Design
--   * Each business is a tenant. Every business row carries tenant_id.
--   * Row Level Security isolates tenants: a user sees only rows for
--     tenants they belong to (tenant_members).
--   * Records are stored as `data jsonb` plus a few indexed columns, so
--     tenants can add unlimited custom fields without schema changes.
--     Generated columns expose common fields for indexing and reporting.
--   * Sensitive collections (employees, payruns, timesheets) are limited
--     to the owner, manager and accountant roles.
--   * Every write is audited (audit_log).
--   * Journal entries must balance (trigger).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Platform: plans, tenants, membership
-- ---------------------------------------------------------------------
create table if not exists plans (
  id            text primary key,              -- starter | pro | enterprise | distribution
  name          text not null,
  price_cad     numeric(10,2) not null default 0,
  modules       text[] not null default '{}',  -- module keys entitled
  max_users     int not null default 3,
  ai_actions    int not null default 50,       -- per month; -1 = fair-use unlimited
  connectors    int not null default 2,        -- -1 = unlimited
  stripe_price  text
);

insert into plans (id,name,price_cad,modules,max_users,ai_actions,connectors) values
 ('starter','Starter',149,array['dashboard','workorders','pos','schedule','customers','vehicles','inventory','purchasing','integrations','ai','reports','settings'],3,50,2),
 ('pro','Pro',299,array['dashboard','workorders','pos','schedule','customers','vehicles','storage','inventory','purchasing','integrations','accounting','crm','ai','reports','settings'],15,500,-1),
 ('enterprise','Enterprise',549,array['dashboard','workorders','pos','schedule','customers','vehicles','storage','inventory','purchasing','integrations','accounting','payroll','crm','ai','reports','settings'],100,-1,-1),
 ('distribution','Distribution / Banner',0,array['dashboard','workorders','pos','schedule','customers','vehicles','storage','inventory','purchasing','integrations','accounting','payroll','crm','ai','reports','settings','b2b'],1000,-1,-1)
on conflict (id) do nothing;

create table if not exists tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  plan_id       text not null references plans(id) default 'starter',
  status        text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled')),
  province      text not null default 'AB',
  parent_id     uuid references tenants(id),  -- banner / franchise group
  settings      jsonb not null default '{}',  -- branding, tax, labour rates, workflows, custom fields, flags
  stripe_customer text,
  stripe_subscription text,
  trial_ends_at timestamptz default now() + interval '30 days',
  created_at    timestamptz not null default now()
);

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'advisor'
            check (role in ('owner','manager','advisor','technician','accountant','sales','viewer')),
  display_name text,
  pin_hash  text,                 -- staff quick-switch PIN (sha-256), never the raw PIN
  location_ids uuid[] default '{}',
  active    boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Helper functions (security definer so policies don't recurse)
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1 from tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid() and m.active);
$$;

create or replace function has_role(t uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1 from tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid() and m.active and m.role = any(roles));
$$;

alter table plans enable row level security;
alter table tenants enable row level security;
alter table tenant_members enable row level security;
alter table platform_admins enable row level security;

create policy plans_read on plans for select using (true);
create policy plans_admin on plans for all using (is_platform_admin()) with check (is_platform_admin());

create policy tenants_read on tenants for select using (is_member(id));
create policy tenants_update on tenants for update using (has_role(id, array['owner'])) with check (has_role(id, array['owner']));
create policy tenants_admin on tenants for all using (is_platform_admin()) with check (is_platform_admin());

create policy members_read on tenant_members for select using (is_member(tenant_id));
create policy members_write on tenant_members for all
  using (has_role(tenant_id, array['owner','manager']))
  with check (has_role(tenant_id, array['owner','manager']));

create policy padmin_self on platform_admins for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Tenant-scoped record tables (generic jsonb + generated columns)
-- ---------------------------------------------------------------------
create or replace function make_tenant_table(tbl text, restricted boolean default false)
returns void language plpgsql as $$
declare roles text := case when restricted then 'array[''owner'',''manager'',''accountant'']' else null end;
begin
  execute format($f$
    create table if not exists %I (
      id          text primary key,
      tenant_id   uuid not null references tenants(id) on delete cascade,
      location_id text,
      data        jsonb not null default '{}',
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      updated_by  uuid default auth.uid()
    )$f$, tbl);
  execute format('create index if not exists %I on %I (tenant_id)', tbl||'_tenant_idx', tbl);
  execute format('create index if not exists %I on %I using gin (data jsonb_path_ops)', tbl||'_data_idx', tbl);
  execute format('alter table %I enable row level security', tbl);
  execute format('drop policy if exists %I on %I', tbl||'_rw', tbl);
  if restricted then
    execute format('create policy %I on %I for all using (has_role(tenant_id, %s)) with check (has_role(tenant_id, %s))',
                   tbl||'_rw', tbl, roles, roles);
  else
    execute format('create policy %I on %I for all using (is_member(tenant_id)) with check (is_member(tenant_id))',
                   tbl||'_rw', tbl);
  end if;
  execute format('drop trigger if exists %I on %I', tbl||'_audit', tbl);
  execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()',
                 tbl||'_audit', tbl);
  execute format('drop trigger if exists %I on %I', tbl||'_touch', tbl);
  execute format('create trigger %I before update on %I for each row execute function touch_row()',
                 tbl||'_touch', tbl);
end $$;

create table if not exists audit_log (
  id bigserial primary key,
  tenant_id uuid,
  tbl text, row_id text, action text,
  actor uuid default auth.uid(),
  before jsonb, after jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_tenant_idx on audit_log (tenant_id, at desc);
alter table audit_log enable row level security;
create policy audit_read on audit_log for select using (has_role(tenant_id, array['owner','manager','accountant']));

create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (tenant_id, tbl, row_id, action, before, after)
  values (coalesce(new.tenant_id, old.tenant_id), tg_table_name, coalesce(new.id, old.id), tg_op,
          case when tg_op <> 'INSERT' then old.data - 'sin' - 'clock_pin' end,   -- never copy SINs/PINs into the audit trail
          case when tg_op <> 'DELETE' then new.data - 'sin' - 'clock_pin' end);
  return coalesce(new, old);
end $$;

create or replace function touch_row() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;

-- Open collections (all tenant members)
select make_tenant_table(t) from unnest(array[
  'customers','vehicles','workorders','appointments','inventory','purchase_orders','vendors',
  'invoices','payments','bills','journal','accounts','deals','activities','campaigns',
  'tire_storage','bank_txns','locations','connectors','staff'
]) as t;

-- Restricted collections (owner / manager / accountant only)
select make_tenant_table(t, true) from unnest(array['employees','timesheets','payruns']) as t;

-- Generated columns for reporting and indexing
-- (text::date is not immutable, so ISO dates go through an immutable parser)
create or replace function iso_date(t text) returns date language sql immutable as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' then make_date(substr(t,1,4)::int, substr(t,6,2)::int, substr(t,9,2)::int) end
$$;
alter table customers   add column if not exists name   text generated always as (data->>'name') stored;
alter table customers   add column if not exists phone  text generated always as (data->>'phone') stored;
alter table vehicles    add column if not exists vin    text generated always as (data->>'vin') stored;
alter table workorders  add column if not exists status text generated always as (data->>'status') stored;
alter table invoices    add column if not exists number text generated always as (data->>'number') stored;
alter table invoices    add column if not exists total  numeric generated always as ((data->>'total')::numeric) stored;
alter table invoices    add column if not exists inv_date date generated always as (iso_date(data->>'date')) stored;
alter table inventory   add column if not exists sku    text generated always as (data->>'sku') stored;
alter table inventory   add column if not exists tire_size text generated always as (data->>'size') stored;
create index if not exists vehicles_vin_idx on vehicles (tenant_id, vin);
create index if not exists inventory_size_idx on inventory (tenant_id, tire_size);
create index if not exists invoices_date_idx on invoices (tenant_id, inv_date);

-- ---------------------------------------------------------------------
-- Accounting integrity: journal entries must balance
-- data = { date, memo, source, lines:[{account, debit, credit}] }
-- ---------------------------------------------------------------------
create or replace function journal_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric;
begin
  select coalesce(sum((l->>'debit')::numeric),0), coalesce(sum((l->>'credit')::numeric),0)
    into d, c from jsonb_array_elements(new.data->'lines') l;
  if round(d,2) <> round(c,2) then
    raise exception 'Journal entry % is out of balance (debits %, credits %)', new.id, d, c;
  end if;
  return new;
end $$;
drop trigger if exists journal_balance_chk on journal;
create trigger journal_balance_chk before insert or update on journal
  for each row execute function journal_balanced();

-- Locked periods: entries dated on/before settings.lock_date are immutable
create or replace function journal_lock() returns trigger language plpgsql as $$
declare lock date;
begin
  select (settings->>'lock_date')::date into lock from tenants where id = coalesce(new.tenant_id, old.tenant_id);
  if lock is not null and ((coalesce(new.data, old.data)->>'date')::date <= lock) then
    raise exception 'Accounting period is locked through %', lock;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists journal_lock_chk on journal;
create trigger journal_lock_chk before insert or update or delete on journal
  for each row execute function journal_lock();

-- Flattened ledger view for reports / BI tools (RLS flows through security_invoker)
create or replace view ledger_lines with (security_invoker = true) as
select j.tenant_id, j.id as entry_id, (j.data->>'date')::date as entry_date,
       j.data->>'memo' as memo, j.data->>'source' as source,
       l->>'account' as account,
       coalesce((l->>'debit')::numeric,0) as debit,
       coalesce((l->>'credit')::numeric,0) as credit
from journal j, jsonb_array_elements(j.data->'lines') l;

-- ---------------------------------------------------------------------
-- Integrations: secrets live server-side only (Netlify functions use the
-- service role). Clients never read this table.
-- ---------------------------------------------------------------------
create table if not exists connector_secrets (
  tenant_id uuid not null references tenants(id) on delete cascade,
  connector text not null,
  secret    text not null,           -- AES-256-GCM (CONNECTOR_KEY env) envelope written by the function
  updated_at timestamptz not null default now(),
  primary key (tenant_id, connector)
);
alter table connector_secrets enable row level security;  -- no policies: service role only

-- AI usage metering (plan gating and cost tracking)
create table if not exists ai_usage (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid default auth.uid(),
  task text not null,
  input_tokens int, output_tokens int,
  at timestamptz not null default now()
);
create index if not exists ai_usage_idx on ai_usage (tenant_id, at);
alter table ai_usage enable row level security;
create policy ai_usage_read on ai_usage for select using (has_role(tenant_id, array['owner','manager']));

-- ---------------------------------------------------------------------
-- Onboarding RPC: the signed-in user creates a tenant and becomes owner
-- ---------------------------------------------------------------------
create or replace function create_tenant(p_name text, p_province text default 'AB', p_plan text default 'starter')
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; s text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  s := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text,1,6);
  insert into tenants (name, slug, plan_id, province) values (p_name, s, p_plan, p_province) returning id into tid;
  insert into tenant_members (tenant_id, user_id, role, display_name) values (tid, auth.uid(), 'owner', p_name || ' Owner');
  return tid;
end $$;
grant execute on function create_tenant(text,text,text) to authenticated;
