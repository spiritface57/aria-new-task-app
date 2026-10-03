-- Aria Family Tasks v2: public, multi-family schema for Supabase.
-- Run once on a NEW project (SQL Editor). Not a migration from v1.
--
-- Security model (read this before changing anything):
--   * Clients READ through RLS-protected tables (SELECT is the only table grant).
--   * Every WRITE goes through a SECURITY DEFINER function that validates the
--     domain rules. Supabase grants INSERT/UPDATE/DELETE on public tables to
--     anon/authenticated by default; this file revokes them explicitly.
--   * Errors are raised as stable snake_case codes; the UI maps them to text.
--
-- Identity model:
--   * A parent is an email/password user, member of exactly one family.
--   * A child is a PROFILE (public.children), not a login. Phones/browsers are
--     linked to a profile through public.child_devices using anonymous logins.
--     Losing a device loses nothing: a parent links a new one to the same profile.

create schema if not exists private;

-- ───────────────────────────── Tables ─────────────────────────────

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null,                 -- IANA name; validated in RPCs
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.parents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  joined_at timestamptz not null default now()
);
create index parents_family on public.parents(family_id);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, family_id)                  -- target for same-family composite FKs
);
create index children_family on public.children(family_id);

create table public.child_devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  child_id uuid not null,
  family_id uuid not null,
  linked_at timestamptz not null default now(),
  foreign key (child_id, family_id) references public.children(id, family_id) on delete cascade
);
create index child_devices_child on public.child_devices(child_id);

create table public.invites (
  code_hash text primary key,             -- sha256 of the code; plaintext is never stored
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('parent', 'child_device')),
  child_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check ((kind = 'child_device') = (child_id is not null)),
  foreign key (child_id, family_id) references public.children(id, family_id) on delete cascade
);
create index invites_family on public.invites(family_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  days_mask integer not null check (days_mask between 1 and 127), -- bit0 = Monday
  time_local time not null,               -- wall-clock time in families.timezone
  active boolean not null default true,
  starts_on date not null,                -- family-local date the task was created
  created_at timestamptz not null default now(),
  unique (id, family_id)
);
create index tasks_family on public.tasks(family_id);

-- Composite FKs make "task and child belong to the same family" impossible to violate.
create table public.task_assignees (
  task_id uuid not null,
  child_id uuid not null,
  family_id uuid not null,
  primary key (task_id, child_id),
  foreign key (task_id, family_id) references public.tasks(id, family_id) on delete cascade,
  foreign key (child_id, family_id) references public.children(id, family_id) on delete cascade
);
create index task_assignees_child on public.task_assignees(child_id);

create table public.task_results (
  task_id uuid not null,
  child_id uuid not null,
  family_id uuid not null,
  local_date date not null,
  state text not null check (state in ('done', 'help', 'not_done')),
  note text not null default '' check (char_length(note) <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (task_id, child_id, local_date),
  -- Deliberately NOT referencing task_assignees: unassigning a child keeps history.
  foreign key (task_id, family_id) references public.tasks(id, family_id) on delete cascade,
  foreign key (child_id, family_id) references public.children(id, family_id) on delete cascade
);
create index task_results_family_date on public.task_results(family_id, local_date);

create table public.push_subscriptions (
  endpoint text primary key check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions(user_id);

-- Idempotency for reminders. Server-only; clients have no access to schema private.
create table private.reminder_log (
  task_id uuid not null references public.tasks(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (task_id, child_id, local_date)
);

-- Outbox for "Need help" pushes to parents. Unlike reminders this is
-- at-least-once: rows are retried until a push is delivered (max 5 attempts).
create table private.parent_alerts (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  unique (task_id, child_id, local_date)   -- one help alert per task, child and day
);

-- Parents sign in with email + password and no email server, so a forgotten
-- password is recovered with a one-time recovery code instead of a reset email.
create table private.recovery_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── Limits ─────────────────────────────
-- Public app: every family-scoped insert is capped to bound abuse and cost.
create function private.limit_of(p_name text) returns integer
language sql immutable set search_path = '' as $$
  select case p_name
    when 'parents' then 4
    when 'children' then 10
    when 'tasks' then 200
    when 'open_invites' then 20
    when 'push_per_user' then 10
  end
$$;

-- ───────────────────────────── Caller helpers ─────────────────────
create function private.parent_family() returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.parents where user_id = (select auth.uid())
$$;

create function private.device_child() returns uuid
language sql stable security definer set search_path = '' as $$
  select child_id from public.child_devices where user_id = (select auth.uid())
$$;

create function private.device_family() returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.child_devices where user_id = (select auth.uid())
$$;

create function private.is_anonymous() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true)
$$;

create function private.family_today(p_family uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone f.timezone)::date from public.families f where f.id = p_family
$$;

create function private.require_parent() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := private.parent_family();
begin
  if v is null then raise exception 'parents_only'; end if;
  return v;
end $$;

-- One-time codes (invites, recovery): 128 random bits shown as 32 hex characters.
-- Only the sha256 is stored. Typed codes may contain spaces, dashes or lowercase.
create function private.new_code() returns text
language sql volatile set search_path = '' as $$
  select upper(replace(gen_random_uuid()::text, '-', ''))
$$;

create function private.code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'UTF8')), 'hex')
$$;

create function private.valid_timezone(p_tz text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz)
$$;

-- ───────────────────────────── RLS (reads) ────────────────────────
alter table public.families enable row level security;
alter table public.parents enable row level security;
alter table public.children enable row level security;
alter table public.child_devices enable row level security;
alter table public.invites enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_results enable row level security;
alter table public.push_subscriptions enable row level security;

create policy read_family on public.families for select to authenticated
  using (id = (select private.parent_family()) or id = (select private.device_family()));
create policy read_parents on public.parents for select to authenticated
  using (family_id = (select private.parent_family()) or family_id = (select private.device_family()));
-- A child device sees only its own profile, not siblings.
create policy read_children on public.children for select to authenticated
  using (family_id = (select private.parent_family()) or id = (select private.device_child()));
create policy read_devices on public.child_devices for select to authenticated
  using (family_id = (select private.parent_family()) or user_id = (select auth.uid()));
-- invites: no policy. Codes are shown once, at creation.
create policy read_tasks on public.tasks for select to authenticated
  using (family_id = (select private.parent_family())
         or exists (select 1 from public.task_assignees a
                     where a.task_id = tasks.id and a.child_id = (select private.device_child())));
create policy read_assignees on public.task_assignees for select to authenticated
  using (family_id = (select private.parent_family()) or child_id = (select private.device_child()));
create policy read_results on public.task_results for select to authenticated
  using (family_id = (select private.parent_family()) or child_id = (select private.device_child()));
create policy read_own_push on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- ───────────────────────────── RPCs (writes) ──────────────────────

create function public.create_family(p_name text, p_display_name text, p_timezone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_family uuid;
begin
  if auth.uid() is null or private.is_anonymous() then raise exception 'email_account_required'; end if;
  if private.parent_family() is not null or private.device_child() is not null then
    raise exception 'already_in_family';
  end if;
  if not private.valid_timezone(p_timezone) then raise exception 'invalid_timezone'; end if;
  insert into public.families(name, timezone, created_by)
    values (trim(p_name), p_timezone, auth.uid()) returning id into v_family;
  insert into public.parents(user_id, family_id, display_name)
    values (auth.uid(), v_family, trim(p_display_name));
  return v_family;
end $$;

create function public.update_family(p_name text, p_timezone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent();
begin
  if not private.valid_timezone(p_timezone) then raise exception 'invalid_timezone'; end if;
  update public.families set name = trim(p_name), timezone = p_timezone where id = v_family;
end $$;

create function public.add_child(p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent(); v_id uuid;
begin
  perform 1 from public.families where id = v_family for update; -- serialize limit checks
  if (select count(*) from public.children where family_id = v_family and archived_at is null)
     >= private.limit_of('children') then raise exception 'limit_children'; end if;
  insert into public.children(family_id, display_name) values (v_family, trim(p_display_name))
    returning id into v_id;
  return v_id;
end $$;

create function public.update_child(p_child uuid, p_display_name text, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent();
begin
  update public.children
     set display_name = trim(p_display_name),
         archived_at = case when p_archived then coalesce(archived_at, now()) else null end
   where id = p_child and family_id = v_family;
  if not found then raise exception 'child_not_found'; end if;
  if p_archived then delete from public.child_devices where child_id = p_child; end if;
end $$;

-- Returns the plaintext code exactly once.
create function public.create_invite(p_kind text, p_child uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent(); v_code text;
begin
  if p_kind not in ('parent', 'child_device') then raise exception 'invalid_invite_kind'; end if;
  if p_kind = 'child_device' and not exists (
       select 1 from public.children where id = p_child and family_id = v_family and archived_at is null)
  then raise exception 'child_not_found'; end if;
  perform 1 from public.families where id = v_family for update;
  if (select count(*) from public.invites
       where family_id = v_family and consumed_at is null and expires_at > now())
     >= private.limit_of('open_invites') then raise exception 'limit_invites'; end if;
  v_code := private.new_code();
  insert into public.invites(code_hash, family_id, kind, child_id, created_by, expires_at)
    values (private.code_hash(v_code), v_family, p_kind,
            case when p_kind = 'child_device' then p_child end, auth.uid(),
            now() + case when p_kind = 'parent' then interval '7 days' else interval '24 hours' end);
  return v_code;
end $$;

create function public.accept_invite(p_code text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.invites%rowtype;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if private.parent_family() is not null or private.device_child() is not null then
    raise exception 'already_in_family';
  end if;
  select * into v_inv from public.invites
   where code_hash = private.code_hash(p_code)
     and consumed_at is null and expires_at > now()
   for update;
  if not found then raise exception 'invite_invalid'; end if;

  if v_inv.kind = 'parent' then
    if private.is_anonymous() then raise exception 'email_account_required'; end if;
    if coalesce(trim(p_display_name), '') = '' then raise exception 'name_required'; end if;
    perform 1 from public.families where id = v_inv.family_id for update;
    if (select count(*) from public.parents where family_id = v_inv.family_id)
       >= private.limit_of('parents') then raise exception 'limit_parents'; end if;
    insert into public.parents(user_id, family_id, display_name)
      values (auth.uid(), v_inv.family_id, trim(p_display_name));
  else
    if exists (select 1 from public.children where id = v_inv.child_id and archived_at is not null)
    then raise exception 'invite_invalid'; end if;
    insert into public.child_devices(user_id, child_id, family_id)
      values (auth.uid(), v_inv.child_id, v_inv.family_id);
  end if;

  update public.invites set consumed_at = now() where code_hash = v_inv.code_hash;
  return jsonb_build_object('family_id', v_inv.family_id, 'role',
           case when v_inv.kind = 'parent' then 'parent' else 'child' end,
           'child_id', v_inv.child_id);
end $$;

-- Lost or replaced phone: a parent cuts its access immediately.
create function public.remove_child_device(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent();
begin
  delete from public.child_devices where user_id = p_user and family_id = v_family;
  if not found then raise exception 'device_not_found'; end if;
end $$;

-- Create (p_id null) or edit a task and its assignees atomically.
create function public.save_task(
  p_id uuid, p_title text, p_time time, p_days integer, p_active boolean, p_assignees uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent(); v_id uuid; v_assignees uuid[];
begin
  v_assignees := array(select distinct unnest(coalesce(p_assignees, '{}')));
  if cardinality(v_assignees) = 0 then raise exception 'assignee_required'; end if;
  if exists (select 1 from unnest(v_assignees) a(id)
              where not exists (select 1 from public.children c
                                 where c.id = a.id and c.family_id = v_family and c.archived_at is null))
  then raise exception 'child_not_found'; end if;

  if p_id is null then
    perform 1 from public.families where id = v_family for update;
    if (select count(*) from public.tasks where family_id = v_family) >= private.limit_of('tasks')
    then raise exception 'limit_tasks'; end if;
    insert into public.tasks(family_id, title, days_mask, time_local, active, starts_on)
      values (v_family, trim(p_title), p_days, p_time, p_active, private.family_today(v_family))
      returning id into v_id;
  else
    update public.tasks
       set title = trim(p_title), days_mask = p_days, time_local = p_time, active = p_active
     where id = p_id and family_id = v_family
     returning id into v_id;
    if v_id is null then raise exception 'task_not_found'; end if;
    delete from public.task_assignees where task_id = v_id and child_id <> all (v_assignees);
  end if;

  insert into public.task_assignees(task_id, child_id, family_id)
    select v_id, a, v_family from unnest(v_assignees) a
  on conflict do nothing;
  return v_id;
end $$;

create function public.delete_task(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent();
begin
  delete from public.tasks where id = p_id and family_id = v_family;
  if not found then raise exception 'task_not_found'; end if;
end $$;

-- Children report their own results; parents may record on a child's behalf.
create function public.submit_result(
  p_task uuid, p_child uuid, p_date date, p_state text, p_note text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_parent_family uuid := private.parent_family();
  v_task public.tasks%rowtype;
  v_today date;
begin
  select * into v_task from public.tasks where id = p_task;
  if not found then raise exception 'task_not_found'; end if;

  if v_parent_family is distinct from v_task.family_id
     and private.device_child() is distinct from p_child then
    raise exception 'not_allowed';
  end if;
  if not exists (select 1 from public.task_assignees where task_id = p_task and child_id = p_child)
  then raise exception 'not_assigned'; end if;

  v_today := private.family_today(v_task.family_id);
  if p_date > v_today then raise exception 'date_in_future'; end if;
  if p_date < v_task.starts_on then raise exception 'not_scheduled'; end if;
  if (v_task.days_mask & (1 << (extract(isodow from p_date)::int - 1))) = 0 then
    raise exception 'not_scheduled';
  end if;
  -- Children may only change the recent past; parents can correct older records.
  if v_parent_family is null and p_date < v_today - 14 then raise exception 'too_old'; end if;
  if p_state not in ('done', 'help', 'not_done') then raise exception 'invalid_state'; end if;

  insert into public.task_results(task_id, child_id, family_id, local_date, state, note, updated_by, updated_at)
    values (p_task, p_child, v_task.family_id, p_date, p_state,
            left(coalesce(trim(p_note), ''), 500), auth.uid(), now())
  on conflict (task_id, child_id, local_date) do update
    set state = excluded.state, note = excluded.note,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  -- Only the child asking for help alerts parents, not a parent recording it.
  if p_state = 'help' and v_parent_family is null then
    insert into private.parent_alerts(task_id, child_id, family_id, local_date)
      values (p_task, p_child, v_task.family_id, p_date)
    on conflict do nothing;
  end if;
end $$;

-- Endpoint is the key: a shared tablet that switches users moves to the new user.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if (select count(*) from public.push_subscriptions
       where user_id = auth.uid() and endpoint <> p_endpoint) >= private.limit_of('push_per_user')
  then raise exception 'limit_push'; end if;
  insert into public.push_subscriptions(endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;

create function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
$$;

-- Erases the whole family. Auth accounts are removed separately (Edge Function).
create function public.delete_family()
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent();
begin
  delete from public.families where id = v_family;
end $$;

-- ───────────────────────────── Reminders (server only) ────────────
-- Called every minute by the send-reminders Edge Function with the service role.
-- Claims due reminders BEFORE sending (at-most-once): a failed push is not
-- retried, but a retry storm can never spam a child.
-- Lookback covers cron jitter/outages; anything older is skipped, not sent late.
create function public.claim_due_reminders(
  p_now timestamptz default now(), p_lookback interval default interval '15 minutes'
) returns table (task_id uuid, child_id uuid, local_date date, title text,
                 endpoint text, p256dh text, auth text)
language sql security definer set search_path = '' as $$
  with candidates as (
    select t.id as task_id, a.child_id, d.local_date, t.title,
           -- Nonexistent local times (DST spring-forward) shift forward; repeated
           -- ones (fall-back) resolve to a single instant. Either way: one reminder.
           ((d.local_date + t.time_local) at time zone f.timezone) as due_at
      from public.families f
      join public.tasks t on t.family_id = f.id and t.active
      join public.task_assignees a on a.task_id = t.id
      join public.children c on c.id = a.child_id and c.archived_at is null
      cross join lateral (values ((p_now at time zone f.timezone)::date),
                                 ((p_now at time zone f.timezone)::date - 1)) d(local_date)
     where (t.days_mask & (1 << (extract(isodow from d.local_date)::int - 1))) <> 0
       and d.local_date >= t.starts_on
  ), due as (
    select * from candidates c
     where c.due_at <= p_now and c.due_at > p_now - p_lookback
       and not exists (select 1 from public.task_results r       -- already answered
                        where r.task_id = c.task_id and r.child_id = c.child_id
                          and r.local_date = c.local_date)
  ), claimed as (
    insert into private.reminder_log(task_id, child_id, local_date)
      select task_id, child_id, local_date from due
    on conflict do nothing
    returning task_id, child_id, local_date
  )
  select cl.task_id, cl.child_id, cl.local_date, d.title, s.endpoint, s.p256dh, s.auth
    from claimed cl
    join due d using (task_id, child_id, local_date)
    join public.child_devices cd on cd.child_id = cl.child_id
    join public.push_subscriptions s on s.user_id = cd.user_id
$$;

-- Claims pending help alerts and returns one row per parent push endpoint.
-- A claimed row becomes claimable again after 2 minutes unless completed.
create function public.claim_parent_alerts()
returns table (alert_id bigint, child_name text, title text,
               endpoint text, p256dh text, auth text)
language sql security definer set search_path = '' as $$
  with picked as (
    select id from private.parent_alerts
     where sent_at is null and attempts < 5
       and created_at > now() - interval '1 day'
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
     order by id limit 200
     for update skip locked
  ), claimed as (
    update private.parent_alerts a
       set claimed_at = now(), attempts = a.attempts + 1
      from picked where a.id = picked.id
    returning a.id, a.task_id, a.child_id, a.family_id
  )
  select cl.id, c.display_name, t.title, s.endpoint, s.p256dh, s.auth
    from claimed cl
    join public.children c on c.id = cl.child_id
    join public.tasks t on t.id = cl.task_id
    join public.parents p on p.family_id = cl.family_id
    join public.push_subscriptions s on s.user_id = p.user_id
$$;

create function public.complete_parent_alerts(p_ids bigint[])
returns void language sql security definer set search_path = '' as $$
  update private.parent_alerts set sent_at = now() where id = any(p_ids) and sent_at is null;
$$;

-- Deletes the caller's login. The last parent deleting their account also
-- deletes the family and all of its data (the UI warns before this).
create function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.parent_family();
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if v_family is not null
     and (select count(*) from public.parents where family_id = v_family) = 1 then
    delete from public.families where id = v_family;
  end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ───────────────────────────── Password recovery ─────────────────

create function private.rotate_recovery_code(p_user uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_code text := private.new_code();
begin
  insert into private.recovery_codes(user_id, code_hash) values (p_user, private.code_hash(v_code))
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now();
  return v_code;
end $$;

-- Signed-in parent: create or replace their recovery code. Shown once.
create function public.create_recovery_code()
returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_anonymous() then raise exception 'email_account_required'; end if;
  return private.rotate_recovery_code(auth.uid());
end $$;

create function public.has_recovery_code()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.recovery_codes where user_id = (select auth.uid()))
$$;

-- Server only (reset-password Edge Function). Returns the user only when both
-- email and code match, so wrong emails and wrong codes look identical.
create function public.find_recovery_user(p_email text, p_code text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
    join private.recovery_codes r on r.user_id = u.id
   where lower(u.email) = lower(trim(p_email))
     and not coalesce(u.is_anonymous, false)
     and r.code_hash = private.code_hash(p_code)
$$;

-- Server only: after a successful reset the old code stops working.
create function public.replace_recovery_code(p_user uuid)
returns text language sql security definer set search_path = '' as $$
  select private.rotate_recovery_code(p_user)
$$;

-- Daily housekeeping, scheduled with pg_cron (see cron.sql).
create function private.cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.reminder_log where sent_at < now() - interval '30 days';
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from private.parent_alerts where created_at < now() - interval '30 days';
  -- Anonymous logins that never linked to a child are abandoned or abuse.
  delete from auth.users u
   where u.is_anonymous and u.created_at < now() - interval '1 day'
     and not exists (select 1 from public.child_devices d where d.user_id = u.id);
end $$;

-- ───────────────────────────── Grants ─────────────────────────────
-- Supabase default privileges grant ALL on public tables/functions to anon and
-- authenticated. Revoke everything, then grant back only what is intended.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

grant select on public.families, public.parents, public.children, public.child_devices,
  public.tasks, public.task_assignees, public.task_results, public.push_subscriptions
  to authenticated;

-- RLS policies call these helpers as the caller, so they need usage/execute.
grant usage on schema private to authenticated;
grant execute on function private.parent_family(), private.device_child(),
  private.device_family() to authenticated;

grant execute on function
  public.create_family(text, text, text), public.update_family(text, text),
  public.add_child(text), public.update_child(uuid, text, boolean),
  public.create_invite(text, uuid), public.accept_invite(text, text),
  public.remove_child_device(uuid),
  public.save_task(uuid, text, time, integer, boolean, uuid[]), public.delete_task(uuid),
  public.submit_result(uuid, uuid, date, text, text),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.delete_family(), public.delete_my_account(),
  public.create_recovery_code(), public.has_recovery_code()
  to authenticated;

grant execute on function public.claim_due_reminders(timestamptz, interval),
  public.claim_parent_alerts(), public.complete_parent_alerts(bigint[]),
  public.find_recovery_user(text, text), public.replace_recovery_code(uuid) to service_role;

-- Scheduling, Realtime and secrets: run supabase/cron.sql after this file.
