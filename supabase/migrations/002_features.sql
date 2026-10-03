-- 002: one-time tasks, checklists, points/streaks/rewards, parent check,
-- photo proof, repeating reminders and notification buttons.
-- Run ONCE in Supabase → SQL Editor, after schema.sql (existing projects too).

-- ───────────────────────────── Tasks ─────────────────────────────
alter table public.tasks
  add column kind text not null default 'repeat' check (kind in ('repeat', 'once')),
  add column due_on date,
  add column points integer not null default 0 check (points between 0 and 1000),
  add column needs_check boolean not null default false,  -- parent confirms before points count
  add column needs_photo boolean not null default false,
  add column checklist text[] not null default '{}'
    check (cardinality(checklist) <= 20);

alter table public.tasks drop constraint tasks_days_mask_check;
alter table public.tasks add constraint tasks_schedule_check check (
  (kind = 'repeat' and days_mask between 1 and 127 and due_on is null)
  or (kind = 'once' and days_mask = 0 and due_on is not null));

-- ───────────────────────────── Results ───────────────────────────
-- Points are copied onto the result when it is recorded, so editing a task's
-- points later never rewrites history. Points count once approved_at is set.
alter table public.task_results
  add column points integer not null default 0,
  add column needs_check boolean not null default false,
  add column approved_at timestamptz,
  add column approved_by uuid references auth.users(id) on delete set null,
  add column photo_path text check (char_length(photo_path) <= 300);

update public.task_results set approved_at = updated_at where state = 'done';
create index task_results_child on public.task_results(child_id);

-- ───────────────────────────── Rewards ───────────────────────────
create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  cost integer not null check (cost between 1 and 100000),
  active boolean not null default true,    -- rewards are retired, never deleted
  created_at timestamptz not null default now(),
  unique (id, family_id)
);
create index rewards_family on public.rewards(family_id);

create table public.reward_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  reward_id uuid not null,
  child_id uuid not null,
  title text not null,                     -- copied: renaming a reward keeps history
  cost integer not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  foreign key (reward_id, family_id) references public.rewards(id, family_id) on delete cascade,
  foreign key (child_id, family_id) references public.children(id, family_id) on delete cascade
);
create index reward_requests_family on public.reward_requests(family_id, status);
create index reward_requests_child on public.reward_requests(child_id);

alter table public.rewards enable row level security;
alter table public.reward_requests enable row level security;
create policy read_rewards on public.rewards for select to authenticated
  using (family_id = (select private.parent_family()) or family_id = (select private.device_family()));
create policy read_reward_requests on public.reward_requests for select to authenticated
  using (family_id = (select private.parent_family()) or child_id = (select private.device_child()));

-- ───────────────────────────── Reminders ─────────────────────────
-- One row per task occurrence that has been reminded. A reminder rings up to
-- 3 times, 5 minutes apart, until answered; "Remind me in 10 min" moves next_at.
-- token_hash authorises the notification's Done / Snooze buttons.
drop table private.reminder_log;
create table private.reminder_state (
  task_id uuid not null references public.tasks(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  local_date date not null,
  sent_count integer not null default 0,
  next_at timestamptz not null,
  token_hash text,
  token_expires timestamptz,
  primary key (task_id, child_id, local_date)
);
create index reminder_state_token on private.reminder_state(token_hash);

create or replace function private.limit_of(p_name text) returns integer
language sql immutable set search_path = '' as $$
  select case p_name
    when 'parents' then 4
    when 'children' then 10
    when 'tasks' then 200
    when 'open_invites' then 20
    when 'push_per_user' then 10
    when 'rewards' then 50
    when 'pending_rewards' then 10
  end
$$;

-- ───────────────────────────── Photos ────────────────────────────
-- Private bucket. Path: <family_id>/<child_id>/<task_id>/<date>-<random>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 1048576, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists proofs_upload on storage.objects;
drop policy if exists proofs_read on storage.objects;
-- Only a child's own phone uploads, and only into its own folder.
create policy proofs_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'proofs'
  and (storage.foldername(name))[1] = (select private.device_family())::text
  and (storage.foldername(name))[2] = (select private.device_child())::text);
-- Parents see their family's photos; a child sees only its own.
create policy proofs_read on storage.objects for select to authenticated using (
  bucket_id = 'proofs'
  and ((storage.foldername(name))[1] = (select private.parent_family())::text
       or (storage.foldername(name))[2] = (select private.device_child())::text));

-- ───────────────────────────── Scheduling helper ─────────────────
create function private.is_due_on(t public.tasks, d date) returns boolean
language sql immutable set search_path = '' as $$
  select case when t.kind = 'once' then d = t.due_on
              else d >= t.starts_on and (t.days_mask & (1 << (extract(isodow from d)::int - 1))) <> 0 end
$$;

-- ───────────────────────────── Recording results ─────────────────
-- Shared by submit_result (app) and notification buttons (server). Callers
-- have already decided who is acting; this enforces the domain rules.
create function private.record_result(
  p_task uuid, p_child uuid, p_date date, p_state text, p_note text,
  p_photo text, p_actor uuid, p_by_parent boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks%rowtype;
  v_today date;
  v_done boolean := p_state = 'done';
begin
  select * into v_task from public.tasks where id = p_task;
  if not found then raise exception 'task_not_found'; end if;
  if not exists (select 1 from public.task_assignees where task_id = p_task and child_id = p_child)
  then raise exception 'not_assigned'; end if;
  if p_state not in ('done', 'help', 'not_done') then raise exception 'invalid_state'; end if;

  v_today := private.family_today(v_task.family_id);
  if not private.is_due_on(v_task, p_date) then raise exception 'not_scheduled'; end if;
  if v_task.kind = 'repeat' then
    if p_date > v_today then raise exception 'date_in_future'; end if;
    -- Children may only change the recent past; parents can correct older records.
    if not p_by_parent and p_date < v_today - 14 then raise exception 'too_old'; end if;
  end if;  -- one-time tasks may be finished early, or late ("late" until done)

  if v_done and v_task.needs_photo and not p_by_parent and p_photo is null
     and not exists (select 1 from public.task_results          -- a photo was already sent
                      where task_id = p_task and child_id = p_child and local_date = p_date
                        and photo_path is not null) then
    raise exception 'photo_required';
  end if;
  if p_photo is not null and not (
       p_photo like v_task.family_id::text || '/' || p_child::text || '/%'
       and exists (select 1 from storage.objects o where o.bucket_id = 'proofs' and o.name = p_photo))
  then raise exception 'photo_invalid'; end if;

  insert into public.task_results as r (task_id, child_id, family_id, local_date, state, note, updated_by,
                                       updated_at, points, needs_check, approved_at, approved_by, photo_path)
  values (p_task, p_child, v_task.family_id, p_date, p_state, left(coalesce(trim(p_note), ''), 500),
          p_actor, now(),
          case when v_done then v_task.points else 0 end,
          v_done and v_task.needs_check and not p_by_parent,
          case when v_done and (p_by_parent or not v_task.needs_check) then now() end,
          case when v_done and p_by_parent then p_actor end,
          p_photo)
  on conflict (task_id, child_id, local_date) do update
    set state = excluded.state, note = excluded.note, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at, points = excluded.points,
        needs_check = excluded.needs_check, approved_at = excluded.approved_at,
        approved_by = excluded.approved_by,
        photo_path = coalesce(excluded.photo_path, r.photo_path);

  if p_state = 'help' and not p_by_parent then
    insert into private.parent_alerts(task_id, child_id, family_id, local_date)
      values (p_task, p_child, v_task.family_id, p_date)
    on conflict do nothing;
  end if;
end $$;

drop function public.submit_result(uuid, uuid, date, text, text);
create function public.submit_result(
  p_task uuid, p_child uuid, p_date date, p_state text, p_note text default '', p_photo text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_family uuid := (select family_id from public.tasks where id = p_task);
  v_by_parent boolean := private.parent_family() is not distinct from v_family and v_family is not null;
begin
  if v_family is null then raise exception 'task_not_found'; end if;
  if not v_by_parent and private.device_child() is distinct from p_child then raise exception 'not_allowed'; end if;
  perform private.record_result(p_task, p_child, p_date, p_state, p_note, p_photo, auth.uid(), v_by_parent);
end $$;

-- Parent accepts a "Done" (points count) or sends it back as "Not done".
create function public.review_result(p_task uuid, p_child uuid, p_date date, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent();
begin
  if p_accept then
    update public.task_results set approved_at = now(), approved_by = auth.uid()
     where task_id = p_task and child_id = p_child and local_date = p_date
       and family_id = v_family and state = 'done';
  else
    update public.task_results
       set state = 'not_done', points = 0, needs_check = false, approved_at = null, approved_by = null,
           note = left(trim(note || ' (Parent: not accepted)'), 500), updated_by = auth.uid(), updated_at = now()
     where task_id = p_task and child_id = p_child and local_date = p_date
       and family_id = v_family and state = 'done';
  end if;
  if not found then raise exception 'result_not_found'; end if;
end $$;

-- ───────────────────────────── Saving tasks ──────────────────────
drop function public.save_task(uuid, text, time, integer, boolean, uuid[]);
create function public.save_task(
  p_id uuid, p_title text, p_time time, p_days integer, p_active boolean, p_assignees uuid[],
  p_kind text default 'repeat', p_due_on date default null, p_points integer default 0,
  p_needs_check boolean default false, p_needs_photo boolean default false,
  p_checklist text[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent(); v_id uuid; v_assignees uuid[]; v_list text[];
begin
  if p_kind not in ('repeat', 'once') then raise exception 'invalid_task_kind'; end if;
  if p_kind = 'once' and p_due_on is null then raise exception 'due_date_required'; end if;
  v_list := array(select left(trim(x), 80) from unnest(coalesce(p_checklist, '{}')) x where trim(x) <> '');
  if cardinality(v_list) > 20 then raise exception 'checklist_too_long'; end if;

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
    insert into public.tasks(family_id, title, days_mask, time_local, active, starts_on,
                             kind, due_on, points, needs_check, needs_photo, checklist)
      values (v_family, trim(p_title), case when p_kind = 'once' then 0 else p_days end, p_time, p_active,
              private.family_today(v_family), p_kind, case when p_kind = 'once' then p_due_on end,
              coalesce(p_points, 0), p_needs_check, p_needs_photo, v_list)
      returning id into v_id;
  else
    update public.tasks
       set title = trim(p_title), days_mask = case when p_kind = 'once' then 0 else p_days end,
           time_local = p_time, active = p_active, kind = p_kind,
           due_on = case when p_kind = 'once' then p_due_on end, points = coalesce(p_points, 0),
           needs_check = p_needs_check, needs_photo = p_needs_photo, checklist = v_list
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

-- ───────────────────────────── Rewards RPCs ──────────────────────
create function public.save_reward(p_id uuid, p_title text, p_cost integer, p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent(); v_id uuid;
begin
  if p_id is null then
    perform 1 from public.families where id = v_family for update;
    if (select count(*) from public.rewards where family_id = v_family) >= private.limit_of('rewards')
    then raise exception 'limit_rewards'; end if;
    insert into public.rewards(family_id, title, cost, active)
      values (v_family, trim(p_title), p_cost, p_active) returning id into v_id;
  else
    update public.rewards set title = trim(p_title), cost = p_cost, active = p_active
     where id = p_id and family_id = v_family returning id into v_id;
    if v_id is null then raise exception 'reward_not_found'; end if;
  end if;
  return v_id;
end $$;

create function private.child_balance(p_child uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(points) from public.task_results
                    where child_id = p_child and state = 'done' and approved_at is not null), 0)
       - coalesce((select sum(cost) from public.reward_requests
                    where child_id = p_child and status in ('pending', 'approved')), 0)
$$;

-- Pending requests reserve points, so a child can't ask for more than they have.
create function public.request_reward(p_reward uuid, p_child uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_reward public.rewards%rowtype; v_id uuid;
begin
  select * into v_reward from public.rewards where id = p_reward and active;
  if not found then raise exception 'reward_not_found'; end if;
  if private.parent_family() is distinct from v_reward.family_id
     and private.device_child() is distinct from p_child then raise exception 'not_allowed'; end if;
  perform 1 from public.children where id = p_child and family_id = v_reward.family_id
                                   and archived_at is null for update;   -- serialize per child
  if not found then raise exception 'child_not_found'; end if;
  if (select count(*) from public.reward_requests where child_id = p_child and status = 'pending')
     >= private.limit_of('pending_rewards') then raise exception 'limit_pending_rewards'; end if;
  if private.child_balance(p_child) < v_reward.cost then raise exception 'not_enough_points'; end if;
  insert into public.reward_requests(family_id, reward_id, child_id, title, cost)
    values (v_reward.family_id, p_reward, p_child, v_reward.title, v_reward.cost) returning id into v_id;
  return v_id;
end $$;

create function public.decide_reward_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_family uuid := private.require_parent();
begin
  update public.reward_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_at = now(), decided_by = auth.uid()
   where id = p_id and family_id = v_family and status = 'pending';
  if not found then raise exception 'request_not_found'; end if;
end $$;

-- Streak: days in a row on which every repeating task was done. Days with
-- nothing scheduled neither break nor extend it; today counts once complete.
create function public.child_stats()
returns table (child_id uuid, streak integer, earned integer, spent integer, balance integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_family uuid := coalesce(private.parent_family(), private.device_family());
  v_only uuid := private.device_child();
  v_today date; v_day date; v_sched integer; v_done integer; c record;
begin
  if v_family is null then return; end if;
  v_today := private.family_today(v_family);
  for c in select ch.id from public.children ch
            where ch.family_id = v_family and ch.archived_at is null
              and (v_only is null or ch.id = v_only) loop
    streak := 0; v_day := v_today;
    for i in 1..120 loop
      select count(*), count(r.task_id) filter (where r.state = 'done') into v_sched, v_done
        from public.tasks t
        join public.task_assignees a on a.task_id = t.id and a.child_id = c.id
        left join public.task_results r on r.task_id = t.id and r.child_id = c.id and r.local_date = v_day
       where t.kind = 'repeat' and t.active and private.is_due_on(t, v_day);
      if v_sched > 0 then
        if v_done = v_sched then streak := streak + 1;
        elsif v_day <> v_today then exit;
        end if;
      end if;
      v_day := v_day - 1;
    end loop;
    child_id := c.id;
    earned := coalesce((select sum(points) from public.task_results tr
                         where tr.child_id = c.id and tr.state = 'done' and tr.approved_at is not null), 0);
    spent := coalesce((select sum(cost) from public.reward_requests rr
                        where rr.child_id = c.id and rr.status in ('pending', 'approved')), 0);
    balance := earned - spent;
    return next;
  end loop;
end $$;

-- ───────────────────────────── Reminders (server only) ───────────
drop function public.claim_due_reminders(timestamptz, interval);
create function public.claim_due_reminders(
  p_now timestamptz default now(), p_lookback interval default interval '15 minutes'
) returns table (task_id uuid, child_id uuid, local_date date, title text, attempt integer,
                 token text, quick_done boolean, endpoint text, p256dh text, auth text)
language sql security definer set search_path = '' as $$
  with occ as (
    select t.id as task_id, a.child_id, d.local_date, t.title,
           (cardinality(t.checklist) = 0 and not t.needs_photo) as quick_done,
           -- Nonexistent local times (DST spring-forward) shift forward; repeated
           -- ones (fall-back) resolve to a single instant.
           ((d.local_date + t.time_local) at time zone f.timezone) as due_at
      from public.families f
      join public.tasks t on t.family_id = f.id and t.active
      join public.task_assignees a on a.task_id = t.id
      join public.children c on c.id = a.child_id and c.archived_at is null
      cross join lateral (values ((p_now at time zone f.timezone)::date),
                                 ((p_now at time zone f.timezone)::date - 1)) d(local_date)
     where private.is_due_on(t, d.local_date)
       and not exists (select 1 from public.task_results r     -- answered: stop ringing
                        where r.task_id = t.id and r.child_id = a.child_id and r.local_date = d.local_date)
  ), due as materialized (
    select o.*, private.new_code() as token
      from occ o
      left join private.reminder_state s
        on s.task_id = o.task_id and s.child_id = o.child_id and s.local_date = o.local_date
     where (s.task_id is null and o.due_at <= p_now and o.due_at > p_now - p_lookback)
        or (s.sent_count < 3 and s.next_at <= p_now and s.next_at > p_now - p_lookback)
  ), claimed as (
    insert into private.reminder_state as s (task_id, child_id, local_date, sent_count, next_at, token_hash, token_expires)
    select task_id, child_id, local_date, 1, p_now + interval '5 minutes', private.code_hash(token), p_now + interval '1 day'
      from due
    on conflict (task_id, child_id, local_date) do update
      set sent_count = s.sent_count + 1, next_at = p_now + interval '5 minutes',
          token_hash = excluded.token_hash, token_expires = excluded.token_expires
      where s.next_at <= p_now and s.sent_count < 3      -- a concurrent run already took it
    returning s.task_id, s.child_id, s.local_date, s.sent_count
  )
  select cl.task_id, cl.child_id, cl.local_date, d.title, cl.sent_count, d.token, d.quick_done,
         ps.endpoint, ps.p256dh, ps.auth
    from claimed cl
    join due d on d.task_id = cl.task_id and d.child_id = cl.child_id and d.local_date = cl.local_date
    join public.child_devices cd on cd.child_id = cl.child_id
    join public.push_subscriptions ps on ps.user_id = cd.user_id
$$;

-- Done / Snooze buttons on a reminder. Returns 'done', 'snoozed', 'open_app'
-- (task needs a checklist or photo) or 'invalid'. Tokens work once.
create function public.use_reminder_token(p_token text, p_action text)
returns text language plpgsql security definer set search_path = '' as $$
declare s private.reminder_state%rowtype; v_task public.tasks%rowtype;
begin
  select * into s from private.reminder_state
   where token_hash = private.code_hash(p_token) and token_expires > now() for update;
  if not found then return 'invalid'; end if;
  if p_action = 'snooze' then
    update private.reminder_state
       set next_at = now() + interval '10 minutes', sent_count = least(sent_count, 2), token_hash = null
     where task_id = s.task_id and child_id = s.child_id and local_date = s.local_date;
    return 'snoozed';
  elsif p_action = 'done' then
    select * into v_task from public.tasks where id = s.task_id;
    if cardinality(v_task.checklist) > 0 or v_task.needs_photo then return 'open_app'; end if;
    perform private.record_result(s.task_id, s.child_id, s.local_date, 'done', '', null, null, false);
    update private.reminder_state set token_hash = null
     where task_id = s.task_id and child_id = s.child_id and local_date = s.local_date;
    return 'done';
  end if;
  return 'invalid';
end $$;

-- Photo cleanup (server only): objects older than 60 days, attached or orphaned.
-- Files must be removed through the Storage API; the Edge Function does that,
-- then calls forget_photos so results stop pointing at them.
create function public.expired_photos(p_limit integer default 100)
returns table (name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
   where o.bucket_id = 'proofs' and o.created_at < now() - interval '60 days'
   order by o.created_at limit p_limit
$$;

create function public.forget_photos(p_names text[])
returns void language sql security definer set search_path = '' as $$
  update public.task_results set photo_path = null where photo_path = any(p_names);
$$;

create or replace function private.cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.reminder_state where local_date < current_date - 30;
  delete from public.invites where expires_at < now() - interval '30 days';
  delete from private.parent_alerts where created_at < now() - interval '30 days';
  delete from auth.users u
   where u.is_anonymous and u.created_at < now() - interval '1 day'
     and not exists (select 1 from public.child_devices d where d.user_id = u.id);
end $$;

-- ───────────────────────────── Grants ────────────────────────────
revoke all on public.rewards, public.reward_requests from anon, authenticated;
grant select on public.rewards, public.reward_requests to authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.parent_family(), private.device_child(),
  private.device_family() to authenticated;

grant execute on function
  public.create_family(text, text, text), public.update_family(text, text),
  public.add_child(text), public.update_child(uuid, text, boolean),
  public.create_invite(text, uuid), public.accept_invite(text, text),
  public.remove_child_device(uuid),
  public.save_task(uuid, text, time, integer, boolean, uuid[], text, date, integer, boolean, boolean, text[]),
  public.delete_task(uuid),
  public.submit_result(uuid, uuid, date, text, text, text),
  public.review_result(uuid, uuid, date, boolean),
  public.save_reward(uuid, text, integer, boolean),
  public.request_reward(uuid, uuid), public.decide_reward_request(uuid, boolean),
  public.child_stats(),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.delete_family(), public.delete_my_account(),
  public.create_recovery_code(), public.has_recovery_code()
  to authenticated;

grant execute on function
  public.claim_due_reminders(timestamptz, interval), public.use_reminder_token(text, text),
  public.claim_parent_alerts(), public.complete_parent_alerts(bigint[]),
  public.find_recovery_user(text, text), public.replace_recovery_code(uuid),
  public.expired_photos(integer), public.forget_photos(text[])
  to service_role;

-- Live updates for the new screens.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rewards, public.reward_requests;
  end if;
end $$;
