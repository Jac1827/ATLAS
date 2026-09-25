-- Reviewed immutable Budget Builder publications; summary reads never fetch GL payloads.
begin;
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
commit;
