-- Explicit reviewed source-absent forecast cells remain in scope as null.
-- Additive policy only: no historical source, revision, receipt or publication
-- rows are changed. User values retain the original absence and review lineage.
begin;
create function atlas_private.forecast_blank_required_rewrite(body text,old_text text,new_text text)
returns text language plpgsql immutable set search_path='' as $$begin
 if length(body)-length(replace(body,old_text,''))<>length(old_text) then raise exception 'Reviewed forecast blank rewrite prerequisite differs at %',left(old_text,100);end if;
 return replace(body,old_text,new_text);
end;$$;
revoke all on function atlas_private.forecast_blank_required_rewrite(text,text,text) from public,anon,authenticated;
create function atlas_private.forecast_blank_required_definition(signature text,expected text)
returns text language plpgsql stable set search_path='' as $$
declare body text;definition text;
begin
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid=signature::regprocedure;
 if encode(sha256(convert_to(body,'UTF8')),'hex') is distinct from expected then raise exception 'Reviewed forecast blank prerequisite differs: %',signature;end if;
 return definition;
end;$$;
revoke all on function atlas_private.forecast_blank_required_definition(text,text) from public,anon,authenticated;
create function atlas_private.forecast_blank_review_time(value text)
returns boolean language plpgsql stable set search_path='' as $$
begin
 if value is null or value!~'^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T[0-2][0-9]:[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-2][0-9]:[0-5][0-9])$' then return false;end if;
 return isfinite(value::timestamptz) and value::timestamptz<=now()+interval '5 minutes';
 exception when others then return false;
end;$$;
-- Keep the original, fully fingerprinted mapping when validating either kind
-- of source absence. Reclassifying review rows must not invalidate its already
-- verified immutable relationship proof or repeat validation of the full upload.
do $absence$
declare d text;body text;shared_body text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.resolve_reforecast_workbook_scope(jsonb,jsonb)','5ee9dff904ce1c7dfbeaa04ea1b7af189b64f169f1906e0ac332d59a6ca53ea5');
 select prosrc into body from pg_proc where oid='atlas_private.resolve_reforecast_workbook_scope(jsonb,jsonb)'::regprocedure;
 shared_body:=atlas_private.forecast_blank_required_rewrite(body,$before$ if not coalesce(mapping->'workbookSourcePolicy' ? 'outsideForecastScope',false) then return result;end if;$before$,$after$ if absence_disposition not in ('outside_forecast_scope','reviewed_forecast_blank') or absence_disposition is null then raise exception 'Unknown workbook source absence disposition';end if;$after$);
 -- All four occurrences address only the review list, not the mapping passed
 -- to immutable relationship validation or its exact full-mapping fingerprint.
 if (length(shared_body)-length(replace(shared_body,$key$mapping->'workbookSourcePolicy'->'outsideForecastScope'$key$,'')))/length($key$mapping->'workbookSourcePolicy'->'outsideForecastScope'$key$)<>4 then raise exception 'Workbook source absence review-list prerequisite differs';end if;
 shared_body:=replace(shared_body,$key$mapping->'workbookSourcePolicy'->'outsideForecastScope'$key$,'reviews');
 shared_body:=atlas_private.forecast_blank_required_rewrite(shared_body,$before$  result:=result||jsonb_build_array(review||jsonb_build_object('disposition','outside_forecast_scope','sourceScopeExclusionConfirmed',true,'source',jsonb_build_object('kind','workbook_scope_exclusion','uploadId',config->'uploadId','sourceHash',source_hash,'auditId',upload->'integrity'->'auditId','mappingVersion',mapping->'version','sourceScenario',mapping->'sourceScenario','review',review)));$before$,$after$  result:=result||jsonb_build_array(review||jsonb_build_object('disposition',absence_disposition,'sourceScopeExclusionConfirmed',absence_disposition='outside_forecast_scope','source',jsonb_build_object('kind',case when absence_disposition='reviewed_forecast_blank' then 'reviewed_forecast_blank' else 'workbook_scope_exclusion' end,'uploadId',config->'uploadId','sourceHash',source_hash,'auditId',upload->'integrity'->'auditId','mappingVersion',mapping->'version','sourceScenario',mapping->'sourceScenario','review',review)||case when absence_disposition='reviewed_forecast_blank' then jsonb_build_object('workbookSourceAbsent',true) else '{}'::jsonb end)||case when absence_disposition='reviewed_forecast_blank' then jsonb_build_object('amount',null,'isBlank',true,'legitimateBlank',true,'reviewedForecastBlankConfirmed',true) else '{}'::jsonb end);$after$);
 execute format('create function atlas_private.resolve_reforecast_workbook_absence(source jsonb,config jsonb,reviews jsonb,absence_disposition text) returns jsonb language plpgsql stable security invoker set search_path='''' set plan_cache_mode=''force_generic_plan'' as %L',shared_body);
 execute atlas_private.forecast_blank_required_rewrite(d,body,$wrapper$
begin
 if not coalesce(config->'importMapping'->'workbookSourcePolicy' ? 'outsideForecastScope',false) then return '[]'::jsonb;end if;
 return atlas_private.resolve_reforecast_workbook_absence(source,config,config->'importMapping'->'workbookSourcePolicy'->'outsideForecastScope','outside_forecast_scope');
end;$wrapper$);
end;$absence$;
revoke all on function atlas_private.resolve_reforecast_workbook_absence(jsonb,jsonb,jsonb,text) from public,anon,authenticated;
create function atlas_private.resolve_reforecast_reviewed_forecast_blanks(source jsonb,config jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set plan_cache_mode='force_generic_plan' as $$
declare policy jsonb:=config->'importMapping'->'workbookSourcePolicy';reviews jsonb:=policy->'reviewedForecastBlanks';review jsonb;result jsonb:='[]';
begin
 if not coalesce(policy ? 'reviewedForecastBlanks',false) then return result;end if;
 if jsonb_typeof(reviews) is distinct from 'array' then raise exception 'Reviewed forecast blanks must be explicit GL/month reviews';end if;
 for review in select value from jsonb_array_elements(reviews) loop
  if jsonb_typeof(review) is distinct from 'object' or not atlas_private.forecast_blank_review_time(review->>'reviewedAt') or review->>'reviewedBy' is distinct from config->'importMapping'->>'reviewedBy' then raise exception 'Every reviewed forecast blank needs a valid authorized actor and timestamp';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(policy->'outsideForecastScope','[]'))v where v->>'period'=review->>'period' and v->>'accountCode'=review->>'accountCode') then raise exception 'A reviewed forecast blank remains in scope and cannot also be outside forecast scope';end if;
 end loop;
 -- Original mapping stays intact for exact immutable relationship proof reuse.
 return atlas_private.resolve_reforecast_workbook_absence(source,config,reviews,'reviewed_forecast_blank');
end;$$;
create function atlas_private.reviewed_forecast_user_override(over jsonb,cell jsonb,cid uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce(cell->>'disposition'='reviewed_forecast_blank' and over->>'uploadId' is null and over->>'sourceLineId' is null and jsonb_typeof(over->'amount') in ('number','null')
 and over->'source'->>'kind'='user' and over->'source'->>'workbookSourceAbsent'='true' and over->'source'->'reviewedForecastBlank'=cell->'source'
 and atlas_private.planning_review_valid(over,cid,over->>'period',over->'amount') and atlas_private.forecast_blank_review_time(over->>'reviewedAt'),false)
$$;
-- Only amount suggestions for intentional blanks use the additional immutable
-- acceptance ledger. Ordinary ratio recommendation undo keeps its existing API.
create function atlas_private.reviewed_forecast_recommendation_ids(config jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 with history as (select value event from jsonb_array_elements(coalesce(config->'history','[]'))),
 drivers as (
  select value driver from jsonb_array_elements(coalesce(config->'drivers','[]'))
  union all select d from history h cross join lateral jsonb_array_elements(case when jsonb_typeof(h.event->'before')='array' then h.event->'before' else '[]'::jsonb end)d
  union all select d from history h cross join lateral jsonb_array_elements(case when jsonb_typeof(h.event->'after')='array' then h.event->'after' else '[]'::jsonb end)d
 ),ids as (
  select driver->>'recommendationId' id from drivers where driver->>'type'='historical_weighted_amount' and driver->'evidence'->>'method'='weighted_governed_actual_amount'
  union select v from history h cross join lateral jsonb_array_elements_text(coalesce(h.event->'recommendationIds','[]'))v where h.event->>'action'='clear_reviewed_forecast_blank'
 )select coalesce(jsonb_agg(id order by id),'[]') from ids where nullif(id,'') is not null
$$;
revoke all on function atlas_private.reviewed_forecast_recommendation_ids(jsonb) from public,anon,authenticated;
create function atlas_private.validate_reviewed_forecast_blank_edit(source jsonb,config jsonb,previous_config jsonb,previous_snapshot jsonb)
returns void language plpgsql stable security invoker set search_path='' as $$
declare review jsonb;prior_review jsonb;over jsonb;old_over jsonb;before_value jsonb;cell jsonb;driver jsonb;old_driver jsonb;event jsonb;baseline_cell jsonb;reviews jsonb;inherited boolean;decision jsonb;historical_ids jsonb;override_index jsonb;prior_override_index jsonb;cid uuid:=(source->>'communityId')::uuid;p text;code text;
begin
 historical_ids:=atlas_private.reviewed_forecast_recommendation_ids(previous_config)||atlas_private.reviewed_forecast_recommendation_ids(config);
 reviews:=coalesce(config->'importMapping'->'workbookSourcePolicy'->'reviewedForecastBlanks','[]');
 if config->>'uploadId' is not distinct from previous_config->>'uploadId' and exists(select 1 from jsonb_array_elements(coalesce(previous_config->'importMapping'->'workbookSourcePolicy'->'reviewedForecastBlanks','[]'))old where not exists(select 1 from jsonb_array_elements(reviews)r where r->>'period'=old->>'period' and r->>'accountCode'=old->>'accountCode')) then raise exception 'Retain the reviewed source-absence policy and lineage when editing this workbook forecast';end if;
 select reviews||coalesce(jsonb_agg(coalesce(b->'workbookSource',b->'source')->'review'),'[]') into reviews from jsonb_array_elements(coalesce(source->'baseline'->'lines','[]'))b where coalesce(b->'workbookSource',b->'source')->>'kind'='reviewed_forecast_blank' and not exists(select 1 from jsonb_array_elements(reviews)r where r->>'period'=b->>'period' and r->>'accountCode'=b->>'accountCode');
 -- SELECT INTO formerly chose the first matching array element. Index once
 -- with the same ordinal winner; SQL-null identities never matched before.
 if jsonb_array_length(reviews)>0 then
  select coalesce(jsonb_object_agg(k,v),'{}') into override_index from (select distinct on(k) k,v from (select jsonb_build_array(v->>'period',v->>'accountCode')::text k,v,n from jsonb_array_elements(coalesce(config->'overrides','[]')) with ordinality q(v,n) where v->>'period' is not null and v->>'accountCode' is not null)s order by k,n)first_match;
  select coalesce(jsonb_object_agg(k,v),'{}') into prior_override_index from (select distinct on(k) k,v from (select jsonb_build_array(v->>'period',v->>'accountCode')::text k,v,n from jsonb_array_elements(coalesce(previous_config->'overrides','[]')) with ordinality q(v,n) where v->>'period' is not null and v->>'accountCode' is not null)s order by k,n)first_match;
 end if;
 for review in select value from jsonb_array_elements(reviews) loop
  p:=review->>'period';code:=review->>'accountCode';
  select value into baseline_cell from jsonb_array_elements(coalesce(source->'baseline'->'lines','[]'))b where b->>'period'=p and b->>'accountCode'=code;
  inherited:=not exists(select 1 from jsonb_array_elements(coalesce(config->'importMapping'->'workbookSourcePolicy'->'reviewedForecastBlanks','[]'))r where r->>'period'=p and r->>'accountCode'=code);
  select value into prior_review from jsonb_array_elements(coalesce(previous_config->'importMapping'->'workbookSourcePolicy'->'reviewedForecastBlanks','[]'))v where v->>'period'=p and v->>'accountCode'=code;
  if inherited then prior_review:=review;end if;
  if not inherited and (review is distinct from prior_review or config->>'uploadId' is distinct from previous_config->>'uploadId') then
   if review->>'reviewedBy' is distinct from auth.uid()::text then raise exception 'New forecast blank reviews must belong to the signed-in authorized reviewer';end if;
   if source->'lockedPeriods' ? p or source->'actuals'->'notApplicablePeriods' ? p or p<=source->'actuals'->>'cutoffPeriod' or not coalesce(source->'periods' ? p,false) then raise exception 'New forecast blank reviews require an eligible open forecast month';end if;
  end if;
  if source->'lockedPeriods' ? p or source->'actuals'->'notApplicablePeriods' ? p or p<=source->'actuals'->>'cutoffPeriod' then continue;end if;
  over:=case when p is not null and code is not null then override_index->jsonb_build_array(p,code)::text end;
  old_over:=case when p is not null and code is not null then prior_override_index->jsonb_build_array(p,code)::text end;
  if over->'source'->>'kind'='str_schedule' and config->>'scenarioPurpose'='str_overlay' and config->'strStreams'->0->>'type'='saved_json_monthly_programme' then perform atlas_private.reforecast_saved_str_receipt(source,config);continue;end if;
  if over is distinct from old_over and over is not null then
   select value into cell from jsonb_array_elements(coalesce(source->'workbookReviewedForecastBlankCells','[]'))v where v->>'period'=p and v->>'accountCode'=code;
   if cell is null and inherited then cell:=jsonb_build_object('period',p,'accountCode',code,'disposition','reviewed_forecast_blank','source',coalesce(baseline_cell->'workbookSource',baseline_cell->'source'));end if;
   select v->'forecast' into before_value from jsonb_array_elements(coalesce(previous_snapshot->'lines','[]'))v where v->>'period'=p and v->>'accountCode'=code;
   if not atlas_private.reviewed_forecast_user_override(over,cell,cid) or over->>'ownerId' is distinct from auth.uid()::text or over->'before' is distinct from coalesce(before_value,case when inherited then baseline_cell->'amount' end,'null'::jsonb) then raise exception 'Changed reviewed blank value requires the signed-in user and exact prior value with reviewed before/after evidence';end if;
  end if;
  for driver in select value from jsonb_array_elements(coalesce(config->'drivers','[]'))v where v->'accountCodes' ? code and v->'periods' ? p loop
   select value into old_driver from jsonb_array_elements(coalesce(previous_config->'drivers','[]'))v where v->>'id'=driver->>'id';
   if driver is distinct from old_driver and not coalesce(driver-'periods'=old_driver-'periods' and jsonb_typeof(driver->'periods')='array' and not exists(select 1 from jsonb_array_elements_text(driver->'periods')v where not(old_driver->'periods' ? v)) and not exists(select 1 from jsonb_array_elements_text(old_driver->'periods')removed where not(driver->'periods' ? removed) and not(source->'lockedPeriods' ? removed) and (source->'actuals'->>'cutoffPeriod' is null or removed>source->'actuals'->>'cutoffPeriod') and (exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->>'period'=removed and o->>'accountCode'=code) or not exists(select 1 from jsonb_array_elements(coalesce(config->'history','[]'))e where e->>'action'='clear_reviewed_forecast_blank' and e->>'period'=removed and e->>'accountCode'=code and e->>'actor'=auth.uid()::text and atlas_private.forecast_blank_review_time(e->>'timestamp') and e->'before'=(select l->'forecast' from jsonb_array_elements(coalesce(previous_snapshot->'lines','[]'))l where l->>'period'=removed and l->>'accountCode'=code) and e->'after'='null'::jsonb and length(trim(coalesce(e->>'reason','')))>=3 and not exists(select 1 from jsonb_array_elements(coalesce(previous_config->'history','[]'))h where h=e)))),false) and (driver->>'ownerId' is distinct from auth.uid()::text or driver->'recommendationReview'->>'reviewedBy' is distinct from auth.uid()::text) then raise exception 'New recommendation acceptance must belong to the signed-in authorized reviewer';end if;
  end loop;
  select v->'forecast' into before_value from jsonb_array_elements(coalesce(previous_snapshot->'lines','[]'))v where v->>'period'=p and v->>'accountCode'=code;
  if review is not distinct from prior_review and config->>'uploadId' is not distinct from previous_config->>'uploadId' and jsonb_typeof(before_value)='number' and over is null and not exists(select 1 from jsonb_array_elements(coalesce(config->'drivers','[]'))v where v->'accountCodes' ? code and v->'periods' ? p) then
   select value into event from jsonb_array_elements(coalesce(config->'history','[]'))v where v->>'action'='clear_reviewed_forecast_blank' and v->>'period'=p and v->>'accountCode'=code and v->'before'=before_value and v->'after'='null'::jsonb and v->>'actor'=auth.uid()::text and atlas_private.forecast_blank_review_time(v->>'timestamp') and length(trim(coalesce(v->>'reason','')))>=3 and not exists(select 1 from jsonb_array_elements(coalesce(previous_config->'history','[]'))old where old=v);
   if event is null then raise exception 'Clearing a reviewed forecast value requires an explicit signed-in cell review with the exact prior value';end if;
  end if;
 end loop;
 for event in select value from jsonb_array_elements(coalesce(previous_config->'history','[]'))v where v->>'action'='clear_reviewed_forecast_blank' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v->'before')='array' then v->'before' else '[]'::jsonb end||case when jsonb_typeof(v->'after')='array' then v->'after' else '[]'::jsonb end)d where d->>'type'='historical_weighted_amount' and d->'evidence'->>'method'='weighted_governed_actual_amount') loop
  if not exists(select 1 from jsonb_array_elements(coalesce(config->'history','[]'))v where v=event) then raise exception 'Retain the original reviewed forecast clear history';end if;
 end loop;
 for decision in select value from jsonb_array_elements(coalesce(previous_config->'suggestionDecisions','[]'))v where historical_ids ? (v->>'id') loop
  if not exists(select 1 from jsonb_array_elements(coalesce(config->'suggestionDecisions','[]'))v where v=decision) then raise exception 'Retain the original historical recommendation decision; record clear or undo as new audit history';end if;
 end loop;
 for decision in select value from jsonb_array_elements(coalesce(config->'suggestionDecisions','[]'))v where historical_ids ? (v->>'id') and not exists(select 1 from jsonb_array_elements(coalesce(previous_config->'suggestionDecisions','[]'))old where old=v) loop
  if decision->>'actor' is distinct from auth.uid()::text or not atlas_private.forecast_blank_review_time(decision->>'timestamp') or length(trim(coalesce(decision->>'reason','')))<3 then raise exception 'New recommendation decisions require the signed-in actor, timestamp and reason';end if;
  if decision->>'status'='accepted' and exists(select 1 from jsonb_array_elements(coalesce(previous_config->'suggestionDecisions','[]'))v where v->>'id'=decision->>'id' and v->>'status'='accepted') then
   if exists(select 1 from jsonb_array_elements(coalesce(previous_config->'drivers','[]'))v where v->>'recommendationId'=decision->>'id') or not exists(select 1 from jsonb_array_elements(coalesce(previous_config->'history','[]'))v where v->>'action'='clear_reviewed_forecast_blank' and v->'recommendationIds' ? (decision->>'id') and v->'after'='null'::jsonb and atlas_private.forecast_blank_review_time(v->>'timestamp') and (v->>'timestamp')::timestamptz<=(decision->>'timestamp')::timestamptz and not exists(select 1 from jsonb_array_elements(coalesce(previous_config->'suggestionDecisions','[]'))old where old->>'id'=decision->>'id' and old->>'status'='accepted' and (old->>'timestamp')::timestamptz>(v->>'timestamp')::timestamptz)) then raise exception 'Reaccepting a historical recommendation requires its prior explicit clear and no active amount driver';end if;
  end if;
 end loop;
end;$$;
revoke all on function atlas_private.forecast_blank_review_time(text),atlas_private.resolve_reforecast_reviewed_forecast_blanks(jsonb,jsonb),atlas_private.reviewed_forecast_user_override(jsonb,jsonb,uuid),atlas_private.validate_reviewed_forecast_blank_edit(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
-- Historical suggestions are advisory. Only a matched explicit acceptance can
-- contribute to a reviewed blank; recompute the proposal from governed evidence.
create function atlas_private.reviewed_forecast_recommendation(source jsonb,config jsonb,cell jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare driver jsonb;decision jsonb;review jsonb;observation jsonb;history jsonb;source_row jsonb;actual_line jsonb;baseline_line jsonb;eligible jsonb;expected_weight numeric;eligible_count bigint;code text:=cell->>'accountCode';p text:=cell->>'period';n bigint;seen text[]:='{}';weighted numeric:=0;weight_total numeric:=0;proposed numeric;retained boolean;
begin
 select count(*),jsonb_agg(d)->0 into n,driver from jsonb_array_elements(coalesce(config->'drivers','[]'))d where d->'accountCodes' ? code and d->'periods' ? p;
 if n<>1 then return false;end if;
 if jsonb_typeof(driver->'periods') is distinct from 'array' or jsonb_array_length(driver->'periods')=0 or (select count(distinct v) from jsonb_array_elements_text(driver->'periods')v)<>jsonb_array_length(driver->'periods') or exists(select 1 from jsonb_array_elements_text(driver->'periods')period where not exists(select 1 from jsonb_array_elements(coalesce(source->'workbookReviewedForecastBlankCells','[]')||coalesce(source->'baseline'->'lines','[]'))b where b->>'period'=period and b->>'accountCode'=code and coalesce(b->'workbookSource',b->'source')->>'kind'='reviewed_forecast_blank')) then return false;end if;
 review:=driver->'recommendationReview';
 select count(*),jsonb_agg(d)->0 into n,decision from jsonb_array_elements(coalesce(config->'suggestionDecisions','[]'))d where d->>'id'=driver->>'recommendationId' and d->>'status'='accepted' and d->>'timestamp'=review->>'reviewedAt' and d->>'actor'=review->>'reviewedBy';
 if n<>1 or coalesce(driver->>'recommendationId','')='' or driver->>'type' is distinct from 'historical_weighted_amount' or driver->>'operation' is distinct from 'amount' or driver->>'id' is distinct from 'historical-blank-'||code or driver->'accountCodes' is distinct from jsonb_build_array(code) or jsonb_typeof(driver->'value') is distinct from 'number' then return false;end if;
 if not coalesce(review->>'confirmed'='true' and review->>'reviewedBy'=driver->>'ownerId' and review->>'reviewedBy'=decision->>'actor' and review->>'reviewedAt'=driver->>'reviewedAt' and review->>'reviewedAt'=decision->>'timestamp' and atlas_private.forecast_blank_review_time(review->>'reviewedAt') and atlas_private.planning_authorized_reviewer((source->>'communityId')::uuid,review->>'reviewedBy') and length(trim(review->>'reason'))>=3 and decision->>'reason'=review->>'reason' and driver->>'reason'=review->>'reason' and length(driver->>'source')>0 and decision->>'source'=driver->>'source' and decision->'proposedValue'=review->'proposedValue' and decision->'appliedValue'=review->'appliedValue' and driver->'value'=review->'appliedValue',false) then return false;end if;
 if driver->'evidence'->>'method' is distinct from 'weighted_governed_actual_amount' or driver->'evidence'->>'seasonality' is distinct from 'historical_monthly_amount_estimate' or driver->'evidence'->'successorRelationships' is distinct from '[]'::jsonb or jsonb_typeof(driver->'evidence'->'observations') is distinct from 'array' then return false;end if;
 retained:=coalesce(source->'retainedReviewedForecastRecommendationBindings' ? encode(sha256(convert_to((driver-'periods')::text,'UTF8')),'hex'),false);
 select coalesce(jsonb_agg(h order by h->>'period'),'[]') into eligible from jsonb_array_elements(coalesce(source->'recommendationHistory','[]'))h
 where h->>'eligible'='true' and h->>'status'='available' and h->>'period'<p and (not retained or h->>'period'<=decision->>'cutoff')
 and h->'baseline'->>'status'='available' and h->'baseline'->>'period'=h->>'period' and h->'baseline'->>'verified'='true' and h->'baseline'->>'approved'='true' and h->'baseline'->>'locked'='true'
 and h->'baseline'->>'sourceType' in ('original_budget','approved_reforecast') and (h->'baseline'->>'sourceType'<>'approved_reforecast' or nullif(h->'baseline'->>'publicationId','') is not null)
 and nullif(h->'baseline'->>'versionId','') is not null and nullif(h->'baseline'->>'contentHash','') is not null
 and (select count(*) from jsonb_array_elements(coalesce(h->'lines','[]'))l where l->>'accountCode'=code)=1
 and (select count(*) from jsonb_array_elements(coalesce(h->'baseline'->'lines','[]'))l where l->>'accountCode'=code)=1
 and exists(select 1 from jsonb_array_elements(h->'lines')l where l->>'accountCode'=code and l->>'closeVersionId'=h->>'closeVersionId' and jsonb_typeof(l->'actual')='number')
 and exists(select 1 from jsonb_array_elements(h->'baseline'->'lines')l where l->>'accountCode'=code and jsonb_typeof(l->'amount')='number');
 if exists(select 1 from jsonb_array_elements(eligible)h group by h->>'period' having count(*)<>1) then return false;end if;
 if jsonb_typeof(coalesce(config->'recommendationWeights','{}')) is distinct from 'object' or exists(select 1 from jsonb_each(coalesce(config->'recommendationWeights','{}'))w where jsonb_typeof(w.value) is distinct from 'number' or w.value::text::numeric<0) then return false;end if;
 select count(*) into eligible_count from jsonb_array_elements(eligible) with ordinality q(h,ordinal) where coalesce((config->'recommendationWeights'->>(h->>'period'))::numeric,ordinal)>0;
 if retained then eligible_count:=jsonb_array_length(driver->'evidence'->'observations');end if;
 for observation in select value from jsonb_array_elements(driver->'evidence'->'observations') loop
  if observation->>'period'=any(seen) or observation->>'period'>=p or observation->>'period'>decision->>'cutoff' or jsonb_typeof(observation->'actual') is distinct from 'number' or jsonb_typeof(observation->'weight') is distinct from 'number' or (observation->>'weight')::numeric<=0 then return false;end if;
  if cardinality(seen)>0 and observation->>'period'<=seen[cardinality(seen)] then return false;end if;
  seen:=array_append(seen,observation->>'period');
  select count(*),jsonb_agg(h)->0 into n,history from jsonb_array_elements(eligible)h where h->>'period'=observation->>'period';
  if n<>1 or nullif(history->>'closeVersionId','') is null or nullif(history->>'sourceHash','') is null then return false;end if;
  select count(*),jsonb_agg(l)->0 into n,actual_line from jsonb_array_elements(coalesce(history->'lines','[]'))l where l->>'accountCode'=code;
  if n<>1 or actual_line->'actual' is distinct from observation->'actual' then return false;end if;
  select value into baseline_line from jsonb_array_elements(history->'baseline'->'lines')l where l->>'accountCode'=code;
  select coalesce((config->'recommendationWeights'->>(h->>'period'))::numeric,ordinal) into expected_weight from jsonb_array_elements(eligible) with ordinality q(h,ordinal) where h->>'period'=observation->>'period';
  if retained then expected_weight:=(observation->>'weight')::numeric;end if; -- Exact prior server-validated driver binds the frozen accepted weights.
  if observation->'weight' is distinct from to_jsonb(expected_weight) then return false;end if;
  if jsonb_typeof(observation->'sourceRows') is distinct from 'array' or jsonb_array_length(observation->'sourceRows')<>1 then return false;end if;source_row:=observation->'sourceRows'->0;
  if source_row->>'accountCode' is distinct from code or source_row->'actual' is distinct from actual_line->'actual' or source_row->>'versionId' is distinct from history->>'closeVersionId' or source_row->>'sourceHash' is distinct from history->>'sourceHash' then return false;end if;
  if source_row->'baseline' is distinct from baseline_line->'amount' or source_row->'baselineLineage' is distinct from jsonb_build_object('sourceType',history->'baseline'->'sourceType','versionId',history->'baseline'->'versionId','publicationId',coalesce(history->'baseline'->'publicationId','null'),'contentHash',history->'baseline'->'contentHash') then return false;end if;
  weighted:=weighted+(observation->>'actual')::numeric*(observation->>'weight')::numeric;weight_total:=weight_total+(observation->>'weight')::numeric;
 end loop;
 if cardinality(seen)<3 or cardinality(seen)<>eligible_count or (not retained and decision->>'cutoff' is distinct from source->'actuals'->>'cutoffPeriod') or (retained and decision->>'cutoff'>source->'actuals'->>'cutoffPeriod') or driver->'evidence'->'sampleCount' is distinct from to_jsonb(cardinality(seen)) or driver->'evidence'->'totalWeight' is distinct from to_jsonb(weight_total) then return false;end if;
 proposed:=round(weighted/weight_total,2);
 return review->'proposedValue'=to_jsonb(proposed);
 exception when invalid_text_representation or numeric_value_out_of_range or division_by_zero then return false;
end;$$;
revoke all on function atlas_private.reviewed_forecast_recommendation(jsonb,jsonb,jsonb) from public,anon,authenticated;
create function atlas_private.reforecast_reviewed_null_parent(line jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(line->'forecast'='null'::jsonb and line->>'legitimateBlank'='true' and line->>'isBlank'='true'
 and nullif(line->'source'->>'auditId','') is not null
 and ((line->>'disposition'='workbook_blank' and line->'source'->>'kind'='workbook_import')
 or (line->>'disposition'='reviewed_forecast_blank' and line->>'reviewedForecastBlankConfirmed'='true' and line->'source'->>'kind'='reviewed_forecast_blank' and line->'source'->>'workbookSourceAbsent'='true' and line->'source'->'review'->>'confirmed'='true')),false)
$$;
revoke all on function atlas_private.reforecast_reviewed_null_parent(jsonb) from public,anon,authenticated;
-- Only the lifecycle's already locked prior revision can authorize inert import
-- evidence or a retained recommendation review. Caller payload markers are ignored.
create function atlas_private.reviewed_forecast_save_source(cid uuid,config jsonb,previous_config jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare active_config jsonb;source jsonb;over jsonb;driver jsonb;prior_driver jsonb;inert jsonb:='[]';retained jsonb:='[]';locked text[]:='{}';mapping_hash text;
begin
 config:=atlas_private.expand_reforecast_mapping_references(cid,config);
 previous_config:=atlas_private.expand_reforecast_mapping_references(cid,previous_config);
 active_config:=config;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v) then
  select coalesce(array_agg(p),'{}') into locked from (select distinct v->>'period' p from jsonb_array_elements(coalesce(config->'overrides','[]'))v)s where atlas_private.reforecast_month_locked(cid,p);
  if cardinality(locked)>0 then mapping_hash:=encode(sha256(convert_to((config->'importMapping')::text,'UTF8')),'hex');end if;
  for over in select value from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'period'=any(locked) loop
   if ((config->'importMapping'->'workbookSourcePolicy' ? 'reviewedForecastBlanks' and config->'importMapping'=previous_config->'importMapping' and config->>'uploadId'=previous_config->>'uploadId' and over->>'uploadId'=config->>'uploadId' and nullif(over->>'sourceLineId','') is not null) or (over->'source'->>'kind'='user' and over->'source'->>'workbookSourceAbsent'='true' and over->'source'->'reviewedForecastBlank'->>'kind'='reviewed_forecast_blank')) and exists(select 1 from jsonb_array_elements(coalesce(previous_config->'overrides','[]'))old where old=over) then
    inert:=inert||jsonb_build_array(jsonb_build_object('uploadId',over->'uploadId','sourceLineId',over->'sourceLineId','period',over->'period','accountCode',over->'accountCode','mappingHash',mapping_hash));
   end if;
  end loop;
  if jsonb_array_length(inert)>0 then
  select jsonb_set(active_config,'{overrides}',coalesce(jsonb_agg(v),'[]')) into active_config from jsonb_array_elements(coalesce(config->'overrides','[]'))v where not exists(select 1 from jsonb_array_elements(inert)i where i->>'accountCode'=v->>'accountCode' and i->>'period'=v->>'period');
  end if;
 end if;
 -- Same pinned wrapper implementation, with the temporary active override view
 -- only for its locked-input check. Attach the complete original evidence once.
 source:=atlas_private.reforecast_source_before_workbook_blanks(cid,active_config);
 source:=atlas_private.attach_reforecast_workbook_context(source,config);
 for driver in select value from jsonb_array_elements(coalesce(config->'drivers','[]'))v where v->>'type'='historical_weighted_amount' loop
  select value into prior_driver from jsonb_array_elements(coalesce(previous_config->'drivers','[]'))v where v->>'id'=driver->>'id';
  if driver-'periods'=prior_driver-'periods' and jsonb_typeof(driver->'periods')='array' and not exists(select 1 from jsonb_array_elements_text(driver->'periods')p where not(prior_driver->'periods' ? p)) then
   retained:=retained||to_jsonb(encode(sha256(convert_to((driver-'periods')::text,'UTF8')),'hex'));
  end if;
 end loop;
 if jsonb_array_length(inert)>0 then source:=source||jsonb_build_object('retainedClosedWorkbookCells',inert);end if;
 if jsonb_array_length(retained)>0 then source:=source||jsonb_build_object('retainedReviewedForecastRecommendationBindings',retained);end if;
 -- These server-derived validation bindings are not new canonical evidence.
 -- Keep the canonical sourceVersion stable for an unchanged ready/submit action;
 -- the persisted revision still hashes the complete source including bindings.
 return source;
end;$$;
revoke all on function atlas_private.reviewed_forecast_save_source(uuid,jsonb,jsonb) from public,anon,authenticated;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.attach_reforecast_workbook_context(jsonb,jsonb)','5922c742c3f35869b17bf551580197a49b38e56e7468d96dadb9441e5226d10e');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$coverage jsonb;proofs jsonb;$before$,$after$coverage jsonb;proofs jsonb;reviewed jsonb;$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$ excluded:=atlas_private.resolve_reforecast_workbook_scope(source,config);$before$,$after$ excluded:=atlas_private.resolve_reforecast_workbook_scope(source,config);
 reviewed:=atlas_private.resolve_reforecast_reviewed_forecast_blanks(source,config);$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$source,config,cells||excluded);$before$,$after$source,config,cells||excluded||reviewed);$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$jsonb_array_length(imported)=0 and coverage is null$before$,$after$jsonb_array_length(imported)=0 and jsonb_array_length(reviewed)=0 and coverage is null$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$ return (source-'sourceVersion')$before$,$after$ if config->'importMapping'->'workbookSourcePolicy' ? 'reviewedForecastBlanks' then source:=source||jsonb_build_object('workbookReviewedForecastBlankCells',reviewed);end if;
 return (source-'sourceVersion')$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_workbook_relationship_proof(jsonb,jsonb)','5d9c88644bb21f56ca6becb08db2ec4b879ca4f2c89276c0ae1f8ada985890c3');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$coalesce(source->'workbookOutsideScopeCells','[]')$before$,$after$coalesce(source->'workbookOutsideScopeCells','[]')||coalesce(source->'workbookReviewedForecastBlankCells','[]')$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_workbook_predicate_mapping(jsonb)','7a8709b8ada037cbaeb1fba980a28930f64e82630290384a552aae93899cf383');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$-'outsideForecastScope'$before$,$after$-'outsideForecastScope'-'reviewedForecastBlanks'$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.calculate_reforecast(jsonb,jsonb)','645e4c0cee61d92b90079776bb5ce76d18a7dbd9c9bef0bb3f351f2d0cef44d0');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$ source:=source||jsonb_build_object('workbookForecastIndex',base_index);$before$,$after$ select base_index||coalesce(jsonb_object_agg(jsonb_build_array(c->>'period',c->>'accountCode')::text,c),'{}') into base_index from jsonb_array_elements(coalesce(source->'workbookReviewedForecastBlankCells','[]'))c;
 source:=source||jsonb_build_object('workbookForecastIndex',base_index);$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$   if base_cell is not null then line:=line||jsonb_build_object('workbookSourceAmount'$before$,$after$   if base_cell->>'disposition'='reviewed_forecast_blank' then
    manual:=atlas_private.reviewed_forecast_user_override(over,base_cell,(source->>'communityId')::uuid);
    if over is not null and not manual then raise exception 'A reviewed forecast blank value requires an explicit reviewed user origin';end if;
    if driven and not manual and not atlas_private.reviewed_forecast_recommendation(source,config,base_cell) then raise exception 'Accept a governed historical recommendation explicitly before filling a reviewed forecast blank';end if;
    line:=line||jsonb_build_object('reviewedForecastBlankConfirmed',true,'sourceScopeExclusionConfirmed',false);
   end if;
   if base_cell is not null then line:=line||jsonb_build_object('workbookSourceAmount'$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$'workbookSourceDisposition',coalesce(base_cell->>'disposition','included')$before$,$after$'workbookSourceDisposition',case when base_cell->>'disposition'='reviewed_forecast_blank' then 'source_absent' else coalesce(base_cell->>'disposition','included') end$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$   if base_cell is not null and (manual or driven) then$before$,$after$   if base_cell is not null and (manual or driven) and not coalesce(base_cell->>'disposition'='reviewed_forecast_blank' and over->'amount'='null'::jsonb,false) then$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$    if manual then line:=line||jsonb_build_object('source',coalesce(over->'source',jsonb_build_object('kind','reviewed_manual_override','ownerId',over->'ownerId','reviewedAt',over->'reviewedAt','reason',over->'reason')));end if;$before$,$after$    if manual then line:=line||jsonb_build_object('source',coalesce(over->'source',jsonb_build_object('kind','reviewed_manual_override','ownerId',over->'ownerId','reviewedAt',over->'reviewedAt','reason',over->'reason')));elsif base_cell->>'disposition'='reviewed_forecast_blank' then line:=line||jsonb_build_object('source',jsonb_build_object('kind','user','method','accepted_recommendation','workbookSourceAbsent',true,'reviewedForecastBlank',base_cell->'source','acceptance',(select d->'recommendationReview' from jsonb_array_elements(config->'drivers')d where d->'accountCodes' ? (line->>'accountCode') and d->'periods' ? (line->>'period'))));end if;$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$    if manual then line:=line||jsonb_build_object$before$,$after$    if base_cell->>'disposition'='reviewed_forecast_blank' then line:=line||jsonb_build_object('reviewedForecastBlankConfirmed',false);end if;
    if manual then line:=line||jsonb_build_object$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$   elsif base_cell->>'disposition'='outside_forecast_scope' then$before$,$after$   elsif base_cell->>'disposition'='reviewed_forecast_blank' then
    line:=line||jsonb_build_object('forecast',null,'disposition','reviewed_forecast_blank','isBlank',true,'legitimateBlank',true,'reviewedForecastBlankConfirmed',true,'sourceScopeExclusionConfirmed',false,'source',base_cell->'source');
   elsif base_cell->>'disposition'='outside_forecast_scope' then$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$l->>'disposition'='workbook_blank' and l->>'legitimateBlank'='true'$before$,$after$l->>'disposition' in ('workbook_blank','reviewed_forecast_blank') and l->>'legitimateBlank'='true'$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$l->>'legitimateBlank'='true' and l->>'disposition'='workbook_blank'$before$,$after$l->>'legitimateBlank'='true' and l->>'disposition' in ('workbook_blank','reviewed_forecast_blank')$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_workbook_metric(jsonb,boolean,boolean)','a2c35124d068dc44cfb314ed3442a2114dc2597a654bef2df252619f04e7ca54');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$row->>'legitimateBlank'='true' and row->>'disposition'='workbook_blank'$before$,$after$row->>'legitimateBlank'='true' and row->>'disposition' in ('workbook_blank','reviewed_forecast_blank')$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_workbook_coverage(jsonb)','4521c4fbd18d8fd2e346d2b045341170946172d56864fa85c5244b551c1c8c75');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$'sourceAbsentCellCount'$before$,$after$'reviewedForecastBlankCellCount',count(*) filter(where v->>'disposition'='reviewed_forecast_blank' and v->>'reviewedForecastBlankConfirmed'='true' and v->'forecast'='null'::jsonb),
 'sourceAbsentCellCount'$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_report_snapshot(jsonb)','348c07df33aaa8e44e054a306d29fab8c7a754f3b9eae33ca51f4d10dd250e30');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$array['disposition','isBlank','legitimateBlank','sourceScopeExclusionConfirmed'$before$,$after$array['disposition','isBlank','legitimateBlank','reviewedForecastBlankConfirmed','sourceScopeExclusionConfirmed'$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.save_reforecast_builder(uuid,uuid,integer,uuid,text,jsonb)','12668c5c09b4da1e6111497e59fc49775222f633e6ebca47607200dda8084745');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$ source:=atlas_private.reforecast_source_for_config(p_community_id,config);$before$,$after$ source:=atlas_private.reviewed_forecast_save_source(p_community_id,config,prior.payload);$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$ snapshot:=atlas_private.calculate_reforecast(source,config);$before$,$after$ perform atlas_private.validate_reviewed_forecast_blank_edit(source,config,prior.payload,prior.snapshot);
 snapshot:=atlas_private.calculate_reforecast(source,config);$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb)','2c6c0f4680b2dc479951433a76139d42e0dc9a01a0dbbe32721cd29408f53e99');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$   if b->>'disposition' in ('workbook_blank','outside_forecast_scope')$before$,$after$   if coalesce(b->'workbookSource',b->'source')->>'kind'='reviewed_forecast_blank' then
    if line->>'sourceKind' in ('forecast','inherited_locked') then line:=line||atlas_private.reforecast_report_fields(b,array['disposition','isBlank','legitimateBlank','reviewedForecastBlankConfirmed','sourceScopeExclusionConfirmed','workbookSourceAmount','workbookSourceDisposition','workbookSource']);if b->>'disposition'='reviewed_forecast_blank' then line:=line||jsonb_build_object('source',coalesce(b->'workbookSource',b->'source'->'priorSource',b->'source'));end if;
    else line:=line||jsonb_build_object('legitimateBlank',false);end if;
   end if;
   if b->>'disposition' in ('workbook_blank','outside_forecast_scope')$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$'legitimateBlank',over->>'disposition'='workbook_blank'$before$,$after$'legitimateBlank',over->>'disposition' in ('workbook_blank','reviewed_forecast_blank')$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$    affected:=affected+1;before_value:=(line->>'forecast')::numeric;$before$,$after$    if line->'forecast'='null'::jsonb and line->>'reviewedForecastBlankConfirmed'='true' and not atlas_private.reviewed_forecast_recommendation(source,config,jsonb_build_object('period',p,'accountCode',code)) then raise exception 'Inherited reviewed forecast blank requires an explicitly accepted governed recommendation';end if;
    affected:=affected+1;before_value:=(line->>'forecast')::numeric;$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$  state:=jsonb_set(state,array[k],line,true);
 end loop;
 select coalesce(jsonb_agg(v||$before$,$after$  if coalesce(line->'workbookSource',line->'source')->>'kind'='reviewed_forecast_blank' and not atlas_private.reforecast_workbook_policy(binding->'importMapping') and over->'source'->>'kind' is distinct from 'str_schedule' then
   if not atlas_private.reviewed_forecast_user_override(over,jsonb_build_object('disposition','reviewed_forecast_blank','source',coalesce(line->'workbookSource',line->'source')),(source->>'communityId')::uuid) then raise exception 'Inherited reviewed forecast blank edit requires explicit user review and source lineage';end if;
   line:=line||jsonb_build_object('disposition',case when over->'amount'='null'::jsonb then 'reviewed_forecast_blank' else 'reviewer_override' end,'isBlank',over->'amount'='null'::jsonb,'legitimateBlank',over->'amount'='null'::jsonb,'reviewedForecastBlankConfirmed',over->'amount'='null'::jsonb,'source',case when over->'amount'='null'::jsonb then coalesce(line->'workbookSource',line->'source') else over->'source' end);
  end if;
  if line->>'disposition' in ('workbook_blank','reviewed_forecast_blank') and jsonb_typeof(line->'forecast')='number' and over->'source'->>'kind'='str_schedule' then line:=line||jsonb_build_object('disposition','reviewer_override','isBlank',false,'legitimateBlank',false,'reviewedForecastBlankConfirmed',false,'source',over->'source');end if;
  state:=jsonb_set(state,array[k],line,true);
 end loop;
 select coalesce(jsonb_agg(v||$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$v->>'disposition'='workbook_blank' and v->>'legitimateBlank'='true'$before$,$after$v->>'disposition' in ('workbook_blank','reviewed_forecast_blank') and v->>'legitimateBlank'='true'$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_noncash_metrics(jsonb,jsonb,text,boolean)','220cdbc56ffd0199e5d6ef8f928653069938aa2e05144e85274d54bf815b685b');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$row->>'disposition'='workbook_blank' and row->>'legitimateBlank'='true'$before$,$after$row->>'disposition' in ('workbook_blank','reviewed_forecast_blank') and row->>'legitimateBlank'='true'$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.save_reforecast_str_json_source(uuid,uuid,jsonb,jsonb)','3a919a3d84aa029b281c21afc318d896826c819262ba472f0d050a04d3cc53b2');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$n=1 and jsonb_typeof(base->'forecast') is distinct from 'number'$before$,$after$n=1 and jsonb_typeof(base->'forecast') is distinct from 'number' and not atlas_private.reforecast_reviewed_null_parent(base)$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$  combined:=case when absent then$before$,$after$  combined:=case when absent or atlas_private.reforecast_reviewed_null_parent(base) then$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$'parentDisposition',case when absent then 'no_parent_publication_row' else 'existing_parent_cell' end$before$,$after$'parentDisposition',case when absent then 'no_parent_publication_row' when atlas_private.reforecast_reviewed_null_parent(base) then base->>'disposition' else 'existing_parent_cell' end$after$);
 execute d;
end;$migration$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_overlay_snapshot_guard()','87a8d72ec39686c01a43007ed472c849b2027cb7fefe8c76355842899127de8b');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$'strContribution',case when b is null and saved then (v->>'forecast')::numeric else (v->>'forecast')::numeric-(b->>'forecast')::numeric end$before$,$after$'strContribution',case when atlas_private.reforecast_reviewed_null_parent(b) and v->'forecast'='null'::jsonb then 0 when atlas_private.reforecast_reviewed_null_parent(b) and saved then (select (c->>'amount')::numeric from jsonb_array_elements(receipt->'review'->'cells')c where c->>'period'=v->>'period' and c->>'accountCode'=v->>'accountCode' and c->'combinedForecast'=v->'forecast') when b is null and saved then (v->>'forecast')::numeric else (v->>'forecast')::numeric-(b->>'forecast')::numeric end$after$);
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$'parentDisposition',case when b is null then 'no_parent_publication_row' else 'existing_parent_cell' end$before$,$after$'parentDisposition',case when b is null then 'no_parent_publication_row' when atlas_private.reforecast_reviewed_null_parent(b) then b->>'disposition' else 'existing_parent_cell' end$after$);
 execute d;
end;$migration$;
do $$begin perform atlas_private.forecast_blank_required_definition('atlas_private.reforecast_source_for_config(uuid,jsonb)','1c2de8f47211af9d5a9950d9f427268b7e99e9c3a8d7035351e77055f76ddc96');end;$$;
do $migration$
declare d text;
begin
 d:=atlas_private.forecast_blank_required_definition('atlas_private.reforecast_import_issues(jsonb,jsonb)','10632c8d0ddf98f17ec7829881984b603d620f2c1add89f5e9010397f3a4a2c0');
 d:=atlas_private.forecast_blank_required_rewrite(d,$before$   and line->>'period'<=source->'actuals'->>'cutoffPeriod' then$before$,$after$   and line->>'period'<=source->'actuals'->>'cutoffPeriod' and not exists(select 1 from jsonb_array_elements(coalesce(source->'retainedClosedWorkbookCells','[]'))i where i->>'uploadId'=config->>'uploadId' and i->>'sourceLineId'=line->>'id' and i->>'period'=line->>'period' and i->>'mappingHash'=encode(sha256(convert_to(mapping::text,'UTF8')),'hex')) then$after$);
 execute d;
end;$migration$;
do $migration$declare d text;begin d:=atlas_private.forecast_blank_required_definition('public.atlas_publish_reforecast(uuid,integer,uuid,text)','9618801e1856067cb4d60706e639434dced7975c4fa04a84541056097ffd91bf');
d:=atlas_private.forecast_blank_required_rewrite(d,$before$ source:=atlas_private.reforecast_source_for_config(rec.community_id,rec.payload);$before$,$after$ source:=atlas_private.reviewed_forecast_save_source(rec.community_id,rec.payload,rec.payload);$after$);execute d;end;$migration$;
drop function atlas_private.forecast_blank_required_rewrite(text,text,text);
drop function atlas_private.forecast_blank_required_definition(text,text);
commit;
