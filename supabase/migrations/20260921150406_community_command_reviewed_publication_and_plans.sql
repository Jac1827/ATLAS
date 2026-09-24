begin;
-- Additive Community Command plan persistence. Existing settings plans are not deleted.
create schema if not exists atlas_private;
revoke all on schema atlas_private from public;
grant usage on schema atlas_private to authenticated;
create or replace function atlas_private.command_access(cid uuid, action text default 'read')
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=cid
 where p.user_id=auth.uid() and p.status='active' and c.deleted_at is null
 and public.atlas_can_access_community(cid)
 and (c.status='active' or p.role='admin' or cid=any(coalesce(p.allowed_community_ids,'{}')))
 and p.role in ('admin','centra','executive','regional','community_manager','finance','viewer')
 and not ('2'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('portfolio_overview'=any(coalesce(p.locked_page_keys,'{}')))
 and (action='read' or (action='edit' and p.role in ('admin','executive','regional','community_manager'))
 or (action='verify' and p.role in ('admin','executive','regional'))
 or (action='finance' and p.role in ('admin','centra','executive','regional','finance') and not ('12'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('budget'=any(coalesce(p.locked_page_keys,'{}')))))
 );
$$;
revoke all on function atlas_private.command_access(uuid,text) from public,anon;
grant execute on function atlas_private.command_access(uuid,text) to authenticated;
create table if not exists public.atlas_community_plans(
 plan_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null check(period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 payload jsonb not null default '{"tasks":[]}',version integer not null default 1,
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(community_id,period_key),check(jsonb_typeof(payload->'tasks')='array'));
create table if not exists public.atlas_community_plan_events(
 event_id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.atlas_community_plans(plan_id),
 community_id uuid not null references public.atlas_communities(community_id),version integer not null,
 previous_payload jsonb,next_payload jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(plan_id,version));
create index if not exists atlas_community_plans_period on public.atlas_community_plans(period_key,community_id);
create index if not exists atlas_community_plan_events_scope on public.atlas_community_plan_events(community_id,plan_id,created_at);
alter table public.atlas_community_plans enable row level security;
alter table public.atlas_community_plan_events enable row level security;
create policy command_plan_read on public.atlas_community_plans for select to authenticated using(atlas_private.command_access(community_id));
create policy command_event_read on public.atlas_community_plan_events for select to authenticated using(atlas_private.command_access(community_id));
revoke all on public.atlas_community_plans,public.atlas_community_plan_events from anon,authenticated;
grant select on public.atlas_community_plans,public.atlas_community_plan_events to authenticated;
create or replace function public.atlas_save_community_plan(p_community_id uuid,p_period text,p_expected_version integer,p_payload jsonb)
returns public.atlas_community_plans language plpgsql security definer set search_path='' as $$
declare old public.atlas_community_plans; result public.atlas_community_plans; task jsonb; prior jsonb; ids text[]:='{}'; next_tasks jsonb:='[]'; stamp text:=now()::text; next_task jsonb; target_plan_id uuid;
begin
 if not atlas_private.command_access(p_community_id,'edit') then raise exception 'Community plan edit access denied';end if;
 if p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_payload is null or jsonb_typeof(p_payload->'tasks') is distinct from 'array' or jsonb_array_length(p_payload->'tasks')>200 or octet_length(p_payload::text)>1048576 then raise exception 'Invalid or oversized plan';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_community_id::text||p_period,0));
 select * into old from public.atlas_community_plans where community_id=p_community_id and period_key=p_period for update;
 target_plan_id:=coalesce(old.plan_id,gen_random_uuid());
 if coalesce(old.version,0) is distinct from p_expected_version then raise exception 'Plan changed in another session; reload before saving';end if;
 for task in select value from jsonb_array_elements(p_payload->'tasks') loop
  if coalesce(task->>'id','')='' or coalesce(task->>'title','')='' or (task->>'id')=any(ids) or coalesce(task->>'status','') not in ('Suggested','Accepted/Open','In Progress','Completed','Verified','Cancelled') or coalesce(task->>'origin','') not in ('Manual','Recommended') then raise exception 'Invalid or duplicate task';end if;
  ids:=array_append(ids,task->>'id');
  select value into prior from jsonb_array_elements(coalesce(old.payload->'tasks','[]')) where value->>'id'=task->>'id';
  if task->>'origin'='Recommended' and not exists(select 1 from public.atlas_command_findings f where f.finding_id::text=task->>'sourceFindingId' and f.community_id=p_community_id and f.period_key=p_period) then raise exception 'Recommendations require a registered source finding';end if;
  if prior is not null and prior->>'sourceFindingId' is distinct from task->>'sourceFindingId' then raise exception 'Task source finding is immutable';end if;
  if prior is not null and prior->>'origin' is distinct from task->>'origin' then raise exception 'Task origin is immutable';end if;
  if length(task->>'id')>200 or length(task->>'title')>300 then raise exception 'Task identity or title too long';end if;
  if prior->>'status'='Suggested' and task->>'status' not in ('Suggested','Accepted/Open','Cancelled') then raise exception 'Accept suggested task before execution';end if;
  if task->>'status'='Verified' then
   if (prior is null or prior->>'status' not in ('Completed','Verified') or not atlas_private.command_access(p_community_id,'verify') or coalesce(task->>'completionEvidence','')='') then raise exception 'Complete with evidence before authorized verification';end if;
   if prior->>'status'='Verified' and (task-'updatedAt'-'lastEditedBy') is distinct from (prior-'updatedAt'-'lastEditedBy') then raise exception 'Reopen verified task before editing';end if;
  end if;
  if task->>'status'='Completed' and coalesce(task->>'completionEvidence','')='' then raise exception 'Completion evidence is required';end if;
  next_task:=task||jsonb_build_object('planId',target_plan_id,'communityId',p_community_id,'linkedPeriod',p_period,'createdBy',coalesce(prior->>'createdBy',auth.uid()::text),'createdAt',coalesce(prior->>'createdAt',stamp),'lastEditedBy',auth.uid(),'updatedAt',stamp,'verifiedBy',case when task->>'status'='Verified' then coalesce(prior->>'verifiedBy',auth.uid()::text) else null end,'completedBy',case when task->>'status' in ('Completed','Verified') then coalesce(prior->>'completedBy',auth.uid()::text) else null end,'verificationStatus',case when task->>'status'='Verified' then 'Verified' else 'Unverified' end,'verifiedAt',case when task->>'status'='Verified' then coalesce(prior->>'verifiedAt',stamp) else null end,'completedAt',case when task->>'status' in ('Completed','Verified') then coalesce(prior->>'completedAt',stamp) else null end);
  next_tasks:=next_tasks||jsonb_build_array(next_task);
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(old.payload->'tasks','[]')) t where not ((t->>'id')=any(ids))) then raise exception 'Cancel existing tasks instead of deleting audit history';end if;
 p_payload:=p_payload||jsonb_build_object('tasks',next_tasks,'communityId',p_community_id,'period',p_period);
 insert into public.atlas_community_plans(plan_id,community_id,period_key,payload,created_by,updated_by) values(target_plan_id,p_community_id,p_period,p_payload,auth.uid(),auth.uid())
 on conflict(community_id,period_key) do update set payload=excluded.payload,version=atlas_community_plans.version+1,updated_by=auth.uid(),updated_at=now() returning * into result;
 insert into public.atlas_community_plan_events(plan_id,community_id,version,previous_payload,next_payload,actor_id) values(result.plan_id,p_community_id,result.version,old.payload,result.payload,auth.uid());
 return result;
end;$$;
revoke all on function public.atlas_save_community_plan(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.atlas_save_community_plan(uuid,text,integer,jsonb) to authenticated;
create table if not exists public.atlas_community_plan_reports(
 report_id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.atlas_community_plans(plan_id),
 community_id uuid not null references public.atlas_communities(community_id),plan_version integer not null,
 executive_note text not null default '',snapshot jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
create index command_report_scope on public.atlas_community_plan_reports(community_id,plan_id,created_at desc);
alter table public.atlas_community_plan_reports enable row level security;
create policy command_report_read on public.atlas_community_plan_reports for select to authenticated using(atlas_private.command_access(community_id));
revoke all on public.atlas_community_plan_reports from anon,authenticated;
grant select on public.atlas_community_plan_reports to authenticated;
create or replace function public.atlas_generate_community_plan_report(p_plan_id uuid,p_expected_version integer,p_note text default '',p_occupancy jsonb default null)
returns public.atlas_community_plan_reports language plpgsql security definer set search_path='' as $$
declare plan public.atlas_community_plans; result public.atlas_community_plan_reports; financial jsonb; occupancy jsonb; occupied numeric; rentable numeric; target numeric;
begin
 select * into plan from public.atlas_community_plans where plan_id=p_plan_id for share;
 if plan.plan_id is null or not atlas_private.command_access(plan.community_id,'edit') then raise exception 'Plan report access denied';end if;
 if plan.version is distinct from p_expected_version then raise exception 'Plan changed in another session; reload before reporting';end if;
 if p_note is null or length(p_note)>4000 then raise exception 'Invalid executive note';end if;
 select jsonb_build_object('publicationId',publication_id,'summary',summary) into financial from public.atlas_command_financial_summaries where community_id=plan.community_id and period_key=plan.period_key;
 if p_occupancy is not null and p_occupancy<>'null'::jsonb then
  if p_occupancy->>'communityId' is distinct from plan.community_id::text or p_occupancy->>'period' is distinct from plan.period_key or jsonb_typeof(p_occupancy->'occupiedUnits') is distinct from 'number' or jsonb_typeof(p_occupancy->'rentableUnits') is distinct from 'number' or coalesce(p_occupancy->>'source','')='' or coalesce(p_occupancy->>'sourceTimestamp','')='' or coalesce(p_occupancy->>'revisionKey','')='' then raise exception 'Verified period-specific occupancy source required';end if;
  occupied:=(p_occupancy->>'occupiedUnits')::numeric;rentable:=(p_occupancy->>'rentableUnits')::numeric;
  if rentable<=0 or occupied<0 or occupied>rentable or trunc(occupied)<>occupied or trunc(rentable)<>rentable then raise exception 'Invalid occupancy source counts';end if;
  target:=ceil((financial->'summary'->>'occupancyPct')::numeric*rentable/100);
  occupancy:=jsonb_build_object('occupiedUnits',occupied,'rentableUnits',rentable,'physicalPct',occupied/rentable*100,'budgetPct',financial->'summary'->'occupancyPct','budgetUnits',target,'variance',occupied-target,'source',p_occupancy->'source','sourceTimestamp',p_occupancy->'sourceTimestamp','revisionKey',p_occupancy->'revisionKey');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text||':report',0));
 select * into result from public.atlas_community_plan_reports where plan_id=p_plan_id and plan_version=plan.version and executive_note=p_note and (snapshot->'financial') is not distinct from coalesce(financial,'null'::jsonb) and (snapshot->'occupancy') is not distinct from coalesce(occupancy,'null'::jsonb) order by created_at limit 1;
 if result.report_id is not null then return result;end if;
 insert into public.atlas_community_plan_reports(plan_id,community_id,plan_version,executive_note,snapshot,created_by)
 values(plan.plan_id,plan.community_id,plan.version,p_note,jsonb_build_object('plan',plan.payload,'period',plan.period_key,'sourceUpdatedAt',plan.updated_at,'community',(select display_name from public.atlas_communities where community_id=plan.community_id),'financial',financial,'occupancy',occupancy,'coverage',case when occupancy is null then 'Operational occupancy source is unavailable in this snapshot. ' else 'Occupancy uses the retained period-specific source revision. ' end||'Missing or incomplete financial coverage must be resolved in Budget Builder; underspend does not establish true savings.'),auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) to authenticated;
-- Reviewed immutable Budget Builder publications; summary reads never fetch GL payloads.
create table public.atlas_command_financial_publications(
 publication_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null check(period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),fiscal_year integer not null check(fiscal_year between 2000 and 2099),
 version integer not null, fingerprint text not null,payload jsonb not null,published_by uuid not null references auth.users(id),published_at timestamptz not null default now(),
 unique(community_id,period_key,version),unique(community_id,period_key,fingerprint));
create table public.atlas_command_financial_summaries(
 community_id uuid not null references public.atlas_communities(community_id),period_key text not null,publication_id uuid not null references public.atlas_command_financial_publications(publication_id),
 fiscal_year integer not null,version integer not null,summary jsonb not null,primary key(community_id,period_key));
create index command_financial_summary_period on public.atlas_command_financial_summaries(period_key,community_id);
alter table public.atlas_command_financial_publications enable row level security;
alter table public.atlas_command_financial_summaries enable row level security;
create policy command_financial_detail_read on public.atlas_command_financial_publications for select to authenticated using(atlas_private.command_access(community_id,'finance'));
create policy command_financial_summary_read on public.atlas_command_financial_summaries for select to authenticated using(atlas_private.command_access(community_id));
revoke all on public.atlas_command_financial_publications,public.atlas_command_financial_summaries from anon,authenticated;
grant select on public.atlas_command_financial_publications,public.atlas_command_financial_summaries to authenticated;
create table public.atlas_command_findings(
 finding_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),period_key text not null,
 publication_id uuid not null references public.atlas_command_financial_publications(publication_id),metric text not null,payload jsonb not null,
 created_at timestamptz not null default now(),unique(community_id,period_key,publication_id,metric));
create index command_findings_scope on public.atlas_command_findings(community_id,period_key,created_at desc);
alter table public.atlas_command_findings enable row level security;
create policy command_finding_read on public.atlas_command_findings for select to authenticated using(atlas_private.command_access(community_id));
revoke all on public.atlas_command_findings from anon,authenticated;
grant select on public.atlas_command_findings to authenticated;
create function atlas_private.command_financial_metric(rows jsonb,metric text,basis text default 'month') returns jsonb language plpgsql immutable set search_path='' as $$
declare a numeric;b numeric;n integer;ac integer;bc integer;v numeric;
begin
 select count(*),count(*) filter(where jsonb_typeof(r->(case when basis='ytd' then 'ytdActual' else 'actual' end))='number'),count(*) filter(where jsonb_typeof(r->(case when basis='ytd' then 'ytdBudget' else 'budget' end))='number'),sum((r->>(case when basis='ytd' then 'ytdActual' else 'actual' end))::numeric),sum((r->>(case when basis='ytd' then 'ytdBudget' else 'budget' end))::numeric) into n,ac,bc,a,b from jsonb_array_elements(rows) r where r->>'metric'=metric;
 if n=0 or bc<>n then return jsonb_build_object('status','missing','label','Incomplete budget coverage','actual',null,'budget',null,'variance',null);end if;
 if ac<>n then return jsonb_build_object('status','missing','label','Missing actuals','actual',null,'budget',b,'variance',null);end if;
 v:=case when metric='expenses' then b-a else a-b end;
 return jsonb_build_object('status',case when v<0 then 'unfavorable' else 'favorable' end,'label',case when v>=0 then 'On Track' when metric='expenses' then 'Overspent' else 'Behind' end,'actual',a,'budget',b,'variance',v);
end;$$;
revoke all on function atlas_private.command_financial_metric(jsonb,text,text) from public,anon,authenticated;
create function public.atlas_publish_command_financials(p_community_id uuid,p_period text,p_expected_version integer,p_payload jsonb)
returns public.atlas_command_financial_summaries language plpgsql security definer set search_path='' as $$
declare previous public.atlas_command_financial_summaries;result public.atlas_command_financial_summaries; pub public.atlas_command_financial_publications;fp text;r jsonb;k text;ids text[]:='{}';summary jsonb;stamp timestamptz:=now();
begin
 if not atlas_private.command_access(p_community_id,'finance') or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role in ('admin','executive','finance')) then raise exception 'Financial publication access denied';end if;
 if p_payload is null or p_payload->>'communityId' is distinct from p_community_id::text or p_payload->>'period' is distinct from p_period or p_payload->>'periodBasis' is distinct from 'calendar_month' or p_payload->>'approvedLocked' is distinct from 'true' or p_payload->>'reviewConfirmed' is distinct from 'true' or coalesce(p_payload->>'scenarioId','')='' or coalesce(p_payload->>'scenarioVersion','')='' or coalesce(p_payload->>'builderPropertyId','')='' or coalesce(p_payload->>'actualSource','')='' or coalesce(p_payload->>'budgetSource','')='' or coalesce(p_payload->>'sourceTimestamp','')='' or jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows')>2000 or octet_length(p_payload::text)>2097152 then raise exception 'Incomplete reviewed financial publication';end if;
 if p_payload->>'fiscalYear' !~ '^20[0-9]{2}$' or p_payload->>'year' is distinct from left(p_period,4) then raise exception 'Financial year or period mismatch';end if;
 for r in select value from jsonb_array_elements(p_payload->'rows') loop
  k:=r->>'glCode';
  if coalesce(k,'')='' or k=any(ids) or coalesce(r->>'metric','') not in ('gpr','expenses') or (r->>'metric'='gpr' and k<>'5120') or (r->>'metric'='expenses' and (r->>'nature' is distinct from 'expense' or r->>'operatingApproved' is distinct from 'true' or k='5120')) then raise exception 'Invalid or duplicate approved GL mapping';end if;
  ids:=array_append(ids,k);
  foreach k in array array['actual','budget','ytdActual','ytdBudget'] loop
   if jsonb_typeof(r->k) not in ('number','null') or (jsonb_typeof(r->k)='number' and (abs((r->>k)::numeric)>1000000000000 or round((r->>k)::numeric,2)<>(r->>k)::numeric)) then raise exception 'Invalid financial amount';end if;
  end loop;
 end loop;
 if not ('5120'=any(ids)) or not exists(select 1 from jsonb_array_elements(p_payload->'rows') item where item->>'metric'='expenses') then raise exception 'GPR and operating expense coverage are required';end if;
 if jsonb_typeof(p_payload->'occupancyPct') not in ('number','null') then raise exception 'Invalid occupancy budget';end if;
 if jsonb_typeof(p_payload->'occupancyPct')='number' and ((p_payload->>'occupancyPct')::numeric<0 or (p_payload->>'occupancyPct')::numeric>100) then raise exception 'Invalid occupancy budget';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_community_id::text||p_period||':finance',0));
 select * into previous from public.atlas_command_financial_summaries where community_id=p_community_id and period_key=p_period for update;
 fp:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 select * into pub from public.atlas_command_financial_publications where community_id=p_community_id and period_key=p_period and fingerprint=fp;
 if pub.publication_id is not null then
  if previous.publication_id=pub.publication_id then return previous;end if;
  raise exception 'This source version was superseded; review the current publication';
 end if;
 if coalesce(previous.version,0) is distinct from p_expected_version then raise exception 'Financial publication changed in another session; reload before publishing';end if;
 insert into public.atlas_command_financial_publications(community_id,period_key,fiscal_year,version,fingerprint,payload,published_by,published_at) values(p_community_id,p_period,(p_payload->>'fiscalYear')::integer,coalesce(previous.version,0)+1,fp,p_payload,auth.uid(),stamp) returning * into pub;
 summary:=jsonb_build_object('gpr',atlas_private.command_financial_metric(p_payload->'rows','gpr'),'expenses',atlas_private.command_financial_metric(p_payload->'rows','expenses'),'ytdGpr',atlas_private.command_financial_metric(p_payload->'rows','gpr','ytd'),'ytdExpenses',atlas_private.command_financial_metric(p_payload->'rows','expenses','ytd'),'occupancyPct',p_payload->'occupancyPct','scenarioId',p_payload->'scenarioId','scenarioVersion',p_payload->'scenarioVersion','sourceTimestamp',p_payload->'sourceTimestamp','publishedAt',stamp,'mappingVersion',p_payload->'mappingVersion','periodBasis',p_payload->'periodBasis');
 insert into public.atlas_command_financial_summaries(community_id,period_key,publication_id,fiscal_year,version,summary) values(p_community_id,p_period,pub.publication_id,pub.fiscal_year,pub.version,summary) on conflict(community_id,period_key) do update set publication_id=excluded.publication_id,fiscal_year=excluded.fiscal_year,version=excluded.version,summary=excluded.summary returning * into result;
 for k in select unnest(array['gpr','expenses']) loop
  if summary->k->>'status' in ('unfavorable','missing') then
   insert into public.atlas_command_findings(community_id,period_key,publication_id,metric,payload)
   values(p_community_id,p_period,pub.publication_id,k,jsonb_build_object('category',case when summary->k->>'status'='missing' then 'Data Readiness' when k='gpr' then 'GPR' else 'Expenses' end,'status','Open','severity',case when summary->k->>'status'='missing' then 'Data Readiness' else 'Watch' end,'actual',summary->k->'actual','target',summary->k->'budget','variance',summary->k->'variance','label',summary->k->'label','source',p_payload->'actualSource','sourceTimestamp',p_payload->'sourceTimestamp','approvedScenario',p_payload->'scenarioId','recommendedResponse',case when summary->k->>'status'='missing' then 'Resolve incomplete '||k||' source coverage for '||p_period when k='gpr' then 'Review GPR shortfall of $'||abs((summary->k->>'variance')::numeric)||' and validate occupancy, pricing and timing causes for '||p_period else 'Review operating expense overrun of $'||abs((summary->k->>'variance')::numeric)||' and validate timing before assigning corrective ownership for '||p_period end));
  end if;
 end loop;
 return result;
end;$$;
revoke all on function public.atlas_publish_command_financials(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.atlas_publish_command_financials(uuid,text,integer,jsonb) to authenticated;
create table public.atlas_command_report_deliveries(
 delivery_id uuid primary key default gen_random_uuid(),report_id uuid not null references public.atlas_community_plan_reports(report_id),community_id uuid not null references public.atlas_communities(community_id),
 recipients text[] not null,status text not null default 'claimed' check(status in ('claimed','sent','unknown')),provider_message_id text,requested_by uuid not null references auth.users(id),created_at timestamptz not null default now(),sent_at timestamptz);
create index command_delivery_report on public.atlas_command_report_deliveries(report_id);
alter table public.atlas_command_report_deliveries enable row level security;
create policy command_delivery_read on public.atlas_command_report_deliveries for select to authenticated using(atlas_private.command_access(community_id,'edit'));
revoke all on public.atlas_command_report_deliveries from anon,authenticated;
grant select on public.atlas_command_report_deliveries to authenticated;
grant select,update on public.atlas_command_report_deliveries to service_role;
create function public.atlas_claim_command_report_delivery(p_report_id uuid,p_recipients text[]) returns public.atlas_command_report_deliveries language plpgsql security definer set search_path='' as $$
declare report public.atlas_community_plan_reports; result public.atlas_command_report_deliveries; v_recipients text[];
begin
 select * into report from public.atlas_community_plan_reports where report_id=p_report_id;
 if report.report_id is null or not atlas_private.command_access(report.community_id,'edit') then raise exception 'Report delivery access denied';end if;
 select array_agg(distinct lower(trim(email)) order by lower(trim(email))) into v_recipients from unnest(p_recipients) email;
 if coalesce(cardinality(v_recipients),0)<1 or cardinality(v_recipients)>20 or exists(select 1 from unnest(v_recipients) email where email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$' or length(email)>254) then raise exception 'Choose 1 to 20 valid recipients';end if;
 if exists(select 1 from unnest(v_recipients) email where email not like '%@risere.com') and not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role in ('admin','executive')) then raise exception 'External investor delivery requires Admin or Executive permission';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_report_id::text||':delivery',0));
 if exists(select 1 from public.atlas_command_report_deliveries d where d.report_id=p_report_id and d.recipients && v_recipients) then raise exception 'A delivery for this report and recipient is already recorded; verify its status before any resend';end if;
 insert into public.atlas_command_report_deliveries(report_id,community_id,recipients,requested_by) values(p_report_id,report.community_id,v_recipients,auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_claim_command_report_delivery(uuid,text[]) from public,anon;
grant execute on function public.atlas_claim_command_report_delivery(uuid,text[]) to authenticated;

commit;