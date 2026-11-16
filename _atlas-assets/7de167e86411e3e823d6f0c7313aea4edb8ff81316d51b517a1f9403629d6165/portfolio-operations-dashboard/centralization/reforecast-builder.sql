-- Forecast Builder governed vintages. Additive history; no source or publication is overwritten.
begin;
create or replace function atlas_private.reforecast_access(cid uuid, action text default 'read')
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=cid
 where p.user_id=auth.uid() and p.status='active' and c.deleted_at is null and public.atlas_can_access_community(cid)
 and ((action='active_read' and (atlas_private.command_access(cid) or (not ('8'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('reporting'=any(coalesce(p.locked_page_keys,'{}'))))))
 or (not ('12'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('budget'=any(coalesce(p.locked_page_keys,'{}')))
 and (action in ('read','active_read') or action='edit' and p.role in ('admin','executive','regional','centra','community_manager')
 or action in ('approve','publish','reopen') and p.role in ('admin','executive')))));
$$;
create table public.atlas_reforecast_events(
 event_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 scenario_id uuid not null,publication_id uuid references public.atlas_reforecast_publications(publication_id),event_type text not null check(event_type in ('reopened')),
 request_id uuid not null unique,request_hash text not null,detail jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now());
create table public.atlas_reforecast_source_reviews(
 review_id uuid primary key default gen_random_uuid(),review_order bigint generated always as identity,community_id uuid not null references public.atlas_communities(community_id),
 upload_id uuid not null,request_id uuid not null unique,content_hash text not null,payload jsonb not null,reviewed_by uuid not null references auth.users(id),reviewed_at timestamptz not null default now(),
 foreign key(upload_id,community_id) references public.atlas_reforecast_uploads(upload_id,community_id));
create index reforecast_event_publication on public.atlas_reforecast_events(publication_id,event_type);
create index reforecast_source_review_latest on public.atlas_reforecast_source_reviews(upload_id,review_order desc);
do $$declare t text;begin foreach t in array array['atlas_reforecast_events','atlas_reforecast_source_reviews'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy reforecast_read on public.%I for select to authenticated using(atlas_private.reforecast_access(community_id))',t);
 execute format('create trigger reforecast_immutable before update or delete on public.%I for each row execute function atlas_private.finance_immutable()',t);
 end loop;end;$$;

create or replace function atlas_private.reforecast_close_eligible(cid uuid,p text,source_hash text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare coverage jsonb;
begin
 if to_regprocedure('atlas_private.finance_coverage(uuid,text,text)') is null then return true;end if;
 execute 'select atlas_private.finance_coverage($1,$2,$3)' into coverage using cid,p,source_hash;
 return coverage->>'fullMonthAllowed'='true';
end;$$;
revoke all on function atlas_private.reforecast_close_eligible(uuid,text,text) from public,anon,authenticated;
-- Portfolio Bonus captures retain a null run community; resolve exact canonical line assignments.
create or replace function atlas_private.reforecast_bonus_run_in_community(run jsonb,cid uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare matches boolean;
begin
 if run->>'community_id' is not null then return run->>'community_id'=cid::text;end if;
 if to_regclass('public.atlas_bonus_calculation_lines') is null or to_regclass('public.atlas_employee_assignments') is null then return false;end if;
 execute 'select exists(select 1 from public.atlas_bonus_calculation_lines l join public.atlas_employee_assignments a on a.assignment_id=l.assignment_id where l.bonus_calculation_run_id=$1 and l.deleted_at is null and a.deleted_at is null and a.community_id=$2 and to_jsonb(a)->>''employee_id''=l.employee_id::text)' into matches using (run->>'bonus_calculation_run_id')::uuid,cid;
 return matches;
end;$$;
revoke all on function atlas_private.reforecast_bonus_run_in_community(jsonb,uuid) from public,anon,authenticated;
create or replace function atlas_private.reforecast_month_locked(cid uuid,p text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare locked boolean;
begin
 if exists(select 1 from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.accounting_basis='accrual' and h.period_key=p and atlas_private.reforecast_close_eligible(cid,p,v.source_hash)) then return true;end if;
 if to_regclass('public.atlas_bonus_calculation_runs') is not null then
 execute 'select exists(select 1 from public.atlas_bonus_calculation_runs r join public.atlas_bonus_periods b using(bonus_period_id) where atlas_private.reforecast_bonus_run_in_community(to_jsonb(r),$1) and r.deleted_at is null and (r.status=''locked'' or b.status in (''locked'',''approved'',''paid'',''archived'')) and b.start_date<=($2||''-01'')::date and b.end_date>=((($2||''-01'')::date+interval ''1 month'')::date-1))' into locked using cid,p;
 if locked then return true;end if;end if;
 return false;
end;$$;
create or replace function atlas_private.reforecast_publication_period_valid(pub public.atlas_reforecast_publications,p text default null) returns boolean language plpgsql stable security definer set search_path='' as $$
declare receipt jsonb;latest public.atlas_reforecast_source_reviews;contract jsonb;utility_issues jsonb;config jsonb;
begin
 if pub.publication_id is null or exists(select 1 from public.atlas_reforecast_events where publication_id=pub.publication_id and event_type='reopened' and (p is null or not(detail ? 'retiredPeriods') or detail->'retiredPeriods' ? p)) then return false;end if;
 if pub.snapshot->>'fingerprint' is distinct from encode(sha256(convert_to((pub.snapshot-'fingerprint')::text,'UTF8')),'hex') then return false;end if;
 if exists(select 1 from jsonb_array_elements(coalesce(pub.source->'actuals'->'closeVersions','[]')) c where not exists(select 1 from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=pub.community_id and h.period_key=c->>'period' and h.accounting_basis='accrual' and h.version_id::text=c->>'versionId' and v.source_hash=c->>'sourceHash' and atlas_private.reforecast_close_eligible(pub.community_id,h.period_key,v.source_hash))) then return false;end if;
 if exists(select 1 from jsonb_array_elements(coalesce(pub.source->'recommendationHistory','[]')) c where c->>'eligible'='true' and not exists(select 1 from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=pub.community_id and h.period_key=c->>'period' and h.accounting_basis='accrual' and h.version_id::text=c->>'closeVersionId' and v.source_hash=c->>'sourceHash' and atlas_private.reforecast_close_eligible(pub.community_id,h.period_key,v.source_hash))) then return false;end if;
 if jsonb_array_length(coalesce(pub.snapshot->'utilityDrivers','[]'))>0 then
 if to_regprocedure('atlas_private.reforecast_utility_issues(jsonb,jsonb)') is null then return false;end if;
 select payload into config from public.atlas_reforecast_revisions where revision_id=pub.revision_id;
 begin execute 'select atlas_private.reforecast_utility_issues($1,$2)' into utility_issues using pub.source,config;exception when others then return false;end;
 if jsonb_array_length(utility_issues)>0 then return false;end if;
 end if;
 for receipt in select value from jsonb_array_elements(coalesce(pub.source->'sourceReceipts','[]')) loop
 select * into latest from public.atlas_reforecast_source_reviews where upload_id::text=receipt->>'uploadId' and community_id=pub.community_id order by review_order desc limit 1;
 if receipt->>'sourceType' in ('hello_landing','rise_str','monthly_property_statement','contract','utility_forecast') and (latest.payload->>'status' is distinct from 'approved' or latest.review_id::text is distinct from receipt->>'reviewId' or latest.content_hash is distinct from receipt->>'reviewHash') then return false;end if;
 if receipt->'review'->'canonicalContract'->>'contractId' is not null then
 contract:=null;if to_regclass('public.atlas_contracts') is not null then execute 'select to_jsonb(c) from public.atlas_contracts c where contract_id=$1 and community_id=$2 and deleted_at is null' into contract using (receipt->'review'->'canonicalContract'->>'contractId')::uuid,pub.community_id;end if;
 if contract is null or contract->'version' is distinct from receipt->'review'->'canonicalContract'->'version' or (receipt->'review'->'canonicalContract'->>'contentHash' is not null and encode(sha256(convert_to(contract::text,'UTF8')),'hex') is distinct from receipt->'review'->'canonicalContract'->>'contentHash') then return false;end if;
 end if;end loop;
 return true;
end;$$;

create or replace function atlas_private.reforecast_publication_valid(pub public.atlas_reforecast_publications) returns boolean language sql stable security definer set search_path='' as $$select atlas_private.reforecast_publication_period_valid(pub,null)$$;
revoke all on function atlas_private.reforecast_publication_period_valid(public.atlas_reforecast_publications,text) from public,anon,authenticated;

create or replace function public.atlas_reforecast_effective_baseline(p_community_ids uuid[],p_periods text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cid uuid;p text;pub public.atlas_reforecast_publications;source jsonb;lines jsonb;result jsonb:='[]';item jsonb;close_id uuid;ids jsonb;
begin
 if cardinality(p_community_ids)>100 or p_periods is null or cardinality(p_periods)=0 or cardinality(p_periods)>24 or exists(select 1 from unnest(p_periods)v where v is null or v!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'Distinct full calendar months and at most 100 communities required';end if;
 foreach cid in array p_community_ids loop
 if not atlas_private.reforecast_access(cid,'active_read') then continue;end if;
 foreach p in array p_periods loop
 select v.* into pub from public.atlas_reforecast_active_heads h join public.atlas_reforecast_publications v using(publication_id) where h.community_id=cid and h.period_key=p;
 select h.version_id into close_id from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.period_key=p and h.accounting_basis='accrual' and atlas_private.reforecast_close_eligible(cid,p,v.source_hash);
 item:=jsonb_build_object('communityId',cid,'period',p,'status','unavailable','verified',false,'reason','No unambiguous approved baseline covers this full month','closeVersionId',close_id);
 if pub.publication_id is not null then
 if atlas_private.reforecast_publication_period_valid(pub,p) and p=any(pub.periods) then
 select coalesce(jsonb_agg(v||jsonb_build_object('amount',v->'forecast','sourceType','approved_reforecast','publicationId',pub.publication_id,'versionId',pub.revision_id) order by v->>'accountCode'),'[]') into lines from jsonb_array_elements(pub.snapshot->'lines')v where v->>'period'=p;
 if jsonb_array_length(lines)>0 and not exists(select 1 from jsonb_array_elements(lines)v where jsonb_typeof(v->'amount') is distinct from 'number' or v->>'mappingValid' is distinct from 'true') then item:=item||jsonb_build_object('status','available','reason',null,'sourceType','approved_reforecast','versionId',pub.revision_id,'publicationId',pub.publication_id,'approved',true,'locked',true,'verified',true,'lines',lines,'contentHash',pub.snapshot->>'fingerprint','source',pub.source);end if;
 else item:=item||jsonb_build_object('reason','Active forecast evidence is reopened, stale or failed readback verification','publicationId',pub.publication_id);end if;
 elsif exists(select 1 from public.atlas_reforecast_events e join public.atlas_reforecast_publications v using(publication_id) where e.community_id=cid and p=any(v.periods)) then
 item:=item||jsonb_build_object('reason','The active forecast was reopened; a replacement approval is required');
 else
 begin source:=atlas_private.reforecast_source(cid,array[p],null,null);exception when others then source:=null;end;
 lines:=source->'baseline'->'lines';select coalesce(jsonb_agg(distinct v->'source'->'versionId'),'[]'::jsonb) into ids from jsonb_array_elements(coalesce(lines,'[]'::jsonb))v;
 if jsonb_array_length(coalesce(lines,'[]'))>0 and jsonb_array_length(ids)=1 and not exists(select 1 from jsonb_array_elements(lines)v where jsonb_typeof(v->'amount') is distinct from 'number') then
 select jsonb_agg(v||jsonb_build_object('nature',coalesce(a->'nature',v->'nature'),'placement',coalesce(a->'placement',v->'placement'),'category',coalesce(a->'category',v->'category'),'sourceType','original_budget','versionId',ids->0) order by v->>'accountCode') into lines from jsonb_array_elements(lines)v left join lateral (select value a from jsonb_array_elements(source->'registry'->'accounts') where value->>'accountCode'=v->>'accountCode')q on true;
 item:=item||jsonb_build_object('status','available','reason',null,'sourceType','original_budget','versionId',ids->0,'publicationId',null,'approved',true,'locked',true,'verified',true,'lines',lines,'contentHash',encode(sha256(convert_to((source->'baseline')::text,'UTF8')),'hex'));
 end if;end if;
 result:=result||jsonb_build_array(item);
 end loop;end loop;return result;
end;$$;

-- Preserve reviewed utility relationships in every newly captured source, including mapping readback.
create or replace function atlas_private.reforecast_source_with_registry(cid uuid,periods text[],budget_ids uuid[] default null,registry_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb;relationships jsonb;
begin
 source:=atlas_private.reforecast_source(cid,periods,budget_ids,registry_id);
 select coalesce(payload->'relationships',payload->'utilityRelationships','[]'::jsonb) into relationships from public.atlas_reforecast_registries where community_id=cid and version_id::text=source->'registry'->>'version';
 source:=jsonb_set(source,'{registry,relationships}',coalesce(relationships,'[]'::jsonb));
 return (source-'sourceVersion')||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_source_with_registry(uuid,text[],uuid[],uuid) from public,anon,authenticated;
create or replace function public.atlas_read_reforecast_source(p_community_id uuid,p_periods text[],p_baseline_version_ids uuid[] default null,p_registry_version_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not atlas_private.reforecast_access(p_community_id) then raise exception 'Reforecast source access denied';end if;
 return atlas_private.reforecast_source_with_registry(p_community_id,p_periods,p_baseline_version_ids,p_registry_version_id);end;$$;

-- Recommendation history is evidence only; it never substitutes actuals for forecast lines.
create or replace function atlas_private.reforecast_recommendation_history(cid uuid,first_open text,registry jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p text;v public.atlas_financial_close_versions;result jsonb:='[]';baseline jsonb;lines jsonb;item jsonb;
begin
 if first_open is null then return result;end if;
 for p in select to_char(d,'YYYY-MM') from generate_series((first_open||'-01')::date-interval '12 months',(first_open||'-01')::date-interval '1 month',interval '1 month')d loop
 select c.* into v from public.atlas_financial_close_heads h join public.atlas_financial_close_versions c using(version_id) where h.community_id=cid and h.period_key=p and h.accounting_basis='accrual';
 item:=jsonb_build_object('period',p,'status','unavailable','eligible',false,'reason','A full governed close and verified baseline are required','closeVersionId',v.version_id,'sourceHash',v.source_hash);
 if v.version_id is not null and atlas_private.reforecast_close_eligible(cid,p,v.source_hash) then
 select value into baseline from jsonb_array_elements(public.atlas_reforecast_effective_baseline(array[cid],array[p]));
 select coalesce(jsonb_agg(jsonb_build_object('accountCode',r.gl_code,'actual',r.actual,'amount',r.actual,'nature',a->'nature','placement',a->'placement','category',a->'category','closeVersionId',v.version_id,'source',r.source_location) order by r.gl_code),'[]') into lines from public.atlas_financial_close_rows r left join lateral (select value a from jsonb_array_elements(registry->'accounts') where value->>'accountCode'=r.gl_code)q on true where r.version_id=v.version_id;
 item:=item||jsonb_build_object('baseline',baseline,'lines',lines);
 if baseline->>'status'='available' and jsonb_array_length(lines)>0 and not exists(select 1 from jsonb_array_elements(lines)l where jsonb_typeof(l->'actual') is distinct from 'number') then item:=item||jsonb_build_object('status','available','eligible',true,'reason',null);end if;
 end if;
 result:=result||jsonb_build_array(item);
 end loop;return result;
end;$$;
revoke all on function atlas_private.reforecast_recommendation_history(uuid,text,jsonb) from public,anon,authenticated;

create or replace function atlas_private.reforecast_source_for_config(cid uuid,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare periods text[];budgets uuid[];source jsonb;chosen jsonb;versions jsonb:='[]';selected jsonb:='[]';inherited jsonb:='[]';locked jsonb:='[]';p text;pub public.atlas_reforecast_publications;line jsonb;receipt jsonb;receipts jsonb:='[]';contract jsonb;original jsonb;typ text:=coalesce(config->>'baselineType','original_budget');
begin
 select array_agg(v order by v) into periods from jsonb_array_elements_text(config->'periods')v;
 select array_agg(v::uuid) into budgets from jsonb_array_elements_text(coalesce(config->'baselineVersionIds','[]'))v;
 source:=atlas_private.reforecast_source_with_registry(cid,periods,budgets,nullif(config->>'registryVersionId','')::uuid);source:=jsonb_set(source,'{actuals,latestFullClosePeriod}',coalesce((select to_jsonb(max(h.period_key)) from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.accounting_basis='accrual' and atlas_private.reforecast_close_eligible(cid,h.period_key,v.source_hash)),'null'::jsonb));original:=source->'baseline'->'lines';
 if typ not in ('original_budget','approved_reforecast') then raise exception 'Choose an approved original budget or verified approved forecast';end if;
 foreach p in array periods loop
 chosen:=null;pub:=null;
 if typ='approved_reforecast' then
 if (select count(*) from public.atlas_reforecast_publications v where community_id=cid and config->'baselinePublicationIds' ? v.publication_id::text and p=any(v.periods))<>1 then raise exception 'Selected approved forecast must cover every included full month without overlap';end if;
 select * into pub from public.atlas_reforecast_publications v where community_id=cid and config->'baselinePublicationIds' ? v.publication_id::text and p=any(v.periods);
 if not atlas_private.reforecast_publication_period_valid(pub,p) then raise exception 'Selected approved forecast is reopened, stale or unverified';end if;
 select jsonb_agg(v||jsonb_build_object('amount',v->'forecast','source',jsonb_build_object('sourceType','approved_reforecast','publicationId',pub.publication_id,'versionId',pub.revision_id,'revisionId',pub.revision_id,'contentHash',pub.snapshot->>'fingerprint','priorSource',v->'source'))) into chosen from jsonb_array_elements(pub.snapshot->'lines')v where v->>'period'=p;
 versions:=versions||jsonb_build_array(jsonb_build_object('period',p,'sourceType',typ,'publicationId',pub.publication_id,'versionId',pub.revision_id,'contentHash',pub.snapshot->>'fingerprint'));
 else select jsonb_agg(v||jsonb_build_object('source',(v->'source')||jsonb_build_object('sourceType','original_budget'))) into chosen from jsonb_array_elements(original)v where v->>'period'=p;
 versions:=versions||jsonb_build_array(jsonb_build_object('period',p,'sourceType',typ,'versionId',chosen->0->'source'->'versionId','sourceHash',chosen->0->'source'->'sourceHash'));
 end if;
 if atlas_private.reforecast_month_locked(cid,p) then
 select value into receipt from jsonb_array_elements(public.atlas_reforecast_effective_baseline(array[cid],array[p]));
 if receipt->>'status' is distinct from 'available' then raise exception 'Locked month % requires its exact verified inherited baseline: %',p,receipt->>'reason';end if;
 locked:=locked||to_jsonb(p);chosen:='[]';
 for line in select value from jsonb_array_elements(receipt->'lines') loop
 if receipt->>'sourceType'='approved_reforecast' then
 select value into line from public.atlas_reforecast_publications v cross join lateral jsonb_array_elements(v.snapshot->'lines')l where v.publication_id=(receipt->>'publicationId')::uuid and l->>'period'=p and l->>'accountCode'=line->>'accountCode';
 else line:=line||jsonb_build_object('forecast',line->'amount','originalBudget',line->'amount','baselineLineage',line->'source');end if;
 inherited:=inherited||jsonb_build_array(line);chosen:=chosen||jsonb_build_array(line||jsonb_build_object('amount',line->'forecast'));
 end loop;
 versions:=(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(versions)v where v->>'period'<>p)||jsonb_build_array(receipt-'lines');
 end if;
 if chosen is null or jsonb_array_length(chosen)=0 then raise exception 'Approved baseline detail is unavailable for %',p;end if;
 selected:=selected||chosen;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where locked ? (v->>'period')) then raise exception 'Locked month inputs are immutable inherited detail; remove the override';end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(config->'sourceUploadIds','[]'))id where not exists(select 1 from public.atlas_reforecast_uploads u where u.upload_id::text=id and u.community_id=cid)) then raise exception 'Source upload is outside the scenario community';end if;
 source:=jsonb_set(source,'{baseline}',source->'baseline'||jsonb_build_object('sourceType',typ,'originalBudgetLines',original,'lines',selected,'periodVersions',versions));
 source:=source||jsonb_build_object('lockedPeriods',locked,'inheritedLines',inherited,'sourceReceipts',(select coalesce(jsonb_agg(jsonb_build_object('uploadId',u.upload_id,'sourceType',u.payload->>'sourceType','sourceHash',u.source_hash,'contentHash',u.content_hash,'review',r.payload,'reviewId',r.review_id,'reviewHash',r.content_hash) order by u.upload_id),'[]') from public.atlas_reforecast_uploads u left join lateral (select * from public.atlas_reforecast_source_reviews where upload_id=u.upload_id order by review_order desc limit 1)r on true where u.community_id=cid and config->'sourceUploadIds' ? u.upload_id::text));
 for receipt in select value from jsonb_array_elements(source->'sourceReceipts') loop
 if receipt->'review'->'canonicalContract'->>'contractId' is not null then
 contract:=null;
 if to_regclass('public.atlas_contracts') is not null then execute 'select to_jsonb(c) from public.atlas_contracts c where contract_id=$1 and community_id=$2 and deleted_at is null' into contract using (receipt->'review'->'canonicalContract'->>'contractId')::uuid,cid;end if;
 receipt:=receipt||jsonb_build_object('stale',contract is null or contract->'version' is distinct from receipt->'review'->'canonicalContract'->'version' or (receipt->'review'->'canonicalContract'->>'contentHash' is not null and encode(sha256(convert_to(contract::text,'UTF8')),'hex') is distinct from receipt->'review'->'canonicalContract'->>'contentHash'));
 end if;receipts:=receipts||jsonb_build_array(receipt);end loop;
 source:=jsonb_set(source,'{sourceReceipts}',receipts);
 source:=source||jsonb_build_object('recommendationHistory',atlas_private.reforecast_recommendation_history(cid,(select min(v) from unnest(periods)v where not locked ? v),source->'registry'));
 return (source-'sourceVersion')||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion')::text,'UTF8')),'hex'));
end;$$;
create or replace function public.atlas_read_reforecast_builder_source(p_community_id uuid,p_periods text[],p_baseline_version_ids uuid[] default null,p_registry_version_id uuid default null,p_baseline_type text default 'original_budget',p_baseline_publication_ids uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not atlas_private.reforecast_access(p_community_id) then raise exception 'Forecast source access denied';end if;
 return atlas_private.reforecast_source_for_config(p_community_id,jsonb_build_object('periods',p_periods,'baselineVersionIds',coalesce(to_jsonb(p_baseline_version_ids),'[]'),'registryVersionId',p_registry_version_id,'baselineType',p_baseline_type,'baselinePublicationIds',coalesce(to_jsonb(p_baseline_publication_ids),'[]')));end;$$;

create or replace function atlas_private.calculate_reforecast(source jsonb,config jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare state jsonb:='{}';lines jsonb:='[]';diagnostics jsonb:='[]';impacts jsonb:='[]';monthly jsonb:='[]';totals jsonb:='{}';categories jsonb:='[]';leasing jsonb:='[]';changes jsonb:='[]';skipped jsonb:='[]';unavailable jsonb:='[]';leasing_row jsonb;leasing_source jsonb;
 p text;code text;k text;phase text;metric text;a jsonb;b jsonb;actual jsonb;inherited_line jsonb;original_line jsonb;line jsonb;driver jsonb;over jsonb;targets jsonb;control jsonb;metric_set jsonb;month_lines jsonb;item jsonb;
 value numeric;before_value numeric;base numeric;original numeric;actual_value numeric;close_id text;closed boolean;applicable boolean;known boolean;changed integer;affected integer;total numeric;missing integer;override_index integer:=0;driver_ids text[]:='{}';cutoff text:=source->'actuals'->>'cutoffPeriod';snapshot jsonb;
begin
 if jsonb_array_length(source->'baseline'->'versionIds')=0 then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','missing_baseline','severity','error','message','Select a locked original budget baseline.'));end if;
 if jsonb_array_length(coalesce(config->'drivers','[]'))=0 and jsonb_array_length(coalesce(config->'overrides','[]'))=0 then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','no_driver_changes','severity','warning','message','No accepted drivers or overrides are applied. Open-period amounts equal the original budget.'));end if;
 if source->'registry'->>'version' is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','mapping_required','severity','error','message','Approve a GL category and statement-placement registry.'));end if;
 for p in select jsonb_array_elements_text(source->'periods') loop
  closed:=cutoff is not null and p<=cutoff;applicable:=not coalesce(source->'actuals'->'notApplicablePeriods' ? p,false);
  select v into control from jsonb_array_elements(source->'actuals'->'monthly')v where v->>'period'=p;
  if closed and applicable and control is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','missing_closed_actual','severity','error','period',p,'message','A governed close is missing before the actuals cutoff.'));end if;
  for code in select distinct c from (select v->>'accountCode' c from jsonb_array_elements(source->'baseline'->'lines')v where v->>'period'=p union select v->>'accountCode' from jsonb_array_elements(source->'actuals'->'lines')v where v->>'period'=p union select v->>'accountCode' from jsonb_array_elements(source->'registry'->'accounts')v where v->>'effectiveFrom'<=p and (v->>'retiredAfter' is null or v->>'retiredAfter'>=p)) codes where c is not null order by c loop
   select v into a from jsonb_array_elements(source->'registry'->'accounts')v where v->>'accountCode'=code;
   select v into b from jsonb_array_elements(source->'baseline'->'lines')v where v->>'period'=p and v->>'accountCode'=code;
   select v into actual from jsonb_array_elements(source->'actuals'->'lines')v where v->>'period'=p and v->>'accountCode'=code;
   base:=(b->>'amount')::numeric;select v into original_line from jsonb_array_elements(coalesce(source->'baseline'->'originalBudgetLines',source->'baseline'->'lines'))v where v->>'period'=p and v->>'accountCode'=code;original:=(original_line->>'amount')::numeric;select v into inherited_line from jsonb_array_elements(coalesce(source->'inheritedLines','[]'))v where v->>'period'=p and v->>'accountCode'=code;actual_value:=(actual->>'amount')::numeric;close_id:=actual->>'closeVersionId';
   if close_id is null then close_id:=control->>'closeVersionId';end if;
   known:=a is not null and (closed or a->>'effectiveFrom'<=p);
   if not known and applicable then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','unmapped_account','severity','error','period',p,'accountCode',code,'message','GL category, nature or effective statement placement is missing.'));end if;
   value:=case when not applicable then null when source->'lockedPeriods' ? p then (inherited_line->>'forecast')::numeric when closed then actual_value when a->>'retiredAfter'<p then 0 else base end;
   line:=jsonb_build_object('period',p,'accountCode',code,'originalBudget',original,'selectedBaseline',base,'baselineLineage',b->'source','immutable',coalesce(source->'lockedPeriods' ? p,false),'inheritedDetail',inherited_line,'actual',case when closed and applicable then actual_value end,'forecast',value,'sourceKind',case when not applicable then 'not_applicable' when source->'lockedPeriods' ? p then 'inherited_locked' when closed then 'closed_actual' else 'forecast' end,'closeVersionId',close_id,'accountName',coalesce(a->>'name',b->>'accountName',code),'category',a->'category','identifier',coalesce(a->'identifier',a->'nature'),'nature',a->'nature','placement',a->'placement','mappingValid',known,'retired',a->>'retiredAfter' is not null and p>a->>'retiredAfter','applicable',applicable,'driverSources','[]'::jsonb,'driverIds','[]'::jsonb,'source',case when source->'lockedPeriods' ? p then inherited_line->'source' when closed then actual->'source' else b->'source' end);
   state:=jsonb_set(state,array[p||'|'||code],line,true);
  end loop;
 end loop;
 for driver in select v from jsonb_array_elements(coalesce(config->'drivers','[]'))v loop
  if coalesce(driver->>'id','')='' or driver->>'id'=any(driver_ids) or coalesce(driver->>'operation','') not in ('percent_change','amount','add','percent_of_account','occupancy_vacancy') or jsonb_typeof(driver->'value') is distinct from 'number' or abs((driver->>'value')::numeric)>1000000000000 then raise exception 'Invalid or duplicate scenario driver';end if;
  driver_ids:=array_append(driver_ids,driver->>'id');
  if driver->>'operation'='occupancy_vacancy' and ((driver->>'value')::numeric<0 or (driver->>'value')::numeric>1) then raise exception 'Occupancy driver must be a fraction between zero and one';end if;
  targets:=coalesce(driver->'accountCodes',source->'registry'->'driverMappings'->(driver->>'type'),'[]');
  if jsonb_typeof(targets)<>'array' or jsonb_array_length(targets)=0 then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','driver_mapping_required','severity','error','driverId',driver->>'id','message','Driver has no explicitly mapped applicable GLs.'));impacts:=impacts||jsonb_build_array(jsonb_build_object('id',driver->>'id','type',coalesce(driver->>'type',''),'operation',driver->>'operation','value',driver->'value','source',driver->'source','reason',coalesce(driver->>'reason',''),'changed','[]'::jsonb,'skippedClosed','[]'::jsonb,'unavailable','[]'::jsonb,'status','unavailable','explanation','No reviewed applicable account mapping.'));continue;end if;
  changed:=0;affected:=0;changes:='[]';skipped:='[]';unavailable:='[]';
  for p in select v from jsonb_array_elements_text(coalesce(driver->'periods',source->'periods')) with ordinality q(v,ord) group by v order by min(ord) loop
   if not(source->'periods' ? p) then continue;end if;
   for code in select v from jsonb_array_elements_text(targets) with ordinality q(v,ord) group by v order by min(ord) loop
    k:=p||'|'||code;line:=state->k;
    if (source->'lockedPeriods' ? p) or (cutoff is not null and p<=cutoff) or source->'actuals'->'notApplicablePeriods' ? p then skipped:=skipped||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code));continue;end if;
    if exists(select 1 from jsonb_array_elements(source->'registry'->'accounts')z where z->>'accountCode'=code and z->>'retiredAfter'<p) then skipped:=skipped||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'reason','Prospectively retired by reviewed mapping registry'));continue;end if;
    if line is null or line->>'mappingValid' is distinct from 'true' then unavailable:=unavailable||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'reason','Missing effective account mapping'));diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','driver_target_unavailable','severity','error','period',p,'accountCode',code,'driverId',driver->>'id','message','Driver target lacks an effective mapped GL.'));continue;end if;
    affected:=affected+1;before_value:=(line->>'forecast')::numeric;
    case driver->>'operation'
    when 'amount' then value:=(driver->>'value')::numeric;
    when 'add' then value:=before_value+(driver->>'value')::numeric;
    when 'percent_change' then value:=before_value*(1+(driver->>'value')::numeric);
    when 'percent_of_account' then value:=(state->(p||'|'||(driver->>'baseAccountCode'))->>'forecast')::numeric*(driver->>'value')::numeric;
    when 'occupancy_vacancy' then value:=-abs((state->(p||'|'||(driver->>'baseAccountCode'))->>'forecast')::numeric)*(1-(driver->>'value')::numeric);
    end case;
    value:=round(value,2);if value is distinct from before_value then changed:=changed+1;changes:=changes||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'before',before_value,'after',value,'delta',value-before_value));end if;
    if value is null then unavailable:=unavailable||jsonb_build_array(jsonb_build_object('period',p,'accountCode',code,'reason','Missing required source amount'));diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','driver_input_missing','severity','error','period',p,'accountCode',code,'driverId',driver->>'id','message','Driver input or dependent account is unavailable.'));end if;
    line:=line||jsonb_build_object('forecast',value,'driverIds',(line->'driverIds')||jsonb_build_array(driver->>'id'),'driverSources',(line->'driverSources')||jsonb_build_array(jsonb_build_object('driverId',driver->>'id','operation',driver->>'operation','value',driver->'value','source',driver->'source','reason',coalesce(driver->>'reason',''))));state:=jsonb_set(state,array[k],line,true);
   end loop;
  end loop;
  impacts:=impacts||jsonb_build_array(jsonb_build_object('id',driver->>'id','type',coalesce(driver->>'type',''),'operation',driver->>'operation','value',driver->'value','source',driver->'source','reason',coalesce(driver->>'reason',''),'affectedLines',affected,'changedLines',changed,'changed',changes,'skippedClosed',skipped,'unavailable',unavailable,'status',case when jsonb_array_length(unavailable)>0 then 'unavailable' when changed>0 then 'applied' else 'no_impact' end,'explanation',case when jsonb_array_length(unavailable)>0 then 'One or more applicable periods or account inputs are unavailable.' when changed>0 then 'Changed '||changed||' open-period account amount(s).' when jsonb_array_length(skipped)>0 then 'All applicable changes are in governed closed periods and were not applied.' when not exists(select 1 from jsonb_array_elements_text(coalesce(driver->'periods',source->'periods'))d where source->'periods' ? d) then 'No driver periods overlap the reporting period.' else 'Mapped open-period values already equal this driver result.' end));
 end loop;
 for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v loop
  override_index:=override_index+1;
  p:=over->>'period';code:=over->>'accountCode';k:=p||'|'||code;
  if not(source->'periods' ? p) or coalesce(code,'')='' or jsonb_typeof(over->'amount') not in ('number','null') then raise exception 'Invalid working-cell override';end if;
  if (source->'lockedPeriods' ? p) or (cutoff is not null and p<=cutoff) or source->'actuals'->'notApplicablePeriods' ? p then continue;end if;
  if exists(select 1 from jsonb_array_elements(source->'registry'->'accounts')z where z->>'accountCode'=code and z->>'retiredAfter'<p) then continue;end if;
  line:=state->k;if line is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','override_mapping_required','severity','error','period',p,'accountCode',code,'message','Map this GL before applying a working-cell override.'));continue;end if;
  if coalesce(over->>'reason','')='' then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','override_reason','severity','error','period',p,'accountCode',code,'message','Record an adjustment reason for this working-cell override.'));end if;
  line:=line||jsonb_build_object('forecast',round((over->>'amount')::numeric,2),'override',over,'driverIds',(line->'driverIds')||jsonb_build_array('override-'||(override_index-1)),'driverSources',(line->'driverSources')||jsonb_build_array(jsonb_build_object('driverId','override-'||(override_index-1),'operation','amount','value',over->'amount','source',over->'source','reason',coalesce(over->>'reason',''))));state:=jsonb_set(state,array[k],line,true);
 end loop;
 select coalesce(jsonb_agg(v||jsonb_build_object('forecastVariance',(v->>'forecast')::numeric-(v->>'selectedBaseline')::numeric,'actualVariance',(v->>'actual')::numeric-(case when v->>'immutable'='true' then v->>'forecast' else v->>'selectedBaseline' end)::numeric,'forecastFavorability',case when v->>'forecast' is null or v->>'selectedBaseline' is null then 'unavailable' when (v->>'forecast')::numeric=(v->>'selectedBaseline')::numeric then 'neutral' when ((v->>'forecast')::numeric>(v->>'selectedBaseline')::numeric)=(v->>'nature' in ('income','contra_income')) then 'favorable' else 'unfavorable' end) order by v->>'period',v->>'accountCode'),'[]') into lines from jsonb_each(state) x(k,v);
 for line in select v from jsonb_array_elements(lines)v loop
  if line->>'sourceKind'='forecast' and line->>'forecast' is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','open_value_missing','severity','error','period',line->>'period','accountCode',line->>'accountCode','message','Open forecast value is missing; enter an explicit value or documented zero.'));
  elsif line->>'sourceKind'='closed_actual' and line->>'actual' is null then diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code','closed_detail_missing','severity','warning','period',line->>'period','accountCode',line->>'accountCode','message','This GL is absent from the closed package. It remains unavailable; canonical closed controls govern monthly totals.'));end if;
 end loop;
 for p in select jsonb_array_elements_text(source->'periods') loop
  select coalesce(jsonb_agg(v),'[]') into month_lines from jsonb_array_elements(lines)v where v->>'period'=p;
  select v into control from jsonb_array_elements(source->'actuals'->'monthly')v where v->>'period'=p;
  metric_set:=jsonb_build_object('period',p,'closed',cutoff is not null and p<=cutoff and not(source->'actuals'->'notApplicablePeriods' ? p),'applicable',not(source->'actuals'->'notApplicablePeriods' ? p),'originalBudget',atlas_private.reforecast_metric(month_lines,'originalBudget'),'selectedBaseline',atlas_private.reforecast_metric(month_lines,'selectedBaseline'),'reforecast',case when source->'actuals'->'notApplicablePeriods' ? p then atlas_private.reforecast_metric('[]','forecast') when cutoff is not null and p<=cutoff and not coalesce(source->'lockedPeriods' ? p,false) then atlas_private.reforecast_metric(month_lines,'actual')||coalesce(control,'{}')||jsonb_build_object('expenses',control->'opex') else atlas_private.reforecast_metric(month_lines,'forecast') end,'actuals',case when cutoff is not null and p<=cutoff and not(source->'actuals'->'notApplicablePeriods' ? p) then atlas_private.reforecast_metric(month_lines,'actual')||coalesce(control,'{}')||jsonb_build_object('expenses',control->'opex') else atlas_private.reforecast_metric('[]','actual') end,'closeVersionId',control->'closeVersionId','detailCoverage',(select coalesce(jsonb_agg(v->>'accountCode'),'[]') from jsonb_array_elements(month_lines)v where v->>'sourceKind'='closed_actual' and v->>'actual' is null),'controlSource',control->'source');
  monthly:=monthly||jsonb_build_array(metric_set);
 end loop;
 foreach phase in array array['originalBudget','selectedBaseline','reforecast','actuals','actualsThroughCutoff'] loop
  item:='{}';foreach metric in array array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow'] loop
   select sum((v->(case when phase='actualsThroughCutoff' then 'actuals' else phase end)->>metric)::numeric),count(*) filter(where v->(case when phase='actualsThroughCutoff' then 'actuals' else phase end)->>metric is null) into total,missing from jsonb_array_elements(monthly)v where (phase='originalBudget' or not(source->'actuals'->'notApplicablePeriods' ? (v->>'period'))) and (phase<>'actualsThroughCutoff' or v->>'closed'='true');
   item:=item||jsonb_build_object(metric,case when missing=0 then round(total,2) end);
  end loop;
  item:=item||jsonb_build_object('margin',case when (item->>'revenue')::numeric<>0 then (item->>'noi')::numeric/(item->>'revenue')::numeric end);totals:=totals||jsonb_build_object(phase,item);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('category',category,'monthly',(select jsonb_agg(jsonb_build_object('period',pr.period_value,'originalBudget',(select case when count(*) filter(where v->>'originalBudget' is null)=0 then coalesce(sum((v->>'originalBudget')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category),'forecast',(select case when count(*) filter(where v->>'forecast' is null)=0 then coalesce(sum((v->>'forecast')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category),'actual',case when pr.period_value<=cutoff then (select case when count(*) filter(where v->>'actual' is null)=0 then coalesce(sum((v->>'actual')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category) end) order by pr.period_value) from jsonb_array_elements_text(source->'periods') as pr(period_value))) order by category),'[]') into categories from (select distinct v->>'category' category from jsonb_array_elements(lines)v where v->>'category' is not null)c;
 for p in select jsonb_array_elements_text(source->'periods') loop
  closed:=cutoff is not null and p<=cutoff and not(source->'actuals'->'notApplicablePeriods' ? p);
  select v into leasing_source from jsonb_array_elements(case when closed then coalesce(source->'actuals'->'leasing','[]') else coalesce(source->'baseline'->'leasing','[]') end)v where v->>'period'=p;
  leasing_row:=jsonb_build_object('period',p,'sourceKind',case when source->'actuals'->'notApplicablePeriods' ? p then 'not_applicable' when source->'lockedPeriods' ? p then 'inherited_locked' when closed then 'closed_actual' else 'forecast' end,'units',leasing_source->'units','occupiedUnits',leasing_source->'occupiedUnits','moveIns',leasing_source->'moveIns','moveOuts',leasing_source->'moveOuts','marketRent',leasing_source->'marketRent','source',leasing_source->'source');
  for driver in select v from jsonb_array_elements(coalesce(config->'drivers','[]'))v loop
   if not closed and not(source->'actuals'->'notApplicablePeriods' ? p) and driver->>'operation'='occupancy_vacancy' and (driver->'periods' is null or driver->'periods' ? p) and leasing_row->>'units' is not null and exists(select 1 from jsonb_array_elements(lines)l where l->>'period'=p and l->>'mappingValid'='true' and l->>'retired' is distinct from 'true' and l->>'forecast' is not null and l->'driverIds' ? (driver->>'id')) then leasing_row:=leasing_row||jsonb_build_object('occupiedUnits',(leasing_row->>'units')::numeric*(driver->>'value')::numeric);end if;
  end loop;
  leasing:=leasing||jsonb_build_array(leasing_row||jsonb_build_object('occupancy',case when (leasing_row->>'units')::numeric>0 then (leasing_row->>'occupiedUnits')::numeric/(leasing_row->>'units')::numeric end));
 end loop;
 snapshot:=jsonb_build_object('schemaVersion',1,'communityId',source->'communityId','periods',source->'periods','identity',jsonb_build_object('engineVersion','atlas-reforecast-v1','communityId',source->'communityId','periods',source->'periods','actualCutoff',cutoff,'actualCloseVersions',source->'actuals'->'closeVersions','mappingRegistryVersion',source->'registry'->'version','baselineVersionIds',source->'baseline'->'versionIds','baselinePeriodVersions',source->'baseline'->'periodVersions','baselineSourceType',source->'baseline'->>'sourceType','priorPublicationIds',(select coalesce(jsonb_agg(distinct v->>'publicationId'),'[]') from jsonb_array_elements(coalesce(source->'baseline'->'periodVersions','[]'))v where v->>'publicationId' is not null),'closeVersions',source->'actuals'->'closeVersions','registryVersion',source->'registry'->'version','sourceVersion',source->'sourceVersion','driverVersion',config->>'driverVersion'),'status',case when exists(select 1 from jsonb_array_elements(diagnostics)d where d->>'severity'='error') then 'action_required' else 'ready' end,'lines',lines,'monthly',monthly,'totals',totals,'categories',categories,'leasing',leasing,'diagnostics',diagnostics,'driverImpacts',impacts,'cutoffPeriod',cutoff,'completeness',jsonb_build_object('blockerCount',(select count(*) from jsonb_array_elements(diagnostics)d where d->>'severity'='error'),'warningCount',(select count(*) from jsonb_array_elements(diagnostics)d where d->>'severity'='warning')));
 snapshot:=snapshot||jsonb_build_object('recommendationHistory',coalesce(source->'recommendationHistory','[]'::jsonb),'sunsetRelationships',(select coalesce(jsonb_agg(jsonb_build_object('accountCode',gl->>'accountCode','successorAccountCode',gl->>'successorAccountCode','retiredAfter',gl->>'retiredAfter','reason',coalesce(gl->>'retirementReason',gl->>'deactivationReason'),'mappingRegistryVersion',source->'registry'->'version','approved',true)),'[]'::jsonb) from jsonb_array_elements(source->'registry'->'accounts')gl where gl->>'retiredAfter' is not null and gl->>'successorAccountCode' is not null and coalesce(gl->>'retirementReason',gl->>'deactivationReason','')<>'' and coalesce(gl->>'newActivityCoding','')<>'' and exists(select 1 from jsonb_array_elements(source->'registry'->'accounts')v where v->>'accountCode'=gl->>'successorAccountCode' and v->>'retiredAfter' is null)));
 return snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
end;$$;


create or replace function atlas_private.save_reforecast_builder(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.atlas_reforecast_revisions;rec public.atlas_reforecast_revisions;head public.atlas_reforecast_heads;source jsonb;snapshot jsonb;config jsonb;periods text[];budget_ids uuid[];role_name text;hash text;next_status text;person uuid;owner_id uuid;reviewer_id uuid;submitted public.atlas_reforecast_revisions;
begin
 if not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Reforecast edit access denied';end if;
 if p_scenario_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_action not in ('create','save_draft','reconcile','ready','submit','approve','lock') or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2097152 then raise exception 'Invalid reforecast save request';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_scenario_id,p_expected_revision,p_action,p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||p_community_id,0));perform pg_advisory_xact_lock(hashtextextended('reforecast-scenario:'||p_scenario_id,0));
 select * into rec from public.atlas_reforecast_revisions where request_id=p_request_id;
 if rec.revision_id is not null then
  if rec.community_id<>p_community_id or rec.actor_id<>auth.uid() or rec.request_hash<>hash then raise exception 'Reforecast save request ID reused for different changes';end if;
  select * into head from public.atlas_reforecast_heads where scenario_id=p_scenario_id;return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',rec.source,'snapshot',rec.snapshot);
 end if;
 select r.* into prior from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=p_scenario_id;
 if prior.revision_id is not null and prior.community_id<>p_community_id then raise exception 'Scenario community is immutable';end if;
 if coalesce(prior.revision,0)<>p_expected_revision then raise exception 'Reforecast changed in another session. Keep your edits and reload before retrying';end if;
 if prior.status='locked' then raise exception 'Locked reforecasts are immutable; create a new working scenario';end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 if p_action in ('create','save_draft','reconcile') then
  if prior.status='approved' then raise exception 'Approved reforecasts require a new working scenario';end if;
  config:=p_payload;
 else
  if prior.revision_id is null then raise exception 'Save a working draft before a workflow transition';end if;
  if (p_payload-'reason') is distinct from (prior.payload-'reason') then raise exception 'Save changed inputs as a working draft before changing review status';end if;
  config:=prior.payload||jsonb_build_object('reason',p_payload->>'reason');
 end if;
 if coalesce(config->>'name','')='' or length(config->>'name')>200 or coalesce(config->>'model','') not in ('conventional','student','lease_up','short_term','owner_specific','mixed') or jsonb_typeof(config->'periods') is distinct from 'array' or length(trim(coalesce(config->>'reason','')))<3 then raise exception 'Scenario name, model, reporting periods and adjustment reason are required';end if;
 if jsonb_typeof(coalesce(config->'drivers','[]'))<>'array' or jsonb_array_length(coalesce(config->'drivers','[]'))>500 or jsonb_typeof(coalesce(config->'overrides','[]'))<>'array' or jsonb_array_length(coalesce(config->'overrides','[]'))>20000 then raise exception 'Invalid or oversized scenario inputs';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v group by v->>'period',v->>'accountCode' having count(*)>1) then raise exception 'Keep one working-cell override for each GL and reporting month';end if;
 select array_agg(v order by v) into periods from jsonb_array_elements_text(config->'periods')v;
 if config->>'uploadId' is not null and not exists(select 1 from public.atlas_reforecast_uploads where upload_id=(config->>'uploadId')::uuid and community_id=p_community_id) then raise exception 'Workbook upload community mismatch';end if;
 select array_agg(v::uuid) into budget_ids from jsonb_array_elements_text(coalesce(config->'baselineVersionIds','[]'))v;
 if config->>'ownerId' is null and prior.revision_id is null then config:=config||jsonb_build_object('ownerId',auth.uid());end if;
 owner_id:=nullif(config->>'ownerId','')::uuid;reviewer_id:=nullif(config->>'reviewerId','')::uuid;
 foreach person in array array[owner_id,reviewer_id] loop
  if person is not null and not exists(select 1 from public.atlas_user_profiles where user_id=person and status='active' and (role in ('admin','executive','centra') or p_community_id=any(coalesce(allowed_community_ids,'{}')))) then raise exception 'Owner or reviewer is not active and authorized for this community';end if;
 end loop;
 if reviewer_id is not null and not exists(select 1 from public.atlas_user_profiles where user_id=reviewer_id and role in ('admin','executive','regional')) then raise exception 'Reviewer must be an Admin, executive or Regional';end if;
 if exists(select 1 from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.community_id=p_community_id and h.scenario_id<>p_scenario_id and h.status not in ('approved','locked') and (select array_agg(v order by v) from jsonb_array_elements_text(r.payload->'periods')v)=periods) then raise exception 'One editable scenario already exists for this community and exact period set';end if;
 source:=atlas_private.reforecast_source_for_config(p_community_id,config);
 snapshot:=atlas_private.calculate_reforecast(source,config);
 if config->>'uploadId' is not null or jsonb_array_length(coalesce(config->'importHistory','[]'))>0 or exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null) then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||atlas_private.reforecast_import_issues(source,config));end if;
 if owner_id is null or reviewer_id is null then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||jsonb_build_array(jsonb_build_object('code','ownership_required','severity','error','message','Assign an active owner and authorized reviewer.')));end if;
 snapshot:=jsonb_set(snapshot,'{completeness,blockerCount}',to_jsonb((select count(*) from jsonb_array_elements(snapshot->'diagnostics')d where d->>'severity'='error')));
 snapshot:=jsonb_set(snapshot,'{status}',to_jsonb(case when (snapshot->'completeness'->>'blockerCount')::integer>0 then 'action_required'::text else 'ready'::text end));
 rec.revision_id:=gen_random_uuid();
 snapshot:=snapshot||jsonb_build_object('identity',(snapshot->'identity')||jsonb_build_object('scenarioId',p_scenario_id,'scenarioVersion',p_expected_revision+1,'reforecastVersion',rec.revision_id));
 snapshot:=snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((snapshot-'fingerprint')::text,'UTF8')),'hex'));
 if p_action in ('ready','submit','approve','lock') then
  if (snapshot->'completeness'->>'blockerCount')::integer>0 then raise exception 'Resolve mapping, missing values and ownership blockers before review or approval';end if;
  if prior.source->>'sourceVersion' is distinct from source->>'sourceVersion' then raise exception 'Canonical actuals, budget or registry evidence changed. Save and reconcile the working draft before review';end if;
 end if;
 case p_action
 when 'create' then next_status:='uploaded';
 when 'save_draft' then next_status:=case when source->'registry'->>'version' is null then 'mapping_required' else 'working_draft' end;
 when 'reconcile' then next_status:=case when (snapshot->'completeness'->>'blockerCount')::integer=0 then 'reconciled' when exists(select 1 from jsonb_array_elements(snapshot->'diagnostics')d where d->>'code' in ('unmapped_account','mapping_required','driver_mapping_required')) then 'mapping_required' else 'working_draft' end;
 when 'ready' then if prior.status not in ('working_draft','reconciled') then raise exception 'Reconcile a working draft before marking ready';end if;next_status:='ready_for_review';
 when 'submit' then if prior.status<>'ready_for_review' then raise exception 'Mark the reforecast ready before submission';end if;next_status:='submitted';
 when 'approve' then
  if prior.status not in ('submitted','approved') or not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Only an authorized Admin or executive can approve and lock a submitted reforecast';end if;
  select * into submitted from public.atlas_reforecast_revisions where scenario_id=p_scenario_id and action='submit' order by revision desc limit 1;
  if (owner_id=auth.uid() or submitted.actor_id=auth.uid()) and submitted.actor_role not in ('admin','executive') then raise exception 'Regional preparation requires a separate approver; Admin or executive submissions may self-approve';end if;
  next_status:='approved';
 when 'lock' then if prior.status<>'approved' or not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Approve the reforecast before an authorized lock';end if;next_status:='locked';
 end case;
 insert into public.atlas_reforecast_revisions(revision_id,scenario_id,community_id,revision,status,action,request_id,request_hash,payload,source,snapshot,actor_id,actor_role)
 values(rec.revision_id,p_scenario_id,p_community_id,p_expected_revision+1,next_status,p_action,p_request_id,hash,config,source,snapshot,auth.uid(),role_name) returning * into rec;
 insert into public.atlas_reforecast_heads values(p_scenario_id,p_community_id,rec.revision,rec.revision_id,next_status)
 on conflict(scenario_id) do update set revision=excluded.revision,revision_id=excluded.revision_id,status=excluded.status returning * into head;
 return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',source,'snapshot',snapshot);
end;$$;


create or replace function public.atlas_publish_reforecast(p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_reason text)
returns public.atlas_reforecast_publications language plpgsql security definer set search_path='' as $$
declare rec public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;source jsonb;periods text[];budget_ids uuid[];hash text;next_version integer;
begin
 select r.* into rec from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=p_scenario_id;
 if rec.revision_id is null or not atlas_private.reforecast_access(rec.community_id,'publish') then raise exception 'Only an authorized Admin or executive may publish an active reforecast';end if;
 if p_request_id is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Publication request and reason required';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_scenario_id,p_expected_revision,p_reason)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||rec.community_id,0));
 select * into pub from public.atlas_reforecast_publications where request_id=p_request_id;
 if pub.publication_id is not null then if pub.request_hash<>hash or pub.published_by<>auth.uid() then raise exception 'Publication request ID reused';end if;return pub;end if;
 if rec.status<>'locked' or rec.revision<>p_expected_revision then raise exception 'Only the expected locked reforecast revision may be published';end if;
 select * into pub from public.atlas_reforecast_publications where revision_id=rec.revision_id;
 if pub.publication_id is not null then
  if exists(select 1 from unnest(pub.periods)p where not atlas_private.reforecast_month_locked(pub.community_id,p) and not exists(select 1 from public.atlas_reforecast_active_heads h where h.community_id=pub.community_id and h.period_key=p and h.publication_id=pub.publication_id)) then raise exception 'This publication was superseded; create and approve a new revision rather than reactivating history';end if;return pub;
 end if;
 select array_agg(v order by v) into periods from jsonb_array_elements_text(rec.payload->'periods')v;
 select array_agg(v::uuid) into budget_ids from jsonb_array_elements_text(coalesce(rec.payload->'baselineVersionIds','[]'))v;
 source:=atlas_private.reforecast_source_for_config(rec.community_id,rec.payload);
 if source->>'sourceVersion' is distinct from rec.source->>'sourceVersion' then raise exception 'Closed actual evidence changed after locking. Preserve this locked version and create a revised working scenario';end if;
 if (rec.snapshot->'completeness'->>'blockerCount')::integer<>0 then raise exception 'Locked snapshot has unresolved blockers';end if;
 select coalesce(max(version),0)+1 into next_version from public.atlas_reforecast_publications where community_id=rec.community_id;
 insert into public.atlas_reforecast_publications(community_id,scenario_id,revision_id,version,request_id,request_hash,periods,snapshot,source,reason,published_by,published_role)
 values(rec.community_id,p_scenario_id,rec.revision_id,next_version,p_request_id,hash,periods,rec.snapshot,rec.source,p_reason,auth.uid(),(select role from public.atlas_user_profiles where user_id=auth.uid())) returning * into pub;
 insert into public.atlas_reforecast_active_heads select rec.community_id,p,pub.publication_id from unnest(periods)p where not atlas_private.reforecast_month_locked(rec.community_id,p)
 on conflict(community_id,period_key) do update set publication_id=excluded.publication_id;
 return pub;
end;$$;


create or replace function public.atlas_save_reforecast_scenario(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rec public.atlas_reforecast_revisions;head public.atlas_reforecast_heads;pub public.atlas_reforecast_publications;hash text;
begin
 if p_action in ('approve','lock') then raise exception 'Use the atomic Approve and Lock action';end if;
 if p_action='approve_lock' then
 if not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Only an authorized Admin or executive can approve and lock';end if;
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||p_community_id,0));
 select * into pub from public.atlas_reforecast_publications where request_id=p_request_id;
 if pub.publication_id is not null then
 select * into rec from public.atlas_reforecast_revisions where revision_id=pub.revision_id;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_scenario_id,p_action,p_expected_revision,p_payload)::text,'UTF8')),'hex');
 if rec.actor_id<>auth.uid() or pub.community_id<>p_community_id or pub.scenario_id<>p_scenario_id or pub.request_hash is distinct from encode(sha256(convert_to(jsonb_build_array(p_scenario_id,p_expected_revision+2,p_payload->>'reason')::text,'UTF8')),'hex') or (rec.payload-'reason') is distinct from (p_payload-'reason') then raise exception 'Approval request ID reused for different changes';end if;
 else
 result:=atlas_private.save_reforecast_builder(p_community_id,p_scenario_id,p_expected_revision,gen_random_uuid(),'approve',p_payload);
 result:=atlas_private.save_reforecast_builder(p_community_id,p_scenario_id,p_expected_revision+1,gen_random_uuid(),'lock',result->'revision'->'payload');
 pub:=public.atlas_publish_reforecast(p_scenario_id,p_expected_revision+2,p_request_id,p_payload->>'reason');
 end if;
 select * into rec from public.atlas_reforecast_revisions where revision_id=pub.revision_id;select * into head from public.atlas_reforecast_heads where scenario_id=p_scenario_id;
 return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',rec.source,'snapshot',rec.snapshot,'publication',to_jsonb(pub));
 end if;
 result:=atlas_private.save_reforecast_builder(p_community_id,p_scenario_id,p_expected_revision,p_request_id,p_action,p_payload);
 select * into rec from public.atlas_reforecast_revisions where revision_id=(result->'revision'->>'revision_id')::uuid;
 update public.atlas_reforecast_heads set status=rec.status where scenario_id=rec.scenario_id and revision_id=rec.revision_id returning * into head;
 if head.scenario_id is null then select * into head from public.atlas_reforecast_heads where scenario_id=rec.scenario_id;end if;
 return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',rec.source,'snapshot',rec.snapshot);
end;$$;

create or replace function public.atlas_read_reforecast_workspace(p_community_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]';r record;source jsonb;periods text[];budgets uuid[];
begin
 if cardinality(p_community_ids)>100 then raise exception 'Read at most 100 communities at a time';end if;
 for r in select h as head,v as revision from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions v using(revision_id) where h.community_id=any(p_community_ids) and atlas_private.reforecast_access(h.community_id,'edit') order by v.created_at desc loop
  select array_agg(v) into periods from jsonb_array_elements_text((r.revision).payload->'periods')v;select array_agg(v::uuid) into budgets from jsonb_array_elements_text(coalesce((r.revision).payload->'baselineVersionIds','[]'))v;
  source:=(r.revision).source;
  result:=result||jsonb_build_array(jsonb_build_object('head',to_jsonb(r.head),'revision',to_jsonb(r.revision),'source',source,'snapshot',(r.revision).snapshot));
 end loop;return result;
end;$$;

create or replace function public.atlas_reopen_reforecast(p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;event public.atlas_reforecast_events;result jsonb;hash text;new_id uuid;config jsonb;
begin
 select r.* into prior from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=p_scenario_id;
 if prior.revision_id is null or not atlas_private.reforecast_access(prior.community_id,'reopen') then raise exception 'Only an authorized Admin or executive may reopen';end if;
 if p_request_id is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Reopen request and reason required';end if;
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||prior.community_id,0));
 hash:=encode(sha256(convert_to(jsonb_build_array(p_scenario_id,p_expected_revision,p_reason)::text,'UTF8')),'hex');select * into event from public.atlas_reforecast_events where request_id=p_request_id;
 if event.event_id is not null then if event.actor_id<>auth.uid() or event.request_hash<>hash then raise exception 'Reopen request ID reused';end if;return event.detail->'result';end if;
 if prior.revision<>p_expected_revision or prior.status not in ('locked','approved') then raise exception 'Expected approved or locked revision required for reopen';end if;
 select * into pub from public.atlas_reforecast_publications where revision_id=prior.revision_id;
 new_id:=gen_random_uuid();config:=prior.payload||jsonb_build_object('reason',p_reason,'reopenedFromScenarioId',p_scenario_id,'reopenedFromPublicationId',pub.publication_id);
 -- Create the new draft before retirement so inherited locked evidence is retained exactly.
 result:=atlas_private.save_reforecast_builder(prior.community_id,new_id,0,gen_random_uuid(),'save_draft',config);
 insert into public.atlas_reforecast_events(community_id,scenario_id,publication_id,event_type,request_id,request_hash,detail,actor_id) values(prior.community_id,p_scenario_id,pub.publication_id,'reopened',p_request_id,hash,jsonb_build_object('reason',p_reason,'newScenarioId',new_id,'retiredPeriods',(select coalesce(jsonb_agg(p),'[]') from unnest(pub.periods)p where not atlas_private.reforecast_month_locked(prior.community_id,p)),'result',result),auth.uid());
 delete from public.atlas_reforecast_active_heads where publication_id=pub.publication_id and not atlas_private.reforecast_month_locked(prior.community_id,period_key);
 return result;
end;$$;

create or replace function public.atlas_review_reforecast_source(p_upload_id uuid,p_request_id uuid,p_review jsonb) returns public.atlas_reforecast_source_reviews language plpgsql security definer set search_path='' as $$
declare u public.atlas_reforecast_uploads;r public.atlas_reforecast_source_reviews;hash text;contract jsonb;
begin
 select * into u from public.atlas_reforecast_uploads where upload_id=p_upload_id;
 if u.upload_id is null or not atlas_private.reforecast_access(u.community_id,'approve') then raise exception 'Only an authorized Admin or executive may review source mappings';end if;
 if p_request_id is null or coalesce(p_review->>'sourceType','') not in ('hello_landing','rise_str','monthly_property_statement','contract','utility_forecast') or coalesce(p_review->>'period','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or coalesce(p_review->>'status','') not in ('approved','rejected') or jsonb_typeof(p_review->'mapping') is distinct from 'object' or length(trim(coalesce(p_review->>'reason','')))<3 then raise exception 'Reviewed source type, full month, mapping, disposition and reason required';end if;
 if p_review->>'sourceType'='contract' then
 if to_regclass('public.atlas_contracts') is null or coalesce(u.payload->'contract'->>'contractId','')='' then raise exception 'Link this contract source to its existing canonical Contract Manager record before review';end if;
 execute 'select to_jsonb(c) from public.atlas_contracts c where contract_id=$1 and community_id=$2 and deleted_at is null' into contract using (u.payload->'contract'->>'contractId')::uuid,u.community_id;
 if contract is null then raise exception 'Canonical contract is outside the source community or unavailable';end if;
 if p_review->>'status'='approved' and (coalesce(u.payload->'contract'->>'accountCode','')='' or jsonb_typeof(u.payload->'contract'->'monthlyAmount') is distinct from 'number' or coalesce(u.payload->'contract'->>'effectiveDate','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$') then raise exception 'Review contract GL, monthly amount and effective date before approval';end if;
 end if;
 if u.payload->'statement' is not null then
 if (u.payload->'statement'->>'communityId' is not null and u.payload->'statement'->>'communityId'<>u.community_id::text) or u.payload->'statement'->>'period' is distinct from p_review->>'period' or u.payload->>'sourceType' is distinct from p_review->>'sourceType' or (coalesce(u.payload->'statement'->>'sourceHash',u.payload->'statement'->'metadata'->>'sourceHash',u.payload->'statement'->'source'->>'sha256') is not null and coalesce(u.payload->'statement'->>'sourceHash',u.payload->'statement'->'metadata'->>'sourceHash',u.payload->'statement'->'source'->>'sha256')<>u.source_hash) then raise exception 'Review must match the retained statement period, provider and hash';end if;
 if p_review->>'status'='approved' and (u.payload->'statement'->>'status' is distinct from 'reconciled' or jsonb_array_length(coalesce(u.payload->'statement'->'issues','[]'))>0 or exists(select 1 from jsonb_array_elements(coalesce(u.payload->'statement'->'checks','[]'))c where c->>'status' in ('mismatch','failed','error'))) then raise exception 'Statement must reconcile before source approval';end if;
 end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_upload_id,p_review)::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('reforecast-source-review:'||p_upload_id,0));
 select * into r from public.atlas_reforecast_source_reviews where request_id=p_request_id;
 if r.review_id is not null then if r.reviewed_by<>auth.uid() or r.content_hash<>hash then raise exception 'Source review request ID reused';end if;return r;end if;
 insert into public.atlas_reforecast_source_reviews(community_id,upload_id,request_id,content_hash,payload,reviewed_by) values(u.community_id,u.upload_id,p_request_id,hash,p_review||case when contract is null then '{}'::jsonb else jsonb_build_object('canonicalContract',jsonb_build_object('contractId',contract->'contract_id','version',contract->'version','sourceHash',contract->'source_hash','contentHash',encode(sha256(convert_to(contract::text,'UTF8')),'hex'),'vendor',contract->'vendor_name')) end,auth.uid()) returning * into r;return r;
end;$$;
create or replace function public.atlas_read_reforecast_sources(p_community_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not atlas_private.reforecast_access(p_community_id) then raise exception 'Source ledger access denied';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('uploadId',u.upload_id,'communityId',u.community_id,'fileName',u.payload->'source'->>'fileName','sourceType',u.payload->>'sourceType','sourceHash',u.source_hash,'contentHash',u.content_hash,'createdAt',u.created_at,'createdBy',u.created_by,'reviewId',r.review_id,'reviewHash',r.content_hash,'reviewedAt',r.reviewed_at,'reviewedBy',r.reviewed_by,'review',r.payload) order by u.created_at desc),'[]') from public.atlas_reforecast_uploads u left join lateral (select * from public.atlas_reforecast_source_reviews where upload_id=u.upload_id order by review_order desc limit 1)r on true where u.community_id=p_community_id);
end;$$;
-- Unpaid calculations retain their evidence and receive a recalculation marker; paid/locked rows are never changed.
create or replace function atlas_private.reforecast_stale_bonus() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;periods text[];
begin
 cid:=new.community_id;
 if tg_table_name='atlas_reforecast_publications' then periods:=new.periods;else select p.periods into periods from public.atlas_reforecast_publications p where p.publication_id=new.publication_id;end if;
 if to_regclass('public.atlas_bonus_calculation_runs') is not null then
 execute 'update public.atlas_bonus_calculation_runs r set exceptions=coalesce(r.exceptions,''[]''::jsonb)||jsonb_build_array(jsonb_build_object(''code'',''baseline_stale'',''reason'',''Forecast baseline changed; recalculate unpaid results'',''publicationId'',$3)) from public.atlas_bonus_periods b where r.bonus_period_id=b.bonus_period_id and atlas_private.reforecast_bonus_run_in_community(to_jsonb(r),$1) and r.deleted_at is null and r.status in (''draft'',''review'',''approved'') and b.status=''open'' and exists(select 1 from unnest($2::text[])p where (p||''-01'')::date between b.start_date and b.end_date)' using cid,periods,new.publication_id;
 end if;return new;
end;$$;
create trigger reforecast_bonus_stale after insert on public.atlas_reforecast_publications for each row execute function atlas_private.reforecast_stale_bonus();
create trigger reforecast_reopen_bonus_stale after insert on public.atlas_reforecast_events for each row execute function atlas_private.reforecast_stale_bonus();

revoke all on function atlas_private.reforecast_month_locked(uuid,text),atlas_private.reforecast_publication_valid(public.atlas_reforecast_publications),atlas_private.reforecast_source_for_config(uuid,jsonb),atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb),atlas_private.reforecast_stale_bonus() from public,anon,authenticated;
revoke all on function public.atlas_reforecast_effective_baseline(uuid[],text[]),public.atlas_read_reforecast_builder_source(uuid,text[],uuid[],uuid,text,uuid[]),public.atlas_reopen_reforecast(uuid,integer,uuid,text),public.atlas_review_reforecast_source(uuid,uuid,jsonb),public.atlas_read_reforecast_sources(uuid) from public,anon;
grant execute on function public.atlas_reforecast_effective_baseline(uuid[],text[]),public.atlas_read_reforecast_builder_source(uuid,text[],uuid[],uuid,text,uuid[]),public.atlas_reopen_reforecast(uuid,integer,uuid,text),public.atlas_review_reforecast_source(uuid,uuid,jsonb),public.atlas_read_reforecast_sources(uuid) to authenticated;
-- Ordinary source-ledger readers never receive retained statement bytes or private identifiers.
drop policy reforecast_read on public.atlas_reforecast_uploads;
create policy reforecast_read on public.atlas_reforecast_uploads for select to authenticated using(atlas_private.reforecast_access(community_id,'edit'));
drop policy reforecast_read on public.atlas_reforecast_revisions;
create policy reforecast_read on public.atlas_reforecast_revisions for select to authenticated using(atlas_private.reforecast_access(community_id,'edit'));

create or replace function public.atlas_read_active_reforecast(p_community_ids uuid[],p_periods text[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]';pub public.atlas_reforecast_publications;valid boolean;
begin
 if cardinality(p_community_ids)>100 then raise exception 'Read at most 100 communities at a time';end if;
 for pub in select distinct v.* from public.atlas_reforecast_active_heads h join public.atlas_reforecast_publications v using(publication_id) where h.community_id=any(p_community_ids) and (p_periods is null or h.period_key=any(p_periods)) and atlas_private.reforecast_access(h.community_id,'active_read') loop
 valid:=not exists(select 1 from public.atlas_reforecast_active_heads h where h.publication_id=pub.publication_id and (p_periods is null or h.period_key=any(p_periods)) and not atlas_private.reforecast_publication_period_valid(pub,h.period_key));
 result:=result||jsonb_build_array(jsonb_build_object('publicationId',pub.publication_id,'communityId',pub.community_id,'scenarioId',pub.scenario_id,'revisionId',pub.revision_id,'version',pub.version,'periods',pub.periods,'activePeriods',(select jsonb_agg(period_key order by period_key) from public.atlas_reforecast_active_heads where community_id=pub.community_id and publication_id=pub.publication_id),'publishedAt',pub.published_at,'publishedBy',pub.published_by,'snapshot',pub.snapshot,'source',pub.source,'approved',true,'locked',true,'contentHash',pub.snapshot->>'fingerprint','verified',valid,'status',case when valid then 'available' else 'unavailable' end,'reason',case when not valid then 'Approved source evidence was reopened, changed or failed verification' end));
 end loop;return result;
end;$$;
create or replace function public.atlas_read_reforecast_sources(p_community_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]';row record;statement jsonb;approved boolean;
begin if not atlas_private.reforecast_access(p_community_id) then raise exception 'Source ledger access denied';end if;
 for row in select u.*,r.payload review,r.review_id,r.content_hash review_hash,r.reviewed_at,r.reviewed_by from public.atlas_reforecast_uploads u left join lateral (select * from public.atlas_reforecast_source_reviews where upload_id=u.upload_id order by review_order desc limit 1)r on true where u.community_id=p_community_id order by u.created_at desc loop
 approved:=row.review->>'status'='approved';
 statement:=jsonb_build_object('provider',row.payload->'statement'->'provider','streamId',row.payload->'statement'->'streamId','communityId',row.community_id,'period',row.review->'period','periodBasis',row.payload->'statement'->'periodBasis','currency',row.payload->'statement'->'currency','parserVersion',row.payload->'statement'->'parserVersion','sourceHash',row.source_hash,'status',row.payload->'statement'->'status','reviewState',coalesce(row.review->>'status','unreviewed'),'readbackVerified',coalesce(approved,false),'mapping',row.review->'mapping','reviewReceiptId',row.review_id,'summary',row.payload->'statement'->'summary','metrics',row.payload->'statement'->'metrics','checks',row.payload->'statement'->'checks');
 if approved and row.review->'mapping'->>'netIncomeMetric'='net_allocation' and coalesce(row.review->'mapping'->>'version','')<>'' then statement:=jsonb_set(statement,'{metrics}',coalesce(statement->'metrics','{}')||jsonb_build_object('netIncome',statement->'summary'->'netAllocation','netIncomeMappingApproved',true));
 else statement:=jsonb_set(statement,'{metrics}',coalesce(statement->'metrics','{}')||jsonb_build_object('netIncome',null,'netIncomeMappingApproved',false));end if;
 result:=result||jsonb_build_array(jsonb_build_object('uploadId',row.upload_id,'communityId',row.community_id,'fileName',row.payload->'source'->>'fileName','sourceType',row.payload->>'sourceType','period',row.review->'period','streamId',row.payload->'statement'->'streamId','sourceHash',row.source_hash,'contentHash',row.content_hash,'createdAt',row.created_at,'createdBy',row.created_by,'reviewId',row.review_id,'reviewHash',row.review_hash,'reviewedAt',row.reviewed_at,'reviewedBy',row.reviewed_by,'review',row.review,'statement',statement,'contract',case when row.payload->>'sourceType'='contract' then jsonb_build_object('contractId',row.payload->'contract'->'contractId','vendor',row.payload->'contract'->'vendor','service',row.payload->'contract'->'service','effectiveDate',row.payload->'contract'->'effectiveDate','endDate',row.payload->'contract'->'endDate','term',row.payload->'contract'->'term','accountCode',row.payload->'contract'->'accountCode','monthlyAmount',row.payload->'contract'->'monthlyAmount','escalationMethod',row.payload->'contract'->'escalationMethod','escalationRate',row.payload->'contract'->'escalationRate','escalationMonth',row.payload->'contract'->'escalationMonth','clauseReference',row.payload->'contract'->'clauseReference','reviewState',coalesce(row.review->>'status','unreviewed'),'canonicalVersion',row.review->'canonicalContract'->'version') end));
 end loop;return result;
end;$$;

-- Retirement preserves the historical row; successor disposition is explicit reviewed metadata.
alter function public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) set schema atlas_private;
alter function atlas_private.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) rename to save_reforecast_registry_pre_builder;
revoke all on function atlas_private.save_reforecast_registry_pre_builder(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
create function public.atlas_save_reforecast_registry(p_community_id uuid,p_expected_version_id uuid,p_request_id uuid,p_payload jsonb)
returns public.atlas_reforecast_registries language plpgsql security definer set search_path='' as $$
declare a jsonb;previous jsonb;accounts_next jsonb:='[]';relationships jsonb;rel jsonb;codes text[]:='{}';code text;allocation jsonb;
begin
 if not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Only an authorized Admin or executive may approve GL mappings';end if;
 select payload into previous from public.atlas_reforecast_registries where version_id=p_expected_version_id and community_id=p_community_id;
 for a in select value from jsonb_array_elements(p_payload->'accounts') loop
 if a->>'retiredAfter' is not null and not exists(select 1 from jsonb_array_elements(coalesce(previous->'accounts','[]'))v where v=a) then
 if coalesce(a->>'deactivationReason',a->>'retirementReason','')='' or coalesce(a->>'newActivityCoding','')='' or (a->>'effectiveDeactivationDate' is not null and a->>'effectiveDeactivationDate'!~'^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$') or (coalesce(a->>'successorAccountCode','')='' and a->>'noSuccessor' is distinct from 'true' and a->>'successorDisposition' is distinct from 'no_successor') then raise exception 'Sunset GL requires deactivation date, reason, future activity coding and successor or explicit no successor';end if;
 if coalesce(a->>'successorAccountCode','')<>'' and (a->>'noSuccessor'='true' or a->>'successorDisposition'='no_successor' or a->>'successorAccountCode'=a->>'accountCode' or not exists(select 1 from jsonb_array_elements(p_payload->'accounts')v where v->>'accountCode'=a->>'successorAccountCode' and v->>'retiredAfter' is null)) then raise exception 'Successor must be another active canonical GL';end if;
 end if;
 if a->>'identifier' is not null and a->>'identifier' not in ('income','contra_income','expense','capital') then raise exception 'Canonical GL identifier must be income, contra_income, expense or capital';end if;
 if a->>'retiredAfter' is not null and a->>'effectiveDeactivationDate' is null then a:=a||jsonb_build_object('effectiveDeactivationDate',to_char((a->>'retiredAfter'||'-01')::date+interval '1 month','YYYY-MM-DD'));end if;
 accounts_next:=accounts_next||jsonb_build_array(a);end loop;
 p_payload:=jsonb_set(p_payload,'{accounts}',accounts_next);
 relationships:=coalesce(p_payload->'relationships',p_payload->'utilityRelationships','[]'::jsonb);
 if jsonb_typeof(relationships) is distinct from 'array' then raise exception 'Utility relationships must be an explicit reviewed array';end if;
 for rel in select value from jsonb_array_elements(relationships) loop
 if rel->>'relationship' is null or rel->>'relationship' not in ('usage_recovery','separate_income','unrecouped') then raise exception 'Utility relationship requires a supported explicit disposition';end if;
 if rel->>'relationship'='usage_recovery' then
 if rel->>'expenseAccount' is null or rel->>'incomeAccount' is null or rel->>'expenseAccount'=rel->>'incomeAccount' or rel->>'incomeAccount'='5956' or rel->>'expenseAccount'='5956' or not exists(select 1 from jsonb_array_elements(accounts_next)gl where gl->>'accountCode'=rel->>'expenseAccount' and gl->>'nature'='expense') or not exists(select 1 from jsonb_array_elements(accounts_next)gl where gl->>'accountCode'=rel->>'incomeAccount' and gl->>'nature' in ('income','contra_income')) then raise exception 'Usage recovery requires distinct registered expense and income GLs; 5956 remains separate';end if;
 else
 if rel->>'accountCode' is null or not exists(select 1 from jsonb_array_elements(accounts_next)gl where gl->>'accountCode'=rel->>'accountCode' and gl->>'nature'=case when rel->>'relationship'='unrecouped' then 'expense' else 'income' end) then raise exception 'Utility relationship references an unregistered or mismatched GL';end if;
 end if;
 foreach code in array array[rel->>'accountCode',rel->>'expenseAccount',rel->>'incomeAccount'] loop
 if code is not null then if code=any(codes) then raise exception 'Utility relationship GL is assigned more than once';end if;codes:=array_append(codes,code);end if;end loop;
 if rel->>'relationship'<>'separate_income' and (rel->>'utility' is null or rel->>'utility' not in ('electricity','water','sewer','water_sewer','gas','natural_gas','internet')) then raise exception 'Utility relationship requires an explicit utility type';end if;
 if rel ? 'allocation' then allocation:=rel->'allocation';
 if rel->>'utility'<>'water_sewer' or allocation->>'reviewed' is distinct from 'true' or coalesce(allocation->>'source','')='' or jsonb_typeof(allocation->'water') is distinct from 'number' or jsonb_typeof(allocation->'sewer') is distinct from 'number' then raise exception 'Water/sewer allocation requires reviewed explicit weights and source';end if;
 if (allocation->>'water')::numeric<0 or (allocation->>'sewer')::numeric<0 or (allocation->>'water')::numeric+(allocation->>'sewer')::numeric<>1 then raise exception 'Water/sewer allocation weights must total one';end if;
 end if;end loop;
 p_payload:=(p_payload-'utilityRelationships')||jsonb_build_object('relationships',relationships);

 return atlas_private.save_reforecast_registry_pre_builder(p_community_id,p_expected_version_id,p_request_id,p_payload);
end;$$;
revoke all on function public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb) to authenticated;

create or replace function atlas_private.reforecast_str_validation(source jsonb,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare stream jsonb;unit jsonb;month jsonb;line jsonb;over jsonb;receipt jsonb;prior jsonb;issues jsonb:='[]';schedules jsonb:='[]';expected jsonb:='{}';eligible jsonb;included jsonb;period text;code text;k text;stream_id text;seen text[]:='{}';available numeric;occupancy numeric;gross_rate numeric;net_rate numeric;fee_rate numeric;nights numeric;occupied numeric;gross numeric;potential numeric;vacancy numeric;net numeric;fees numeric;amount numeric;base numeric;mode text;basis text;metric text;
begin
 if jsonb_typeof(coalesce(config->'strStreams','[]'))<>'array' then raise exception 'STR streams must be an array';end if;
 for stream in select value from jsonb_array_elements(coalesce(config->'strStreams','[]')) loop
 stream_id:=stream->>'id';
 if coalesce(stream_id,'') not in ('hello_landing','rise_str') or stream_id=any(seen) then raise exception 'Use unique Hello Landing and RISE STR stream identifiers';end if;seen:=array_append(seen,stream_id);
 if stream->>'reviewed' is distinct from 'true' then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_review_required','severity','error','message','Accept the reviewed STR schedule before submission.','streamId',stream_id));continue;end if;
 mode:=stream->>'application';basis:=stream->>'incomeBasis';
 if coalesce(mode,'') not in ('replace','add') or coalesce(basis,'') not in ('gross','net') or length(trim(coalesce(stream->>'assumptionReason','')))<3 then raise exception 'Reviewed STR application, income basis and assumption reason required';end if;
 if not exists(select 1 from jsonb_array_elements(source->'registry'->'accounts')a where a->>'accountCode'=stream->>'incomeAccountCode' and a->>'nature'='income') or (basis='gross' and not exists(select 1 from jsonb_array_elements(source->'registry'->'accounts')a where a->>'accountCode'=stream->>'vacancyAccountCode' and a->>'nature'='contra_income' and a->>'accountCode'<>stream->>'incomeAccountCode')) then raise exception 'STR gross income and vacancy require distinct income and contra-income GL mappings';end if;
 if jsonb_typeof(stream->'units') is distinct from 'array' or jsonb_typeof(stream->'monthly') is distinct from 'array' then raise exception 'STR monthly roster and schedule required';end if;
 if exists(select 1 from jsonb_array_elements(stream->'units')u group by u->>'id' having count(*)>1) or exists(select 1 from jsonb_array_elements(stream->'units')u where coalesce(u->>'id','')='' or (coalesce(u->>'availableFrom','')<>'' and u->>'availableFrom'!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') or (coalesce(u->>'takeBackMonth','')<>'' and u->>'takeBackMonth'!~'^20[0-9]{2}-(0[1-9]|1[0-2])$')) then raise exception 'Unique unit references and full availability/take-back months required';end if;
 if exists(select 1 from jsonb_array_elements(stream->'monthly')m group by m->>'period' having count(*)>1) or exists(select 1 from jsonb_array_elements(stream->'monthly')m where m->>'period'!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or not(config->'periods' ? (m->>'period'))) then raise exception 'STR monthly inputs must exactly match included full months';end if;
 for period in select jsonb_array_elements_text(config->'periods') loop
 if source->'lockedPeriods' ? period then continue;end if;
 select value into month from jsonb_array_elements(stream->'monthly') where value->>'period'=period;
 select coalesce(jsonb_agg(u->>'id'),'[]') into eligible from jsonb_array_elements(stream->'units')u where (coalesce(u->>'availableFrom','')='' or u->>'availableFrom'<=period) and (coalesce(u->>'takeBackMonth','')='' or u->>'takeBackMonth'>period);
 included:=coalesce(nullif(month->'includedUnitIds','null'::jsonb),eligible);
 if jsonb_typeof(included)<>'array' or exists(select 1 from jsonb_array_elements_text(included)id where not(eligible ? id)) or (select count(distinct value) from jsonb_array_elements_text(included))<>jsonb_array_length(included) then raise exception 'STR included roster has unavailable or duplicate units';end if;
 available:=case when month ? 'availableUnits' then (month->>'availableUnits')::numeric else jsonb_array_length(included) end;
 occupancy:=(month->>'occupancyPercent')::numeric;gross_rate:=(month->>'grossPerOccupiedNight')::numeric;net_rate:=(month->>'netPerOccupiedNight')::numeric;fee_rate:=(month->>'feePerAvailableUnit')::numeric;
 if available is distinct from jsonb_array_length(included)::numeric or occupancy is null or occupancy not between 0 and 100 or gross_rate is null or gross_rate<0 then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','str_schedule_input','severity','error','message','Review the STR roster, occupancy and gross rate for every open full month.','streamId',stream_id,'period',period));continue;end if;
 nights:=available*extract(day from ((period||'-01')::date+interval '1 month'-interval '1 day'));occupied:=nights*occupancy/100;gross:=round(occupied*gross_rate,2);potential:=round(nights*gross_rate,2);vacancy:=round(-(nights-occupied)*gross_rate,2);fees:=round(available*fee_rate,2);
 if month->>'netMethod'='gross_plus_signed_fees' then net:=round(gross+fees,2);elsif coalesce(month->>'netMethod','per_occupied_night')='per_occupied_night' then net:=round(occupied*net_rate,2);else raise exception 'Invalid STR net income method';end if;
 if basis='net' and net is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_net_unavailable','severity','error','message','Net income requires a reviewed rate or signed fee method.','streamId',stream_id,'period',period));continue;end if;
 schedules:=schedules||jsonb_build_array(jsonb_build_object('streamId',stream_id,'period',period,'availableUnits',available,'occupancyPercent',occupancy,'availableUnitNights',nights,'occupiedUnitNights',occupied,'grossPotentialIncome',potential,'grossIncome',gross,'vacancyLoss',vacancy,'netIncome',net,'fees',fees,'incomeBasis',basis,'application',mode,'assumptionReason',stream->>'assumptionReason'));
 foreach metric in array case when basis='gross' then array['income','vacancy'] else array['income'] end loop
 code:=case when metric='income' then stream->>'incomeAccountCode' else stream->>'vacancyAccountCode' end;k:=period||'|'||code;
 amount:=case when metric='vacancy' then vacancy when basis='net' then net else potential end;
 prior:=expected->k;
 if prior is not null and prior->>'application'<>mode then raise exception 'STR streams sharing a GL require the same add or replace method';end if;
 select (value->>'amount')::numeric into base from jsonb_array_elements(source->'baseline'->'lines') where value->>'period'=period and value->>'accountCode'=code;
 if mode='add' and base is null then raise exception 'Additive STR contribution requires an available selected baseline';end if;
 expected:=jsonb_set(expected,array[k],jsonb_build_object('period',period,'accountCode',code,'application',mode,'amount',coalesce((prior->>'amount')::numeric,case when mode='add' then base else 0 end)+amount),true);
 end loop;
 end loop;end loop;
 for line in select value from jsonb_each(expected) loop
 select value into over from jsonb_array_elements(coalesce(config->'overrides','[]')) where value->>'period'=line->>'period' and value->>'accountCode'=line->>'accountCode';
 if over->'source'->>'kind' is distinct from 'str_schedule' or (over->>'amount')::numeric is distinct from (line->>'amount')::numeric then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_override_mismatch','severity','error','period',line->>'period','accountCode',line->>'accountCode','message','The STR override must match the independently recalculated reviewed roster and rates.'));end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->'source'->>'kind'='str_schedule' and not(expected ? ((o->>'period')||'|'||(o->>'accountCode')))) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_override_unlinked','severity','error','message','An STR override has no reviewed schedule contribution.'));end if;
 for receipt in select value from jsonb_array_elements(coalesce(source->'sourceReceipts','[]')) loop
 if receipt->>'sourceType' in ('hello_landing','rise_str','monthly_property_statement','contract','utility_forecast') and (receipt->'review'->>'status' is distinct from 'approved' or receipt->>'stale'='true') then issues:=issues||jsonb_build_array(jsonb_build_object('code','source_review_required','severity','error','message','Approve the selected source mapping or terms before submission.','uploadId',receipt->'uploadId'));end if;
 end loop;
 return jsonb_build_object('issues',issues,'schedules',schedules);
end;$$;
create or replace function atlas_private.reforecast_builder_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare review jsonb;issues jsonb;blockers integer;old_payload jsonb;s jsonb;previous jsonb;
begin
 select payload into old_payload from public.atlas_reforecast_revisions where scenario_id=new.scenario_id order by revision desc limit 1;
 for s in select value from jsonb_array_elements(coalesce(new.payload->'strStreams','[]')) loop
 select value into previous from jsonb_array_elements(coalesce(old_payload->'strStreams','[]')) where value->>'id'=s->>'id';
 if s is distinct from previous and s->>'reviewed'='true' and s->>'reviewedBy' is distinct from auth.uid()::text then raise exception 'A changed STR schedule must be reviewed by the signed-in scoped editor';end if;
 end loop;
 review:=atlas_private.reforecast_str_validation(new.source,new.payload);issues:=review->'issues';
 new.snapshot:=new.snapshot||jsonb_build_object('strSchedules',review->'schedules','diagnostics',coalesce(new.snapshot->'diagnostics','[]')||issues);
 select count(*) into blockers from jsonb_array_elements(new.snapshot->'diagnostics')d where d->>'severity' in ('error','blocking');
 new.snapshot:=jsonb_set(new.snapshot,'{completeness,blockerCount}',to_jsonb(blockers));new.snapshot:=jsonb_set(new.snapshot,'{status}',to_jsonb(case when blockers>0 then 'action_required'::text else 'ready'::text end));
 if blockers>0 and new.action in ('ready','submit','approve','lock') then raise exception 'Resolve reviewed source and STR schedule blockers before approval';end if;
 if blockers>0 and new.action='reconcile' then new.status:='working_draft';end if;
 new.snapshot:=new.snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((new.snapshot-'fingerprint')::text,'UTF8')),'hex'));return new;
end;$$;
create trigger zz_reforecast_builder_validation before insert on public.atlas_reforecast_revisions for each row execute function atlas_private.reforecast_builder_guard();
revoke all on function atlas_private.reforecast_str_validation(jsonb,jsonb),atlas_private.reforecast_builder_guard() from public,anon,authenticated;

-- Preserve the original-budget comparator while binding every canonical summary to its monthly effective baseline.
create or replace function atlas_private.reforecast_finance_summary(s jsonb,baseline jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=s;metric text;amount numeric;actual numeric;lines jsonb;mapped jsonb;row jsonb;budget public.atlas_approved_budget_versions;part jsonb;total numeric;valid boolean;ytd_periods text[];ytd_baselines jsonb;ym jsonb:='{}';period_baseline jsonb;month_result jsonb;metric_target numeric;
begin
 result:=result||jsonb_build_object('effectiveBaseline',coalesce(baseline,jsonb_build_object('status','unavailable','reason','No verified effective baseline')),'originalBudgetVersion',s->'budgetVersion');
 select * into budget from public.atlas_approved_budget_versions where version_id=nullif(s->>'budgetVersion','')::uuid;
 select coalesce(jsonb_agg(v||jsonb_build_object('mappingValid',v->>'nature' in ('income','contra_income','expense','capital','debt','below_noi') and v->>'placement' in ('above_noi','below_noi'))),'[]') into lines from jsonb_array_elements(coalesce(baseline->'lines','[]'))v;
 mapped:=atlas_private.reforecast_metric(lines,'amount');
 for metric in select key from jsonb_each(s) where jsonb_typeof(value)='object' and value ? 'budget' loop
 amount:=null;
 if baseline->>'status'='available' then
 -- Original budgets already carry their approved metric formulas, even before a forecast registry exists.
 if jsonb_typeof(budget.payload->'metricMappings'->metric)='array' and (baseline->>'sourceType'='original_budget' or metric not in ('revenue','expenses','noi','cashFlow','capital','debt','grossIncome','contraRevenue','belowNoi')) then
 total:=0;valid:=jsonb_array_length(budget.payload->'metricMappings'->metric)>0;
 for part in select value from jsonb_array_elements(budget.payload->'metricMappings'->metric) loop
 select value into row from jsonb_array_elements(lines) where value->>'accountCode'=part->>'glCode';
 if row->>'amount' is null or part->>'factor' is null then valid:=false;exit;end if;
 total:=total+(row->>'amount')::numeric*(part->>'factor')::numeric;
 end loop;if valid then amount:=total;end if;
 elsif metric in ('revenue','expenses','noi','cashFlow','capital','debt','grossIncome','contraRevenue','belowNoi') then amount:=(mapped->>metric)::numeric;
 end if;end if;
 actual:=(s->metric->>'actual')::numeric;
 result:=jsonb_set(result,array[metric],(s->metric)||jsonb_build_object('originalBudget',s->metric->'budget','activeBaseline',amount,'baselineSourceType',baseline->>'sourceType','baselineVersion',baseline->>'versionId','baselinePublicationId',baseline->>'publicationId','variance',actual-amount,'status',case when actual is null or amount is null then 'missing' when actual=amount then 'neutral' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'favorable' else 'unfavorable' end,'availability',case when amount is null then 'baseline_unavailable' when actual is null then 'actual_unavailable' else 'available' end,'label',case when amount is null then coalesce(baseline->>'reason','Active baseline metric unavailable') when actual is null then 'Missing closed actual' when actual=amount then 'On baseline' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'Favorable' else 'Unfavorable' end));
 end loop;
 if jsonb_typeof(s->'ytd')='object' then
 select array_agg(value order by value) into ytd_periods from jsonb_array_elements_text(coalesce(s->'fiscalPeriods','[]'));
 ytd_baselines:='[]';if cardinality(ytd_periods) between 1 and 24 then ytd_baselines:=public.atlas_reforecast_effective_baseline(array[(s->>'communityId')::uuid],ytd_periods);end if;
 for metric in select key from jsonb_each(s->'ytd') loop
 total:=0;valid:=cardinality(ytd_periods)>0 and jsonb_array_length(ytd_baselines)=cardinality(ytd_periods);
 for period_baseline in select value from jsonb_array_elements(ytd_baselines) loop
 month_result:=atlas_private.reforecast_finance_summary(jsonb_build_object('communityId',s->'communityId','period',period_baseline->'period','budgetVersion',s->'budgetVersions'->(period_baseline->>'period'),metric,jsonb_build_object('actual',null,'budget',null)),period_baseline);
 metric_target:=(month_result->metric->>'activeBaseline')::numeric;
 if metric_target is null then valid:=false;else total:=total+metric_target;end if;
 end loop;
 amount:=case when valid then total end;actual:=(s->'ytd'->metric->>'actual')::numeric;
 ym:=ym||jsonb_build_object(metric,(s->'ytd'->metric)||jsonb_build_object('originalBudget',s->'ytd'->metric->'budget','activeBaseline',amount,'variance',actual-amount,'status',case when actual is null or amount is null then 'missing' when actual=amount then 'neutral' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'favorable' else 'unfavorable' end,'availability',case when amount is null then 'baseline_unavailable' when actual is null then 'actual_unavailable' else 'available' end,'label',case when amount is null then 'A verified monthly effective baseline is missing from fiscal YTD' when actual is null then 'Missing closed actual' when actual=amount then 'On baseline' when ((actual>amount)=(metric not in ('expenses','capital','debt','belowNoi'))) then 'Favorable' else 'Unfavorable' end));
 end loop;
 result:=result||jsonb_build_object('ytd',ym,'ytdGpr',ym->'gpr','ytdExpenses',ym->'expenses','ytdBaselinePeriods',(select coalesce(jsonb_agg(jsonb_build_object('period',v->'period','sourceType',v->'sourceType','versionId',v->'versionId','publicationId',v->'publicationId','contentHash',v->'contentHash','status',v->'status','reason',v->'reason')),'[]') from jsonb_array_elements(ytd_baselines)v));
 end if;return result;
end;$$;
revoke all on function atlas_private.reforecast_finance_summary(jsonb,jsonb) from public,anon,authenticated;
do $migration$
begin
 if to_regprocedure('public.atlas_read_finance(uuid[],text[])') is not null then
 alter function public.atlas_read_finance(uuid[],text[]) set schema atlas_private;
 alter function atlas_private.atlas_read_finance(uuid[],text[]) rename to read_finance_pre_forecast_builder;
 revoke all on function atlas_private.read_finance_pre_forecast_builder(uuid[],text[]) from public,anon,authenticated;
 execute $definition$
 create function public.atlas_read_finance(p_community_ids uuid[],p_periods text[]) returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb)
 language plpgsql stable security definer set search_path='' as $body$
 declare baselines jsonb;
 begin
 baselines:=public.atlas_reforecast_effective_baseline(p_community_ids,p_periods);
 return query select r.community_id,r.period_key,r.fiscal_year,r.publication_id,atlas_private.reforecast_finance_summary(r.summary,b.value)
 from atlas_private.read_finance_pre_forecast_builder(p_community_ids,p_periods)r left join lateral (select value from jsonb_array_elements(baselines) where value->>'communityId'=r.community_id::text and value->>'period'=r.period_key)b on true;
 end;$body$;
 $definition$;
 revoke all on function public.atlas_read_finance(uuid[],text[]) from public,anon;
 grant execute on function public.atlas_read_finance(uuid[],text[]) to authenticated;
 end if;
end;$migration$;

-- Existing payout evidence is immutable once its run or period is retained.
create or replace function atlas_private.reforecast_bonus_immutable() returns trigger language plpgsql security definer set search_path='' as $$
declare period_status text;run_status text;created_in_transaction boolean;rid uuid;prior jsonb;next jsonb;
begin
 if tg_op<>'INSERT' then prior:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then next:=to_jsonb(new);end if;
 if tg_op='UPDATE' and prior=next then return new;end if;
 if tg_table_name='atlas_bonus_periods' then
 if exists(select 1 from public.atlas_bonus_calculation_runs r where r.bonus_period_id=old.bonus_period_id) then
 if tg_op='DELETE' or (prior->'period_key',prior->'year',prior->'quarter',prior->'start_date',prior->'end_date') is distinct from (next->'period_key',next->'year',next->'quarter',next->'start_date',next->'end_date') then raise exception 'Retained bonus period identity and dates are immutable';end if;
 end if;
 if prior->>'status' in ('locked','approved','paid','archived') and (tg_op='DELETE' or (case next->>'status' when 'locked' then 1 when 'approved' then 2 when 'paid' then 3 when 'archived' then 4 else 0 end)<(case prior->>'status' when 'locked' then 1 when 'approved' then 2 when 'paid' then 3 else 4 end)) then raise exception 'Retained bonus periods cannot be reopened or removed';end if;
 elsif tg_table_name='atlas_bonus_calculation_runs' then
 select status into period_status from public.atlas_bonus_periods where bonus_period_id=coalesce((prior->>'bonus_period_id')::uuid,(next->>'bonus_period_id')::uuid) for update;
 if prior->>'status'='locked' or period_status in ('locked','approved','paid','archived') then raise exception 'Paid or locked bonus run evidence is immutable';end if;
 if tg_op='UPDATE' and prior->'bonus_period_id' is distinct from next->'bonus_period_id' then
 select status into period_status from public.atlas_bonus_periods where bonus_period_id=(next->>'bonus_period_id')::uuid;
 if period_status in ('locked','approved','paid','archived') then raise exception 'Cannot move a bonus run into a retained period';end if;end if;
 else
 rid:=coalesce((prior->>'bonus_calculation_run_id')::uuid,(next->>'bonus_calculation_run_id')::uuid);
 select r.status,p.status,r.xmin::text=pg_current_xact_id()::text into run_status,period_status,created_in_transaction from public.atlas_bonus_calculation_runs r join public.atlas_bonus_periods p using(bonus_period_id) where r.bonus_calculation_run_id=rid for update of r,p;
 if run_status='locked' or period_status in ('locked','approved','paid','archived') then
 -- The existing record RPC creates a run then all of its lines in one transaction.
 if tg_op<>'INSERT' or not coalesce(created_in_transaction,false) then raise exception 'Paid or locked bonus line evidence is immutable';end if;end if;
 if tg_op='UPDATE' and prior->'bonus_calculation_run_id' is distinct from next->'bonus_calculation_run_id' then
 if exists(select 1 from public.atlas_bonus_calculation_runs r join public.atlas_bonus_periods p using(bonus_period_id) where r.bonus_calculation_run_id=(next->>'bonus_calculation_run_id')::uuid and (r.status='locked' or p.status in ('locked','approved','paid','archived'))) then raise exception 'Cannot move a bonus line into retained evidence';end if;end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function atlas_private.reforecast_bonus_immutable() from public,anon,authenticated;
do $$begin
 if to_regclass('public.atlas_bonus_periods') is not null then create trigger reforecast_bonus_period_immutable before update or delete on public.atlas_bonus_periods for each row execute function atlas_private.reforecast_bonus_immutable();end if;
 if to_regclass('public.atlas_bonus_calculation_runs') is not null then create trigger reforecast_bonus_run_immutable before insert or update or delete on public.atlas_bonus_calculation_runs for each row execute function atlas_private.reforecast_bonus_immutable();end if;
 if to_regclass('public.atlas_bonus_calculation_lines') is not null then create trigger reforecast_bonus_line_immutable before insert or update or delete on public.atlas_bonus_calculation_lines for each row execute function atlas_private.reforecast_bonus_immutable();end if;
end;$$;

-- Unpaid payability requires exact canonical plan, metric and employee-assignment proof.
create or replace function atlas_private.reforecast_bonus_eligibility_current(line jsonb,period jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare plan jsonb;assignment jsonb;employee jsonb;retained jsonb:=line->'line_payload'->'retainedRow';rules jsonb;definition jsonb;results jsonb;key text;starts date;ends date;
begin
 if to_regclass('public.atlas_incentive_plans') is null or to_regclass('public.atlas_employee_assignments') is null or to_regclass('public.atlas_employees') is null then return false;end if;
 execute 'select to_jsonb(p) from public.atlas_incentive_plans p where p.incentive_plan_id=$1 and p.deleted_at is null' into plan using (line->>'incentive_plan_id')::uuid;
 execute 'select to_jsonb(a),to_jsonb(e) from public.atlas_employee_assignments a join public.atlas_employees e using(employee_id) where a.assignment_id=$1 and a.employee_id=$2 and a.deleted_at is null and e.deleted_at is null' into assignment,employee using (line->>'assignment_id')::uuid,(line->>'employee_id')::uuid;
 if plan is null or assignment is null or employee is null then return false;end if;
 starts:=(period->>'start_date')::date;ends:=(period->>'end_date')::date;
 if starts is null or ends is null or starts>ends or (plan->>'effective_start')::date>starts or (plan->>'effective_end' is not null and (plan->>'effective_end')::date<ends) or (assignment->>'effective_start')::date>starts or (assignment->>'effective_end' is not null and (assignment->>'effective_end')::date<ends) then return false;end if;
 -- Partial-period/prorated eligibility requires its own verified evidence; it is not inferred here.
 if lower(assignment->>'employment_status') is distinct from 'active' or lower(employee->>'status') is distinct from 'active' or employee->>'bonus_eligible' is distinct from 'true' or (employee->>'bonus_effective_date' is not null and (employee->>'bonus_effective_date')::date>starts) then return false;end if;
 if retained->'employee'->>'employeeId' is distinct from line->>'employee_id' or retained->'employee'->>'assignmentId' is distinct from line->>'assignment_id' or retained->'employee'->>'assignmentVersion' is distinct from assignment->>'version' or retained->'employee'->>'active' is distinct from 'true' or retained->'employee'->>'bonusEligible' is distinct from 'true' or retained->'employee'->>'effectiveStart' is distinct from assignment->>'effective_start' or nullif(retained->'employee'->>'effectiveEnd','') is distinct from assignment->>'effective_end' then return false;end if;
 if retained->'plan'->>'id' is distinct from plan->>'incentive_plan_id' or retained->'plan'->>'version' is distinct from plan->>'version' or retained->'plan'->>'status' is distinct from 'active' or retained->'plan'->>'effectiveStart' is distinct from plan->>'effective_start' or nullif(retained->'plan'->>'effectiveEnd','') is distinct from plan->>'effective_end' or coalesce(retained->'plan'->>'roleId',retained->'plan'->>'role_id') is distinct from plan->>'role_id' or (plan->>'role_id' is not null and assignment->>'role_id' is distinct from plan->>'role_id') then return false;end if;
 rules:=plan->'eligibility_rules';
 if jsonb_typeof(rules) is distinct from 'object' or retained->'plan'->'eligibilityRules' is distinct from rules then return false;end if;
 -- Explicit canonical ID/status restrictions are supported. Unknown rule semantics fail closed.
 for key in select jsonb_object_keys(rules) loop
 if key='requireBonusEligible' then if rules->>key is distinct from 'true' then return false;end if;
 elsif key in ('communityIds','roleIds','employeeIds','employmentStatuses') then
 if jsonb_typeof(rules->key) is distinct from 'array' or jsonb_array_length(rules->key)=0 or not ((rules->key) ? case key when 'communityIds' then assignment->>'community_id' when 'roleIds' then assignment->>'role_id' when 'employeeIds' then employee->>'employee_id' else assignment->>'employment_status' end) then return false;end if;
 else return false;end if;end loop;
 if jsonb_typeof(plan->'metric_rules') is distinct from 'array' or jsonb_array_length(plan->'metric_rules')=0 or retained->'plan'->'metrics' is distinct from plan->'metric_rules' or jsonb_typeof(retained->'metricResults') is distinct from 'array' or jsonb_array_length(retained->'metricResults')<>jsonb_array_length(plan->'metric_rules') then return false;end if;
 if exists(select 1 from jsonb_array_elements(plan->'metric_rules')m where coalesce(m->>'id','')='') or exists(select 1 from jsonb_array_elements(plan->'metric_rules')m group by m->>'id' having count(*)<>1) then return false;end if;
 select jsonb_agg(m order by m->>'id') into definition from jsonb_array_elements(plan->'metric_rules')m;
 select jsonb_agg(m->'metric' order by m->'metric'->>'id') into results from jsonb_array_elements(retained->'metricResults')m;
 return definition=results;
exception when others then return false;
end;$$;
revoke all on function atlas_private.reforecast_bonus_eligibility_current(jsonb,jsonb) from public,anon,authenticated;

-- Unpaid approved calculations must still reference current governed financial evidence.
create or replace function atlas_private.reforecast_bonus_finance_current(payload jsonb,cid uuid,period jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare metric jsonb;evidence jsonb;months text[];month text;idx integer;baselines jsonb;current_baseline jsonb;stored_baseline jsonb;close_id text;
begin
 if cid is null or jsonb_typeof(payload->'retainedRow'->'metricResults') is distinct from 'array' then return false;end if;
 for metric in select value from jsonb_array_elements(payload->'retainedRow'->'metricResults') loop
 if metric->'metric'->>'metricKey' in ('budget_attainment','revenue','expenses','noi','cash_flow') then
 if (period->>'start_date')::date<>date_trunc('quarter',(period->>'start_date')::date)::date or (period->>'end_date')::date<>((period->>'start_date')::date+interval '3 months'-interval '1 day')::date then return false;end if;
 select array_agg(to_char(d,'YYYY-MM') order by d) into months from generate_series((period->>'start_date')::date,(period->>'end_date')::date,interval '1 month')d;
 evidence:=metric->'financialEvidence';
 if evidence->'periods' is distinct from to_jsonb(months) or jsonb_typeof(evidence->'baselineEvidence') is distinct from 'array' or jsonb_array_length(evidence->'baselineEvidence')<>3 or jsonb_typeof(evidence->'actualCloseVersions') is distinct from 'array' or jsonb_array_length(evidence->'actualCloseVersions')<>3 or coalesce(evidence->>'snapshotFingerprint','')='' or evidence->'financialSnapshot'->'identity'->>'communityId' is distinct from cid::text then return false;end if;
 baselines:=public.atlas_reforecast_effective_baseline(array[cid],months);idx:=0;
 foreach month in array months loop
 select value into current_baseline from jsonb_array_elements(baselines) where value->>'period'=month;
 if (select count(*) from jsonb_array_elements(evidence->'baselineEvidence')v where v->>'period'=month)<>1 then return false;end if;
 select value into stored_baseline from jsonb_array_elements(evidence->'baselineEvidence') where value->>'period'=month;
 if current_baseline->>'status' is distinct from 'available' or current_baseline->>'verified' is distinct from 'true' or stored_baseline->>'communityId' is distinct from cid::text or (current_baseline->>'sourceType',current_baseline->>'versionId',current_baseline->>'publicationId',current_baseline->>'contentHash') is distinct from (stored_baseline->>'sourceType',stored_baseline->>'versionId',stored_baseline->>'publicationId',stored_baseline->>'contentHash') then return false;end if;
 close_id:=evidence->'actualCloseVersions'->>idx;
 if close_id is null or not exists(select 1 from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.period_key=month and h.accounting_basis='accrual' and h.version_id::text=close_id and atlas_private.reforecast_close_eligible(cid,month,v.source_hash)) then return false;end if;
 idx:=idx+1;end loop;
 end if;end loop;
 return true;
exception when others then return false;
end;$$;
revoke all on function atlas_private.reforecast_bonus_finance_current(jsonb,uuid,jsonb) from public,anon,authenticated;

create or replace function public.atlas_read_bonus_receipts(p_period_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile public.atlas_user_profiles;rec record;line record;lines jsonb;verified boolean;result jsonb:='[]';input_lines jsonb;line_community uuid;
begin
 select * into profile from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 if profile.user_id is null or profile.role not in ('admin','centra','executive','regional','community_manager','bonus','finance') or '9'=any(coalesce(profile.locked_tab_ids,'{}')) or 'bonus'=any(coalesce(profile.locked_page_keys,'{}')) then raise exception 'Bonus receipt access denied';end if;
 for rec in select to_jsonb(r) run,to_jsonb(p) period from public.atlas_bonus_calculation_runs r join public.atlas_bonus_periods p using(bonus_period_id) where p.period_key=p_period_key and r.deleted_at is null and (r.status in ('approved','locked') or p.status in ('locked','approved','paid','archived')) order by r.calculated_at,r.bonus_calculation_run_id loop
 if rec.run->>'community_id' is not null then
 if not public.atlas_can_access_community((rec.run->>'community_id')::uuid) then continue;end if;
 elsif not exists(select 1 from public.atlas_bonus_calculation_lines l where l.bonus_calculation_run_id=(rec.run->>'bonus_calculation_run_id')::uuid and l.deleted_at is null) or exists(select 1 from public.atlas_bonus_calculation_lines l left join public.atlas_employee_assignments a on a.assignment_id=l.assignment_id and a.deleted_at is null where l.bonus_calculation_run_id=(rec.run->>'bonus_calculation_run_id')::uuid and l.deleted_at is null and (a.community_id is null or to_jsonb(a)->>'employee_id' is distinct from l.employee_id::text or not public.atlas_can_access_community(a.community_id))) then continue;end if;
 if exists(select 1 from public.atlas_bonus_calculation_lines l left join public.atlas_employee_assignments a on a.assignment_id=l.assignment_id where l.bonus_calculation_run_id=(rec.run->>'bonus_calculation_run_id')::uuid and l.deleted_at is null and (a.community_id is null or to_jsonb(a)->>'employee_id' is distinct from l.employee_id::text or a.deleted_at is not null or not public.atlas_can_access_community(a.community_id))) then continue;end if;
 input_lines:=rec.run->'inputs'->'lines';verified:=rec.run->>'calculation_hash'=encode(sha256(convert_to(coalesce((rec.run->'inputs')::text,''),'UTF8')),'hex') and jsonb_typeof(input_lines)='array';lines:='[]';
 for line in select l.* from public.atlas_bonus_calculation_lines l where l.bonus_calculation_run_id=(rec.run->>'bonus_calculation_run_id')::uuid and l.deleted_at is null order by l.bonus_line_id loop
 lines:=lines||jsonb_build_array(to_jsonb(line));
 if rec.run->>'status'<>'locked' and rec.period->>'status'='open' then
 select a.community_id into line_community from public.atlas_employee_assignments a where a.assignment_id=line.assignment_id and to_jsonb(a)->>'employee_id'=line.employee_id::text and a.deleted_at is null;
 if not atlas_private.reforecast_bonus_eligibility_current(to_jsonb(line),rec.period) or not atlas_private.reforecast_bonus_finance_current(line.line_payload,line_community,rec.period) then verified:=false;end if;end if;
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(input_lines)='array' then input_lines else '[]'::jsonb end)i where i=line.line_payload and nullif(i->>'employee_id','') is not distinct from line.employee_id::text and nullif(i->>'assignment_id','') is not distinct from line.assignment_id::text and nullif(i->>'incentive_plan_id','') is not distinct from line.incentive_plan_id::text and i->>'metric_key' is not distinct from line.metric_key and i->>'metric_source_table' is not distinct from line.metric_source_table and nullif(i->>'metric_source_id','') is not distinct from line.metric_source_id::text and case when jsonb_typeof(i->'payout_amount')='number' then (i->>'payout_amount')::numeric=line.payout_amount else false end) then verified:=false;end if;
 end loop;
 verified:=coalesce(verified,false) and jsonb_array_length(lines)>0 and jsonb_array_length(lines)=jsonb_array_length(case when jsonb_typeof(input_lines)='array' then input_lines else '[]'::jsonb end);
 if verified then verified:=(select jsonb_agg(v order by v) from jsonb_array_elements(input_lines)v)=(select jsonb_agg(l->'line_payload' order by l->'line_payload') from jsonb_array_elements(lines)l);end if;
 if rec.run->>'status'<>'locked' and rec.period->>'status'='open' and exists(select 1 from jsonb_array_elements(coalesce(rec.run->'exceptions','[]'))e where e->>'code'='baseline_stale') then verified:=false;end if;
 select coalesce(jsonb_agg(l||jsonb_build_object('line_payload',((l->'line_payload')-'secureCalculationDetail') #- '{retainedRow,employee,salary}' #- '{line_payload,secureCalculationDetail}' #- '{line_payload,retainedRow,employee,salary}')),'[]'::jsonb) into lines from jsonb_array_elements(lines)l;
 result:=result||jsonb_build_array(jsonb_build_object('period',rec.period,'run',rec.run-'inputs'-'source_snapshot_id','lines',lines,'verified',verified,'reason',case when verified then null else 'Stored bonus evidence failed exact payload and line readback verification' end));
 end loop;
 if jsonb_array_length(result)=0 then select coalesce(jsonb_agg(jsonb_build_object('period',to_jsonb(p),'run',null,'lines','[]'::jsonb,'verified',false,'reason','retained_evidence_unavailable')),'[]'::jsonb) into result from public.atlas_bonus_periods p where p.period_key=p_period_key and p.status in ('locked','approved','paid','archived');end if;
 return result;
end;$$;
revoke all on function public.atlas_read_bonus_receipts(text) from public,anon;
grant execute on function public.atlas_read_bonus_receipts(text) to authenticated;

commit;
