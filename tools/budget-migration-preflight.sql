-- Read-only production preflight before the governed lifecycle migration.
-- Every row must be ready=true. A false result requires definition review;
-- do not weaken the migration's required-anchor guard or mark it applied.
with checks(signature,control,anchors) as (values
 ('public.atlas_save_reforecast_registry(uuid,uuid,uuid,jsonb)','registry review authority',array[$a$atlas_private.reforecast_access(p_community_id,'approve')$a$]),
 ('public.atlas_read_reforecast_publication(uuid)','published state validation',array[$a$rec.status<>'locked'$a$]),
 ('public.atlas_read_reforecast_publication(uuid)','investor status evidence',array[$a$'status','approved_locked',$a$]),
 ('atlas_private.read_reforecast_save_receipt(uuid,uuid)','investor receipt linkage',array[$a$select * into head from public.atlas_reforecast_heads where scenario_id=r.scenario_id;$a$]),
 ('atlas_private.read_reforecast_save_receipt(uuid,uuid)','receipt permissions',array[$a$'currentHead',to_jsonb(head),'revision'$a$]),
 ('atlas_private.save_reforecast_registry_pre_builder(uuid,uuid,uuid,jsonb)','retained registry authority',array[$a$reforecast_access(p_community_id,'approve')$a$]),
 ('public.atlas_review_reforecast_source(uuid,uuid,jsonb)','source review authority',array[$a$reforecast_access(u.community_id,'approve')$a$]),
 ('atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)','initial workbook import',array[$a$if coalesce(p_payload->>'baselineType','original_budget') not in ('original_budget','approved_reforecast') or jsonb_array_length(coalesce(p_payload->'baselineVersionIds','[]'))=0 then$a$]),
 ('atlas_private.calculate_reforecast(jsonb,jsonb)','initial workbook baseline',array[$a$if jsonb_array_length(source->'baseline'->'versionIds')=0 then$a$]),
 ('atlas_private.calculate_reforecast(jsonb,jsonb)','blank source lineage',array[$a$'selectedBaseline',base,'baselineDisposition'$a$]),
 ('atlas_private.calculate_reforecast(jsonb,jsonb)','blank forecast value',array[$a$line->>'sourceKind'='forecast' and line->>'forecast' is null then$a$]),
 ('atlas_private.reforecast_metric(jsonb,text)','blank metric semantics',array[$a$count(*) filter(where v->>field is null)$a$]),
 ('public.atlas_reforecast_effective_baseline(uuid[],text[])','blank baseline semantics',array[$a$jsonb_typeof(v->'amount') is distinct from 'number' or v->>'mappingValid'$a$]),
 ('public.atlas_read_reforecast_publication(uuid)','report recommendation evidence',array[
  $a$atlas_private.reforecast_report_fields(v,array['period','accountCode','originalValue','originalCalculatedValue','amount','overrideValue','reason','actor','actorId','timestamp','createdAt'])$a$,
  $a$atlas_private.reforecast_report_fields(v,array['period','accountCode','originalValue','amount','overrideValue','reason','actor','actorId','timestamp','createdAt'])$a$])
), targets as (
 select *,case when signature='atlas_private.calculate_reforecast(jsonb,jsonb)'
 then coalesce(to_regprocedure('atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb)'),to_regprocedure(signature))
 else to_regprocedure(signature) end target from checks
), definitions as (
 select *,pg_get_functiondef(target) definition from targets
), results as (
 select signature,target::text as resolved_signature,control,
  coalesce((select bool_or(position(anchor in definition)>0) from unnest(anchors) anchor),false) as ready
 from definitions
 union all
 select 'atlas_private.calculate_reforecast(jsonb,jsonb)','atlas_private.calculate_reforecast(jsonb,jsonb)',
  'saved STR calculator forwarding',
  to_regprocedure('atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb)') is null
  or coalesce(position('return atlas_private.calculate_reforecast_before_saved_str(source,calculation);'
   in pg_get_functiondef(to_regprocedure('atlas_private.calculate_reforecast(jsonb,jsonb)')))>0,false)
)
select * from results order by signature,control;
