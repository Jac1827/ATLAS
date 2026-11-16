-- ATLAS employee notification ticker and access-change publication.
-- Safe payloads only: never copy access_notes, salary, payroll, or bonus amounts here.

create table if not exists atlas_employee_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_employee_id uuid references atlas_employees(employee_id) on delete set null,
  recipient_email text not null,
  event_key text not null unique,
  event_type text not null,
  title text not null,
  message text not null,
  module_key text,
  destination_tab_id text,
  destination_page_key text,
  community_id uuid references atlas_communities(community_id) on delete set null,
  behavior text not null default 'auto_expire'
    check (behavior in ('until_viewed','until_dismissed','auto_expire')),
  requires_acknowledgement boolean not null default false,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  viewed_at timestamptz,
  dismissed_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_atlas_employee_notifications_recipient
on atlas_employee_notifications(recipient_user_id, published_at desc);

create index if not exists idx_atlas_employee_notifications_email
on atlas_employee_notifications(lower(recipient_email), published_at desc);

alter table atlas_employee_notifications enable row level security;

drop policy if exists atlas_employee_notifications_read on atlas_employee_notifications;
create policy atlas_employee_notifications_read
on atlas_employee_notifications for select to authenticated
using (
  recipient_user_id = auth.uid()
  or lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or atlas_has_role(array['admin'])
);

revoke all on table atlas_employee_notifications from anon;
revoke insert, update, delete on table atlas_employee_notifications from authenticated;
grant select on table atlas_employee_notifications to authenticated;

create or replace function atlas_employee_notification_action(
  p_notification_id uuid,
  p_action text default 'view'
)
returns table(notification_id uuid, viewed_at timestamptz, dismissed_at timestamptz, acknowledged_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_action text := lower(trim(coalesce(p_action, 'view')));
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  if v_action not in ('view','dismiss','acknowledge') then
    raise exception 'Invalid notification action.' using errcode = '22023';
  end if;

  return query
  update atlas_employee_notifications n
  set viewed_at = case when v_action in ('view','dismiss','acknowledge') then coalesce(n.viewed_at, now()) else n.viewed_at end,
      dismissed_at = case when v_action = 'dismiss' then coalesce(n.dismissed_at, now()) else n.dismissed_at end,
      acknowledged_at = case when v_action = 'acknowledge' then coalesce(n.acknowledged_at, now()) else n.acknowledged_at end
  where n.notification_id = p_notification_id
    and (n.recipient_user_id = v_actor or lower(n.recipient_email) = v_email or atlas_has_role(array['admin']))
  returning n.notification_id, n.viewed_at, n.dismissed_at, n.acknowledged_at;
end;
$$;

create or replace function atlas_admin_publish_employee_notification(
  p_recipient_email text,
  p_recipient_employee_id uuid default null,
  p_event_key text default null,
  p_event_type text default 'data_update',
  p_title text default 'ATLAS update',
  p_message text default '',
  p_module_key text default null,
  p_destination_tab_id text default null,
  p_destination_page_key text default null,
  p_community_id uuid default null,
  p_behavior text default 'auto_expire',
  p_requires_acknowledgement boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_id uuid;
  v_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_behavior text := lower(trim(coalesce(p_behavior, 'auto_expire')));
  v_recipient_user_id uuid;
begin
  if auth.uid() is null or not atlas_has_role(array['admin']) then
    raise exception 'Only an active Atlas Admin can publish employee notices.' using errcode = '42501';
  end if;
  if v_email = '' or trim(coalesce(p_event_key, '')) = '' or trim(coalesce(p_message, '')) = '' then
    raise exception 'Recipient, event key, and message are required.' using errcode = '22023';
  end if;
  if v_behavior not in ('until_viewed','until_dismissed','auto_expire') then
    raise exception 'Invalid notification behavior.' using errcode = '22023';
  end if;

  select u.id into v_recipient_user_id
  from auth.users u where lower(u.email) = v_email
  order by u.created_at desc limit 1;

  insert into atlas_employee_notifications(
    recipient_user_id, recipient_employee_id, recipient_email, event_key, event_type,
    title, message, module_key, destination_tab_id, destination_page_key,
    community_id, behavior, requires_acknowledgement, expires_at
  ) values (
    v_recipient_user_id, p_recipient_employee_id, v_email, trim(p_event_key), trim(p_event_type),
    left(trim(p_title), 160), left(trim(p_message), 800), nullif(trim(p_module_key), ''),
    nullif(trim(p_destination_tab_id), ''), nullif(trim(p_destination_page_key), ''),
    p_community_id, v_behavior, coalesce(p_requires_acknowledgement, false),
    case when v_behavior = 'auto_expire' then now() + interval '12 hours' else null end
  )
  on conflict (event_key) do nothing
  returning atlas_employee_notifications.notification_id into v_notification_id;

  return v_notification_id;
end;
$$;

create or replace function atlas_publish_access_change_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed text[] := '{}';
  v_message text;
  v_key text;
begin
  if tg_op = 'UPDATE' and
     new.role is not distinct from old.role and
     new.status is not distinct from old.status and
     new.access_status is not distinct from old.access_status and
     new.account_status is not distinct from old.account_status and
     new.allowed_community_ids is not distinct from old.allowed_community_ids and
     new.allowed_market_values is not distinct from old.allowed_market_values and
     new.allowed_region_values is not distinct from old.allowed_region_values and
     new.locked_tab_ids is not distinct from old.locked_tab_ids and
     new.locked_page_keys is not distinct from old.locked_page_keys and
     new.bonus_permissions is not distinct from old.bonus_permissions then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_changed := array_append(v_changed, 'ATLAS access record created');
  else
    if new.role is distinct from old.role then v_changed := array_append(v_changed, 'role changed to ' || replace(new.role, '_', ' ')); end if;
    if new.status is distinct from old.status or new.access_status is distinct from old.access_status then v_changed := array_append(v_changed, 'access status changed'); end if;
    if new.account_status is distinct from old.account_status then v_changed := array_append(v_changed, 'account status changed'); end if;
    if new.allowed_community_ids is distinct from old.allowed_community_ids then v_changed := array_append(v_changed, 'property access changed'); end if;
    if new.allowed_market_values is distinct from old.allowed_market_values or new.allowed_region_values is distinct from old.allowed_region_values then v_changed := array_append(v_changed, 'location access changed'); end if;
    if new.locked_tab_ids is distinct from old.locked_tab_ids or new.locked_page_keys is distinct from old.locked_page_keys then v_changed := array_append(v_changed, 'page access changed'); end if;
    if new.bonus_permissions is distinct from old.bonus_permissions then v_changed := array_append(v_changed, 'Bonus and Incentives access changed'); end if;
  end if;

  v_message := array_to_string(v_changed, '; ') || '. Open Employee Access to review your current permissions.';
  v_key := 'access:' || new.invite_id::text || ':' || md5(concat_ws('|', new.role, new.status, new.access_status, new.account_status, new.allowed_community_ids::text, new.allowed_market_values::text, new.allowed_region_values::text, new.locked_tab_ids::text, new.locked_page_keys::text, new.bonus_permissions::text));

  insert into atlas_employee_notifications(
    recipient_user_id, recipient_employee_id, recipient_email, event_key, event_type,
    title, message, module_key, destination_tab_id, destination_page_key,
    behavior, requires_acknowledgement
  ) values (
    coalesce(new.auth_user_id, new.claimed_user_id), new.employee_id, lower(new.email), v_key,
    'access_change', 'Your ATLAS access changed', v_message, 'employee_access', 'settings',
    'employee-access', 'until_dismissed', true
  ) on conflict (event_key) do nothing;

  return new;
end;
$$;

drop trigger if exists atlas_user_access_notification on atlas_user_access_invites;
create trigger atlas_user_access_notification
after insert or update on atlas_user_access_invites
for each row execute function atlas_publish_access_change_notification();

revoke execute on function atlas_employee_notification_action(uuid,text) from public, anon;
revoke execute on function atlas_admin_publish_employee_notification(text,uuid,text,text,text,text,text,text,text,uuid,text,boolean) from public, anon;
grant execute on function atlas_employee_notification_action(uuid,text) to authenticated;
grant execute on function atlas_admin_publish_employee_notification(text,uuid,text,text,text,text,text,text,text,uuid,text,boolean) to authenticated;
