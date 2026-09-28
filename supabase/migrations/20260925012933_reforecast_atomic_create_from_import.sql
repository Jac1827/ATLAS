-- A retained upload is evidence. This transaction makes the reviewed relationship
-- between that evidence and a working revision durable in the same commit.
begin;
create table public.atlas_reforecast_import_receipts (
 request_id uuid primary key,
 community_id uuid not null references public.atlas_communities(community_id),
 scenario_id uuid not null,
 revision_id uuid not null unique,
 upload_id uuid not null,
 mapping_version uuid not null,
 audit_id uuid not null references public.atlas_workbook_audits(audit_id),
 expected_revision integer not null check(expected_revision>=0),
 request_hash text not null,
 receipt jsonb not null,
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(revision_id,community_id,scenario_id) references public.atlas_reforecast_revisions(revision_id,community_id,scenario_id),
 foreign key(upload_id,community_id) references public.atlas_reforecast_uploads(upload_id,community_id),
 foreign key(mapping_version,community_id) references public.atlas_reforecast_registries(version_id,community_id)
);
create index reforecast_import_receipt_community on public.atlas_reforecast_import_receipts(community_id,created_at desc);
alter table public.atlas_reforecast_import_receipts enable row level security;
revoke all on public.atlas_reforecast_import_receipts from public,anon,authenticated;
grant select on public.atlas_reforecast_import_receipts to authenticated;
create policy reforecast_import_receipt_read on public.atlas_reforecast_import_receipts for select to authenticated using(atlas_private.reforecast_access(community_id,'read'));
create trigger reforecast_import_receipt_immutable before update or delete on public.atlas_reforecast_import_receipts for each row execute function atlas_private.finance_immutable();

-- Vena's Local dimension is an explicitly reviewed reporting-currency
-- relationship, never an exchange-rate conversion or a substituted amount.
create function atlas_private.reforecast_import_currency_matches(source_currency text,mapping jsonb)
returns boolean language sql immutable set search_path='' as $$
 select source_currency is null or source_currency=mapping->>'currency' or coalesce(
  source_currency='Local' and mapping->'currencyMapping'->>'sourceCurrency'=source_currency
 and mapping->'currencyMapping'->>'reportingCurrency'=mapping->>'currency'
 and mapping->>'currency'~'^[A-Z]{3}$' and mapping->'currencyMapping'->>'method'='identity'
 and mapping->'currencyMapping'->>'confirmed'='true'
 and mapping->'currencyMapping'->>'reviewedBy'=mapping->>'reviewedBy'
 and coalesce(mapping->'currencyMapping'->>'reviewedBy','')<>''
 and coalesce(mapping->'currencyMapping'->>'reviewedAt','')~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T'
 and length(trim(coalesce(mapping->'currencyMapping'->>'reason','')))>=3,false);
$$;
revoke all on function atlas_private.reforecast_import_currency_matches(text,jsonb) from public,anon,authenticated;

create or replace function atlas_private.reforecast_import_issues_before_close_scope(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare upload jsonb;upload_lines jsonb;registry_accounts jsonb;mapping jsonb:=config->'importMapping';issues jsonb:='[]';line jsonb;m jsonb;a jsonb;over jsonb;entry jsonb;subconfig jsonb;id text;matches integer;amount numeric;cutoff text:=source->'actuals'->>'cutoffPeriod';
begin
 if jsonb_typeof(config->'importHistory')='array' and jsonb_array_length(config->'importHistory')>0 then
  if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null and coalesce(v->>'uploadId',config->>'uploadId') is distinct from config->>'uploadId' and not exists(select 1 from jsonb_array_elements(config->'importHistory')e where e->>'uploadId'=v->>'uploadId')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_upload_unreviewed','severity','error','message','Every workbook-derived override must retain its upload and reviewed import mapping.'));end if;
  for entry in select distinct on(v->>'uploadId')v from jsonb_array_elements((config->'importHistory')||jsonb_build_array(jsonb_build_object('uploadId',config->>'uploadId','mapping',config->'importMapping','issues',config->'importIssues'))) with ordinality e(v,ord) order by v->>'uploadId',ord desc loop
   if entry->>'uploadId' is null then continue;end if;
   if entry->>'uploadId'<>config->>'uploadId' and not exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'uploadId'=entry->>'uploadId') then continue;end if;
   subconfig:=(config-'importHistory')||jsonb_build_object('uploadId',entry->>'uploadId','importMapping',entry->'mapping','importIssues',coalesce(entry->'issues','[]'),'overrides',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(coalesce(config->'overrides','[]'))v where coalesce(v->>'uploadId',config->>'uploadId')=entry->>'uploadId'));
   issues:=issues||atlas_private.reforecast_import_issues(source,subconfig);
  end loop;return issues;
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null and coalesce(v->>'uploadId',config->>'uploadId') is distinct from config->>'uploadId') then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_upload_unreviewed','severity','error','message','Every workbook-derived override must retain its upload and reviewed import mapping.'));end if;
 select payload into upload from public.atlas_reforecast_uploads where upload_id=(config->>'uploadId')::uuid and community_id=(source->>'communityId')::uuid;
 select coalesce(jsonb_object_agg(l->>'id',l),'{}') into upload_lines from jsonb_array_elements(coalesce(upload->'lines','[]'))l;
 select coalesce(jsonb_object_agg(gl->>'accountCode',gl),'{}') into registry_accounts from jsonb_array_elements(coalesce(source->'registry'->'accounts','[]'))gl;
 if mapping is null or mapping->>'confirmed' is distinct from 'true' or mapping->>'version' is distinct from source->'registry'->>'version' or mapping->'propertyAssignment'->>'communityId' is distinct from source->>'communityId' or coalesce(mapping->>'sourceScenario','')='' or coalesce(mapping->>'currency','')!~'^[A-Z]{3}$' or coalesce(mapping->>'reason','')='' or jsonb_typeof(mapping->'selectedLineIds') is distinct from 'array' or jsonb_array_length(mapping->'selectedLineIds')=0 then
  return jsonb_build_array(jsonb_build_object('code','import_mapping_required','severity','error','message','Explicitly review source scenario, currency, selected cells, GL/sign mapping and community before using workbook values.'));
 end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(upload->'metadata'->'entities','[]'))e where not(coalesce(mapping->'propertyAssignment'->'sourceEntities','[]') ? e)) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_entity_required','severity','error','message','Acknowledge every source entity in the explicit property assignment.'));end if;
 if exists(select 1 from jsonb_array_elements(coalesce(upload->'lines','[]'))l cross join lateral jsonb_array_elements(coalesce(mapping->'accountMappings','[]'))map_entry where mapping->'selectedLineIds' ? (l->>'id') and (cutoff is null or l->>'period'>cutoff) and l->>'scenario'=mapping->>'sourceScenario' and map_entry->>'sourceAccountCode'=l->>'accountCode' and (map_entry->>'sheet' is null or map_entry->>'sheet'=l->>'sheet') and (map_entry->>'department' is null or map_entry->>'department'=l->>'department') group by l->>'period',map_entry->>'accountCode' having count(*)>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_duplicate_gl_period','severity','error','message','Selected workbook cells map more than once to the same GL and period. Review an explicit aggregation before approval.'));end if;
 for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop
  line:=upload_lines->id;
  if line is null or line->>'scenario' is distinct from mapping->>'sourceScenario' or not atlas_private.reforecast_import_currency_matches(line->>'currency',mapping) or not(source->'periods' ? (line->>'period')) or not(coalesce(mapping->'periods',source->'periods') ? (line->>'period')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_selection_mismatch','severity','error','message','A selected workbook cell does not match its reviewed source scope.','sourceLineId',id));continue;end if;
  if line->>'period'<=cutoff or line->>'sourceKind'='workbook_actual_evidence' then continue;end if;
  select count(*) into matches from jsonb_array_elements(mapping->'accountMappings')v where v->>'sourceAccountCode'=line->>'accountCode' and (v->>'sheet' is null or v->>'sheet'=line->>'sheet') and (v->>'department' is null or v->>'department'=line->>'department');
  if matches<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_gl_mapping','severity','error','message','Every selected open cell needs exactly one reviewed GL mapping.','sourceLineId',id));continue;end if;
  select v into m from jsonb_array_elements(mapping->'accountMappings')v where v->>'sourceAccountCode'=line->>'accountCode' and (v->>'sheet' is null or v->>'sheet'=line->>'sheet') and (v->>'department' is null or v->>'department'=line->>'department');
  a:=registry_accounts->(m->>'accountCode');
  if a is null or a->>'nature' is distinct from m->>'nature' or a->>'category' is distinct from m->>'category' or a->>'placement' is distinct from m->>'placement' or coalesce(m->>'signMultiplier','') not in ('1','-1') or a->>'effectiveFrom'>line->>'period' or a->>'retiredAfter'<line->>'period' or jsonb_typeof(line->'amount') is distinct from 'number' or line->>'cellType'='e' or line->>'periodBasis'='unconfirmed_period' or (coalesce(line->>'formula','')<>'' and (line->>'cachedValue' is null or line->>'cachedValue'='')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_value_invalid','severity','error','message','Review the selected value, sign and effective mapping.','sourceLineId',id));continue;end if;
  if exists(select 1 from jsonb_array_elements(coalesce(upload->'issues','[]'))e where e->>'sheet'=line->>'sheet' and e->>'address'=line->>'address' and e->>'code' in ('excel_error','broken_formula_reference','external_formula_reference','missing_formula_sheet','broken_named_formula_reference')) or exists(select 1 from jsonb_array_elements(coalesce(upload->'reconciliation','[]'))c where c->>'sheet'=line->>'sheet' and c->>'row'=line->>'row' and c->'periods' ? (line->>'period') and c->>'status'='mismatch') then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_source_unreconciled','severity','error','message','Repair the selected formula or monthly reconciliation before approval.','sourceLineId',id));end if;
  amount:=(line->>'amount')::numeric*(m->>'signMultiplier')::numeric;
  if ((a->>'nature'='contra_income' and amount>0) or (a->>'nature' in ('income','expense','capital','debt') and amount<0)) and m->>'allowReversal' is distinct from 'true' then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_sign_review','severity','error','message','The signed source amount requires explicit reversal review.','sourceLineId',id));end if;
  for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId'=id loop
   if over->>'period' is distinct from line->>'period' or over->>'accountCode' is distinct from m->>'accountCode' or (over->>'amount')::numeric is distinct from amount then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_override_mismatch','severity','error','message','A workbook-derived override does not match its retained source; record manual changes as a separate audited override.','sourceLineId',id));end if;
  end loop;
 end loop;
 for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'sourceLineId' is not null loop
  if not(mapping->'selectedLineIds' ? (over->>'sourceLineId')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_override_unselected','severity','error','message','A workbook override references an unselected source cell.'));end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'importIssues','[]'))e where e->>'severity'='error') then issues:=issues||jsonb_build_array(jsonb_build_object('code','import_review_blockers','severity','error','message','Resolve the retained workbook review errors before approval.'));end if;
 return issues;
end;$$;
revoke all on function atlas_private.reforecast_import_issues_before_close_scope(jsonb,jsonb) from public,anon,authenticated;

create or replace function atlas_private.reforecast_planning_issues(source jsonb,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare issues jsonb:='[]';retained_audit jsonb;upload_lines jsonb;source_cells jsonb;input_reviews jsonb;integrity_reviews jsonb;row_reviews jsonb;row_counts jsonb;cid uuid:=(source->>'communityId')::uuid;over jsonb;entry jsonb;mapping jsonb;upload jsonb;finding jsonb;review jsonb;line jsonb;cell jsonb;row_review jsonb;source_row record;id text;cutoff text:=source->'actuals'->>'cutoffPeriod';
begin
 issues:=issues||atlas_private.planning_calendar_issues(config->'calendar',config->'periods',case when config->'calendar'->>'scenario'=config->>'name' then config->>'name' else config->'importMapping'->>'sourceScenario' end);
 if config->>'governanceSchemaVersion' is distinct from '2' then issues:=issues||atlas_private.planning_issue('planning_governance_required','Review this working draft using the current cell and calendar governance before approval.');end if;
 for over in select v from jsonb_array_elements(coalesce(config->'overrides','[]'))v loop
  if not atlas_private.planning_review_valid(over,cid,over->>'period',over->'amount') then issues:=issues||atlas_private.planning_issue('override_review_required','Every changed forecast cell requires its own reason, authorized owner, effective month, timestamp and before/after values.',jsonb_build_object('period',over->'period','accountCode',over->'accountCode'));end if;
 end loop;
 for entry in select distinct on(v->>'uploadId')v from jsonb_array_elements(coalesce(config->'importHistory','[]')||jsonb_build_array(jsonb_build_object('uploadId',config->'uploadId','mapping',config->'importMapping'))) with ordinality e(v,ord) where v->>'uploadId' is not null order by v->>'uploadId',ord desc loop
  if entry->>'uploadId'<>config->>'uploadId' and not exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'uploadId'=entry->>'uploadId') then continue;end if;
  select payload into upload from public.atlas_reforecast_uploads where upload_id::text=entry->>'uploadId' and community_id=cid;mapping:=entry->'mapping';
  if upload is null then issues:=issues||atlas_private.planning_issue('planning_upload_required','Read the retained workbook evidence for this authorized community.');continue;end if;
  issues:=issues||atlas_private.workbook_audit_issues(upload->'integrity',upload->'source'->>'sha256');
  retained_audit:=atlas_private.resolve_workbook_audit(upload->'integrity',upload->'source'->>'sha256');
  select coalesce(jsonb_object_agg(v->>'id',v),'{}') into upload_lines from jsonb_array_elements(coalesce(upload->'lines','[]'))v;
  select coalesce(jsonb_object_agg((s->>'name')||'!'||(c->>'address'),c),'{}') into source_cells from jsonb_array_elements(coalesce(upload->'sheets','[]'))s cross join lateral jsonb_array_elements(coalesce(s->'cells','[]'))c where coalesce(mapping->'selectedLineIds','[]') ? ((s->>'name')||'!'||(c->>'address'));
  select coalesce(jsonb_object_agg(v->>'cellId',v),'{}') into input_reviews from jsonb_array_elements(coalesce(mapping->'inputReviews','[]'))v;
  select coalesce(jsonb_object_agg(v->>'findingId',v),'{}') into integrity_reviews from jsonb_array_elements(coalesce(mapping->'integrityReviews','[]'))v;
  select coalesce(jsonb_object_agg(jsonb_build_array(v->>'sheet',v->>'row')::text,v),'{}') into row_reviews from jsonb_array_elements(coalesce(mapping->'rowDispositions','[]'))v;
  select coalesce(jsonb_object_agg(k,n),'{}') into row_counts from (select jsonb_build_array(v->>'sheet',v->>'row')::text k,count(*)n from jsonb_array_elements(coalesce(mapping->'rowDispositions','[]'))v group by 1)q;
  if retained_audit->'inventory'->>'sourceHash' is distinct from upload->'source'->>'sha256' then issues:=issues||atlas_private.planning_issue('workbook_hash_binding','The workbook integrity audit must cite the retained original file hash.');end if;
  issues:=issues||atlas_private.planning_calendar_issues(mapping->'calendar',mapping->'periods',mapping->>'sourceScenario');
  for finding in select v from jsonb_array_elements(coalesce(retained_audit->'findings','[]'))v where v->>'severity'='review' loop
   review:=integrity_reviews->(finding->>'id');
   if not atlas_private.planning_review_valid(review,cid,null,null,retained_audit->>'fingerprint') then issues:=issues||atlas_private.planning_issue('workbook_finding_review_required','A non-critical workbook finding needs an explicit authorized review.',jsonb_build_object('findingId',finding->'id'));end if;
  end loop;
  for source_row in select s->>'name' sheet,(c->>'row')::integer row from jsonb_array_elements(coalesce(upload->'sheets','[]'))s cross join lateral jsonb_array_elements(coalesce(s->'cells','[]'))c where coalesce(c->>'formula','')<>'' or c->>'hasValue'='true' and c->>'value' is not null and c->>'value'<>'' group by s->>'name',c->>'row' loop
   row_review:=row_reviews->(jsonb_build_array(source_row.sheet,source_row.row::text)::text);
   if row_review is null or row_review->>'confirmed' is distinct from 'true' or coalesce(row_review->>'disposition','') not in ('included_leaf','subtotal_control','header','memo','supporting_column','duplicate','authorized_exclusion') or length(trim(coalesce(row_review->>'reason','')))<3 or not atlas_private.planning_authorized_reviewer(cid,row_review->>'ownerId') then issues:=issues||atlas_private.planning_issue('planning_row_disposition','Every populated source row needs exactly one reviewed disposition.',jsonb_build_object('sheet',source_row.sheet,'row',source_row.row));end if;
   if coalesce((row_counts->>(jsonb_build_array(source_row.sheet,source_row.row::text)::text))::integer,0)<>1 then issues:=issues||atlas_private.planning_issue('planning_row_disposition_duplicate','Source row disposition is missing or ambiguous.');end if;
  end loop;
  for id in select jsonb_array_elements_text(coalesce(mapping->'selectedLineIds','[]')) loop
   line:=upload_lines->id;
   if line is null or line->>'scenario' is distinct from mapping->>'sourceScenario' or line->>'period'<=cutoff or line->>'sourceKind'='workbook_actual_evidence' then continue;end if;
   cell:=source_cells->id;
   if cell is null or id is distinct from (line->>'sheet')||'!'||(line->>'address') or line->'amount' is distinct from cell->'value' or coalesce(line->>'formula','') is distinct from coalesce(cell->>'formula','') then issues:=issues||atlas_private.planning_issue('planning_source_coordinates','Mapped planning cells must reproduce their immutable source coordinates and value.',jsonb_build_object('sourceLineId',id));end if;
   if coalesce(line->>'formula','')='' and jsonb_typeof(line->'amount')='number' then
    review:=input_reviews->id;
    if not atlas_private.planning_review_valid(review,cid,line->>'period',line->'amount',retained_audit->>'fingerprint') then issues:=issues||atlas_private.planning_issue('planning_input_review_required','A populated planning constant needs its own reviewed input record.',jsonb_build_object('sourceLineId',id));end if;
   end if;
  end loop;
 end loop;return issues;
end;$$;

revoke all on function atlas_private.reforecast_planning_issues(jsonb,jsonb) from public,anon,authenticated;

-- Original-budget publication mappings are review evidence, not a new GL
-- registry. Expose their immutable version relationship so the UI can propose
-- classifications without guessing from account-number ranges or amounts.
alter function atlas_private.reforecast_source(uuid,text[],uuid[],uuid) rename to reforecast_source_before_import_mapping_evidence;
revoke all on function atlas_private.reforecast_source_before_import_mapping_evidence(uuid,text[],uuid[],uuid) from public,anon,authenticated;
create function atlas_private.reforecast_source(cid uuid,periods text[],budget_ids uuid[] default null,registry_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;evidence jsonb;
begin
 result:=atlas_private.reforecast_source_before_import_mapping_evidence(cid,periods,budget_ids,registry_id);
 select coalesce(jsonb_agg(jsonb_build_object('versionId',b.version_id,'communityId',b.community_id,'calendarYear',b.calendar_year,'sourceHash',b.source_hash,'mappingVersion',b.payload->'mappingVersion','metricMappings',b.payload->'metricMappings') order by b.version_id),'[]') into evidence
 from public.atlas_approved_budget_versions b where b.community_id=cid and b.status='locked' and coalesce(result->'baseline'->'versionIds','[]') ? b.version_id::text and jsonb_typeof(b.payload->'metricMappings')='object';
 result:=jsonb_set(result-'sourceVersion','{baseline,approvedMetricMappings}',evidence);
 return result||jsonb_build_object('sourceVersion',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_source(uuid,text[],uuid[],uuid) from public,anon,authenticated;

-- A prospective GL can carry forecast activity while having no original row.
-- Only a reviewed absence permits excluding it from original-budget aggregates;
-- an existing row with a blank amount remains missing, never a synthetic zero.
create function atlas_private.reforecast_original_absence_disposition(source jsonb,config jsonb,p text,code text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare baseline_line jsonb;mapping jsonb;decision jsonb;
begin
 if exists(select 1 from jsonb_array_elements(coalesce(source->'baseline'->'originalBudgetLines',source->'baseline'->'lines','[]'))l where l->>'period'=p and l->>'accountCode'=code) then return null;end if;
 select value into baseline_line from jsonb_array_elements(coalesce(source->'baseline'->'lines','[]'))l where l->>'period'=p and l->>'accountCode'=code;
 if baseline_line->'baselineDisposition'->>'kind'='no_original_budget_row' and baseline_line->'originalBudget'='null'::jsonb then return baseline_line->'baselineDisposition';end if;
 for mapping in select v->'mapping' from jsonb_array_elements(coalesce(config->'importHistory','[]')||jsonb_build_array(jsonb_build_object('mapping',config->'importMapping')))v loop
  if mapping->>'confirmed' is distinct from 'true' or not coalesce(mapping->'periods' ? p,false) then continue;end if;
  select m->'baselineDisposition' into decision from jsonb_array_elements(coalesce(mapping->'accountMappings','[]'))m where m->>'accountCode'=code and m->'baselineDisposition'->>'kind'='no_original_budget_row' limit 1;
  if decision->>'confirmed'='true' and decision->>'reviewedBy'=mapping->>'reviewedBy' and atlas_private.planning_authorized_reviewer((source->>'communityId')::uuid,decision->>'reviewedBy') and coalesce(decision->>'reviewedAt','')~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' and length(trim(coalesce(decision->>'reason','')))>=3 then return decision||jsonb_build_object('originalBudgetVersionIds',config->'baselineVersionIds');end if;
 end loop;
 return null;
end;$$;
revoke all on function atlas_private.reforecast_original_absence_disposition(jsonb,jsonb,text,text) from public,anon,authenticated;

create or replace function atlas_private.reforecast_metric(lines jsonb,field text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare revenue numeric;expense numeric;below numeric;noi numeric;cash numeric;missing integer;result jsonb:='{}';metric text;amount numeric;
begin
 if field in ('originalBudget','selectedBaseline') then select coalesce(jsonb_agg(v),'[]') into lines from jsonb_array_elements(lines)v where not(v->'baselineDisposition'->>'kind'='no_original_budget_row' and v->field='null'::jsonb) or v->'baselineDisposition'->>'kind' is null;end if;
 if jsonb_array_length(lines)=0 or exists(select 1 from jsonb_array_elements(lines)v where v->>'mappingValid' is distinct from 'true') then return jsonb_build_object('grossIncome',null,'contraRevenue',null,'revenue',null,'opex',null,'expenses',null,'belowNoi',null,'capital',null,'debt',null,'noi',null,'margin',null,'cashFlow',null);end if;
 foreach metric in array array['grossIncome','contraRevenue','opex','belowNoi','capital','debt'] loop
  select coalesce(sum(case when metric='belowNoi' and v->>'nature' in ('income','contra_income') then -(v->>field)::numeric else (v->>field)::numeric end),0),count(*) filter(where v->>field is null) into amount,missing
  from jsonb_array_elements(lines)v where case metric when 'grossIncome' then v->>'nature'='income' and v->>'placement'='above_noi' when 'contraRevenue' then v->>'nature'='contra_income' and v->>'placement'='above_noi' when 'opex' then v->>'nature'='expense' and v->>'placement'='above_noi' when 'belowNoi' then v->>'placement'='below_noi' and v->>'nature' not in ('capital','debt') when 'capital' then v->>'nature'='capital' when 'debt' then v->>'nature'='debt' end;
  result:=result||jsonb_build_object(metric,case when missing=0 then round(amount,2) end);
 end loop;
 revenue:=(result->>'grossIncome')::numeric+(result->>'contraRevenue')::numeric;expense:=(result->>'opex')::numeric;noi:=revenue-expense;cash:=noi-(result->>'belowNoi')::numeric-(result->>'capital')::numeric-(result->>'debt')::numeric;
 return result||jsonb_build_object('revenue',round(revenue,2),'expenses',expense,'noi',round(noi,2),'margin',case when revenue<>0 then noi/revenue end,'cashFlow',round(cash,2));
end;$$;
revoke all on function atlas_private.reforecast_metric(jsonb,text) from public,anon,authenticated;

-- Workbook cached values retain their full source precision in GL/month cells.
-- Report formatting and existing driver/manual rounding remain unchanged.
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
   line:=jsonb_build_object('period',p,'accountCode',code,'originalBudget',original,'selectedBaseline',base,'baselineDisposition',case when original_line is null then atlas_private.reforecast_original_absence_disposition(source,config,p,code) end,'baselineLineage',b->'source','immutable',coalesce(source->'lockedPeriods' ? p,false),'inheritedDetail',inherited_line,'actual',case when closed and applicable then actual_value end,'forecast',value,'sourceKind',case when not applicable then 'not_applicable' when source->'lockedPeriods' ? p then 'inherited_locked' when closed then 'closed_actual' else 'forecast' end,'closeVersionId',close_id,'accountName',coalesce(a->>'name',b->>'accountName',code),'category',a->'category','identifier',coalesce(a->'identifier',a->'nature'),'nature',a->'nature','placement',a->'placement','mappingValid',known,'retired',a->>'retiredAfter' is not null and p>a->>'retiredAfter','applicable',applicable,'driverSources','[]'::jsonb,'driverIds','[]'::jsonb,'source',case when source->'lockedPeriods' ? p then inherited_line->'source' when closed then actual->'source' else b->'source' end);
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
  line:=line||jsonb_build_object('forecast',case when over->>'sourceLineId' is not null then (over->>'amount')::numeric else round((over->>'amount')::numeric,2) end,'override',over,'driverIds',(line->'driverIds')||jsonb_build_array('override-'||(override_index-1)),'driverSources',(line->'driverSources')||jsonb_build_array(jsonb_build_object('driverId','override-'||(override_index-1),'operation','amount','value',over->'amount','source',over->'source','reason',coalesce(over->>'reason',''))));state:=jsonb_set(state,array[k],line,true);
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
 select coalesce(jsonb_agg(jsonb_build_object('category',category,'monthly',(select jsonb_agg(jsonb_build_object('period',pr.period_value,'originalBudget',(select case when count(*) filter(where v->>'originalBudget' is null and v->'baselineDisposition'->>'kind' is distinct from 'no_original_budget_row')=0 then coalesce(sum((v->>'originalBudget')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category),'forecast',(select case when count(*) filter(where v->>'forecast' is null)=0 then coalesce(sum((v->>'forecast')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category),'actual',case when pr.period_value<=cutoff then (select case when count(*) filter(where v->>'actual' is null)=0 then coalesce(sum((v->>'actual')::numeric),0) end from jsonb_array_elements(lines)v where v->>'period'=pr.period_value and v->>'category'=category) end) order by pr.period_value) from jsonb_array_elements_text(source->'periods') as pr(period_value))) order by category),'[]') into categories from (select distinct v->>'category' category from jsonb_array_elements(lines)v where v->>'category' is not null)c;
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


revoke all on function atlas_private.calculate_reforecast(jsonb,jsonb) from public,anon,authenticated;

create function atlas_private.read_reforecast_import_receipt(p_community_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare receipt_row public.atlas_reforecast_import_receipts;r public.atlas_reforecast_revisions;head public.atlas_reforecast_heads;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'read') then raise exception 'Reforecast import receipt access denied';end if;
 select * into receipt_row from public.atlas_reforecast_import_receipts where community_id=p_community_id and request_id=p_request_id;
 if not found then return null;end if;
 select * into r from public.atlas_reforecast_revisions where revision_id=receipt_row.revision_id and community_id=p_community_id;
 if r.revision_id is null or r.snapshot->>'fingerprint' is distinct from receipt_row.receipt->>'snapshotFingerprint'
 or r.snapshot->>'fingerprint' is distinct from encode(sha256(convert_to((r.snapshot-'fingerprint')::text,'UTF8')),'hex')
 or exists(select 1 from jsonb_array_elements(receipt_row.receipt->'importedCells')c where
  (select count(*) from jsonb_array_elements(r.snapshot->'lines')l where l->>'period'=c->>'period' and l->>'accountCode'=c->>'accountCode' and l->'forecast'=c->'amount')<>1
  or (select count(*) from jsonb_array_elements(r.payload->'overrides')o where o->>'period'=c->>'period' and o->>'accountCode'=c->>'accountCode' and o->'amount'=c->'amount' and o->>'sourceLineId'=c->>'sourceLineId' and o->>'uploadId'=receipt_row.upload_id::text)<>1)
 then raise exception 'Immutable import receipt readback verification failed';end if;
 select * into head from public.atlas_reforecast_heads where scenario_id=r.scenario_id;
 -- head describes the receipted revision. currentHead lets a recovering client
 -- detect later edits without pretending the old receipt is the current draft.
 return jsonb_build_object('head',jsonb_build_object('scenario_id',r.scenario_id,'community_id',r.community_id,'revision_id',r.revision_id,'revision',r.revision,'status',r.status),
  'currentHead',to_jsonb(head),'revision',to_jsonb(r),'source',r.source,'snapshot',r.snapshot,'receipt',receipt_row.receipt);
end;$$;

create function atlas_private.create_reforecast_from_import(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_upload_id uuid,p_mapping jsonb,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.atlas_reforecast_uploads;receipt_row public.atlas_reforecast_import_receipts;r public.atlas_reforecast_revisions;prior public.atlas_reforecast_revisions;
 request_hash text;config jsonb;history jsonb;source jsonb;audit jsonb;source_cells jsonb;row_reviews jsonb;line jsonb;map_entry jsonb;account jsonb;cell jsonb;row_review jsonb;before_line jsonb;baseline_disposition jsonb;over jsonb;result jsonb;
 imported jsonb:='[]';excluded jsonb:='[]';overrides jsonb:='[]';issues jsonb;receipt jsonb;disposition text;coordinates jsonb;matches integer;amount numeric;
 reviewed_at text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');periods text[];registry_id uuid;retained_audit_id uuid;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Reforecast import edit access denied';end if;
 if p_scenario_id is null or p_request_id is null or p_upload_id is null or p_expected_revision is null or p_expected_revision<0
 or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_mapping) is distinct from 'object'
 or octet_length(p_payload::text)+octet_length(p_mapping::text)>2097152 then raise exception 'Invalid or oversized atomic import request';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_scenario_id,p_expected_revision,p_upload_id,p_mapping,p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reforecast-import-request:'||p_request_id,0));
 select * into receipt_row from public.atlas_reforecast_import_receipts where request_id=p_request_id;
 if found then
  if receipt_row.community_id<>p_community_id or receipt_row.actor_id<>auth.uid() or receipt_row.request_hash<>request_hash then raise exception 'Import request ID reused for different changes';end if;
  return atlas_private.read_reforecast_import_receipt(p_community_id,p_request_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reforecast-active:'||p_community_id,0));
 perform pg_advisory_xact_lock(hashtextextended('reforecast-scenario:'||p_scenario_id,0));
 select r0.* into prior from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r0 using(revision_id) where h.scenario_id=p_scenario_id;
 if prior.revision_id is not null and prior.community_id<>p_community_id then raise exception 'Scenario community is immutable';end if;
 if coalesce(prior.revision,0)<>p_expected_revision then raise exception 'Reforecast changed in another session. Keep your mapping and reload before retrying';end if;
 if prior.status in ('approved','locked') then raise exception 'Approved and locked reforecasts require a new working forecast';end if;
 select * into u from public.atlas_reforecast_uploads where upload_id=p_upload_id and community_id=p_community_id;
 if u.upload_id is null or u.payload->'propertyAssignment'->>'communityId' is distinct from p_community_id::text or u.payload->'propertyAssignment'->>'confirmed' is distinct from 'true' then raise exception 'Workbook upload community mismatch';end if;
 if u.payload->'integrity'->>'auditId' is null then raise exception 'Save complete immutable workbook evidence before creating a working forecast';end if;
 retained_audit_id:=(u.payload->'integrity'->>'auditId')::uuid;
 if not exists(select 1 from public.atlas_workbook_audit_scopes s where s.audit_id=retained_audit_id and s.community_id=p_community_id) then raise exception 'Workbook audit is not assigned to this community';end if;
 audit:=atlas_private.resolve_workbook_audit(u.payload->'integrity',u.source_hash);
 if audit->'inventory'->>'sourceHash' is distinct from u.source_hash or u.payload->'source'->>'sha256' is distinct from u.source_hash then raise exception 'Workbook evidence source hash mismatch';end if;
 if p_mapping->>'confirmed' is distinct from 'true' or p_mapping->>'reviewedBy' is distinct from auth.uid()::text
 or p_mapping->'propertyAssignment'->>'communityId' is distinct from p_community_id::text or p_mapping->'propertyAssignment'->>'confirmed' is distinct from 'true'
 or jsonb_typeof(p_mapping->'selectedLineIds') is distinct from 'array' or jsonb_array_length(p_mapping->'selectedLineIds') not between 1 and 20000
 or jsonb_typeof(p_mapping->'accountMappings') is distinct from 'array' or length(trim(coalesce(p_mapping->>'reason','')))<3
 or coalesce(p_mapping->>'sourceScenario','')='' then raise exception 'Review the workbook source scenario, community and exact GL mappings before saving';end if;
 if (select count(distinct id) from jsonb_array_elements_text(p_mapping->'selectedLineIds')id)<>jsonb_array_length(p_mapping->'selectedLineIds') then raise exception 'Selected workbook cells must be unique';end if;
 if jsonb_typeof(p_mapping->'periods') is distinct from 'array' or jsonb_array_length(p_mapping->'periods') not between 1 and 24
 or exists(select 1 from jsonb_array_elements_text(p_mapping->'periods')p where p is null or p!~'^20[0-9]{2}-(0[1-9]|1[0-2])$')
 or (select count(distinct p) from jsonb_array_elements_text(p_mapping->'periods')p)<>jsonb_array_length(p_mapping->'periods')
 or exists(select 1 from jsonb_array_elements_text(p_mapping->'periods')p where not coalesce(p_payload->'periods' ? p,false)) then raise exception 'Select distinct complete reporting months within the working forecast';end if;
 registry_id:=nullif(p_mapping->>'version','')::uuid;
 if registry_id is null or p_payload->>'registryVersionId' is distinct from registry_id::text
 or not exists(select 1 from public.atlas_reforecast_registry_heads h where h.community_id=p_community_id and h.version_id=registry_id)
 then raise exception 'Reviewed mapping version changed. Reload the GL registry and review before saving';end if;
 if coalesce(p_payload->>'baselineType','original_budget') not in ('original_budget','approved_reforecast') or jsonb_array_length(coalesce(p_payload->'baselineVersionIds','[]'))=0 then raise exception 'Choose an immutable approved original budget or exact approved publication baseline';end if;
 if p_payload->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(p_payload->'strStreams','[]'))s where s->>'id'='rise_str') then raise exception 'Workbook prefill belongs to Conventional; derive RISE STR from its exact approved publication';end if;
 config:=p_payload||jsonb_build_object('uploadId',p_upload_id,'importMapping',p_mapping,'registryVersionId',registry_id);
 source:=atlas_private.reforecast_source_for_config(p_community_id,config);
 if source->'registry'->>'version' is distinct from registry_id::text then raise exception 'Mapping source version mismatch';end if;
 if exists(select 1 from jsonb_array_elements_text(p_mapping->'periods')p where source->'lockedPeriods' ? p or source->'actuals'->'notApplicablePeriods' ? p or p<=source->'actuals'->>'cutoffPeriod' or atlas_private.reforecast_month_locked(p_community_id,p)) then raise exception 'Select only eligible open months; governed actual and inherited locked months cannot be imported';end if;
 if exists(select 1 from jsonb_array_elements_text(p_mapping->'selectedLineIds')id where (select count(*) from jsonb_array_elements(coalesce(u.payload->'lines','[]'))l where l->>'id'=id)<>1) then raise exception 'Each selected source cell must occur exactly once in the retained workbook';end if;

 -- Construct every value from immutable evidence, never from browser prefill.
 select coalesce(jsonb_object_agg(c->>'id',c),'{}') into source_cells from jsonb_array_elements(audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')c where p_mapping->'selectedLineIds' ? (c->>'id');
 select coalesce(jsonb_object_agg(jsonb_build_array(v->>'sheet',v->>'row')::text,v),'{}') into row_reviews from jsonb_array_elements(coalesce(p_mapping->'rowDispositions','[]'))v;
 for line in select value from jsonb_array_elements(coalesce(u.payload->'lines','[]')) where p_mapping->'selectedLineIds' ? (value->>'id') loop
  select count(*),jsonb_agg(m)->0 into matches,map_entry from jsonb_array_elements(p_mapping->'accountMappings')m where m->>'sourceAccountCode'=line->>'accountCode'
   and (m->>'sheet' is null or m->>'sheet'=line->>'sheet') and (m->>'department' is null or m->>'department'=line->>'department');
  coordinates:=jsonb_build_object('sheet',line->'sheet','address',line->'address','row',line->'row','column',line->'column');
  row_review:=row_reviews->(jsonb_build_array(line->>'sheet',line->>'row')::text);
  if line->>'scenario' is distinct from p_mapping->>'sourceScenario' or not(p_mapping->'periods' ? (line->>'period')) or line->>'sourceKind'='workbook_actual_evidence' then raise exception 'Selected source cell is outside the reviewed forecast scenario or open months: %',line->>'id';end if;
  if matches<>1 or coalesce(map_entry->>'signMultiplier','') not in ('1','-1') or jsonb_typeof(line->'amount') is distinct from 'number' then raise exception 'Selected cell requires one reviewed GL mapping and a numeric amount; blank is not zero: %',line->>'id';end if;
  select value into account from jsonb_array_elements(source->'registry'->'accounts')a where a->>'accountCode'=map_entry->>'accountCode';
  if account is null then raise exception 'Selected target GL is not in the approved mapping registry';end if;
  cell:=source_cells->(line->>'id');
  if cell is null or line->>'id' is distinct from (line->>'sheet')||'!'||(line->>'address') or line->'amount' is distinct from cell->'value' or coalesce(line->>'formula','') is distinct from coalesce(cell->>'formula','') then raise exception 'Selected value does not reproduce immutable workbook evidence: %',line->>'id';end if;
  if audit->'authorityScope'->>'type'='selected_cells_and_dependencies' and not(coalesce(audit->'authorityScope'->'selectedCells','[]') ? (line->>'id')) then raise exception 'Selected cell is outside retained authoritative workbook scope';end if;
  select value into before_line from jsonb_array_elements(source->'baseline'->'lines')b where b->>'period'=line->>'period' and b->>'accountCode'=map_entry->>'accountCode';
  baseline_disposition:=case when before_line is null and source->'baseline'->>'sourceType'='original_budget' then atlas_private.reforecast_original_absence_disposition(source,config,line->>'period',map_entry->>'accountCode') end;
  if jsonb_typeof(before_line->'amount') is distinct from 'number' and baseline_disposition is null then raise exception 'Selected GL/month has no exact approved baseline value; explicitly review a prospective GL with no original row: % / %',map_entry->>'accountCode',line->>'period';end if;
  amount:=(line->>'amount')::numeric*(map_entry->>'signMultiplier')::numeric;
  if exists(select 1 from jsonb_array_elements(imported)c where c->>'period'=line->>'period' and c->>'accountCode'=map_entry->>'accountCode') then raise exception 'Multiple workbook cells map to the same GL/month; resolve the source relationship before importing';end if;
  cell:=jsonb_build_object('period',line->'period','accountCode',map_entry->'accountCode','amount',amount,'sourceLineId',line->'id','sourceCoordinates',coordinates,'sourceAccountCode',line->'accountCode','department',line->'department','sourceScenario',line->'scenario','sourceAmount',line->'amount','sourceCurrency',line->'currency','reportingCurrency',p_mapping->'currency','signMultiplier',map_entry->'signMultiplier','mappingVersion',registry_id,'disposition','included','baselineDisposition',baseline_disposition,'rowDisposition',row_review->'disposition','actorId',auth.uid(),'reviewedAt',reviewed_at,'isBlank',false);
  imported:=imported||jsonb_build_array(cell);
  over:=cell||jsonb_build_object('uploadId',p_upload_id,'sourceHash',u.source_hash,'reason',p_mapping->>'reason','confirmed',true,'ownerId',auth.uid(),'effectivePeriod',line->'period','before',before_line->'amount','after',amount,'integrityFingerprint',audit->>'fingerprint','source',jsonb_build_object('kind','workbook_import','uploadId',p_upload_id,'auditId',retained_audit_id,'sourceLineId',line->'id','sheet',line->'sheet','address',line->'address','department',line->'department','sourceAccountCode',line->'accountCode','sourceAmount',line->'amount','mappingVersion',registry_id,'requestId',p_request_id));
  overrides:=overrides||jsonb_build_array(over);
 end loop;
 -- Exclusion details cover the review's scenario/months. Other scenarios and
 -- historical months remain complete immutable evidence, with explicit counts.
 -- Aggregate once instead of repeatedly copying a growing 10,000-row JSON array.
 select coalesce(jsonb_agg(jsonb_build_object(
  'sourceLineId',l->'id','sourceCoordinates',jsonb_build_object('sheet',l->'sheet','address',l->'address','row',l->'row','column',l->'column'),
  'sourceAccountCode',l->'accountCode','department',l->'department','period',l->'period','sourceScenario',l->'scenario','sourceAmount',l->'amount',
  'amount',case when jsonb_typeof(l->'amount')='number' and q.n=1 and q.m->>'signMultiplier' in ('1','-1') then to_jsonb((l->>'amount')::numeric*(q.m->>'signMultiplier')::numeric) else null end,
  'accountCode',case when q.n=1 then q.m->'accountCode' end,'mappingVersion',registry_id,
  'disposition',case when l->>'sourceKind'='workbook_actual_evidence' then 'actual_evidence_only' when jsonb_typeof(l->'amount') is distinct from 'number' then 'blank_or_non_numeric' else 'reviewed_exclusion' end,
  'rowDisposition',(row_reviews->(jsonb_build_array(l->>'sheet',l->>'row')::text))->'disposition','reason',p_mapping->>'reason','actorId',auth.uid(),'reviewedAt',reviewed_at,'isBlank',coalesce((l->>'blank')::boolean,l->'amount' is null or l->'amount'='null'::jsonb)
 ) order by l->>'id'),'[]') into excluded
 from jsonb_array_elements(coalesce(u.payload->'lines','[]'))l
 left join lateral (select count(*)n,jsonb_agg(m)->0 m from jsonb_array_elements(p_mapping->'accountMappings')m where m->>'sourceAccountCode'=l->>'accountCode' and (m->>'sheet' is null or m->>'sheet'=l->>'sheet') and (m->>'department' is null or m->>'department'=l->>'department'))q on true
 where l->>'scenario'=p_mapping->>'sourceScenario' and p_mapping->'periods' ? (l->>'period') and not(p_mapping->'selectedLineIds' ? (l->>'id'));
 if jsonb_array_length(imported)<>jsonb_array_length(p_mapping->'selectedLineIds') then raise exception 'Every selected cell must be applied exactly once';end if;
 select coalesce(jsonb_agg(o),'[]')||overrides into overrides from jsonb_array_elements(coalesce(p_payload->'overrides','[]'))o where o->>'uploadId' is distinct from p_upload_id::text and not exists(select 1 from jsonb_array_elements(imported)c where c->>'period'=o->>'period' and c->>'accountCode'=o->>'accountCode');
 -- Keep the current mapping once. Historical entries receive its full reviewed
 -- mapping when a different upload replaces it; receipts retain every event.
 select coalesce(jsonb_agg(e),'[]') into history from jsonb_array_elements(coalesce(p_payload->'importHistory','[]'))e where e->>'uploadId' is distinct from p_upload_id::text;
 if p_payload->>'uploadId' is not null and p_payload->>'uploadId'<>p_upload_id::text and p_payload->'importMapping' is not null then
  select coalesce(jsonb_agg(case when e->>'uploadId'=p_payload->>'uploadId' then e||jsonb_build_object('mapping',p_payload->'importMapping','issues',coalesce(p_payload->'importIssues','[]')) else e end),'[]') into history from jsonb_array_elements(history)e;
  if not exists(select 1 from jsonb_array_elements(history)e where e->>'uploadId'=p_payload->>'uploadId') then history:=history||jsonb_build_array(jsonb_build_object('uploadId',p_payload->'uploadId','mapping',p_payload->'importMapping','issues',coalesce(p_payload->'importIssues','[]')));end if;
 end if;
 config:=config||jsonb_build_object('overrides',overrides,'importHistory',history||jsonb_build_array(jsonb_build_object('uploadId',p_upload_id,'mappingVersion',registry_id,'requestId',p_request_id,'actorId',auth.uid(),'importedAt',reviewed_at)),'importIssues','[]'::jsonb);
 issues:=atlas_private.reforecast_import_issues(source,config);
 if exists(select 1 from jsonb_array_elements(issues)i where i->>'severity' in ('error','blocking')) then raise exception 'Workbook mapping validation failed: %',issues::text;end if;
 result:=atlas_private.save_reforecast_builder(p_community_id,p_scenario_id,p_expected_revision,p_request_id,'save_draft',config);
 -- Read the stored revision after all governance triggers have run.
 select * into r from public.atlas_reforecast_revisions where revision_id=(result->'revision'->>'revision_id')::uuid;
 if exists(select 1 from jsonb_array_elements(imported)c where (select count(*) from jsonb_array_elements(r.snapshot->'lines')l where l->>'period'=c->>'period' and l->>'accountCode'=c->>'accountCode' and l->'forecast'=c->'amount')<>1) then raise exception 'Imported GL/month readback differs from reviewed workbook values';end if;
 receipt:=jsonb_build_object('request_id',p_request_id,'community_id',p_community_id,'scenario_id',p_scenario_id,'revision_id',r.revision_id,'revision',r.revision,'expected_revision',p_expected_revision,'upload_id',p_upload_id,'mapping_version',registry_id,'audit_id',retained_audit_id,'sourceHash',u.source_hash,'uploadContentHash',u.content_hash,'auditFingerprint',audit->>'fingerprint','snapshotFingerprint',r.snapshot->>'fingerprint','mapping',p_mapping,'importedCells',imported,'excludedRows',excluded,'excludedEvidenceSummary',jsonb_build_object('sourceLineCount',jsonb_array_length(coalesce(u.payload->'lines','[]')),'outsideReviewedScopeCount',jsonb_array_length(coalesce(u.payload->'lines','[]'))-jsonb_array_length(imported)-jsonb_array_length(excluded),'sourceScenario',p_mapping->'sourceScenario','periods',p_mapping->'periods','retainedUploadId',p_upload_id),'blockers',r.snapshot->'diagnostics','actor_id',auth.uid(),'created_at',reviewed_at,'verified',true,
  'reconciliation',jsonb_build_object('selectedCellCount',jsonb_array_length(imported),'excludedCellCount',jsonb_array_length(excluded),'zeroCellCount',(select count(*) from jsonb_array_elements(imported)c where (c->>'amount')::numeric=0),'noOriginalBudgetRowCellCount',(select count(*) from jsonb_array_elements(imported)c where c->'baselineDisposition'->>'kind'='no_original_budget_row'),'noOriginalBudgetRowGLCount',(select count(distinct c->>'accountCode') from jsonb_array_elements(imported)c where c->'baselineDisposition'->>'kind'='no_original_budget_row'),'blankExcludedCount',(select count(*) from jsonb_array_elements(excluded)c where c->>'isBlank'='true'),'sourceTotal',(select sum((c->>'sourceAmount')::numeric) from jsonb_array_elements(imported)c),'importedTotal',(select sum((c->>'amount')::numeric) from jsonb_array_elements(imported)c),'readbackTotal',(select sum((l->>'forecast')::numeric) from jsonb_array_elements(r.snapshot->'lines')l join jsonb_array_elements(imported)c on c->>'period'=l->>'period' and c->>'accountCode'=l->>'accountCode'),'monthly',(select jsonb_agg(v order by v->>'period') from (select jsonb_build_object('period',c->>'period','total',sum((c->>'amount')::numeric),'cellCount',count(*))v from jsonb_array_elements(imported)c group by c->>'period')q),'glTotals',(select jsonb_agg(v order by v->>'accountCode') from (select jsonb_build_object('accountCode',c->>'accountCode','total',sum((c->>'amount')::numeric),'cellCount',count(*))v from jsonb_array_elements(imported)c group by c->>'accountCode')q)));
 insert into public.atlas_reforecast_import_receipts(request_id,community_id,scenario_id,revision_id,upload_id,mapping_version,audit_id,expected_revision,request_hash,receipt,actor_id)
 values(p_request_id,p_community_id,p_scenario_id,r.revision_id,p_upload_id,registry_id,retained_audit_id,p_expected_revision,request_hash,receipt,auth.uid());
 return atlas_private.read_reforecast_import_receipt(p_community_id,p_request_id);
end;$$;

-- General saves and atomic approvals use the same receipt-first recovery rule.
-- These rows already are immutable; no second write or request ID is needed.
create function atlas_private.read_reforecast_save_receipt(p_community_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_reforecast_revisions;pub public.atlas_reforecast_publications;head public.atlas_reforecast_heads;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'read') then raise exception 'Reforecast save receipt access denied';end if;
 select * into r from public.atlas_reforecast_revisions where community_id=p_community_id and request_id=p_request_id;
 select * into pub from public.atlas_reforecast_publications where community_id=p_community_id and request_id=p_request_id;
 if r.revision_id is null then
  if pub.publication_id is null then return null;end if;
  select * into r from public.atlas_reforecast_revisions where revision_id=pub.revision_id;
 end if;
 if r.snapshot->>'fingerprint' is distinct from encode(sha256(convert_to((r.snapshot-'fingerprint')::text,'UTF8')),'hex') then raise exception 'Immutable save receipt verification failed';end if;
 select * into head from public.atlas_reforecast_heads where scenario_id=r.scenario_id;
 return jsonb_build_object('head',jsonb_build_object('scenario_id',r.scenario_id,'community_id',r.community_id,'revision_id',r.revision_id,'revision',r.revision,'status',r.status),'currentHead',to_jsonb(head),'revision',to_jsonb(r),'source',r.source,'snapshot',r.snapshot)
  ||case when pub.publication_id is null then '{}'::jsonb else jsonb_build_object('publication',to_jsonb(pub)) end;
end;$$;

create function public.atlas_create_reforecast_from_import(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_upload_id uuid,p_mapping jsonb,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select atlas_private.create_reforecast_from_import(p_community_id,p_scenario_id,p_expected_revision,p_request_id,p_upload_id,p_mapping,p_payload)$$;
create function public.atlas_read_reforecast_import_receipt(p_community_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select atlas_private.read_reforecast_import_receipt(p_community_id,p_request_id)$$;
create function public.atlas_read_reforecast_save_receipt(p_community_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select atlas_private.read_reforecast_save_receipt(p_community_id,p_request_id)$$;
revoke all on function atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb),atlas_private.read_reforecast_import_receipt(uuid,uuid),public.atlas_create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb),public.atlas_read_reforecast_import_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb),atlas_private.read_reforecast_import_receipt(uuid,uuid),public.atlas_create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb),public.atlas_read_reforecast_import_receipt(uuid,uuid) to authenticated;
revoke all on function atlas_private.read_reforecast_save_receipt(uuid,uuid),public.atlas_read_reforecast_save_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas_private.read_reforecast_save_receipt(uuid,uuid),public.atlas_read_reforecast_save_receipt(uuid,uuid) to authenticated;

-- Preserve reviewed original-budget absence in immutable official reports.
create or replace function atlas_private.reforecast_report_snapshot(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;lines jsonb;drivers jsonb;schedules jsonb;item jsonb;monthly jsonb:='[]';metric_keys text[]:=array['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow','margin'];
begin
 result:=atlas_private.reforecast_report_fields(input,array['schemaVersion','communityId','periods','status','cutoffPeriod','completeness']);
 result:=result||jsonb_build_object('originalPublicationFingerprint',input->'fingerprint','identity',atlas_private.reforecast_report_fields(input->'identity',array['engineVersion','communityId','periods','actualCutoff','actualCloseVersions','mappingRegistryVersion','baselineVersionIds','baselineVersionId','baselineSourceType','baselinePeriodVersions','closeVersions','registryVersion','sourceVersion','driverVersion','scenarioId','scenarioVersion','reforecastVersion','scenarioPurpose','parentPublication','sourceHashes']));
 result:=jsonb_set(result,'{identity,baselinePeriodVersions}',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','sourceType','versionId','publicationId','revisionId','contentHash','sourceHash','closeVersionId','verified','status'])),'[]') from jsonb_array_elements(coalesce(input->'identity'->'baselinePeriodVersions','[]'))v));
 select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','accountName','department','category','nature','identifier','placement','originalBudget','selectedBaseline','actual','forecast','sourceKind','closeVersionId','mappingValid','immutable','retired','applicable','forecastVariance','actualVariance','forecastFavorability','actualFavorability'])||jsonb_build_object('baselineDisposition',atlas_private.reforecast_report_fields(v->'baselineDisposition',array['kind','confirmed','reviewedBy','reviewedAt','reason','originalBudgetVersionIds']),'baselineLineage',atlas_private.reforecast_report_fields(v->'baselineLineage',array['sourceType','versionId','publicationId','revisionId','contentHash','sourceHash'])) order by v->>'period',v->>'accountCode'),'[]') into lines from jsonb_array_elements(coalesce(input->'lines','[]'))v;
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

revoke all on function atlas_private.reforecast_report_snapshot(jsonb) from public,anon,authenticated;

commit;
