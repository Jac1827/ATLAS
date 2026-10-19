-- Optional report delivery is independent of DLR. No subscriptions are seeded.
-- The Worker validates current user/community access on every request and run.
create table public.atlas_report_subscriptions (
  report_subscription_id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.atlas_communities(community_id),
  community_name text not null,
  report_type text not null check (report_type in ('rise_weekly_leasing','investor_community_packet')),
  version integer not null default 1 check (version > 0),
  mode text not null default 'manual' check (mode in ('manual','automated')),
  frequency text not null default 'weekly' check (frequency in ('daily','weekly','monthly')),
  weekday integer not null default 1 check (weekday between 0 and 6),
  month_day integer not null default 1 check (month_day between 1 and 31),
  send_time text not null default '08:00' check (send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'America/New_York',
  period_policy text not null default 'current_month' check (period_policy in ('current_month','previous_month')),
  max_source_age_days integer not null default 7 check (max_source_age_days between 1 and 31),
  recipient_config jsonb not null default '{"resolverVersion":1,"toInvestorContacts":false,"employeeRecipientIds":[]}',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (community_id, report_type),
  check (jsonb_typeof(recipient_config) = 'object')
);

create table public.atlas_report_delivery_history (
  report_delivery_id uuid primary key default gen_random_uuid(),
  report_subscription_id uuid not null references public.atlas_report_subscriptions(report_subscription_id),
  subscription_version integer not null,
  community_id uuid not null references public.atlas_communities(community_id),
  report_type text not null,
  scheduled_date date not null,
  reporting_period text not null check (reporting_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null check (status in ('preparing','held','sending','sent','delivery_uncertain')),
  reason text,
  subject text,
  recipients text[] not null default '{}',
  source_receipt jsonb not null default '{}',
  report_hash text,
  report_payload jsonb not null default '{}',
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (report_subscription_id, scheduled_date)
);
create index atlas_report_delivery_history_scope on public.atlas_report_delivery_history(community_id,report_type,created_at desc);
create index atlas_report_subscriptions_due on public.atlas_report_subscriptions(mode);
create index atlas_report_subscriptions_actor on public.atlas_report_subscriptions(updated_by);
create index atlas_report_subscriptions_creator on public.atlas_report_subscriptions(created_by);
alter table public.atlas_report_subscriptions enable row level security;
alter table public.atlas_report_delivery_history enable row level security;
revoke all on public.atlas_report_subscriptions, public.atlas_report_delivery_history from public, anon, authenticated, service_role;
grant select,insert,update on public.atlas_report_subscriptions, public.atlas_report_delivery_history to service_role;
-- Deliberately no browser write policies, anonymous reads, or DELETE grants.
