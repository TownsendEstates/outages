-- StatusPing schema
-- Businesses (organizations) publish a status page; their customers follow it
-- anonymously from a device and receive push notifications.
--
-- Access model
--   * Owners sign in (Supabase Auth) and reach their own rows through RLS.
--   * The public (anon key) has NO direct table access. Everything public goes
--     through the SECURITY DEFINER functions at the bottom of this file, so
--     pages cannot be enumerated and follower data is never exposed.

-- ---------------------------------------------------------------- tables ---

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 60),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  support_email text check (support_email is null or char_length(support_email) <= 254),
  support_phone text check (support_phone is null or char_length(support_phone) <= 40),
  support_url   text check (support_url is null or char_length(support_url) <= 300),
  brand_color   text not null default '#2563EB' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  plan          text not null default 'free' check (plan in ('free', 'pro', 'business')),
  created_at    timestamptz not null default now()
);

create table public.components (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  status     text not null default 'operational'
             check (status in ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index components_org_idx on public.components (org_id, position);

create table public.incidents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  title         text not null check (char_length(title) between 3 and 120),
  impact        text not null default 'minor' check (impact in ('minor', 'major', 'critical', 'maintenance')),
  status        text not null default 'investigating'
                check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  component_ids uuid[] not null default '{}',
  started_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index incidents_org_idx on public.incidents (org_id, started_at desc);

create table public.incident_updates (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  status      text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create index incident_updates_incident_idx on public.incident_updates (incident_id, created_at);

-- A device is an anonymous follower. Its id is a random UUID generated on the
-- device and acts as the device's secret; no personal information is stored.
create table public.devices (
  id         uuid primary key,
  push_token text check (push_token is null or push_token ~ '^Expo(nent)?PushToken\[[^\]]{1,200}\]$'),
  platform   text check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);

create table public.follows (
  device_id  uuid not null references public.devices (id) on delete cascade,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, org_id)
);
create index follows_org_idx on public.follows (org_id, created_at);

-- ----------------------------------------------------------- plan limits ---

create function public.plan_limits(p_plan text)
returns table (max_components int, max_followers int, custom_branding boolean)
language sql immutable
set search_path = ''
as $$
  select t.max_components, t.max_followers, t.custom_branding from (values
    ('free',     3,       25,      false),
    ('pro',      20,      1000,    true),
    ('business', 1000000, 1000000, true)
  ) as t (plan, max_components, max_followers, custom_branding)
  where t.plan = p_plan
$$;

-- Free pages keep the default colour. Also resets it on downgrade.
create function public.enforce_org_plan()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if not (select custom_branding from public.plan_limits(new.plan)) then
    new.brand_color := '#2563EB';
  end if;
  return new;
end $$;

create trigger organizations_enforce_plan
  before insert or update on public.organizations
  for each row execute function public.enforce_org_plan();

create function public.enforce_component_limit()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_max int;
  v_count int;
begin
  select l.max_components into v_max
    from public.organizations o, public.plan_limits(o.plan) l
   where o.id = new.org_id
     for update of o;
  select count(*) into v_count from public.components where org_id = new.org_id;
  if v_count >= v_max then
    raise exception 'PLAN_LIMIT_COMPONENTS' using errcode = 'P0001',
      hint = 'Upgrade your plan to add more services.';
  end if;
  return new;
end $$;

create trigger components_enforce_limit
  before insert on public.components
  for each row execute function public.enforce_component_limit();

-- -------------------------------------------------------------------- RLS ---

alter table public.organizations    enable row level security;
alter table public.components       enable row level security;
alter table public.incidents        enable row level security;
alter table public.incident_updates enable row level security;
alter table public.devices          enable row level security;
alter table public.follows          enable row level security;

create function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations
     where id = p_org and owner_id = (select auth.uid())
  )
$$;

-- The public never touches tables directly.
revoke all on public.organizations, public.components, public.incidents,
              public.incident_updates, public.devices, public.follows
  from anon, authenticated;

-- Owners: the plan column is deliberately not writable from the client. It is
-- only changed by the billing webhook (service role).
grant select, delete on public.organizations to authenticated;
grant insert (owner_id, name, slug, support_email, support_phone, support_url, brand_color)
  on public.organizations to authenticated;
grant update (name, support_email, support_phone, support_url, brand_color)
  on public.organizations to authenticated;

grant select, insert, delete on public.components to authenticated;
grant update (name, status, position) on public.components to authenticated;

grant select, insert, delete on public.incidents to authenticated;
grant update (title, impact, status, component_ids, resolved_at) on public.incidents to authenticated;

grant select, insert on public.incident_updates to authenticated;

create policy org_owner_select on public.organizations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy org_owner_insert on public.organizations for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy org_owner_update on public.organizations for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy org_owner_delete on public.organizations for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy components_owner on public.components for all to authenticated
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
create policy incidents_owner on public.incidents for all to authenticated
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));
create policy incident_updates_owner on public.incident_updates for all to authenticated
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

-- devices / follows: no policies. Only SECURITY DEFINER functions and the
-- service role can read or write them.

-- ------------------------------------------------------- owner functions ---

-- Open an incident, post its first update and flag the affected services, in
-- one transaction. Runs as the caller, so RLS applies.
create function public.report_incident(
  p_org uuid,
  p_title text,
  p_impact text,
  p_component_ids uuid[],
  p_component_status text,
  p_body text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_incident uuid;
  v_update uuid;
begin
  insert into public.incidents (org_id, title, impact, component_ids)
  values (p_org, p_title, p_impact, coalesce(p_component_ids, '{}'))
  returning id into v_incident;

  insert into public.incident_updates (incident_id, org_id, status, body)
  values (v_incident, p_org, 'investigating', p_body)
  returning id into v_update;

  if p_component_status is not null then
    update public.components
       set status = p_component_status
     where org_id = p_org and id = any (coalesce(p_component_ids, '{}'));
  end if;

  return v_update;
end $$;

-- Post an update. Resolving restores the affected services to operational.
create function public.post_incident_update(p_incident uuid, p_status text, p_body text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents;
  v_update uuid;
begin
  select * into v_inc from public.incidents where id = p_incident;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.incident_updates (incident_id, org_id, status, body)
  values (p_incident, v_inc.org_id, p_status, p_body)
  returning id into v_update;

  update public.incidents
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then now() else null end
   where id = p_incident;

  if p_status = 'resolved' then
    update public.components c
       set status = 'operational'
     where c.org_id = v_inc.org_id
       and c.id = any (v_inc.component_ids)
       -- leave a service alone if another open incident still affects it
       and not exists (
         select 1 from public.incidents i
          where i.org_id = v_inc.org_id and i.id <> p_incident
            and i.status <> 'resolved' and c.id = any (i.component_ids)
       );
  end if;

  return v_update;
end $$;

create function public.org_follower_count(p_org uuid)
returns int language sql stable security definer
set search_path = ''
as $$
  select case when public.is_org_owner(p_org)
    then (select count(*)::int from public.follows where org_id = p_org)
  end
$$;

-- Required by Apple (guideline 5.1.1(v)): accounts must be deletable in-app.
-- Cascades to the organization, its services, incidents and followers.
create function public.delete_my_account()
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  delete from auth.users where id = (select auth.uid());
end $$;

-- ------------------------------------------------------ public functions ---

create function public.slug_available(p_slug text)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from public.organizations where slug = lower(p_slug))
$$;

-- Everything a public status page shows: open incidents plus the 15 most
-- recently resolved ones.
create function public.get_status_page(p_slug text)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'org', jsonb_build_object(
      'id', o.id, 'name', o.name, 'slug', o.slug,
      'support_email', o.support_email, 'support_phone', o.support_phone,
      'support_url', o.support_url, 'brand_color', o.brand_color,
      'show_badge', o.plan = 'free'
    ),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status)
                       order by c.position, c.created_at)
        from public.components c where c.org_id = o.id
    ), '[]'::jsonb),
    'incidents', coalesce((
      select jsonb_agg(to_jsonb(x) - 'rn' order by x.resolved_at desc nulls first, x.started_at desc)
        from (
          select i.id, i.title, i.impact, i.status, i.component_ids, i.started_at, i.resolved_at,
                 row_number() over (partition by (i.status = 'resolved') order by i.started_at desc) as rn,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', u.id, 'status', u.status, 'body', u.body, 'created_at', u.created_at)
                            order by u.created_at desc)
                     from public.incident_updates u where u.incident_id = i.id
                 ), '[]'::jsonb) as updates
            from public.incidents i
           where i.org_id = o.id
        ) x
       where x.status <> 'resolved' or x.rn <= 15
    ), '[]'::jsonb)
  )
  from public.organizations o
  where o.slug = lower(p_slug)
$$;

create function public.follow_org(p_device uuid, p_slug text, p_push_token text, p_platform text)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations where slug = lower(p_slug);
  if v_org is null then
    raise exception 'PAGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.devices (id, push_token, platform)
  values (p_device, p_push_token, p_platform)
  on conflict (id) do update
    set push_token = coalesce(excluded.push_token, public.devices.push_token),
        platform   = coalesce(excluded.platform, public.devices.platform),
        updated_at = now();

  insert into public.follows (device_id, org_id) values (p_device, v_org)
  on conflict do nothing;

  return v_org;
end $$;

create function public.unfollow_org(p_device uuid, p_org uuid)
returns void language sql security definer
set search_path = ''
as $$
  delete from public.follows where device_id = p_device and org_id = p_org
$$;

-- Keeps the push token fresh for a device that already follows something.
create function public.register_device(p_device uuid, p_push_token text, p_platform text)
returns void language sql security definer
set search_path = ''
as $$
  update public.devices
     set push_token = p_push_token, platform = coalesce(p_platform, platform), updated_at = now()
   where id = p_device
$$;

-- Removes a device and everything it follows ("forget this device").
create function public.forget_device(p_device uuid)
returns void language sql security definer
set search_path = ''
as $$
  delete from public.devices where id = p_device
$$;

create function public.get_followed(p_device uuid)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'name', o.name, 'slug', o.slug, 'brand_color', o.brand_color,
    'component_statuses', coalesce((
      select jsonb_agg(c.status) from public.components c where c.org_id = o.id
    ), '[]'::jsonb),
    'open_incidents', (
      select count(*)::int from public.incidents i
       where i.org_id = o.id and i.status <> 'resolved'
    )
  ) order by o.name), '[]'::jsonb)
  from public.follows f
  join public.organizations o on o.id = f.org_id
  where f.device_id = p_device
$$;

-- ------------------------------------------------ service-role functions ---

-- Push tokens to notify for an org, capped at the plan's follower allowance
-- (earliest followers first).
create function public.notification_targets(p_org uuid)
returns table (device_id uuid, push_token text)
language sql stable security definer
set search_path = ''
as $$
  select t.device_id, t.push_token
  from (
    select f.device_id, d.push_token
      from public.follows f
      join public.devices d on d.id = f.device_id
     where f.org_id = p_org
     order by f.created_at
     limit (select l.max_followers
              from public.organizations o, public.plan_limits(o.plan) l
             where o.id = p_org)
  ) t
  where t.push_token is not null
$$;

-- ------------------------------------------------------------ privileges ---

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.plan_limits(text),
  public.slug_available(text),
  public.get_status_page(text),
  public.follow_org(uuid, text, text, text),
  public.unfollow_org(uuid, uuid),
  public.register_device(uuid, text, text),
  public.forget_device(uuid),
  public.get_followed(uuid)
to anon, authenticated;

grant execute on function
  public.is_org_owner(uuid),
  public.report_incident(uuid, text, text, uuid[], text, text),
  public.post_incident_update(uuid, text, text),
  public.org_follower_count(uuid),
  public.delete_my_account()
to authenticated;

grant execute on function public.notification_targets(uuid) to service_role;
