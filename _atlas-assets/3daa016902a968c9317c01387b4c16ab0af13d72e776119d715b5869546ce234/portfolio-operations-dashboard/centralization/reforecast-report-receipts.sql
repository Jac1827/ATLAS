-- Immutable report projections and portfolio status receipts share the governed forecast sources.
begin;

create or replace function atlas_private.reforecast_report_scope(cids uuid[])
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and cardinality(cids)>0 and cardinality(cids)<=100
 and not exists(select 1 from unnest(cids) cid where cid is null or not atlas_private.reforecast_access(cid,'active_read'));
$$;
revoke all on function atlas_private.reforecast_report_scope(uuid[]) from public,anon;
grant execute on function atlas_private.reforecast_report_scope(uuid[]) to authenticated;

create table public.atlas_reforecast_report_receipts(
 snapshot_id uuid primary key default gen_random_uuid(),
 report_kind text not null check(report_kind='portfolio_forecast_status'),
 community_ids uuid[] not null,periods text[] not null,
 request_id uuid not null unique,request_hash text not null,
 snapshot jsonb not null,content_hash text not null,
 generated_by uuid not null references auth.users(id),generated_at timestamptz not null default now()
);
alter table public.atlas_reforecast_report_receipts enable row level security;
revoke all on public.atlas_reforecast_report_receipts from public,anon,authenticated;
grant select on public.atlas_reforecast_report_receipts to authenticated;
create policy reforecast_report_read on public.atlas_reforecast_report_receipts for select to authenticated
 using(atlas_private.reforecast_report_scope(community_ids));
create trigger reforecast_report_immutable before update or delete on public.atlas_reforecast_report_receipts
 for each row execute function atlas_private.finance_immutable();

-- Projection allowlists prevent unit/reservation identifiers and arbitrary source attachments from entering reports.
create or replace function atlas_private.reforecast_report_fields(value jsonb,allowed text[])
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,v),'{}') from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}' end) as e(key,v) where key=any(allowed);
$$;
create or replace function atlas_private.reforecast_report_snapshot(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;lines jsonb;drivers jsonb;schedules jsonb;item jsonb;monthly jsonb:='[]';metric_keys text[]:=array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow','margin'];
begin
 result:=atlas_private.reforecast_report_fields(input,array['schemaVersion','communityId','periods','status','cutoffPeriod','completeness']);
 result:=result||jsonb_build_object('originalPublicationFingerprint',input->'fingerprint','identity',atlas_private.reforecast_report_fields(input->'identity',array['engineVersion','communityId','periods','actualCutoff','actualCloseVersions','mappingRegistryVersion','baselineVersionIds','baselineVersionId','baselineSourceType','baselinePeriodVersions','closeVersions','registryVersion','sourceVersion','driverVersion','scenarioId','scenarioVersion','reforecastVersion']));
 result:=jsonb_set(result,'{identity,baselinePeriodVersions}',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceType','versionId','publicationId','revisionId','contentHash','sourceHash','closeVersionId','verified','status'])),'[]') from jsonb_array_elements(coalesce(input->'identity'->'baselinePeriodVersions','[]'))v));
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','accountName','department','category','nature','identifier','placement','originalBudget','selectedBaseline','actual','forecast','sourceKind','closeVersionId','mappingValid','immutable','retired','applicable','forecastVariance','actualVariance','forecastFavorability','actualFavorability'])||jsonb_build_object('baselineLineage',atlas_private.reforecast_report_fields(v->'baselineLineage',array['sourceType','versionId','publicationId','revisionId','contentHash','sourceHash'])) order by v->>'period',v->>'accountCode'),'[]') into lines from jsonb_array_elements(coalesce(input->'lines','[]'))v;
 for item in select value from jsonb_array_elements(coalesce(input->'monthly','[]')) loop
  monthly:=monthly||jsonb_build_array(atlas_private.reforecast_report_fields(item,array['period','closed','applicable','closeVersionId','detailCoverage','controlSource'])||jsonb_build_object('originalBudget',atlas_private.reforecast_report_fields(item->'originalBudget',metric_keys),'reforecast',atlas_private.reforecast_report_fields(item->'reforecast',metric_keys),'actuals',atlas_private.reforecast_report_fields(item->'actuals',metric_keys)));
 end loop;
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['id','type','operation','value','reason','status'])||jsonb_build_object('changed',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(c,array['period','accountCode','before','after','delta'])),'[]') from jsonb_array_elements(coalesce(v->'changed','[]'))c))),'[]') into drivers from jsonb_array_elements(coalesce(input->'driverImpacts','[]'))v;
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['streamId','id','period','availableUnits','availableUnitCount','occupancyPercent','availableUnitNights','occupiedUnitNights','grossPotentialIncome','grossIncome','estimatedGrossIncome','netIncome','estimatedNetIncome','vacancyLoss','fees','netMethod','status']) order by v->>'streamId',v->>'period'),'[]') into schedules from jsonb_array_elements(coalesce(input->'strSchedules',input->'strLeasing','[]'))v;
 result:=result||jsonb_build_object('lines',lines,'monthly',monthly,'driverImpacts',drivers,'strSchedules',schedules,
 'totals',jsonb_build_object('originalBudget',atlas_private.reforecast_report_fields(input->'totals'->'originalBudget',metric_keys),'reforecast',atlas_private.reforecast_report_fields(input->'totals'->'reforecast',metric_keys),'actuals',atlas_private.reforecast_report_fields(input->'totals'->'actuals',metric_keys),'actualsThroughCutoff',atlas_private.reforecast_report_fields(input->'totals'->'actualsThroughCutoff',metric_keys)),
 'diagnostics',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['code','severity','period','accountCode','message'])),'[]') from jsonb_array_elements(coalesce(input->'diagnostics','[]'))v),
 'leasing',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceKind','units','occupiedUnits','moveIns','moveOuts','marketRent','occupancy'])),'[]') from jsonb_array_elements(coalesce(input->'leasing','[]'))v));
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_report_fields(jsonb,text[]),atlas_private.reforecast_report_snapshot(jsonb) from public,anon,authenticated;

create or replace function public.atlas_read_reforecast_publication(p_publication_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pub public.atlas_reforecast_publications;rec public.atlas_reforecast_revisions;projected jsonb;source jsonb;community_name text;
begin
 select * into pub from public.atlas_reforecast_publications where publication_id=p_publication_id;
 if pub.publication_id is null or not atlas_private.reforecast_access(pub.community_id,'active_read') then raise exception 'Publication report access denied';end if;
 select * into rec from public.atlas_reforecast_revisions where revision_id=pub.revision_id;
 if rec.status<>'locked' or not atlas_private.reforecast_publication_valid(pub) then return jsonb_build_object('publicationId',pub.publication_id,'communityId',pub.community_id,'verified',false,'status','unavailable','reason','Publication is reopened, stale, or failed immutable readback verification');end if;
 if rec.snapshot is distinct from pub.snapshot or rec.source is distinct from pub.source or (select array_agg(v order by v) from jsonb_array_elements_text(rec.payload->'periods')v) is distinct from (select array_agg(v order by v) from unnest(pub.periods)v) then return jsonb_build_object('publicationId',pub.publication_id,'communityId',pub.community_id,'verified',false,'status','unavailable','reason','Publication and locked revision evidence do not match');end if;
 projected:=atlas_private.reforecast_report_snapshot(pub.snapshot);
 projected:=(projected-'fingerprint')||jsonb_build_object('overrides',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','originalValue','originalCalculatedValue','amount','overrideValue','reason','actor','actorId','timestamp','createdAt'])),'[]') from jsonb_array_elements(coalesce(rec.payload->'overrides','[]'))v));
 projected:=projected||jsonb_build_object('fingerprint',encode(sha256(convert_to(projected::text,'UTF8')),'hex'));
 select coalesce(to_jsonb(c)->>'display_name',to_jsonb(c)->>'canonical_name',c.community_id::text) into community_name from public.atlas_communities c where community_id=pub.community_id;
 source:=jsonb_build_object('communityId',pub.community_id,'sourceVersion',pub.source->'sourceVersion','scenario',jsonb_build_object('name',rec.payload->'name','model',rec.payload->'model','periods',rec.payload->'periods','baselineType',rec.payload->'baselineType'),
  'baseline',jsonb_build_object('versionIds',pub.source->'baseline'->'versionIds','sourceType',pub.source->'baseline'->'sourceType','periodVersions',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceType','versionId','publicationId','revisionId','contentHash','sourceHash','closeVersionId','verified','status'])),'[]') from jsonb_array_elements(coalesce(pub.source->'baseline'->'periodVersions','[]'))v)),
  'actuals',jsonb_build_object('cutoffPeriod',pub.source->'actuals'->'cutoffPeriod','closeVersions',pub.source->'actuals'->'closeVersions'),
  'registry',jsonb_build_object('version',pub.source->'registry'->'version','relationships',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['relationship','utility','expenseAccount','incomeAccount','accountCode','category','nature'])),'[]') from jsonb_array_elements(coalesce(pub.source->'registry'->'relationships','[]'))v)),
  'sourceReceipts',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['uploadId','sourceHash','contentHash','reviewId','reviewHash'])),'[]') from jsonb_array_elements(coalesce(pub.source->'sourceReceipts','[]'))v));
 return jsonb_build_object('publicationId',pub.publication_id,'communityId',pub.community_id,'communityName',community_name,'scenarioId',pub.scenario_id,'scenarioName',rec.payload->'name','revisionId',pub.revision_id,'version',pub.version,'periods',pub.periods,
  'activePeriods',(select coalesce(jsonb_agg(period_key order by period_key),'[]') from public.atlas_reforecast_active_heads where publication_id=pub.publication_id),'approved',true,'locked',true,'verified',true,'status','approved_locked',
  'publishedAt',pub.published_at,'publishedBy',pub.published_by,'approvedAt',pub.published_at,'approvedBy',pub.published_by,'contentHash',pub.snapshot->>'fingerprint','reportContentHash',projected->>'fingerprint','snapshot',projected,'source',source);
end;$$;

create or replace function public.atlas_read_reforecast_digest(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare receipt public.atlas_reforecast_report_receipts;
begin
 select * into receipt from public.atlas_reforecast_report_receipts where snapshot_id=p_snapshot_id;
 if receipt.snapshot_id is null or not atlas_private.reforecast_report_scope(receipt.community_ids) then raise exception 'Forecast digest access denied';end if;
 if receipt.content_hash is distinct from encode(sha256(convert_to(receipt.snapshot::text,'UTF8')),'hex') then raise exception 'Forecast digest failed immutable readback verification';end if;
 return receipt.snapshot||jsonb_build_object('snapshotId',receipt.snapshot_id,'contentHash',receipt.content_hash,'verified',true,'generatedAt',receipt.generated_at);
end;$$;

create or replace function public.atlas_capture_reforecast_digest(p_community_ids uuid[],p_periods text[],p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cids uuid[];digest_periods text[];cid uuid;rec public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;receipt public.atlas_reforecast_report_receipts;request_hash text;rows jsonb:='[]';baseline jsonb;baseline_periods jsonb;blockers jsonb;community_name text;submitted_at timestamptz;edited_at timestamptz;found_scenario boolean;status text;next_action text;baseline_type text;baseline_version text;publication_id text;row jsonb;snapshot jsonb;
begin
 if p_request_id is null or not atlas_private.reforecast_report_scope(p_community_ids) then raise exception 'Forecast digest access denied';end if;
 if p_periods is null or cardinality(p_periods)=0 or cardinality(p_periods)>24 or exists(select 1 from unnest(p_periods)p where p is null or p!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'Select full calendar months for the digest';end if;
 select array_agg(distinct v order by v) into cids from unnest(p_community_ids)v;select array_agg(distinct v order by v) into digest_periods from unnest(p_periods)v;
 if cardinality(cids)<>cardinality(p_community_ids) or cardinality(digest_periods)<>cardinality(p_periods) then raise exception 'Digest communities and full months must be unique';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(cids,digest_periods)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-digest:'||p_request_id,0));
 select * into receipt from public.atlas_reforecast_report_receipts where request_id=p_request_id;
 if receipt.snapshot_id is not null then
  if receipt.generated_by<>auth.uid() or receipt.request_hash<>request_hash then raise exception 'Digest request ID reused for different scope';end if;
  return public.atlas_read_reforecast_digest(receipt.snapshot_id);
 end if;
 foreach cid in array cids loop
  select coalesce(to_jsonb(c)->>'display_name',to_jsonb(c)->>'canonical_name',c.community_id::text) into community_name from public.atlas_communities c where community_id=cid;
  baseline:=public.atlas_reforecast_effective_baseline(array[cid],digest_periods);
  select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','status','verified','reason','sourceType','versionId','publicationId','contentHash'])),'[]') into baseline_periods from jsonb_array_elements(baseline)v;
  select case when count(distinct v->>'sourceType')=1 and bool_and(v->>'status'='available') then max(v->>'sourceType') when bool_and(v->>'status'='available') then 'mixed' else 'unavailable' end,
   case when count(distinct v->>'versionId')=1 then max(v->>'versionId') else string_agg((v->>'period')||':'||coalesce(v->>'versionId','unavailable'),'; ' order by v->>'period') end,
   case when count(distinct v->>'publicationId')=1 then max(v->>'publicationId') else null end into baseline_type,baseline_version,publication_id from jsonb_array_elements(baseline)v;
  found_scenario:=false;
  for rec in select r.* from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id)
   where h.community_id=cid and exists(select 1 from jsonb_array_elements_text(r.payload->'periods')p where p=any(digest_periods))
   and (h.status<>'locked' or exists(select 1 from public.atlas_reforecast_publications v join public.atlas_reforecast_active_heads a using(publication_id) where v.scenario_id=h.scenario_id and a.period_key=any(digest_periods)))
   order by r.payload->>'name',r.scenario_id loop
   found_scenario:=true;
   select max(created_at) into submitted_at from public.atlas_reforecast_revisions where scenario_id=rec.scenario_id and action='submit' and revision<=rec.revision;
   select max(created_at) into edited_at from public.atlas_reforecast_revisions where scenario_id=rec.scenario_id and action in ('create','save_draft','reconcile','reopen') and revision<=rec.revision;
   select * into pub from public.atlas_reforecast_publications where revision_id=rec.revision_id;
   select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['code','severity','period','accountCode','message'])),'[]') into blockers from jsonb_array_elements(coalesce(rec.snapshot->'diagnostics','[]'))v where v->>'severity' in ('error','blocking');
   blockers:=blockers||(select coalesce(jsonb_agg(jsonb_build_object('code','baseline_unavailable','period',v->'period','message',v->'reason')),'[]') from jsonb_array_elements(baseline_periods)v where v->>'status'<>'available');
   status:=rec.status;
   next_action:=case when jsonb_array_length(blockers)>0 then 'Resolve blockers and reconcile the working draft' when status='submitted' then 'Admin or Executive: approve and lock' when status='ready_for_review' then 'Submit the frozen revision' when status='locked' then 'Approved baseline active for covered months' else 'Complete the draft and submit for review' end;
   rows:=rows||jsonb_build_array(jsonb_build_object('communityId',cid,'communityName',community_name,'requiredPeriods',digest_periods,'periods',rec.payload->'periods','scenarioId',rec.scenario_id,'scenarioName',rec.payload->'name','status',status,'owner',rec.payload->'ownerId','lastEditedAt',edited_at,'submittedAt',submitted_at,'approver',pub.published_by,'approvedAt',pub.published_at,'baselineType',baseline_type,'baselineVersionId',baseline_version,'publicationId',publication_id,'baselinePeriods',baseline_periods,'blockers',blockers,'nextAction',next_action));
  end loop;
  if not found_scenario then
   select coalesce(jsonb_agg(jsonb_build_object('code','baseline_unavailable','period',v->'period','message',v->'reason')),'[]') into blockers from jsonb_array_elements(baseline_periods)v where v->>'status'<>'available';
   rows:=rows||jsonb_build_array(jsonb_build_object('communityId',cid,'communityName',community_name,'requiredPeriods',digest_periods,'periods','[]'::jsonb,'scenarioName',null,'status','not_started','owner',null,'lastEditedAt',null,'submittedAt',null,'approver',null,'approvedAt',null,'baselineType',baseline_type,'baselineVersionId',baseline_version,'publicationId',publication_id,'baselinePeriods',baseline_periods,'blockers',blockers,'nextAction','Create a forecast for the required months'));
  end if;
 end loop;
 snapshot:=jsonb_build_object('schemaVersion',1,'reportKind','portfolio_forecast_status','communityIds',cids,'periods',digest_periods,'communities',rows);
 insert into public.atlas_reforecast_report_receipts(report_kind,community_ids,periods,request_id,request_hash,snapshot,content_hash,generated_by)
 values('portfolio_forecast_status',cids,digest_periods,p_request_id,request_hash,snapshot,encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),auth.uid()) returning * into receipt;
 return public.atlas_read_reforecast_digest(receipt.snapshot_id);
end;$$;
revoke all on function public.atlas_read_reforecast_publication(uuid),public.atlas_read_reforecast_digest(uuid),public.atlas_capture_reforecast_digest(uuid[],text[],uuid) from public,anon;
grant execute on function public.atlas_read_reforecast_publication(uuid),public.atlas_read_reforecast_digest(uuid),public.atlas_capture_reforecast_digest(uuid[],text[],uuid) to authenticated;
commit;
