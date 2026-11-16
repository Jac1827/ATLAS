create or replace function atlas_private.reforecast_rise_review_scope(stream jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',stream->'id','mappingVersion',stream->'mappingVersion','incomeBasis',stream->'incomeBasis','application',stream->'application','incomeAccountCode',stream->'incomeAccountCode','vacancyAccountCode',stream->'vacancyAccountCode','feeAccountCode',stream->'feeAccountCode','assumptionReason',stream->'assumptionReason',
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u->'id','availableFrom',u->'availableFrom','takeBackMonth',u->'takeBackMonth')),'[]') from jsonb_array_elements(coalesce(stream->'units','[]'))u),
 'monthly',(select coalesce(jsonb_agg(jsonb_build_object('period',m->'period','includedUnitIds',m->'includedUnitIds','availableUnits',m->'availableUnits','occupancyPercent',m->'occupancyPercent','grossPerOccupiedNight',m->'grossPerOccupiedNight','netPerOccupiedNight',m->'netPerOccupiedNight','feePerAvailableUnit',m->'feePerAvailableUnit','netMethod',m->'netMethod','feesIncludedInNet',m->'feesIncludedInNet')),'[]') from jsonb_array_elements(coalesce(stream->'monthly','[]'))m));
$$;
revoke all on function atlas_private.reforecast_rise_review_scope(jsonb) from public,anon,authenticated;

-- RISE is an immutable derived scenario. Conventional remains the operating baseline.
create or replace function atlas_private.reforecast_rise_issues(p_source jsonb,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare issues jsonb:='[]';stream jsonb;month jsonb;receipt jsonb;parent public.atlas_reforecast_publications;parent_config jsonb;p text;code text;
begin
 if config->>'scenarioPurpose' is distinct from 'str_overlay' and not exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))s where s->>'id'='rise_str') then return issues;end if;
 if config->>'scenarioPurpose' is distinct from 'str_overlay' or jsonb_array_length(coalesce(config->'strStreams','[]'))<>1 or config->'strStreams'->0->>'id' is distinct from 'rise_str' then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','str_overlay_required','severity','blocking','message','RISE STR requires a separate overlay; Hello Landing remains in Conventional.'));end if;
 select * into parent from public.atlas_reforecast_publications where publication_id::text=config->'parentPublication'->>'publicationId' and community_id::text=p_source->>'communityId';
 select payload into parent_config from public.atlas_reforecast_revisions where revision_id=parent.revision_id;
 if parent.publication_id is null or not atlas_private.reforecast_publication_valid(parent) or parent_config->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(parent_config->'strStreams','[]'))s where s->>'id'='rise_str')
 or config->'parentPublication'->>'revisionId' is distinct from parent.revision_id::text or config->'parentPublication'->>'contentHash' is distinct from parent.snapshot->>'fingerprint'
 or config->'parentPublication'->>'communityId' is distinct from parent.community_id::text or config->>'baselineType' is distinct from 'approved_reforecast'
 or config->'baselinePublicationIds' is distinct from jsonb_build_array(parent.publication_id) or config->'baselineVersionIds' is distinct from parent_config->'baselineVersionIds'
 or config->'parentPublication'->'originalBudgetVersionIds' is distinct from parent_config->'baselineVersionIds'
 or (select jsonb_agg(v order by v) from jsonb_array_elements_text(config->'periods')v) is distinct from (select jsonb_agg(v order by v) from unnest(parent.periods)v)
 or config->>'registryVersionId' is distinct from parent_config->>'registryVersionId' then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','str_parent_required','severity','blocking','message','Bind RISE to the exact valid Conventional publication, periods, revision, original budget and mapping.'));end if;
 if jsonb_array_length(coalesce(config->'drivers','[]'))<>0 or exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->'source'->>'kind' is distinct from 'str_schedule') then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','str_overlay_only','severity','blocking','message','An STR overlay can contain only its reviewed STR contribution.'));end if;
 for stream in select value from jsonb_array_elements(coalesce(config->'strStreams','[]')) where value->>'id'='rise_str' loop
 if stream->>'reviewed' is distinct from 'true' or nullif(stream->>'reviewedBy','') is null or nullif(stream->>'reviewedAt','') is null or stream->>'mappingVersion' is distinct from p_source->'registry'->>'version' then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','str_mapping_review','severity','blocking','message','Review RISE assumptions and the exact versioned GL mapping.'));end if;
 select value into receipt from jsonb_array_elements(coalesce(p_source->'sourceReceipts','[]'))r where r->>'reviewId'=stream->>'sourceReviewId' and r->>'sourceType'='rise_str' and r->'review'->>'status'='approved' and r->>'stale' is distinct from 'true' and r->'review'->'mapping'->>'version'=stream->>'mappingVersion' and config->'sourceUploadIds' ? (r->>'uploadId');
 if receipt is not null and receipt->'review'->'mapping'->'riseScheduleEvidence' is distinct from atlas_private.reforecast_rise_review_scope(stream) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_review_scope_changed','severity','blocking','message','The exact RISE roster, rates, fees, method, application and mapping must match the approved source review.'));end if;
 if receipt is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_source_required','severity','blocking','message','Link an approved RISE roster, rates and signed-fee source review for this mapping version.'));end if;
 foreach code in array array[stream->>'incomeAccountCode',case when stream->>'incomeBasis'='gross' then stream->>'vacancyAccountCode' end,case when stream->>'incomeBasis'='gross' then stream->>'feeAccountCode' end] loop
 if code='5144' and not coalesce(receipt->'review'->'mapping'->>'allowHelloLandingGl5144'='true' and stream->>'protectedGlApprovalReviewId'=receipt->>'reviewId',false) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_hello_landing_protected','severity','blocking','message','GL 5144 requires explicit approved Hello Landing replacement/duplication authority.'));end if;
 if stream->>'application'='replace' and exists(select 1 from jsonb_array_elements(p_source->'baseline'->'lines')l where l->>'accountCode'=code and coalesce((l->>'amount')::numeric,0)<>0) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_replace_nonzero','severity','blocking','message','STR replacement requires a dedicated zero-balance GL; preserve Conventional income.'));end if;
 end loop;
 if jsonb_array_length(coalesce(stream->'units','[]'))=0 or exists(select 1 from jsonb_array_elements(coalesce(stream->'units','[]'))u where coalesce(u->>'availableFrom','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_roster_required','severity','blocking','message','An approved roster with full-month unit availability is required.'));end if;
 for p in select jsonb_array_elements_text(config->'periods') loop
 if p_source->'lockedPeriods' ? p then continue;end if;
 select value into month from jsonb_array_elements(coalesce(stream->'monthly','[]'))m where m->>'period'=p;
 if jsonb_typeof(month->'feePerAvailableUnit') is distinct from 'number' or coalesce(month->>'netMethod','') not in ('per_occupied_night','gross_plus_signed_fees') or (month->>'netMethod'='per_occupied_night' and (jsonb_typeof(month->'netPerOccupiedNight') is distinct from 'number' or (month->>'netPerOccupiedNight')::numeric<0 or month->>'feesIncludedInNet' is distinct from 'true')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_signed_fees','severity','blocking','period',p,'message','Every full month requires signed fees and an explicit net method; reviewed net rates include all fees once.'));end if;
 if stream->>'incomeBasis'='gross' and coalesce((month->>'feePerAvailableUnit')::numeric,0)<>0 and (stream->>'feeAccountCode' in (stream->>'incomeAccountCode',stream->>'vacancyAccountCode') or not exists(select 1 from jsonb_array_elements(p_source->'registry'->'accounts')a where a->>'accountCode'=stream->>'feeAccountCode' and a->>'nature'='contra_income')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_fee_mapping','severity','blocking','message','Signed gross-basis fees require a distinct reviewed contra-income GL.'));end if;
 end loop;end loop;
 return issues;
end;$$;
revoke all on function atlas_private.reforecast_rise_issues(jsonb,jsonb) from public,anon,authenticated;

create or replace function atlas_private.reforecast_overlay_snapshot_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.atlas_reforecast_publications;bridge jsonb;line jsonb;original jsonb;issues jsonb;blockers integer;
begin
 issues:=atlas_private.reforecast_rise_issues(new.source,new.payload);
 new.snapshot:=jsonb_set(new.snapshot,'{identity,sourceHashes}',(select coalesce(jsonb_agg(v),'[]') from (select jsonb_build_object('kind','workbook','uploadId',u.upload_id,'sourceHash',u.source_hash) v from public.atlas_reforecast_uploads u where u.community_id=new.community_id and u.upload_id::text=new.payload->>'uploadId' union select jsonb_build_object('kind','reviewed_source','uploadId',r->'uploadId','sourceHash',r->'sourceHash','reviewId',r->'reviewId') from jsonb_array_elements(coalesce(new.source->'sourceReceipts','[]'))r union select jsonb_build_object('kind','baseline','period',r->'period','sourceHash',r->'sourceHash','contentHash',r->'contentHash','versionId',r->'versionId') from jsonb_array_elements(coalesce(new.source->'baseline'->'periodVersions','[]'))r) q));
 if new.payload->>'scenarioPurpose'='str_overlay' then
 select * into parent from public.atlas_reforecast_publications where publication_id::text=new.payload->'parentPublication'->>'publicationId' and community_id=new.community_id;
 if parent.publication_id is not null then
 new.snapshot:=jsonb_set(new.snapshot,'{identity,sourceHashes}',coalesce(parent.snapshot->'identity'->'sourceHashes','[]')||coalesce(new.snapshot->'identity'->'sourceHashes','[]'));
 for line in select value from jsonb_array_elements(new.snapshot->'lines') loop
 select value into original from jsonb_array_elements(parent.snapshot->'lines')v where v->>'period'=line->>'period' and v->>'accountCode'=line->>'accountCode';
 if original is null or line->'originalBudget' is distinct from original->'originalBudget' or line->'actual' is distinct from original->'actual' or line->'closeVersionId' is distinct from original->'closeVersionId'
 or (line->'forecast' is distinct from original->'forecast' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'overrides','[]'))o where o->>'period'=line->>'period' and o->>'accountCode'=line->>'accountCode' and o->'source'->>'kind'='str_schedule')) then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','str_ancestor_changed','severity','blocking','message','The overlay must preserve every Conventional GL, original budget and actual outside its STR contribution.'));end if;
 end loop;
 if jsonb_array_length(new.snapshot->'lines')<>jsonb_array_length(parent.snapshot->'lines') or exists(select 1 from jsonb_array_elements(new.snapshot->'lines')v group by v->>'period',v->>'accountCode' having count(*)<>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_lineage_coverage','severity','blocking','message','Overlay GL coverage must equal its Conventional ancestor.'));end if;
 select coalesce(jsonb_agg(jsonb_build_object('period',v->>'period','accountCode',v->>'accountCode','conventional',b->'forecast','strContribution',(v->>'forecast')::numeric-(b->>'forecast')::numeric,'withStr',v->'forecast') order by v->>'period',v->>'accountCode'),'[]') into bridge from jsonb_array_elements(new.snapshot->'lines')v join jsonb_array_elements(parent.snapshot->'lines')b on b->>'period'=v->>'period' and b->>'accountCode'=v->>'accountCode';
 new.snapshot:=new.snapshot||jsonb_build_object('strBridge',bridge);
 end if;
 new.snapshot:=jsonb_set(new.snapshot,'{identity}',(new.snapshot->'identity')||jsonb_build_object('scenarioPurpose','str_overlay','parentPublication',jsonb_build_object('publicationId',parent.publication_id,'revisionId',parent.revision_id,'contentHash',parent.snapshot->>'fingerprint','communityId',parent.community_id,'periods',parent.periods,'originalBudgetVersionIds',new.payload->'baselineVersionIds')));
 end if;
 new.snapshot:=jsonb_set(new.snapshot,'{diagnostics}',coalesce(new.snapshot->'diagnostics','[]')||issues);
 select count(*) into blockers from jsonb_array_elements(new.snapshot->'diagnostics')d where d->>'severity' in ('error','blocking');
 new.snapshot:=jsonb_set(new.snapshot,'{completeness,blockerCount}',to_jsonb(blockers));
 if blockers>0 and new.action in ('ready','submit','approve','lock') then raise exception 'Resolve RISE overlay ancestry, reviewed source, roster, rates, signed fees and protected GL blockers before approval';end if;
 if blockers>0 then new.snapshot:=jsonb_set(new.snapshot,'{status}','"action_required"');if new.action='reconcile' then new.status:='working_draft';end if;end if;
 new.snapshot:=new.snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((new.snapshot-'fingerprint')::text,'UTF8')),'hex'));return new;
end;$$;
create trigger zzz_reforecast_overlay_validation before insert on public.atlas_reforecast_revisions for each row execute function atlas_private.reforecast_overlay_snapshot_guard();
revoke all on function atlas_private.reforecast_overlay_snapshot_guard() from public,anon,authenticated;

create or replace function atlas_private.reforecast_conventional_active_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.atlas_reforecast_publications p join public.atlas_reforecast_revisions r using(revision_id) where p.publication_id=new.publication_id and (r.payload->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(r.payload->'strStreams','[]'))s where s->>'id'='rise_str'))) then raise exception 'RISE STR is an overlay and cannot become the active operating baseline';end if;
 return new;
end;$$;
create trigger reforecast_conventional_active_only before insert or update on public.atlas_reforecast_active_heads for each row execute function atlas_private.reforecast_conventional_active_guard();
revoke all on function atlas_private.reforecast_conventional_active_guard() from public,anon,authenticated;

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
 nights:=available*extract(day from ((period||'-01')::date+interval '1 month'-interval '1 day'));occupied:=nights*occupancy/100;gross:=round(occupied*gross_rate,2);potential:=round(nights*gross_rate,2);vacancy:=gross-potential;fees:=round(available*fee_rate,2);
 if month->>'netMethod'='gross_plus_signed_fees' then net:=round(gross+fees,2);elsif coalesce(month->>'netMethod','per_occupied_night')='per_occupied_night' then net:=round(occupied*net_rate,2);else raise exception 'Invalid STR net income method';end if;
 if basis='net' and net is null then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_net_unavailable','severity','error','message','Net income requires a reviewed rate or signed fee method.','streamId',stream_id,'period',period));continue;end if;
 schedules:=schedules||jsonb_build_array(jsonb_build_object('streamId',stream_id,'period',period,'availableUnits',available,'occupancyPercent',occupancy,'availableUnitNights',nights,'occupiedUnitNights',occupied,'grossPotentialIncome',potential,'grossIncome',gross,'vacancyLoss',vacancy,'netIncome',net,'fees',fees,'netMethod',month->>'netMethod','feesIncludedInNet',month->'feesIncludedInNet','incomeBasis',basis,'application',mode,'assumptionReason',stream->>'assumptionReason'));
 foreach metric in array case when basis='gross' and stream_id='rise_str' and fees<>0 and nullif(stream->>'feeAccountCode','') is not null then array['income','vacancy','fees'] when basis='gross' then array['income','vacancy'] else array['income'] end loop
 code:=case when metric='income' then stream->>'incomeAccountCode' when metric='fees' then stream->>'feeAccountCode' else stream->>'vacancyAccountCode' end;k:=period||'|'||code;
 amount:=case when metric='fees' then fees when metric='vacancy' then vacancy when basis='net' then net else potential end;
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
  if rec.payload->>'scenarioPurpose' is distinct from 'str_overlay' and exists(select 1 from unnest(pub.periods)p where not atlas_private.reforecast_month_locked(pub.community_id,p) and not exists(select 1 from public.atlas_reforecast_active_heads h where h.community_id=pub.community_id and h.period_key=p and h.publication_id=pub.publication_id)) then raise exception 'This publication was superseded; create and approve a new revision rather than reactivating history';end if;return pub;
 end if;
 select array_agg(v order by v) into periods from jsonb_array_elements_text(rec.payload->'periods')v;
 select array_agg(v::uuid) into budget_ids from jsonb_array_elements_text(coalesce(rec.payload->'baselineVersionIds','[]'))v;
 source:=atlas_private.reforecast_source_for_config(rec.community_id,rec.payload);
 if source->>'sourceVersion' is distinct from rec.source->>'sourceVersion' then raise exception 'Closed actual evidence changed after locking. Preserve this locked version and create a revised working scenario';end if;
 if (rec.snapshot->'completeness'->>'blockerCount')::integer<>0 then raise exception 'Locked snapshot has unresolved blockers';end if;
 if rec.payload->>'scenarioPurpose' is distinct from 'str_overlay' and exists(select 1 from public.atlas_reforecast_publications b where rec.payload->'baselinePublicationIds' ? b.publication_id::text and b.snapshot->'identity'->>'scenarioPurpose'='str_overlay') then raise exception 'A RISE overlay cannot be selected as a Conventional operating baseline';end if;
 select coalesce(max(version),0)+1 into next_version from public.atlas_reforecast_publications where community_id=rec.community_id;
 insert into public.atlas_reforecast_publications(community_id,scenario_id,revision_id,version,request_id,request_hash,periods,snapshot,source,reason,published_by,published_role)
 values(rec.community_id,p_scenario_id,rec.revision_id,next_version,p_request_id,hash,periods,rec.snapshot,rec.source,p_reason,auth.uid(),(select role from public.atlas_user_profiles where user_id=auth.uid())) returning * into pub;
 insert into public.atlas_reforecast_active_heads select rec.community_id,p,pub.publication_id from unnest(periods)p where rec.payload->>'scenarioPurpose' is distinct from 'str_overlay' and not atlas_private.reforecast_month_locked(rec.community_id,p)
 on conflict(community_id,period_key) do update set publication_id=excluded.publication_id;
 return pub;
end;$$;



create or replace function atlas_private.reforecast_report_snapshot(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;lines jsonb;drivers jsonb;schedules jsonb;item jsonb;monthly jsonb:='[]';metric_keys text[]:=array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow','margin'];
begin
 result:=atlas_private.reforecast_report_fields(input,array['schemaVersion','communityId','periods','status','cutoffPeriod','completeness']);
 result:=result||jsonb_build_object('originalPublicationFingerprint',input->'fingerprint','identity',atlas_private.reforecast_report_fields(input->'identity',array['engineVersion','communityId','periods','actualCutoff','actualCloseVersions','mappingRegistryVersion','baselineVersionIds','baselineVersionId','baselineSourceType','baselinePeriodVersions','closeVersions','registryVersion','sourceVersion','driverVersion','scenarioId','scenarioVersion','reforecastVersion','scenarioPurpose','parentPublication','sourceHashes']));
 result:=jsonb_set(result,'{identity,baselinePeriodVersions}',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceType','versionId','publicationId','revisionId','contentHash','sourceHash','closeVersionId','verified','status'])),'[]') from jsonb_array_elements(coalesce(input->'identity'->'baselinePeriodVersions','[]'))v));
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','accountName','department','category','nature','identifier','placement','originalBudget','selectedBaseline','actual','forecast','sourceKind','closeVersionId','mappingValid','immutable','retired','applicable','forecastVariance','actualVariance','forecastFavorability','actualFavorability'])||jsonb_build_object('baselineLineage',atlas_private.reforecast_report_fields(v->'baselineLineage',array['sourceType','versionId','publicationId','revisionId','contentHash','sourceHash'])) order by v->>'period',v->>'accountCode'),'[]') into lines from jsonb_array_elements(coalesce(input->'lines','[]'))v;
 for item in select value from jsonb_array_elements(coalesce(input->'monthly','[]')) loop
  monthly:=monthly||jsonb_build_array(atlas_private.reforecast_report_fields(item,array['period','closed','applicable','closeVersionId','detailCoverage','controlSource'])||jsonb_build_object('originalBudget',atlas_private.reforecast_report_fields(item->'originalBudget',metric_keys),'reforecast',atlas_private.reforecast_report_fields(item->'reforecast',metric_keys),'actuals',atlas_private.reforecast_report_fields(item->'actuals',metric_keys)));
 end loop;
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['id','type','operation','value','reason','status'])||jsonb_build_object('changed',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(c,array['period','accountCode','before','after','delta'])),'[]') from jsonb_array_elements(coalesce(v->'changed','[]'))c))),'[]') into drivers from jsonb_array_elements(coalesce(input->'driverImpacts','[]'))v;
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['streamId','id','period','availableUnits','availableUnitCount','occupancyPercent','availableUnitNights','occupiedUnitNights','grossPotentialIncome','grossIncome','estimatedGrossIncome','netIncome','estimatedNetIncome','vacancyLoss','fees','netMethod','incomeBasis','application','feesIncludedInNet','status']) order by v->>'streamId',v->>'period'),'[]') into schedules from jsonb_array_elements(coalesce(input->'strSchedules',input->'strLeasing','[]'))v;
 result:=result||jsonb_build_object('lines',lines,'monthly',monthly,'driverImpacts',drivers,'strSchedules',schedules,
 'totals',jsonb_build_object('originalBudget',atlas_private.reforecast_report_fields(input->'totals'->'originalBudget',metric_keys),'reforecast',atlas_private.reforecast_report_fields(input->'totals'->'reforecast',metric_keys),'actuals',atlas_private.reforecast_report_fields(input->'totals'->'actuals',metric_keys),'actualsThroughCutoff',atlas_private.reforecast_report_fields(input->'totals'->'actualsThroughCutoff',metric_keys)),
 'diagnostics',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['code','severity','period','accountCode','message'])),'[]') from jsonb_array_elements(coalesce(input->'diagnostics','[]'))v),
 'leasing',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceKind','units','occupiedUnits','moveIns','moveOuts','marketRent','occupancy'])),'[]') from jsonb_array_elements(coalesce(input->'leasing','[]'))v));
 result:=result||jsonb_build_object('strBridge',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','conventional','strContribution','withStr']) order by v->>'period',v->>'accountCode'),'[]') from jsonb_array_elements(coalesce(input->'strBridge','[]'))v));
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
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
 if exists(select 1 from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.community_id=p_community_id and h.scenario_id<>p_scenario_id and h.status not in ('approved','locked') and coalesce(r.payload->>'scenarioPurpose','conventional')=coalesce(config->>'scenarioPurpose','conventional') and (select array_agg(v order by v) from jsonb_array_elements_text(r.payload->'periods')v)=periods) then raise exception 'One editable scenario already exists for this community and exact period set';end if;
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



create or replace function atlas_private.reforecast_stale_bonus() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;periods text[];
begin
 if exists(select 1 from public.atlas_reforecast_publications p join public.atlas_reforecast_revisions r using(revision_id) where p.publication_id=new.publication_id and (r.payload->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(r.payload->'strStreams','[]'))v where v->>'id'='rise_str'))) then return new;end if;
 cid:=new.community_id;
 if tg_table_name='atlas_reforecast_publications' then periods:=new.periods;else select p.periods into periods from public.atlas_reforecast_publications p where p.publication_id=new.publication_id;end if;
 if to_regclass('public.atlas_bonus_calculation_runs') is not null then
 execute 'update public.atlas_bonus_calculation_runs r set exceptions=coalesce(r.exceptions,''[]''::jsonb)||jsonb_build_array(jsonb_build_object(''code'',''baseline_stale'',''reason'',''Forecast baseline changed; recalculate unpaid results'',''publicationId'',$3)) from public.atlas_bonus_periods b where r.bonus_period_id=b.bonus_period_id and atlas_private.reforecast_bonus_run_in_community(to_jsonb(r),$1) and r.deleted_at is null and r.status in (''draft'',''review'',''approved'') and b.status=''open'' and exists(select 1 from unnest($2::text[])p where (p||''-01'')::date between b.start_date and b.end_date)' using cid,periods,new.publication_id;
 end if;return new;
end;$$;
