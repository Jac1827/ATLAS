create extension if not exists pgcrypto;

create table if not exists atlas_dlr_snapshots (
  dlr_snapshot_id uuid primary key default gen_random_uuid(),
  community_id uuid references atlas_communities(community_id),
  community_name text not null,
  reporting_date date not null,
  reporting_month date not null,
  report_period_label text,
  status text not null default 'reviewed' check (status in ('draft','reviewed','approved','queued','sent','superseded','blocked')),
  source_module text not null default 'atlas_dlr',
  source_identifier text,
  source_hash text,
  report_hash text not null,
  report_payload jsonb not null,
  delivery_settings jsonb not null default '{}',
  recipient_snapshot jsonb not null default '[]',
  readiness jsonb not null default '{}',
  prepared_by uuid references auth.users(id),
  prepared_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (nullif(trim(community_name), '') is not null),
  check (reporting_month = date_trunc('month', reporting_month)::date),
  check (jsonb_typeof(report_payload) = 'object'),
  check (jsonb_typeof(delivery_settings) = 'object'),
  check (jsonb_typeof(recipient_snapshot) = 'array'),
  check (jsonb_typeof(readiness) = 'object'),
  unique (community_name, reporting_date, report_hash)
);

create table if not exists atlas_dlr_delivery_subscriptions (
  dlr_subscription_id uuid primary key default gen_random_uuid(),
  community_id uuid references atlas_communities(community_id),
  community_name text not null,
  status text not null default 'active' check (status in ('active','paused','disabled')),
  frequency_mode text not null default 'manual' check (frequency_mode in ('manual','daily','weekly','selected_days','daily_and_weekly')),
  selected_weekdays text[] not null default '{}',
  weekly_send_day text not null default 'monday' check (weekly_send_day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  send_time text not null default '08:00' check (send_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  timezone text not null default 'America/New_York',
  automation_mode text not null default 'draft_only' check (automation_mode in ('draft_only','approval_required','fully_automated')),
  send_without_box_score boolean not null default true,
  notify_if_data_missing boolean not null default true,
  require_approval_if_critical boolean not null default true,
  send_on_weekends boolean not null default false,
  send_on_holidays boolean not null default false,
  recipient_config jsonb not null default '{}',
  last_snapshot_id uuid references atlas_dlr_snapshots(dlr_snapshot_id),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (nullif(trim(community_name), '') is not null),
  check (jsonb_typeof(recipient_config) = 'object')
);

create unique index if not exists idx_atlas_dlr_delivery_subscriptions_active
on atlas_dlr_delivery_subscriptions(lower(community_name))
where deleted_at is null;

create table if not exists atlas_dlr_delivery_history (
  dlr_delivery_id uuid primary key default gen_random_uuid(),
  dlr_snapshot_id uuid references atlas_dlr_snapshots(dlr_snapshot_id),
  dlr_subscription_id uuid references atlas_dlr_delivery_subscriptions(dlr_subscription_id),
  community_id uuid references atlas_communities(community_id),
  community_name text not null,
  cadence text not null default 'daily' check (cadence in ('daily','weekly','selected_days','manual')),
  scheduled_date date not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped','awaiting_approval','no_snapshot','no_recipients','provider_not_configured')),
  provider text not null default 'cloudflare_email_service',
  provider_message_id text,
  from_email text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  bcc_emails text[] not null default '{}',
  subject text,
  html_hash text,
  text_hash text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(trim(community_name), '') is not null),
  check (attempt_count >= 0),
  check (jsonb_typeof(metadata) = 'object'),
  unique (community_name, cadence, scheduled_date)
);

alter table atlas_dlr_snapshots enable row level security;
alter table atlas_dlr_delivery_subscriptions enable row level security;
alter table atlas_dlr_delivery_history enable row level security;

create policy "atlas dlr snapshots scoped read"
on atlas_dlr_snapshots for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','centra','executive','finance','regional'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas dlr snapshot writers"
on atlas_dlr_snapshots for all to authenticated
using (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
)
with check (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
);

create policy "atlas dlr subscriptions scoped read"
on atlas_dlr_delivery_subscriptions for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','centra','executive','finance','regional'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas dlr subscription writers"
on atlas_dlr_delivery_subscriptions for all to authenticated
using (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
)
with check (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
);

create policy "atlas dlr delivery history scoped read"
on atlas_dlr_delivery_history for select to authenticated
using (
  atlas_has_role(array['admin','centra','executive','finance','regional'])
  or atlas_can_access_community(community_id)
);

create policy "atlas dlr delivery history writers"
on atlas_dlr_delivery_history for all to authenticated
using (atlas_has_role(array['admin','centra','executive','finance']))
with check (atlas_has_role(array['admin','centra','executive','finance']));

create index if not exists idx_atlas_dlr_snapshots_reporting
on atlas_dlr_snapshots(reporting_date desc, lower(community_name), status)
where deleted_at is null;

create index if not exists idx_atlas_dlr_snapshots_community_prepared
on atlas_dlr_snapshots(lower(community_name), prepared_at desc)
where deleted_at is null;

create index if not exists idx_atlas_dlr_delivery_history_schedule
on atlas_dlr_delivery_history(scheduled_date desc, status, lower(community_name));

create index if not exists idx_atlas_dlr_delivery_history_snapshot
on atlas_dlr_delivery_history(dlr_snapshot_id, created_at desc);

grant select, insert, update on atlas_dlr_snapshots to authenticated;
grant select, insert, update on atlas_dlr_delivery_subscriptions to authenticated;
grant select, insert, update on atlas_dlr_delivery_history to authenticated;