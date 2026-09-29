-- Exact captured installed function, no financial rows. Synthetic regression only.
-- Prior prosrc SHA256: bf900f53b0cee1c2475876245958c20a79d254874717ebe3503c6c84b42ab87a
CREATE OR REPLACE FUNCTION atlas_private.save_reforecast_builder(p_community_id uuid, p_scenario_id uuid, p_expected_revision integer, p_request_id uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior public.atlas_reforecast_revisions;rec public.atlas_reforecast_revisions;head public.atlas_reforecast_heads;source jsonb;snapshot jsonb;config jsonb;periods text[];budget_ids uuid[];role_name text;hash text;next_status text;person uuid;owner_id uuid;reviewer_id uuid;submitted public.atlas_reforecast_revisions;config_overrides jsonb;
begin
 if not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Reforecast edit access denied';end if;
 if p_scenario_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_action not in ('create','save_draft','edit','reconcile','ready','submit','approve','withdraw','reject','reopen','investor_approve','delete') or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2097152 then raise exception 'Invalid reforecast save request';end if;
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
 if prior.status in ('locked','investor_approved') and p_action<>'reopen' then raise exception 'Investor Approved versions are locked. Use formal Reopen with a reason';end if;
 if prior.status='deleted' then raise exception 'Deleted drafts are retained only as audit history';end if;
 if prior.status='submitted' and p_action not in ('approve','withdraw','reject') then raise exception 'Submitted revisions are immutable; withdraw or reject before editing';end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 if p_action in ('create','save_draft','edit','reconcile') then
  if prior.status in ('pending_investor_approval','approved') and p_action not in ('edit','save_draft') then raise exception 'Use Edit for a Pending Investor Approval version';end if;
  config:=p_payload;
 else
  if prior.revision_id is null then raise exception 'Save a working draft before a workflow transition';end if;
  if (p_payload-'reason'-'investorApprovalDate'-'deleteConfirmed') is distinct from (prior.payload-'reason'-'investorApprovalDate'-'deleteConfirmed') then raise exception 'Save changed inputs as a working draft before changing review status';end if;
  config:=prior.payload||jsonb_build_object('reason',p_payload->>'reason');
  if p_action='investor_approve' then config:=config||jsonb_build_object('investorApprovalDate',p_payload->>'investorApprovalDate');end if;
 end if;
 if prior.payload->>'uploadId' is not null and (config->>'uploadId' is null or jsonb_typeof(config->'importMapping') is distinct from 'object') then raise exception 'Retain the workbook provenance and reviewed mapping when editing this scenario';end if;
 if (coalesce(config->'importMapping'->'workbookSourcePolicy','null') is distinct from coalesce(prior.payload->'importMapping'->'workbookSourcePolicy','null') or coalesce(config->'importMapping'->'sourceRowExclusions','[]') is distinct from coalesce(prior.payload->'importMapping'->'sourceRowExclusions','[]')) and config->'importMapping'->>'reviewedBy' is distinct from auth.uid()::text then raise exception 'New workbook source reviews must belong to the signed-in authorized reviewer';end if;
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
 if p_action in ('withdraw','reject','reopen','investor_approve','delete') then
  rec.revision_id:=gen_random_uuid();source:=prior.source;snapshot:=prior.snapshot;
 else
 select coalesce(jsonb_agg(case when old.value is not null and v->'amount' is distinct from old.value->'amount' and v->>'sourceLineId' is not null then
 (v-'sourceLineId'-'uploadId'-'formula'-'cachedValue')||jsonb_build_object('source',jsonb_build_object('kind','manual_revision','priorImport',jsonb_build_object('uploadId',coalesce(v->>'uploadId',prior.payload->>'uploadId'),'sourceLineId',v->>'sourceLineId','priorAmount',old.value->'amount'),'previousRevisionId',prior.revision_id)) else v end),'[]') into config_overrides
 from jsonb_array_elements(coalesce(config->'overrides','[]'))v left join lateral (select value from jsonb_array_elements(coalesce(prior.payload->'overrides','[]'))o where o->>'period'=v->>'period' and o->>'accountCode'=v->>'accountCode')old on true;
 config:=jsonb_set(config,'{overrides}',config_overrides);
 source:=atlas_private.reviewed_forecast_save_source(p_community_id,config,prior.payload);
 perform atlas_private.validate_reviewed_forecast_blank_edit(source,config,prior.payload,prior.snapshot);
 snapshot:=atlas_private.calculate_reforecast(source,config);
 if config->>'uploadId' is not null or jsonb_array_length(coalesce(config->'importHistory','[]'))>0 or exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null) then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||atlas_private.reforecast_import_issues(source,config));end if;
 if owner_id is null or reviewer_id is null then snapshot:=jsonb_set(snapshot,'{diagnostics}',snapshot->'diagnostics'||jsonb_build_array(jsonb_build_object('code','ownership_required','severity','error','message','Assign an active owner and authorized reviewer.')));end if;
 snapshot:=jsonb_set(snapshot,'{completeness,blockerCount}',to_jsonb((select count(*) from jsonb_array_elements(snapshot->'diagnostics')d where d->>'severity'='error')));
 snapshot:=jsonb_set(snapshot,'{status}',to_jsonb(case when (snapshot->'completeness'->>'blockerCount')::integer>0 then 'action_required'::text else 'ready'::text end));
 rec.revision_id:=gen_random_uuid();
 snapshot:=snapshot||jsonb_build_object('identity',(snapshot->'identity')||jsonb_build_object('scenarioId',p_scenario_id,'scenarioVersion',p_expected_revision+1,'reforecastVersion',rec.revision_id));
 snapshot:=snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((snapshot-'fingerprint')::text,'UTF8')),'hex'));
 end if;
 if p_action in ('ready','submit','approve') then
  if (snapshot->'completeness'->>'blockerCount')::integer>0 then raise exception 'Resolve mapping, missing values and ownership blockers before review or approval';end if;
  if prior.source->>'sourceVersion' is distinct from source->>'sourceVersion' then raise exception 'Canonical actuals, budget or registry evidence changed. Save and reconcile the working draft before review';end if;
 end if;
 case p_action
 when 'create' then next_status:='uploaded';
 when 'save_draft','edit' then next_status:=case when prior.status in ('pending_investor_approval','approved') and role_name<>'admin' and not atlas_private.is_budget_vp(auth.uid()) then 'submitted' when source->'registry'->>'version' is null then 'mapping_required' else 'working_draft' end;
 when 'reconcile' then next_status:=case when (snapshot->'completeness'->>'blockerCount')::integer=0 then 'reconciled' when exists(select 1 from jsonb_array_elements(snapshot->'diagnostics')d where d->>'code' in ('unmapped_account','mapping_required','driver_mapping_required')) then 'mapping_required' else 'working_draft' end;
 when 'ready' then if prior.status not in ('uploaded','mapping_required','working_draft','reconciled','withdrawn','rejected','reopened') then raise exception 'Reconcile a working draft before marking ready';end if;next_status:='ready_for_review';
 when 'submit' then if prior.status not in ('uploaded','mapping_required','working_draft','reconciled','ready_for_review','withdrawn','rejected','reopened') then raise exception 'Submit an open working draft';end if;next_status:='submitted';
 when 'approve' then
  if prior.status<>'submitted' or not atlas_private.reforecast_access(p_community_id,'approve') then raise exception 'Only a verified VP-level user may approve and publish a submitted revision';end if;
  next_status:='pending_investor_approval';
 when 'withdraw' then
  select * into submitted from public.atlas_reforecast_revisions where scenario_id=p_scenario_id and status='submitted' order by revision desc limit 1;
  if prior.status<>'submitted' or submitted.actor_id<>auth.uid() then raise exception 'Only the submitter may withdraw this submitted revision';end if;
  next_status:='withdrawn';
 when 'reject' then
  if prior.status<>'submitted' or not atlas_private.reforecast_access(p_community_id,'review') then raise exception 'An authorized reviewer may reject a submitted revision';end if;
  next_status:='rejected';
 when 'reopen' then
  if prior.status not in ('locked','investor_approved') then raise exception 'Only a final locked version requires formal Reopen';end if;
  next_status:='reopened';config:=config||jsonb_build_object('reopenedFromRevisionId',prior.revision_id,'priorInvestorApprovalDate',prior.payload->'investorApprovalDate')-'investorApprovalDate';
 when 'investor_approve' then
  if prior.status<>'pending_investor_approval' or not atlas_private.reforecast_access(p_community_id,'review') then raise exception 'Investor approval requires a VP-published version and an authorized reviewer';end if;
  if coalesce(p_payload->>'investorApprovalDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p_payload->>'investorApprovalDate')::date>current_date then raise exception 'Enter the actual investor approval date';end if;
  if not exists(select 1 from public.atlas_reforecast_publications p where p.revision_id=prior.revision_id and p.snapshot=prior.snapshot) then raise exception 'Publish the exact financial revision before investor approval';end if;
  perform atlas_private.validate_reforecast_investor_source(prior.community_id,prior.scenario_id,prior.revision,prior.source,prior.payload);
  next_status:='investor_approved';config:=config||jsonb_build_object('investorPublicationId',(select publication_id from public.atlas_reforecast_publications where revision_id=prior.revision_id),'investorApprovedBy',auth.uid(),'investorApprovedAt',clock_timestamp());
 when 'delete' then
  if prior.revision_id is null or prior.status not in ('uploaded','mapping_required','working_draft','reconciled','ready_for_review','withdrawn','rejected','reopened') or p_payload->>'deleteConfirmed' is distinct from 'true' then raise exception 'Confirm deletion of an open draft';end if;
  next_status:='deleted';
 end case;
 insert into public.atlas_reforecast_revisions(revision_id,scenario_id,community_id,revision,status,action,request_id,request_hash,payload,source,snapshot,actor_id,actor_role)
 values(rec.revision_id,p_scenario_id,p_community_id,p_expected_revision+1,next_status,p_action,p_request_id,hash,config,source,snapshot,auth.uid(),role_name) returning * into rec;
 insert into public.atlas_reforecast_heads values(p_scenario_id,p_community_id,rec.revision,rec.revision_id,next_status)
 on conflict(scenario_id) do update set revision=excluded.revision,revision_id=excluded.revision_id,status=excluded.status returning * into head;
 return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',source,'snapshot',snapshot);
end;$function$;
