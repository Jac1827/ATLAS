-- Immutable annual forecasts; activation and draft scenarios never write approved budgets.
begin;
create table if not exists public.atlas_utility_forecast_vintages (
 id uuid primary key default gen_random_uuid(), fiscal_year integer not null check(fiscal_year between 2000 and 2200),
 source_file text not null, source_hash text not null unique check(source_hash ~ '^[a-f0-9]{64}$'),
 completed date not null, metadata jsonb not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.atlas_utility_forecast_files (
 vintage_id uuid primary key references public.atlas_utility_forecast_vintages(id), content bytea not null
);
create table if not exists public.atlas_utility_forecast_rows (
 vintage_id uuid not null references public.atlas_utility_forecast_vintages(id), sheet text not null, source_row integer not null check(source_row>0),
 community_id uuid references public.atlas_communities(community_id), utility text not null check(utility in ('electricity','natural_gas','water','sewer')),
 cancelled boolean not null, payload jsonb not null, primary key(vintage_id,sheet,source_row)
);
create index if not exists atlas_utility_forecast_community_idx on public.atlas_utility_forecast_rows(community_id,vintage_id);
create table if not exists public.atlas_utility_forecast_activations (
 id bigint generated always as identity primary key, fiscal_year integer not null, vintage_id uuid not null references public.atlas_utility_forecast_vintages(id),
 prior_vintage_id uuid references public.atlas_utility_forecast_vintages(id), reason text not null check(length(trim(reason))>=5),
 rollback boolean not null default false, actor uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists atlas_utility_forecast_activation_year_idx on public.atlas_utility_forecast_activations(fiscal_year,id desc);
create table if not exists public.atlas_utility_actuals (
 id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null check(period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'), utility text not null check(utility in ('electricity','natural_gas','water','sewer')),
 provider text not null, usage numeric check(usage>=0), unit text, estimated boolean not null default false, total_cost numeric not null,
 fixed_cost numeric,usage_cost numeric,demand_cost numeric,meter_count integer check(meter_count>=0),occupied_units numeric check(occupied_units>=0),
 source jsonb not null, supersedes uuid references public.atlas_utility_actuals(id), created_by uuid not null references auth.users(id) default auth.uid(),created_at timestamptz not null default now(),
 check(usage is null or (nullif(trim(unit),'') is not null and source ? 'file' and source ? 'hash'))
);
create index if not exists atlas_utility_actuals_community_period_idx on public.atlas_utility_actuals(community_id,period_key);
create table if not exists public.atlas_utility_draft_scenarios (
 id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id), fiscal_year integer not null,
 payload jsonb not null, supersedes uuid references public.atlas_utility_draft_scenarios(id),actor uuid not null references auth.users(id) default auth.uid(),created_at timestamptz not null default now()
);
create index if not exists atlas_utility_scenario_community_idx on public.atlas_utility_draft_scenarios(community_id,fiscal_year,created_at desc);
create or replace function atlas_private.utility_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.atlas_user_profiles p where p.user_id=auth.uid() and p.status='active' and p.role='admin' and not ('12'=any(coalesce(p.locked_tab_ids,'{}'))));
$$;
revoke all on function atlas_private.utility_admin() from public;
grant execute on function atlas_private.utility_admin() to authenticated;
alter table public.atlas_utility_forecast_files enable row level security;
create policy utility_file_read on public.atlas_utility_forecast_files for select to authenticated using(atlas_private.utility_admin());
grant select on public.atlas_utility_forecast_files to authenticated;
alter table public.atlas_utility_forecast_vintages enable row level security;
alter table public.atlas_utility_forecast_rows enable row level security;
alter table public.atlas_utility_forecast_activations enable row level security;
alter table public.atlas_utility_actuals enable row level security;
alter table public.atlas_utility_draft_scenarios enable row level security;
create policy utility_vintage_read on public.atlas_utility_forecast_vintages for select to authenticated using(atlas_private.utility_admin() or exists(select 1 from public.atlas_utility_forecast_rows r where r.vintage_id=id));
create policy utility_row_read on public.atlas_utility_forecast_rows for select to authenticated using(atlas_private.utility_admin() or (community_id is not null and atlas_private.command_access(community_id,'read')));
create policy utility_activation_read on public.atlas_utility_forecast_activations for select to authenticated using(exists(select 1 from public.atlas_utility_forecast_vintages v where v.id=vintage_id));
create policy utility_actual_read on public.atlas_utility_actuals for select to authenticated using(atlas_private.command_access(community_id,'read'));
create policy utility_actual_insert on public.atlas_utility_actuals for insert to authenticated with check(atlas_private.command_access(community_id,'finance') and created_by=auth.uid());
create policy utility_draft_read on public.atlas_utility_draft_scenarios for select to authenticated using(atlas_private.command_access(community_id,'read'));
create policy utility_draft_insert on public.atlas_utility_draft_scenarios for insert to authenticated with check((atlas_private.command_access(community_id,'finance') or atlas_private.command_access(community_id,'edit')) and actor=auth.uid());
grant select on public.atlas_utility_forecast_vintages,public.atlas_utility_forecast_rows,public.atlas_utility_forecast_activations,public.atlas_utility_actuals,public.atlas_utility_draft_scenarios to authenticated;
grant insert on public.atlas_utility_actuals,public.atlas_utility_draft_scenarios to authenticated;
create or replace function public.atlas_import_utility_forecast(p_forecast jsonb,p_source text) returns uuid language plpgsql security definer set search_path='' as $$
declare vid uuid; r jsonb; avg_value numeric; n integer; seen text[]='{}'; row_key text; periods text[]; begin
 if not atlas_private.utility_admin() then raise exception 'Active Admin required to import shared forecasts'; end if;
 if encode(sha256(decode(p_source,'base64')),'hex')<>p_forecast->>'fileHash' then raise exception 'Source workbook hash mismatch';end if;
 if p_forecast->>'schemaVersion'<>'1' or jsonb_array_length(p_forecast->'rows') not between 1 and 10000 then raise exception 'Invalid forecast schema'; end if;
 if jsonb_array_length(p_forecast->'validation'->'errors')<>0 then raise exception 'Resolve validation errors first'; end if;
 if jsonb_array_length(p_forecast->'periods')<>12 or (p_forecast->>'start')::date+interval '11 months'<> date_trunc('month',(p_forecast->>'end')::date) then raise exception 'Invalid fiscal period'; end if;
 select array_agg(to_char((p_forecast->>'start')::date + i*interval '1 month','YYYY-MM') order by i) into periods from generate_series(0,11) i;
 if to_jsonb(periods)<>p_forecast->'periods' then raise exception 'Distinct consecutive fiscal months required'; end if;
 select id into vid from public.atlas_utility_forecast_vintages where source_hash=p_forecast->>'fileHash';if vid is not null then return vid;end if;
 insert into public.atlas_utility_forecast_vintages(fiscal_year,source_file,source_hash,completed,metadata,created_by)
 values((p_forecast->>'fiscalYear')::integer,p_forecast->>'fileName',p_forecast->>'fileHash',(p_forecast->>'completed')::date,p_forecast-'rows',auth.uid()) returning id into vid;
 insert into public.atlas_utility_forecast_files values(vid,decode(p_source,'base64'));
 for r in select value from jsonb_array_elements(p_forecast->'rows') loop
  row_key=lower(regexp_replace(r->>'property','[^a-zA-Z0-9]','','g'))||'|'||(r->>'type');
  if row_key=any(seen) then raise exception 'Duplicate property/utility';end if;seen=array_append(seen,row_key);
  if jsonb_array_length(r->'monthly')<>12 or nullif(r->>'city','') is null or (r->>'state') !~ '^[A-Z]{2}$' or nullif(r->>'provider','') is null then raise exception 'Invalid row location, provider or months';end if;
  if r->>'status'='Eligible' and not (r->>'cancelled')::boolean then
   select count(*),avg(value::text::numeric) into n,avg_value from jsonb_array_elements(r->'monthly') where jsonb_typeof(value)='number';
   if n<>12 or abs(avg_value-(r->>'annual')::numeric)>0.00000001 or abs(avg_value-(r->>'reportedAnnual')::numeric)>0.0005 or exists(select 1 from jsonb_array_elements(r->'monthly') where value::text::numeric< -1) then raise exception 'Forecast percentages do not reconcile';end if;
  elsif exists(select 1 from jsonb_array_elements(r->'monthly') where value<>'null'::jsonb) then raise exception 'Ineligible forecasts must remain unavailable';end if;
  insert into public.atlas_utility_forecast_rows values(vid,r->>'sheet',(r->>'row')::integer,(r->>'communityId')::uuid,r->>'type',(r->>'cancelled')::boolean,r);
 end loop;return vid;
end $$;
create or replace function public.atlas_activate_utility_forecast(p_vintage uuid,p_expected uuid,p_reason text,p_rollback boolean default false) returns bigint language plpgsql security definer set search_path='' as $$
declare v public.atlas_utility_forecast_vintages; prior uuid; previous_date date; aid bigint;begin
 if not atlas_private.utility_admin() then raise exception 'Active Admin required';end if;
 select * into strict v from public.atlas_utility_forecast_vintages where id=p_vintage;
 perform pg_advisory_xact_lock(732719,v.fiscal_year);
 select vintage_id into prior from public.atlas_utility_forecast_activations where fiscal_year=v.fiscal_year order by id desc limit 1;
 if prior is distinct from p_expected then raise exception 'Active vintage changed. Reload preview';end if;
 if prior=p_vintage then select id into aid from public.atlas_utility_forecast_activations where fiscal_year=v.fiscal_year order by id desc limit 1;return aid;end if;
 select completed into previous_date from public.atlas_utility_forecast_vintages where id=prior;
 if previous_date>=v.completed and not p_rollback then raise exception 'A newer vintage is active';end if;
 if p_rollback and not exists(select 1 from public.atlas_utility_forecast_activations where fiscal_year=v.fiscal_year and vintage_id=v.id) then raise exception 'Rollback requires a previously activated vintage';end if;
 insert into public.atlas_utility_forecast_activations(fiscal_year,vintage_id,prior_vintage_id,reason,rollback,actor) values(v.fiscal_year,v.id,prior,p_reason,p_rollback,auth.uid()) returning id into aid;return aid;
end $$;
revoke all on function public.atlas_import_utility_forecast(jsonb,text),public.atlas_activate_utility_forecast(uuid,uuid,text,boolean) from public;
grant execute on function public.atlas_import_utility_forecast(jsonb,text),public.atlas_activate_utility_forecast(uuid,uuid,text,boolean) to authenticated;
commit;
