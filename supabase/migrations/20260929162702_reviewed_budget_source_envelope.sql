-- Keep reviewed workbook saves and current-source reads on the same governed
-- tolerance envelope. Historical revisions, source hashes and receipts stay
-- immutable; only a new read/save resolves the current tolerance version.
begin;
create function atlas_private.budget_source_required_rewrite(body text,old_text text,new_text text)
returns text language plpgsql immutable set search_path='' as $$begin
 if length(body)-length(replace(body,old_text,''))<>length(old_text) then raise exception 'Budget source rewrite prerequisite differs at %',left(old_text,100);end if;
 return replace(body,old_text,new_text);
end;$$;
revoke all on function atlas_private.budget_source_required_rewrite(text,text,text) from public,anon,authenticated;
create function atlas_private.budget_source_tolerance_envelope(cid uuid,source jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare tolerance jsonb;
begin
 if jsonb_typeof(source) is distinct from 'object' or source->>'communityId' is distinct from cid::text then raise exception 'Budget source community binding required';end if;
 tolerance:=atlas_private.budget_export_tolerances(cid);
 source:=source||jsonb_build_object('driverToleranceSettings',tolerance->'rules','driverToleranceVersion',tolerance->'versionId');
 -- These two existing server-derived fields authorize retained closed inputs
 -- and prior accepted recommendations. Preserve them in the full source, but
 -- exclude them from canonical identity exactly as the reviewed save did.
 return source||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion'-'retainedClosedWorkbookCells'-'retainedReviewedForecastRecommendationBindings')::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.budget_source_tolerance_envelope(uuid,jsonb) from public,anon,authenticated;
do $acl$begin
 if exists(select 1 from pg_roles where rolname='service_role') then execute 'revoke all on function atlas_private.budget_source_tolerance_envelope(uuid,jsonb) from service_role';end if;
end;$acl$;

-- Rewrite only the source-envelope edges. Keep source reconstruction, exact
-- workbook/closed-cell validation, authorization, ACLs and function settings.
do $upgrade$
declare definition text;anchor text;replacement text;prerequisite record;body text;
begin
 for prerequisite in select * from (values
  ('atlas_private.preview_str_budget_application(jsonb)','1fa70434c242131ba600485794baaa1230fc3f75f8b893a3f89ca11622d5ebf3'),
  ('atlas_private.reforecast_source_for_config(uuid,jsonb)','821ea0f7b558e9e7bf69e3c3bea35cb2de774350a71892fa6ac977d69174c063'),
  ('atlas_private.reviewed_forecast_save_source(uuid,jsonb,jsonb)','60efff49ae36eb5880e183a0d7d660013b0149deb2f4799fb1120b327243fa41'))expected(signature,body_hash) loop
  select prosrc into body from pg_proc where oid=to_regprocedure(prerequisite.signature);
  if encode(sha256(convert_to(body,'UTF8')),'hex') is distinct from prerequisite.body_hash then raise exception 'Budget source prerequisite differs: %',prerequisite.signature;end if;
 end loop;
 select pg_get_functiondef('atlas_private.reforecast_source_for_config(uuid,jsonb)'::regprocedure) into definition;
 anchor:=$before$ source:=atlas_private.reforecast_source_before_budget_tolerances(cid,config);tolerance:=atlas_private.budget_export_tolerances(cid);
 source:=source||jsonb_build_object('driverToleranceSettings',tolerance->'rules','driverToleranceVersion',tolerance->'versionId');
 return source||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion')::text,'UTF8')),'hex'));$before$;
 replacement:=$after$ source:=atlas_private.reforecast_source_before_budget_tolerances(cid,config);
 return atlas_private.budget_source_tolerance_envelope(cid,source);$after$;
 execute atlas_private.budget_source_required_rewrite(definition,anchor,replacement);

 select pg_get_functiondef('atlas_private.reviewed_forecast_save_source(uuid,jsonb,jsonb)'::regprocedure) into definition;
 if strpos(definition,'atlas_private.reforecast_source_before_workbook_blanks(cid,active_config)')=0 or strpos(definition,'retainedReviewedForecastRecommendationBindings')=0 or strpos(definition,'retainedClosedWorkbookCells')=0 then raise exception 'Reviewed budget source prerequisite differs';end if;
 execute atlas_private.budget_source_required_rewrite(definition,' return source;', ' return atlas_private.budget_source_tolerance_envelope(cid,source);');

 select pg_get_functiondef('atlas_private.preview_str_budget_application(jsonb)'::regprocedure) into definition;
 execute atlas_private.budget_source_required_rewrite(definition,
  'config:=target.payload;source:=atlas_private.reforecast_source_for_config(cid,config);',
  'config:=target.payload;source:=atlas_private.reviewed_forecast_save_source(cid,config,target.payload);');
end;$upgrade$;
drop function atlas_private.budget_source_required_rewrite(text,text,text);
commit;
