-- Budget imports remain evidence; new original approvals require full workbook and planning review.
-- Retained approved versions and exact previously committed request retries remain readable.
begin;
alter function atlas_private.approve_original_budget_validated(uuid,jsonb) rename to approve_original_budget_pre_workbook;
create function atlas_private.approve_original_budget_validated(p_community_id uuid,p_payload jsonb) returns public.atlas_approved_budget_versions language plpgsql security definer set search_path='' as $$
declare g jsonb:=p_payload->'governance';mapping jsonb;upload jsonb;registry jsonb;source jsonb;config jsonb;issues jsonb;periods jsonb;line jsonb;account jsonb;review jsonb;r jsonb;cell jsonb;expected jsonb;period text;month integer;matches integer;amount numeric;selected_count integer:=0;required_count integer;id text;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role='admin' and status='active') or not atlas_private.command_access(p_community_id,'finance') then raise exception 'Only an active scoped Admin may approve an original budget';end if;
 if p_payload->>'sourceHashKind' is distinct from 'workbook_bytes' or g->>'schemaVersion' is distinct from 'atlas-original-budget-workbook/1' or g->>'uploadId' is null then raise exception 'Complete immutable workbook intake is required. Browser-normalized rows cannot approve an original budget';end if;
 select payload into upload from public.atlas_reforecast_uploads where upload_id::text=g->>'uploadId' and community_id=p_community_id;
 if upload is null or upload->'source'->>'sha256' is distinct from p_payload->>'sourceHash' or upload->'source'->>'fileName' is distinct from p_payload->>'sourceFile' or upload->'propertyAssignment'->>'communityId' is distinct from p_community_id::text then raise exception 'Original budget source must match its immutable authorized workbook upload';end if;
 mapping:=g->'mapping';
 if mapping->>'currency' is distinct from 'USD' or p_payload->>'currency' is distinct from 'USD' then raise exception 'This canonical financial adapter currently supports USD. Other currencies require an explicitly governed conversion before approval';end if;
 if mapping->>'reviewedBy' is distinct from auth.uid()::text or mapping->'calendar'->>'reviewedBy' is distinct from auth.uid()::text then raise exception 'Original budget mapping and calendar confirmation must identify the approving Admin';end if;
 for review in select v from jsonb_array_elements(coalesce(mapping->'inputReviews','[]')||coalesce(mapping->'integrityReviews','[]')||coalesce(mapping->'rowDispositions','[]'))v loop if review->>'ownerId' is distinct from auth.uid()::text then raise exception 'Review original budget source cells and findings as the approving Admin before approval';end if;end loop;
 select jsonb_agg((p_payload->>'year')||'-'||lpad((v::integer+1)::text,2,'0') order by v::integer) into periods from jsonb_array_elements_text(p_payload->'coverage')v;
 if mapping->'periods' is distinct from periods or mapping->'calendar'->>'startMonth' is distinct from p_payload->>'fiscalStartMonth' or mapping->'propertyAssignment'->>'communityId' is distinct from p_community_id::text then raise exception 'Approved fiscal segment must exactly match the explicitly reviewed workbook calendar and community';end if;
 select payload||jsonb_build_object('version',version_id) into registry from public.atlas_reforecast_registries where version_id::text=mapping->>'version' and community_id=p_community_id;
 if registry is null then raise exception 'Original budget requires a reviewed canonical account registry';end if;
 source:=jsonb_build_object('communityId',p_community_id,'periods',periods,'registry',registry,'actuals',jsonb_build_object('cutoffPeriod',null));
 config:=jsonb_build_object('name',mapping->>'sourceScenario','governanceSchemaVersion',2,'calendar',mapping->'calendar','periods',periods,'uploadId',g->'uploadId','importMapping',mapping,'importIssues',coalesce(g->'issues','[]'),'overrides','[]'::jsonb);
 issues:=atlas_private.reforecast_planning_issues(source,config)||atlas_private.reforecast_import_issues(source,config);
 if jsonb_array_length(issues)>0 then raise exception 'Original budget workbook review is blocked: %',left(issues::text,1200);end if;
 -- Every approved month/account value must be reproduced by exactly one selected source cell and reviewed sign.
 for r in select v from jsonb_array_elements(p_payload->'rows')v loop
  for month in select value::integer from jsonb_array_elements_text(p_payload->'coverage') loop
   period:=(p_payload->>'year')||'-'||lpad((month+1)::text,2,'0');matches:=0;
   for line in select v from jsonb_array_elements(upload->'lines')v where mapping->'selectedLineIds' ? (v->>'id') and v->>'scenario'=mapping->>'sourceScenario' and v->>'period'=period loop
    select m into account from jsonb_array_elements(mapping->'accountMappings')m where m->>'sourceAccountCode'=line->>'accountCode' and m->>'accountCode'=r->>'glCode' and (m->>'sheet' is null or m->>'sheet'=line->>'sheet') and (m->>'department' is null or m->>'department'=line->>'department');if account is null then continue;end if;
    if line->>'sourceKind'='workbook_actual_evidence' then raise exception 'Workbook Actual columns cannot establish the approved original budget';end if;
    matches:=matches+1;selected_count:=selected_count+1;amount:=(line->>'amount')::numeric*(account->>'signMultiplier')::numeric;cell:=r->'sourceCells'->month::text;
    if r->'monthly'->month is distinct from to_jsonb(amount) or cell->>'sourceLineId' is distinct from line->>'id' or cell->>'sheet' is distinct from line->>'sheet' or cell->>'address' is distinct from line->>'address' or cell->>'signMultiplier' is distinct from account->>'signMultiplier' or r->>'nature' is distinct from account->>'nature' or r->>'placement' is distinct from account->>'placement' then raise exception 'Approved budget amount, classification, sign or coordinates differ from the reviewed source';end if;
   end loop;
   if matches<>1 then raise exception 'Every approved GL/month requires exactly one reviewed workbook cell';end if;
  end loop;
 end loop;
 select count(*) into required_count from jsonb_array_elements(upload->'lines')v where mapping->'selectedLineIds' ? (v->>'id') and v->>'scenario'=mapping->>'sourceScenario' and periods ? (v->>'period');
 if required_count<>selected_count then raise exception 'Selected budget source cells were omitted or duplicated in approved rows';end if;
 return atlas_private.approve_original_budget_pre_workbook(p_community_id,p_payload);
end;$$;
revoke all on function atlas_private.approve_original_budget_pre_workbook(uuid,jsonb),atlas_private.approve_original_budget_validated(uuid,jsonb) from public,anon,authenticated;
commit;
