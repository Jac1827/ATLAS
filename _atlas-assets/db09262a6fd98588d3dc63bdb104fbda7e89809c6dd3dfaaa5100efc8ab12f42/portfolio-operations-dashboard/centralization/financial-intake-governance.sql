-- Durable intake evidence and publication receipts. Apply after canonical finance,
-- financial coverage starts, and reforecast governance. No historical version is deleted.
begin;
create table public.atlas_financial_intake_workflows(
 workflow_id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('actuals','budget')),
 community_id uuid references public.atlas_communities(community_id),owner_id uuid not null references auth.users(id),
 source_hash text not null check(source_hash~'^[0-9a-f]{64}$'),source_file text not null,period_key text,
 current_receipt_id uuid,status text not null default 'uploaded',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.atlas_financial_intake_receipts(
 receipt_id uuid primary key default gen_random_uuid(),workflow_id uuid not null references public.atlas_financial_intake_workflows(workflow_id),
 community_id uuid references public.atlas_communities(community_id),request_id uuid not null unique,request_hash text not null,
 status text not null check(status in ('uploaded','classified','community_period_confirmed','fully_mapped','reconciled','review_saved','admin_closed','canonically_published','readback_verified')),
 state text not null,source_hash text not null,mapping_version text,inventory_count integer not null,leaf_count integer not null,control_count integer not null,exception_count integer not null,
 previous_receipt_id uuid references public.atlas_financial_intake_receipts(receipt_id),prior_version_id uuid,version_id uuid,content_hash text,
 publication_ids uuid[] not null default '{}',actor_id uuid not null references auth.users(id),actor_role text not null,created_at timestamptz not null default now(),evidence jsonb not null
);
alter table public.atlas_financial_intake_workflows add foreign key(current_receipt_id) references public.atlas_financial_intake_receipts(receipt_id);
create table public.atlas_financial_review_intakes(review_id uuid primary key references public.atlas_financial_package_reviews(review_id),workflow_id uuid not null references public.atlas_financial_intake_workflows(workflow_id),receipt_id uuid not null references public.atlas_financial_intake_receipts(receipt_id));
create table public.atlas_financial_coverage_policies(
 policy_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),previous_policy_id uuid references public.atlas_financial_coverage_policies(policy_id),
 request_id uuid not null unique,content_hash text not null,payload jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table public.atlas_financial_coverage_heads(community_id uuid primary key references public.atlas_communities(community_id),policy_id uuid not null references public.atlas_financial_coverage_policies(policy_id));
create index financial_intake_workflow_owner on public.atlas_financial_intake_workflows(owner_id,created_at desc);
create index financial_intake_receipt_scope on public.atlas_financial_intake_receipts(workflow_id,created_at,receipt_id);
create index financial_intake_receipt_version on public.atlas_financial_intake_receipts(version_id,status);
create or replace function atlas_private.financial_intake_access(cid uuid,owner uuid,writing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and case when cid is not null then atlas_private.financial_review_access(cid,writing) else owner=auth.uid() and exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and not('12'=any(coalesce(locked_tab_ids,'{}'))) and not('budget'=any(coalesce(locked_page_keys,'{}')))) end;
$$;
do $$declare t text;begin
 foreach t in array array['atlas_financial_intake_workflows','atlas_financial_intake_receipts','atlas_financial_review_intakes','atlas_financial_coverage_policies','atlas_financial_coverage_heads'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['atlas_financial_intake_receipts','atlas_financial_review_intakes','atlas_financial_coverage_policies'] loop execute format('create trigger financial_intake_immutable before update or delete on public.%I for each row execute function atlas_private.finance_immutable()',t);end loop;
end;$$;
create policy financial_intake_read on public.atlas_financial_intake_workflows for select to authenticated using(atlas_private.financial_intake_access(community_id,owner_id));
create policy financial_receipt_read on public.atlas_financial_intake_receipts for select to authenticated using(exists(select 1 from public.atlas_financial_intake_workflows w where w.workflow_id=atlas_financial_intake_receipts.workflow_id));
create policy financial_review_intake_read on public.atlas_financial_review_intakes for select to authenticated using(exists(select 1 from public.atlas_financial_intake_workflows w where w.workflow_id=atlas_financial_review_intakes.workflow_id));
create policy financial_coverage_read on public.atlas_financial_coverage_policies for select to authenticated using(atlas_private.financial_review_access(community_id));
create policy financial_coverage_head_read on public.atlas_financial_coverage_heads for select to authenticated using(atlas_private.financial_review_access(community_id));

create function atlas_private.finance_canonical_json(v jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;begin
 case jsonb_typeof(v)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||atlas_private.finance_canonical_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(v);
 when 'array' then select '['||coalesce(string_agg(atlas_private.finance_canonical_json(value),',' order by ord),'')||']' into result from jsonb_array_elements(v) with ordinality a(value,ord);
 else result:=v::text;end case;return result;end;$$;
create function atlas_private.finance_source_number(v jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare n text;begin if jsonb_typeof(v)='number' then return v::text::numeric;end if;if jsonb_typeof(v)<>'string' then return null;end if;n:=trim(v#>>'{}');if n!~'^\(?-?[$]?[0-9][0-9,]*(\.[0-9]+)?\)?$' then return null;end if;return (case when left(n,1)='(' then -1 else 1 end)*regexp_replace(n,'[(),$]','','g')::numeric;end;$$;
create function atlas_private.finance_intake_validation(c jsonb,cid uuid default null) returns jsonb language plpgsql immutable set search_path='' as $$
declare e jsonb:=c->'intakeEvidence';r jsonb;row_value jsonb;node jsonb;child text;ids text[]:='{}';leaf_ids text[]:='{}';codes text[]:='{}';control_ids text[]:='{}';seen text[];checks jsonb:='[]';issues jsonb:='[]';metrics jsonb:='{}';counts jsonb;amount numeric;total numeric;tolerance numeric;factor numeric;passed boolean;mapping_ready boolean;checked integer:=0;metric text;fingerprint text;
begin
 if e is null or e->>'version' is distinct from '1' then return jsonb_build_object('mappingReady',false,'reconciled',false,'issues',jsonb_build_array(jsonb_build_object('code','row_evidence_required','message','Complete row inventory, mappings and hierarchy evidence are required.')),'inventoryCount',0,'leafCount',0,'controlCount',0,'checkedLeafCount',0,'exceptionCount',1);end if;
 fingerprint:=encode(sha256(convert_to(atlas_private.finance_canonical_json(e-'evidenceFingerprint'),'UTF8')),'hex');
 if e->>'evidenceFingerprint' is distinct from fingerprint then issues:=issues||jsonb_build_array(jsonb_build_object('code','evidence_fingerprint','message','Source row evidence changed after validation.'));end if;
 if e->>'mappingVersion' is null or coalesce(e->>'parserVersion','')='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','version_required','message','Parser and mapping versions are required.'));end if;
 if e->>'exclusionsReviewed' is distinct from 'true' then issues:=issues||jsonb_build_array(jsonb_build_object('code','exclusions_confirmation','message','Review every supporting column and excluded row before approval.'));end if;
 if e->>'communityConfirmed' is distinct from 'true' or e->>'periodConfirmed' is distinct from 'true' or (cid is not null and e->>'communityId' is distinct from cid::text) then issues:=issues||jsonb_build_array(jsonb_build_object('code','identity_confirmation','message','Confirm the canonical community and reporting period.'));end if;
 if coalesce(e->>'workflow','') not in ('monthly_close','historical_backfill') or (e->>'workflow'='monthly_close' and e->>'sourceKind' is distinct from 'bcr') or (e->>'workflow'='historical_backfill' and e->>'historicalBackfillConfirmed' is distinct from 'true') then issues:=issues||jsonb_build_array(jsonb_build_object('code','source_authority','message','A monthly close requires its authoritative BCR; backfill requires explicit per-month approval.'));end if;
 if e->'selectedActualColumn'->>'type' is distinct from 'monthly_actual' or e->'selectedActualColumn'->>'period' is distinct from c->'metadata'->>'period' or coalesce(e->'selectedActualColumn'->>'sheet','')='' or coalesce(e->'selectedActualColumn'->>'column','')='' or coalesce(e->'selectedActualColumn'->>'header','')='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','actual_column','message','Select exactly one monthly actual column with its source period and header.'));end if;
 if jsonb_typeof(e->'rowInventory') is distinct from 'array' or jsonb_array_length(e->'rowInventory')=0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','empty_inventory','message','The complete source-row inventory is required.'));end if;
 for r in select value from jsonb_array_elements(coalesce(e->'rowInventory','[]')) loop
  if coalesce(r->>'id','')='' or r->>'id'=any(ids) then issues:=issues||jsonb_build_array(jsonb_build_object('code','duplicate_inventory','rowId',r->>'id'));else ids:=array_append(ids,r->>'id');end if;
  if coalesce(r->>'sheet','')='' or r->>'row' is null or r->>'rawLabel' is null or r->>'normalizedLabel' is null or r->>'sourceHash' is distinct from c->>'sourceHash' or r->>'mappingVersion' is distinct from e->>'mappingVersion' or r->'columnMapping' is null or coalesce(r->>'reason','')='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','incomplete_row_lineage','rowId',r->>'id'));end if;
  if coalesce(r->>'disposition','') not in ('mapped_leaf','mapped_control','header_or_section','memo_statistical','supporting','duplicate','excluded') then issues:=issues||jsonb_build_array(jsonb_build_object('code','unresolved_row','rowId',r->>'id'));end if;
  if r->>'disposition' in ('excluded','duplicate') and e->>'exclusionsReviewed' is distinct from 'true' then issues:=issues||jsonb_build_array(jsonb_build_object('code','exclusion_review','rowId',r->>'id'));end if;
  if r->>'disposition'='duplicate' and (r->>'duplicateOf' is null or not exists(select 1 from jsonb_array_elements(e->'rowInventory')v where v->>'id'=r->>'duplicateOf' and v->>'id'<>r->>'id')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','duplicate_identity','rowId',r->>'id'));end if;
  if r->>'disposition' in ('mapped_leaf','mapped_control') and (select atlas_private.finance_source_number(v->'value') from jsonb_array_elements(coalesce(r->'rawCells','[]'))v where v->>'column'=r->'actual'->>'column' limit 1) is distinct from (r->'actual'->>'value')::numeric then issues:=issues||jsonb_build_array(jsonb_build_object('code','raw_actual_mismatch','rowId',r->>'id'));end if;
  if r->>'disposition'='mapped_leaf' then
   leaf_ids:=array_append(leaf_ids,r->>'id');select value into row_value from jsonb_array_elements(coalesce(c->'rows','[]')) where value->'source'->>'rowId'=r->>'id' and value->>'kind'='posting';
   if (select count(*) from jsonb_array_elements(coalesce(c->'rows','[]'))v where v->'source'->>'rowId'=r->>'id' and v->>'kind'='posting')<>1 or coalesce(r->>'glCode','')='' or r->>'glCode'=any(codes) or row_value->>'glCode' is distinct from r->>'glCode' or r->>'included' is distinct from 'true' or jsonb_typeof(row_value->'values'->'actual') is distinct from 'number' or r->'actual'->'value' is distinct from row_value->'values'->'actual' or r->'actual'->>'blank' is distinct from 'false' or r->'actual'->>'period' is distinct from c->'metadata'->>'period' or r->'columnMapping'->'actual'->>'type' is distinct from 'monthly_actual' or r->'columnMapping'->'actual'->>'period' is distinct from c->'metadata'->>'period' or not exists(select 1 from jsonb_array_elements(e->'selectedActualColumns')col where col->>'sheet'=r->>'sheet' and col->>'column'=r->'actual'->>'column' and col->>'period'=c->'metadata'->>'period' and col->>'type'='monthly_actual') then issues:=issues||jsonb_build_array(jsonb_build_object('code','leaf_validation','rowId',r->>'id'));
   else checked:=checked+1;end if;codes:=array_append(codes,r->>'glCode');
  elsif r->>'disposition'='mapped_control' then control_ids:=array_append(control_ids,r->>'id');
   if (select count(*) from jsonb_array_elements(coalesce(c->'rows','[]'))v where v->'source'->>'rowId'=r->>'id' and v->>'kind'='control' and v->'values'->'actual'=r->'actual'->'value' and jsonb_typeof(v->'values'->'actual')='number')<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','control_source_value','rowId',r->>'id'));end if;
   if (select count(*) from jsonb_array_elements(coalesce(e->'hierarchy','[]'))v where v->>'sourceRowId'=r->>'id' and v->>'kind'='rollup')<>1 then issues:=issues||jsonb_build_array(jsonb_build_object('code','unbounded_rollup','rowId',r->>'id'));end if;
  elsif r->>'included'='true' then issues:=issues||jsonb_build_array(jsonb_build_object('code','non_account_included','rowId',r->>'id'));end if;
 end loop;
 if cardinality(leaf_ids)=0 or checked<>cardinality(leaf_ids) or (select count(*) from jsonb_array_elements(coalesce(c->'rows','[]'))v where v->>'kind'='posting')<>cardinality(leaf_ids) then issues:=issues||jsonb_build_array(jsonb_build_object('code','incomplete_leaf_coverage','message','Every included account row must be checked; zero checked leaves is not safe.'));end if;
 if (e->'inventoryCounts'->>'total')::integer is distinct from jsonb_array_length(coalesce(e->'rowInventory','[]')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','inventory_count_mismatch','message','Disposition counts must equal the complete source-row inventory.'));end if;
 if (select count(*) from jsonb_array_elements(coalesce(c->'rows','[]'))v where v->>'kind'='control')<>cardinality(control_ids) then issues:=issues||jsonb_build_array(jsonb_build_object('code','control_inventory_mismatch'));end if;
 for metric in select unnest(array['mapped_leaf','mapped_control','header_or_section','memo_statistical','supporting','duplicate','excluded','unresolved']) loop
  if (e->'inventoryCounts'->>metric)::integer is distinct from (select count(*) from jsonb_array_elements(e->'rowInventory')v where v->>'disposition'=metric) then issues:=issues||jsonb_build_array(jsonb_build_object('code','disposition_count_mismatch','disposition',metric));end if;
 end loop;
 if jsonb_typeof(e->'sourceSheets') is distinct from 'array' or jsonb_array_length(e->'sourceSheets')=0 or exists(select 1 from jsonb_array_elements(e->'sourceSheets')ss group by ss->>'sheet' having count(*)<>1) or (select sum((v->>'inventoryCount')::integer) from jsonb_array_elements(e->'sourceSheets')v) is distinct from cardinality(ids) or exists(select 1 from jsonb_array_elements(e->'sourceSheets')v where v->>'sourceHash' is distinct from c->>'sourceHash' or (v->>'inventoryCount')::integer is distinct from (select count(*) from jsonb_array_elements(e->'rowInventory')ir where ir->>'sheet'=v->>'sheet')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','source_sheet_inventory_mismatch'));end if;
 if jsonb_typeof(e->'selectedActualColumns') is distinct from 'array' or jsonb_array_length(e->'selectedActualColumns')=0 or e->'selectedActualColumns'->0 is distinct from e->'selectedActualColumn' or exists(select 1 from jsonb_array_elements(e->'selectedActualColumns')col where col->>'period' is distinct from c->'metadata'->>'period' or col->>'type' is distinct from 'monthly_actual') or exists(select 1 from jsonb_array_elements(e->'selectedActualColumns')col group by col->>'sheet' having count(*)<>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','multiple_actual_columns'));end if;
 mapping_ready:=jsonb_array_length(issues)=0;
 for node in select value from jsonb_array_elements(coalesce(e->'hierarchy','[]')) loop
  total:=0;seen:='{}';passed:=true;tolerance:=coalesce((node->>'tolerance')::numeric,0.01);
  if tolerance<0 or tolerance>0.01 or jsonb_typeof(node->'childRowIds') is distinct from 'array' or jsonb_array_length(node->'childRowIds')=0 or not(node->>'sourceRowId'=any(control_ids) or node->>'kind'='leaf_control' and node->>'sourceRowId'=any(leaf_ids)) then passed:=false;end if;
  for child in select jsonb_array_elements_text(coalesce(node->'childRowIds','[]')) loop
   select (value->'values'->>'actual')::numeric into amount from jsonb_array_elements(coalesce(c->'rows','[]')) where value->'source'->>'rowId'=child and value->>'kind'='posting';factor:=(node->'factors'->>child)::numeric;
   if not(child=any(leaf_ids)) or child=any(seen) or amount is null or factor is null or factor not in (-1,1) then passed:=false;else total:=total+amount*factor;end if;seen:=array_append(seen,child);
  end loop;
  select value into row_value from jsonb_array_elements(coalesce(e->'rowInventory','[]')) where value->>'id'=node->>'sourceRowId';
  if jsonb_typeof(node->'sourceTotal') is distinct from 'number' or row_value->'actual'->'value' is distinct from node->'sourceTotal' or abs(total-(node->>'sourceTotal')::numeric)>tolerance then passed:=false;end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('id',node->>'id','sourceRowId',node->>'sourceRowId','metricKey',node->>'metricKey','sourceTotal',node->'sourceTotal','calculatedTotal',total,'difference',total-(node->>'sourceTotal')::numeric,'tolerance',tolerance,'contributingRows',node->'childRowIds','passed',passed));
  if not passed then issues:=issues||jsonb_build_array(jsonb_build_object('code','control_reconciliation','rowId',node->>'sourceRowId','message','A required hierarchy/control does not reconcile.'));end if;
  metric:=node->>'metricKey';if metric in ('gpr','netRentalIncome','revenue','expenses','noi','cashFlow') then
   if metrics ? metric then issues:=issues||jsonb_build_array(jsonb_build_object('code','duplicate_metric_control','metric',metric));end if;metrics:=metrics||jsonb_build_object(metric,case when passed then total end);
  end if;
 end loop;
 if not(metrics ? 'expenses') and metrics->>'revenue' is not null and metrics->>'noi' is not null then metrics:=metrics||jsonb_build_object('expenses',(metrics->>'revenue')::numeric-(metrics->>'noi')::numeric);checks:=checks||jsonb_build_array(jsonb_build_object('id','derived-expenses','metricKey','expenses','method','reconciled_revenue_less_noi','sourceControlIds',jsonb_build_array('revenue','noi'),'calculatedTotal',metrics->'expenses','passed',true));end if;
 foreach metric in array array['gpr','revenue','expenses','noi'] loop if not(metrics ? metric) then issues:=issues||jsonb_build_array(jsonb_build_object('code','required_control','metric',metric));end if;end loop;
 if (metrics->>'revenue')::numeric-(metrics->>'expenses')::numeric is distinct from (metrics->>'noi')::numeric then issues:=issues||jsonb_build_array(jsonb_build_object('code','noi_equation'));end if;
 if jsonb_array_length(coalesce(c->'exceptions','[]'))>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','extraction_exceptions'));end if;
 return jsonb_build_object('mappingReady',mapping_ready,'reconciled',jsonb_array_length(issues)=0,'inventoryCount',cardinality(ids),'leafCount',cardinality(leaf_ids),'checkedLeafCount',checked,'controlCount',cardinality(control_ids),'exceptionCount',jsonb_array_length(issues),'issues',issues,'checks',checks,'metrics',metrics,'evidenceFingerprint',fingerprint);
end;$$;

create function atlas_private.finance_receipt(wid uuid,stage text,rid uuid,request_hash text,e jsonb,v jsonb default '{}',version uuid default null,hash text default null,prior uuid default null,pubs uuid[] default '{}')
returns public.atlas_financial_intake_receipts language plpgsql security definer set search_path='' as $$
declare w public.atlas_financial_intake_workflows;r public.atlas_financial_intake_receipts;role_name text;begin
 select * into w from public.atlas_financial_intake_workflows where workflow_id=wid for update;select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 insert into public.atlas_financial_intake_receipts(workflow_id,community_id,request_id,request_hash,status,state,source_hash,mapping_version,inventory_count,leaf_count,control_count,exception_count,previous_receipt_id,prior_version_id,version_id,content_hash,publication_ids,actor_id,actor_role,evidence)
 values(wid,w.community_id,rid,request_hash,stage,case stage when 'community_period_confirmed' then 'Community/Period Confirmed' when 'fully_mapped' then 'Fully Mapped' when 'review_saved' then 'Review Saved' when 'admin_closed' then 'Admin Closed' when 'canonically_published' then 'Canonically Published' when 'readback_verified' then 'Readback Verified' else initcap(stage) end,w.source_hash,coalesce(e->'certificate'->'intakeEvidence'->>'mappingVersion',e->>'mappingVersion'),coalesce((v->>'inventoryCount')::int,0),coalesce((v->>'leafCount')::int,0),coalesce((v->>'controlCount')::int,0),coalesce((v->>'exceptionCount')::int,0),w.current_receipt_id,prior,version,hash,pubs,auth.uid(),role_name,e||jsonb_build_object('validation',v)) returning * into r;
 update public.atlas_financial_intake_workflows set current_receipt_id=r.receipt_id,status=stage,updated_at=now() where workflow_id=wid;return r;
end;$$;
create function public.atlas_record_financial_intake(p_workflow_id uuid,p_request_id uuid,p_expected_receipt_id uuid,p_stage text,p_community_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.atlas_financial_intake_workflows;r public.atlas_financial_intake_receipts;v jsonb:='{}';c jsonb:=p_evidence->'certificate';hash text;stages text[]:=array['uploaded','classified','community_period_confirmed','fully_mapped','reconciled'];begin
 if not atlas_private.financial_intake_access(p_community_id,auth.uid(),true) or p_request_id is null then raise exception 'Financial intake access denied';end if;
 if p_stage is null or p_stage<>all(stages) or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>8388608 or coalesce(p_evidence->>'sourceHash','')!~'^[0-9a-f]{64}$' or coalesce(p_evidence->>'sourceFile','')='' then raise exception 'Invalid intake stage or source evidence';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_workflow_id,p_stage,p_community_id,p_evidence)::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('financial-intake-request:'||p_request_id,0));
 select * into r from public.atlas_financial_intake_receipts where request_id=p_request_id;if found then if r.request_hash<>hash or r.actor_id<>auth.uid() then raise exception 'Intake request ID reused for different evidence';end if;select * into w from public.atlas_financial_intake_workflows where workflow_id=r.workflow_id;return jsonb_build_object('workflow',to_jsonb(w),'receipt',to_jsonb(r));end if;
 if p_workflow_id is null then
  if p_stage<>'uploaded' or p_expected_receipt_id is not null then raise exception 'Start with a durable Uploaded receipt';end if;
  insert into public.atlas_financial_intake_workflows(kind,community_id,owner_id,source_hash,source_file,period_key) values('actuals',p_community_id,auth.uid(),p_evidence->>'sourceHash',p_evidence->>'sourceFile',case when c->'metadata'->>'period'~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then c->'metadata'->>'period' end) returning * into w;
 else
  select * into w from public.atlas_financial_intake_workflows where workflow_id=p_workflow_id for update;
  if w.workflow_id is null or not atlas_private.financial_intake_access(w.community_id,w.owner_id,true) or w.kind<>'actuals' then raise exception 'Intake workflow access denied';end if;
  if w.current_receipt_id is distinct from p_expected_receipt_id then raise exception 'Intake changed in another session; retain edits and reload';end if;
  if w.status<>all(stages) or array_position(stages,p_stage)>array_position(stages,w.status)+1 then raise exception 'Complete each intake state in order; saved reviews require a new intake revision';end if;
  if w.source_hash<>p_evidence->>'sourceHash' or w.source_file<>p_evidence->>'sourceFile' or (w.community_id is not null and w.community_id is distinct from p_community_id) then raise exception 'Source or community changed; create a separate intake workflow';end if;
 end if;
 if c is not null and (c->>'sourceHash' is distinct from w.source_hash or c->>'sourceFile' is distinct from w.source_file) then raise exception 'Certificate does not match immutable source identity';end if;
 if w.community_id is null and c->'metadata'->>'period'~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then update public.atlas_financial_intake_workflows set period_key=c->'metadata'->>'period' where workflow_id=w.workflow_id;end if;
 if p_stage<>'uploaded' and (coalesce(c->'intakeEvidence'->>'sourceKind','')='' or coalesce(c->'intakeEvidence'->>'parserVersion','')='') then raise exception 'Classify the report source before continuing';end if;
 if p_stage in ('community_period_confirmed','fully_mapped','reconciled') then
  if p_community_id is null or c->'intakeEvidence'->>'communityConfirmed' is distinct from 'true' or c->'intakeEvidence'->>'periodConfirmed' is distinct from 'true' or c->'intakeEvidence'->>'communityId' is distinct from p_community_id::text or coalesce(c->'metadata'->>'period','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Explicit canonical community and period confirmation required';end if;
  update public.atlas_financial_intake_workflows set community_id=p_community_id,period_key=c->'metadata'->>'period' where workflow_id=w.workflow_id;
 end if;
 if jsonb_typeof(c->'intakeEvidence'->'rowInventory')='array' then
  select jsonb_build_object('inventoryCount',count(*),'leafCount',count(*) filter(where value->>'disposition'='mapped_leaf'),'controlCount',count(*) filter(where value->>'disposition'='mapped_control'),'exceptionCount',jsonb_array_length(coalesce(c->'exceptions','[]'))+count(*) filter(where value->>'disposition'='unresolved'),'validationComplete',false) into v from jsonb_array_elements(c->'intakeEvidence'->'rowInventory');
 end if;
 if p_stage in ('fully_mapped','reconciled') then v:=atlas_private.finance_intake_validation(c,p_community_id);if v->>'mappingReady'<>'true' then raise exception 'Required row inventory or account checks are incomplete: %',v->'issues';end if;if p_stage='reconciled' and v->>'reconciled'<>'true' then raise exception 'Required controls do not reconcile: %',v->'issues';end if;end if;
 r:=atlas_private.finance_receipt(w.workflow_id,p_stage,p_request_id,hash,p_evidence,v);select * into w from public.atlas_financial_intake_workflows where workflow_id=w.workflow_id;return jsonb_build_object('workflow',to_jsonb(w),'receipt',to_jsonb(r));
end;$$;
-- Keep the pre-existing immutable review storage behind the governed entry point.
alter function public.atlas_save_financial_package_review(uuid,jsonb) rename to atlas_save_financial_package_review_legacy;
alter function public.atlas_save_financial_package_review_legacy(uuid,jsonb) set schema atlas_private;
-- Full source-row and formula evidence is retained; use the same bounded 8 MB envelope as intake.
create or replace function atlas_private.atlas_save_financial_package_review_legacy(p_community_id uuid,p_certificate jsonb)
returns public.atlas_financial_package_reviews language plpgsql security definer set search_path='' as $$
declare result public.atlas_financial_package_reviews; fp text; r jsonb; ids text[]:='{}'; k text; source_name text;
begin
 if not atlas_private.financial_review_access(p_community_id,true) then raise exception 'Financial review access denied';end if;
 if p_certificate is null or octet_length(p_certificate::text)>8388608 or jsonb_typeof(p_certificate->'rows') is distinct from 'array'
 or jsonb_array_length(p_certificate->'rows') not between 1 and 10000
 or (p_certificate->>'schemaVersion') is distinct from '1'
 or coalesce(p_certificate->>'sourceHash','') !~ '^[0-9a-f]{64}$'
 or length(coalesce(p_certificate->>'sourceFile','')) not between 1 and 255
 or coalesce(p_certificate->'metadata'->>'basis','') not in ('accrual','cash') then raise exception 'Invalid financial review certificate';end if;
 source_name:=p_certificate->'metadata'->>'sourceProperty';
 if not exists(select 1 from public.atlas_communities c where c.community_id=p_community_id and (lower(trim(c.display_name))=lower(trim(source_name)) or lower(trim(c.canonical_name))=lower(trim(source_name))))
 and not exists(select 1 from public.atlas_community_aliases a where a.community_id=p_community_id and a.active and lower(trim(a.alias))=lower(trim(source_name))) then raise exception 'Source property requires approved alias mapping';end if;
 for r in select value from jsonb_array_elements(p_certificate->'rows') loop
  if r->>'kind' not in ('posting','control') or jsonb_typeof(r->'source') is distinct from 'object' or length(coalesce(r->>'accountName','')) not between 1 and 250 then raise exception 'Invalid financial row';end if;
  if r->>'kind'='posting' then
   k:=r->>'glCode';if coalesce(k,'') !~ '^[0-9]{4,8}([.-][0-9]+)?$' or k=any(ids) then raise exception 'Invalid or duplicate posting GL';end if;ids:=array_append(ids,k);
  end if;
  foreach k in array array['actual','budget','ytdActual','ytdBudget','annualBudget'] loop
   if jsonb_typeof(r->'values'->k) is null or jsonb_typeof(r->'values'->k) not in ('number','null') then raise exception 'Missing amount must be explicit null';end if;
  end loop;
 end loop;
 -- The client reconciliation is retained as evidence only, never trusted as a close gate.
 p_certificate:=p_certificate||jsonb_build_object('status','Import Review','publicationStatus','Not published','serverCloseValidated',false);
 fp:=encode(sha256(convert_to(p_certificate::text,'UTF8')),'hex');
 insert into public.atlas_financial_package_reviews(community_id,period_key,source_property,source_file,source_hash,accounting_basis,parser_version,content_hash,certificate,created_by)
 values(p_community_id,p_certificate->'metadata'->>'period',source_name,p_certificate->>'sourceFile',p_certificate->>'sourceHash',p_certificate->'metadata'->>'basis',1,fp,p_certificate,auth.uid())
 on conflict(community_id,period_key,source_hash,content_hash) do nothing returning * into result;
 if result.review_id is null then select * into result from public.atlas_financial_package_reviews where community_id=p_community_id and period_key=p_certificate->'metadata'->>'period' and source_hash=p_certificate->>'sourceHash' and content_hash=fp;end if;
 return result;
end;$$;
create function public.atlas_save_financial_review_governed(p_workflow_id uuid,p_expected_receipt_id uuid,p_request_id uuid,p_certificate jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.atlas_financial_intake_workflows;prior public.atlas_financial_intake_receipts;r public.atlas_financial_intake_receipts;review public.atlas_financial_package_reviews;v jsonb;hash text;begin
 select * into w from public.atlas_financial_intake_workflows where workflow_id=p_workflow_id for update;
 if w.community_id is null or not atlas_private.financial_intake_access(w.community_id,w.owner_id,true) or p_request_id is null then raise exception 'Saved review requires an authorized confirmed intake';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_workflow_id,p_certificate)::text,'UTF8')),'hex');select * into r from public.atlas_financial_intake_receipts where request_id=p_request_id;
 if found then if r.request_hash<>hash or r.actor_id<>auth.uid() then raise exception 'Review request ID reused';end if;select * into review from public.atlas_financial_package_reviews where review_id=r.version_id;return jsonb_build_object('workflow',to_jsonb(w),'receipt',to_jsonb(r),'review',to_jsonb(review));end if;
 select * into prior from public.atlas_financial_intake_receipts where receipt_id=w.current_receipt_id;
 if w.current_receipt_id is distinct from p_expected_receipt_id or w.status<>'reconciled' then raise exception 'Read and reconcile the latest intake before saving its review';end if;
 if prior.evidence->'certificate' is distinct from p_certificate then raise exception 'Certificate changed after reconciliation; record and reconcile the changes first';end if;
 v:=atlas_private.finance_intake_validation(p_certificate,w.community_id);if v->>'reconciled'<>'true' then raise exception 'Incomplete or unreconciled financial row evidence';end if;
 review:=atlas_private.atlas_save_financial_package_review_legacy(w.community_id,p_certificate);
 r:=atlas_private.finance_receipt(w.workflow_id,'review_saved',p_request_id,hash,jsonb_build_object('certificate',p_certificate),v,review.review_id,review.content_hash);
 insert into public.atlas_financial_review_intakes values(review.review_id,w.workflow_id,r.receipt_id) on conflict(review_id) do nothing;
 select * into w from public.atlas_financial_intake_workflows where workflow_id=w.workflow_id;return jsonb_build_object('workflow',to_jsonb(w),'receipt',to_jsonb(r),'review',to_jsonb(review));
end;$$;
create function public.atlas_save_financial_package_review(p_community_id uuid,p_certificate jsonb)
returns public.atlas_financial_package_reviews language plpgsql security definer set search_path='' as $$
begin raise exception 'Use the durable intake workflow to save a reconciled financial review';end;$$;

-- Mapping-reviewed monthly actuals may be applied without turning supporting columns into actuals.
alter function public.atlas_apply_financial_comparison(uuid,uuid,text) rename to atlas_apply_financial_comparison_legacy;
alter function public.atlas_apply_financial_comparison_legacy(uuid,uuid,text) set schema atlas_private;
create function public.atlas_apply_financial_comparison(p_review_id uuid,p_expected_version_id uuid default null,p_reason text default null)
returns public.atlas_financial_comparison_versions language plpgsql security definer set search_path='' as $$
declare review public.atlas_financial_package_reviews;r public.atlas_financial_comparison_versions;v jsonb;hash text;current_id uuid;begin
 select * into review from public.atlas_financial_package_reviews where review_id=p_review_id;
 if review.review_id is null or not atlas_private.financial_review_access(review.community_id,true) then raise exception 'Financial comparison access denied';end if;
 if review.certificate->'intakeEvidence' is null then return atlas_private.atlas_apply_financial_comparison_legacy(p_review_id,p_expected_version_id,p_reason);end if;
 v:=atlas_private.finance_intake_validation(review.certificate,review.community_id);if v->>'reconciled'<>'true' or review.accounting_basis<>'accrual' then raise exception 'Complete monthly actual row validation and reconciliation first: %',v->'issues';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance:'||review.community_id,0));
 hash:=encode(sha256(convert_to(jsonb_build_object('sourceHash',review.source_hash,'rows',review.certificate->'rows','evidenceFingerprint',v->'evidenceFingerprint')::text,'UTF8')),'hex');
 select version_id into current_id from public.atlas_financial_comparison_heads where community_id=review.community_id and period_key=review.period_key;
 select * into r from public.atlas_financial_comparison_versions where community_id=review.community_id and period_key=review.period_key and content_hash=hash;
 if r.version_id=current_id then return r;end if;
 if current_id is distinct from p_expected_version_id then raise exception 'Comparison changed in another session. Reload before applying';end if;
 if r.version_id is not null then raise exception 'Prior compared evidence cannot be implicitly reactivated';end if;
 if current_id is not null and length(trim(coalesce(p_reason,'')))<5 then raise exception 'A replacement reason is required';end if;
 insert into public.atlas_financial_comparison_versions(community_id,period_key,review_id,previous_version_id,content_hash,source_hash,source_file,accounting_basis,row_count,reason,applied_by)
 values(review.community_id,review.period_key,review.review_id,current_id,hash,review.source_hash,review.source_file,review.accounting_basis,(v->>'leafCount')::int,p_reason,auth.uid()) returning * into r;
 insert into public.atlas_financial_comparison_rows(version_id,community_id,gl_code,account_name,section,actual,source_budget,ytd_actual,source_ytd_budget,source_annual_budget,source_location)
 select r.version_id,review.community_id,row->>'glCode',row->>'accountName',row->>'section',(row->'values'->>'actual')::numeric,(row->'values'->>'budget')::numeric,(row->'values'->>'ytdActual')::numeric,(row->'values'->>'ytdBudget')::numeric,(row->'values'->>'annualBudget')::numeric,row->'source' from jsonb_array_elements(review.certificate->'rows')row where row->>'kind'='posting';
 insert into public.atlas_financial_comparison_heads values(review.community_id,review.period_key,r.version_id) on conflict(community_id,period_key) do update set version_id=excluded.version_id;return r;
end;$$;

create function atlas_private.finance_coverage(cid uuid,p text,source_hash text default null) returns jsonb language plpgsql stable set search_path='' as $$
declare policy public.atlas_financial_coverage_policies;o jsonb;kind text;reason text;begin
 select v.* into policy from public.atlas_financial_coverage_heads h join public.atlas_financial_coverage_policies v using(policy_id) where h.community_id=cid;
 if policy.policy_id is null then return jsonb_build_object('classification','full_month','fullMonthAllowed',true);end if;
 select value into o from jsonb_array_elements(coalesce(policy.payload->'periodOverrides','[]')) where value->>'period'=p;
 kind:=coalesce(o->>'classification',case when p<policy.payload->>'firstFullMonth' then 'unavailable' else 'full_month' end);reason:=coalesce(o->>'reason',policy.payload->>'reason');
 return jsonb_build_object('policyId',policy.policy_id,'classification',kind,'reason',reason,'retainedVersionIds',coalesce(o->'retainedVersionIds','[]'),'fullMonthAllowed',kind='full_month' and (p>=policy.payload->>'firstFullMonth' or source_hash is not null and o->>'approvedSourceHash'=source_hash),'carryIn',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(coalesce(policy.payload->'carryIn','[]'))v where v->>'reportedPeriod'=p));
end;$$;
create function public.atlas_close_financial_review_governed(p_review_id uuid,p_expected_version_id uuid,p_request_id uuid,p_reason text,p_accounting_approved boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare review public.atlas_financial_package_reviews;w public.atlas_financial_intake_workflows;rec public.atlas_financial_intake_receipts;prior public.atlas_financial_close_versions;closed public.atlas_financial_close_versions;comparison public.atlas_financial_comparison_versions;v jsonb;hash text;cmpid uuid;pubs jsonb;pub_ids uuid[];mapping jsonb;controls jsonb;coverage jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role='admin' and status='active') then raise exception 'Only an active Admin may close financial actuals';end if;
 select * into review from public.atlas_financial_package_reviews where review_id=p_review_id;
 if review.review_id is null or not atlas_private.financial_review_access(review.community_id,true) then raise exception 'Financial close access denied';end if;
 if p_request_id is null or p_accounting_approved is distinct from true or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Idempotency key, Accounting confirmation and close reason required';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_review_id,p_reason,p_accounting_approved)::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('finance:'||review.community_id,0));
 select * into rec from public.atlas_financial_intake_receipts where request_id=p_request_id;
 if found then
  if rec.request_hash<>hash or rec.actor_id<>auth.uid() or rec.status<>'canonically_published' then raise exception 'Close request ID reused for different evidence';end if;
  select * into closed from public.atlas_financial_close_versions where version_id=rec.version_id;select coalesce(jsonb_agg(jsonb_build_object('period_key',p.period_key,'publication_id',p.publication_id,'content_hash',p.fingerprint)),'[]') into pubs from public.atlas_command_financial_publications p where p.publication_id=any(rec.publication_ids);
  return jsonb_build_object('close',to_jsonb(closed),'receipt',to_jsonb(rec),'publications',pubs);
 end if;
 if review.period_key>=to_char(current_date,'YYYY-MM') then raise exception 'Only a completed accounting month can close';end if;
 select wf.* into w from public.atlas_financial_review_intakes i join public.atlas_financial_intake_workflows wf using(workflow_id) where i.review_id=p_review_id;
 if w.workflow_id is null then raise exception 'This historical review needs complete row evidence and a new governed intake before a new close';end if;
 v:=atlas_private.finance_intake_validation(review.certificate,review.community_id);if v->>'reconciled'<>'true' then raise exception 'Financial close blocked by row evidence: %',v->'issues';end if;
 coverage:=atlas_private.finance_coverage(review.community_id,review.period_key,review.source_hash);
 if coverage->>'fullMonthAllowed'<>'true' or coalesce(review.certificate->'intakeEvidence'->'coverage'->>'classification','full_month')<>'full_month' then raise exception 'This source is outside authoritative full-month coverage: %',coverage->>'reason';end if;
 if jsonb_array_length(coalesce(coverage->'carryIn','[]'))>0 and review.certificate->'intakeEvidence'->'coverage'->'carryIn' is distinct from coverage->'carryIn' then raise exception 'Review and disclose the coverage policy carry-in treatment without changing monthly actual amounts';end if;
 select cv.* into prior from public.atlas_financial_close_heads h join public.atlas_financial_close_versions cv using(version_id) where h.community_id=review.community_id and h.period_key=review.period_key and h.accounting_basis='accrual';
 if prior.review_id=p_review_id then closed:=prior;else
  if prior.version_id is distinct from p_expected_version_id then raise exception 'Closed version changed in another session. Reload before closing';end if;
  select version_id into cmpid from public.atlas_financial_comparison_heads where community_id=review.community_id and period_key=review.period_key;
  comparison:=public.atlas_apply_financial_comparison(p_review_id,cmpid,p_reason);
  mapping:=jsonb_build_object('mappingVersion',review.certificate->'intakeEvidence'->>'mappingVersion','evidenceFingerprint',v->'evidenceFingerprint','controls',v->'checks','rowInventoryCount',v->'inventoryCount','checkedLeafCount',v->'checkedLeafCount','coverage',coverage);
  controls:=jsonb_build_object('Net Cash Flow',jsonb_build_object('actual',v->'metrics'->'cashFlow'));
  insert into public.atlas_financial_close_versions(community_id,period_key,accounting_basis,comparison_version_id,review_id,previous_version_id,revision,source_hash,source_file,content_hash,approved_by,reason,row_count,metrics,mapping)
  values(review.community_id,review.period_key,review.accounting_basis,comparison.version_id,review.review_id,prior.version_id,coalesce(prior.revision,0)+1,review.source_hash,review.source_file,comparison.content_hash,auth.uid(),p_reason,(v->>'leafCount')::int,jsonb_build_object('netRentalIncome',v->'metrics'->'netRentalIncome','grossPotentialRent',v->'metrics'->'gpr','totalIncome',v->'metrics'->'revenue','operatingExpenses',v->'metrics'->'expenses','netOperatingIncome',v->'metrics'->'noi','sourceControls',controls,'validatedControls',v->'checks'),mapping) returning * into closed;
  insert into public.atlas_financial_close_rows select closed.version_id,review.community_id,r->>'glCode',r->>'accountName',r->>'section',(r->'values'->>'actual')::numeric,(r->'values'->>'ytdActual')::numeric,r->'source' from jsonb_array_elements(review.certificate->'rows')r where r->>'kind'='posting';
  rec:=atlas_private.finance_receipt(w.workflow_id,'admin_closed',gen_random_uuid(),hash,jsonb_build_object('certificate',review.certificate),v,closed.version_id,closed.content_hash,prior.version_id);
  insert into public.atlas_financial_close_heads values(review.community_id,review.period_key,'accrual',closed.version_id) on conflict(community_id,period_key,accounting_basis) do update set version_id=excluded.version_id;
  insert into public.atlas_financial_close_events(version_id,community_id,event_type,actor,detail) values(closed.version_id,closed.community_id,case when prior.version_id is null then 'closed' else 'replacement' end,auth.uid(),jsonb_build_object('reason',p_reason,'validation',v,'coverage',coverage,'previousVersion',prior.version_id));
 end if;
 perform atlas_private.project_finance(review.community_id);
 select array_agg(f.publication_id),jsonb_agg(jsonb_build_object('period_key',f.period_key,'publication_id',f.publication_id,'content_hash',p.fingerprint)) into pub_ids,pubs from public.atlas_command_financial_summaries f join public.atlas_command_financial_publications p using(publication_id) where f.community_id=review.community_id and f.period_key=review.period_key and f.summary->>'actualCloseVersion'=closed.version_id::text;
 if coalesce(cardinality(pub_ids),0)<>1 then raise exception 'Canonical close publication is incomplete';end if;
 rec:=atlas_private.finance_receipt(w.workflow_id,'canonically_published',p_request_id,hash,jsonb_build_object('certificate',review.certificate),v,closed.version_id,closed.content_hash,prior.version_id,pub_ids);
 return jsonb_build_object('close',to_jsonb(closed),'receipt',to_jsonb(rec),'publications',pubs);
end;$$;
create or replace function public.atlas_close_financial_review(p_review_id uuid,p_expected_version_id uuid,p_reason text,p_accounting_approved boolean)
returns public.atlas_financial_close_versions language plpgsql security definer set search_path='' as $$
declare result jsonb;r public.atlas_financial_close_versions;begin
 result:=public.atlas_close_financial_review_governed(p_review_id,p_expected_version_id,gen_random_uuid(),p_reason,p_accounting_approved);select * into r from public.atlas_financial_close_versions where version_id=(result->'close'->>'version_id')::uuid;return r;
end;$$;

create function atlas_private.approve_original_budget_validated(p_community_id uuid,p_payload jsonb)
returns public.atlas_approved_budget_versions language plpgsql security definer set search_path='' as $$
declare r jsonb; part jsonb; k text; codes text[]:='{}'; seen text[]; a jsonb; fp text; prior public.atlas_approved_budget_versions; result public.atlas_approved_budget_versions; y integer; months integer[]; month_idx integer;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role='admin' and status='active') or not atlas_private.command_access(p_community_id,'finance') then raise exception 'Only an active scoped Admin may approve the original budget';end if;
 if p_payload is null or p_payload->>'communityId' is distinct from p_community_id::text or p_payload->>'reviewConfirmed' is distinct from 'true' or p_payload->>'approvedLocked' is distinct from 'true' or p_payload->>'registryVersion' is distinct from 'atlas-finance-v1' or coalesce(p_payload->>'sourceHash','') !~ '^[0-9a-f]{64}$' or coalesce(p_payload->>'sourceFile','')='' or coalesce(p_payload->>'scenarioId','')='' or coalesce(p_payload->>'scenarioVersion','')='' or coalesce(p_payload->>'year','') !~ '^20[0-9]{2}$' or coalesce(p_payload->>'fiscalYear','') !~ '^20[0-9]{2}$' or coalesce(p_payload->>'fiscalStartMonth','') !~ '^(1[0-2]|[1-9])$' or coalesce(p_payload->>'effectiveDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 2000 or octet_length(p_payload::text)>2097152 then raise exception 'Incomplete approved budget and source evidence';end if;
 -- Future approval can be added without changing this original-baseline contract;
 -- it must not become active merely because a browser posts it today.
 if (p_payload->>'effectiveDate')::date>current_date then raise exception 'Future-effective budgets cannot activate before their effective date';end if;
 y:=(p_payload->>'year')::integer;
 if p_payload ? 'coverage' and (jsonb_typeof(p_payload->'coverage') is distinct from 'array' or jsonb_array_length(p_payload->'coverage') not between 1 and 12) then raise exception 'Explicit budget month coverage required';end if;
 select array_agg(value::integer order by value::integer) into months from jsonb_array_elements_text(coalesce(p_payload->'coverage','[0,1,2,3,4,5,6,7,8,9,10,11]'));
 if exists(select 1 from unnest(months) n where n is null or n<0 or n>11) or cardinality(months)<>(select count(distinct n) from unnest(months) n) then raise exception 'Invalid budget month coverage';end if;
 for r in select value from jsonb_array_elements(p_payload->'rows') loop
  k:=r->>'glCode';
  if coalesce(k,'')='' or k=any(codes) or jsonb_typeof(r->'monthly') is distinct from 'array' or jsonb_array_length(r->'monthly')<>12 then raise exception 'Duplicate GL or incomplete twelve-month approved budget';end if;
  codes:=array_append(codes,k);
  for month_idx in 0..11 loop
   a:=r->'monthly'->month_idx;
   if month_idx=any(months) then
    if jsonb_typeof(a) is distinct from 'number' or abs(a::text::numeric)>1000000000000 or round(a::text::numeric,2)<>a::text::numeric then raise exception 'Approved amounts require explicit numeric values; missing is not zero';end if;
   elsif a is distinct from 'null'::jsonb then raise exception 'Amounts outside approved coverage must remain missing';end if;
  end loop;
 end loop;
 if jsonb_typeof(p_payload->'metricMappings') is distinct from 'object' then raise exception 'Reviewed metric GL mappings required';end if;
 for k in select jsonb_object_keys(p_payload->'metricMappings') loop
  if not exists(select 1 from public.atlas_financial_metric_registry where registry_version='atlas-finance-v1' and metric_key=k and availability<>'source_not_supported') then raise exception 'Unsupported metric mapping';end if;
  if jsonb_typeof(p_payload->'metricMappings'->k) is distinct from 'array' then raise exception 'Invalid metric mapping';end if;
  seen:='{}';
  for part in select value from jsonb_array_elements(p_payload->'metricMappings'->k) loop
   if not coalesce(part->>'glCode','')=any(codes) or (part->>'glCode')=any(seen) or coalesce(part->>'factor','') not in ('1','-1') then raise exception 'Invalid or duplicate metric GL mapping';end if;
   seen:=array_append(seen,part->>'glCode');
  end loop;
 end loop;
 foreach k in array array['gpr','revenue','expenses','noi'] loop if coalesce(jsonb_array_length(p_payload->'metricMappings'->k),0)=0 then raise exception 'Explicit reviewed % mapping required',k;end if;end loop;
 if jsonb_typeof(p_payload->'occupancyPct') is distinct from 'array' or jsonb_array_length(p_payload->'occupancyPct')<>12 then raise exception 'Twelve occupancy coverage entries required';end if;
 for a in select value from jsonb_array_elements(p_payload->'occupancyPct') loop
  if a<>'null'::jsonb and (jsonb_typeof(a)<>'number' or a::text::numeric<0 or a::text::numeric>100) then raise exception 'Invalid approved occupancy';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('finance:'||p_community_id::text,0));
 fp:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 select * into prior from public.atlas_approved_budget_versions where community_id=p_community_id and calendar_year=y and content_hash=fp;
 if prior.version_id is not null then
  if prior.content_hash=fp then perform atlas_private.project_finance(p_community_id);return prior;end if;
 end if;
 if exists(select 1 from public.atlas_approved_budget_versions where community_id=p_community_id and calendar_year=y and covered_months && months) then raise exception 'Original approved budget is immutable; revisions and reforecasts cannot overwrite it';end if;
 insert into public.atlas_approved_budget_versions(community_id,calendar_year,fiscal_year,fiscal_start_month,scenario_id,scenario_version,effective_date,source_file,source_hash,content_hash,approved_by,covered_months,payload)
 values(p_community_id,y,(p_payload->>'fiscalYear')::integer,(p_payload->>'fiscalStartMonth')::integer,p_payload->>'scenarioId',p_payload->>'scenarioVersion',(p_payload->>'effectiveDate')::date,p_payload->>'sourceFile',p_payload->>'sourceHash',fp,auth.uid(),months,p_payload) returning * into result;
 return result;
end;$$;
create function public.atlas_approve_original_budget_governed(p_community_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.atlas_approved_budget_versions;w public.atlas_financial_intake_workflows;r public.atlas_financial_intake_receipts;hash text;months integer[];expected integer[];y int;fy int;fm int;pub_ids uuid[];pubs jsonb;v jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role='admin' and status='active') or not atlas_private.command_access(p_community_id,'finance') then raise exception 'Only an active scoped Admin may approve the original budget';end if;
 if p_request_id is null or coalesce(p_payload->>'sourceHashKind','') not in ('workbook_bytes','normalized_approved_rows') or coalesce(p_payload->>'mappingVersion','')='' or jsonb_typeof(p_payload->'coverage') is distinct from 'array' then raise exception 'Idempotency key, explicit source hash basis, mapping version and complete approved coverage required';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_payload)::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('finance:'||p_community_id,0));
 select * into r from public.atlas_financial_intake_receipts where request_id=p_request_id;
 if found then if r.request_hash<>hash or r.actor_id<>auth.uid() or r.status<>'canonically_published' then raise exception 'Budget approval request ID reused for different evidence';end if;select * into b from public.atlas_approved_budget_versions where version_id=r.version_id;else
  y:=(p_payload->>'year')::integer;fy:=(p_payload->>'fiscalYear')::integer;fm:=(p_payload->>'fiscalStartMonth')::integer;
  select array_agg(value::integer order by value::integer) into months from jsonb_array_elements_text(p_payload->'coverage');
  select array_agg(m order by m) into expected from generate_series(0,11)m where case when fm=1 then y=fy else (y=fy-1 and m+1>=fm) or (y=fy and m+1<fm) end;
  if expected is null or months is distinct from expected then raise exception 'Approved coverage must include every month of the fiscal-year segment';end if;
  b:=atlas_private.approve_original_budget_validated(p_community_id,p_payload);perform atlas_private.project_finance(p_community_id);
  insert into public.atlas_financial_intake_workflows(kind,community_id,owner_id,source_hash,source_file,period_key) values('budget',p_community_id,auth.uid(),b.source_hash,b.source_file,b.calendar_year::text) returning * into w;
  select array_agg(f.publication_id) into pub_ids from public.atlas_command_financial_summaries f where f.community_id=p_community_id and f.summary->>'budgetVersion'=b.version_id::text;
  if cardinality(pub_ids)<>cardinality(months) then raise exception 'Budget is not projected into every approved reporting month';end if;
  v:=jsonb_build_object('inventoryCount',jsonb_array_length(p_payload->'rows'),'leafCount',jsonb_array_length(p_payload->'rows'),'controlCount',(select count(*) from jsonb_object_keys(p_payload->'metricMappings')),'exceptionCount',0);
  r:=atlas_private.finance_receipt(w.workflow_id,'canonically_published',p_request_id,hash,jsonb_build_object('mappingVersion',p_payload->>'mappingVersion','budgetPayload',p_payload),v,b.version_id,b.content_hash,null,pub_ids);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('period_key',p.period_key,'publication_id',p.publication_id,'content_hash',p.fingerprint)),'[]') into pubs from public.atlas_command_financial_publications p where p.publication_id=any(r.publication_ids);
 return jsonb_build_object('status','committed','budget',to_jsonb(b),'receipt',to_jsonb(r),'publications',pubs);
end;$$;
create or replace function public.atlas_approve_original_budget(p_community_id uuid,p_payload jsonb)
returns public.atlas_approved_budget_versions language plpgsql security definer set search_path='' as $$
declare response jsonb;r public.atlas_approved_budget_versions;begin
 if coalesce(p_payload->>'requestId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Use central approval with a durable idempotency key; an import-log acceptance is only staged evidence';end if;
 response:=public.atlas_approve_original_budget_governed(p_community_id,(p_payload->>'requestId')::uuid,p_payload-'requestId');select * into r from public.atlas_approved_budget_versions where version_id=(response->'budget'->>'version_id')::uuid;return r;
end;$$;
create function public.atlas_verify_finance_receipt(p_receipt_id uuid,p_version_id uuid,p_content_hash text)
returns public.atlas_financial_intake_receipts language plpgsql security definer set search_path='' as $$
declare r public.atlas_financial_intake_receipts;verified public.atlas_financial_intake_receipts;w public.atlas_financial_intake_workflows;close_v public.atlas_financial_close_versions;budget public.atlas_approved_budget_versions;pub_ids uuid[];begin
 select * into r from public.atlas_financial_intake_receipts where receipt_id=p_receipt_id;select * into w from public.atlas_financial_intake_workflows where workflow_id=r.workflow_id;
 if r.receipt_id is null or not atlas_private.financial_intake_access(w.community_id,w.owner_id) or r.status not in ('canonically_published','readback_verified') or r.version_id is distinct from p_version_id or r.content_hash is distinct from p_content_hash then raise exception 'Committed financial receipt/version/hash mismatch';end if;
 perform pg_advisory_xact_lock(hashtextextended('finance:'||w.community_id,0));
 if w.kind='actuals' then
  select * into close_v from public.atlas_financial_close_versions where version_id=p_version_id and content_hash=p_content_hash and community_id=w.community_id;
  if close_v.version_id is null or close_v.row_count<>(select count(*) from public.atlas_financial_close_rows where version_id=p_version_id) or not exists(select 1 from public.atlas_financial_close_heads h join public.atlas_command_financial_summaries f on f.community_id=h.community_id and f.period_key=h.period_key where h.version_id=p_version_id and f.summary->>'actualCloseVersion'=p_version_id::text and f.publication_id is not null) then raise exception 'Close is saved but current detail/publication readback is incomplete or superseded';end if;
  select array_agg(f.publication_id) into pub_ids from public.atlas_command_financial_summaries f where f.community_id=w.community_id and f.period_key=close_v.period_key;
 else
  select * into budget from public.atlas_approved_budget_versions where version_id=p_version_id and content_hash=p_content_hash and community_id=w.community_id and status='locked';
  select array_agg(f.publication_id) into pub_ids from public.atlas_command_financial_summaries f where f.community_id=w.community_id and f.summary->>'budgetVersion'=p_version_id::text;
  if budget.version_id is null or coalesce(cardinality(pub_ids),0)<>cardinality(budget.covered_months) then raise exception 'Budget is saved but approved coverage publication readback is incomplete';end if;
 end if;
 select * into verified from public.atlas_financial_intake_receipts where workflow_id=w.workflow_id and status='readback_verified' and version_id=p_version_id and content_hash=p_content_hash and actor_id=auth.uid() and publication_ids=pub_ids order by created_at desc limit 1;
 if verified.receipt_id is not null then return verified;end if;
 return atlas_private.finance_receipt(w.workflow_id,'readback_verified',gen_random_uuid(),encode(sha256(convert_to(jsonb_build_array(p_receipt_id,p_version_id,p_content_hash,pub_ids)::text,'UTF8')),'hex'),r.evidence,r.evidence->'validation',p_version_id,p_content_hash,r.prior_version_id,pub_ids);
end;$$;
create function public.atlas_set_financial_coverage_policy(p_community_id uuid,p_expected_policy_id uuid,p_request_id uuid,p_payload jsonb)
returns public.atlas_financial_coverage_policies language plpgsql security definer set search_path='' as $$
declare r public.atlas_financial_coverage_policies;prior uuid;hash text;o jsonb;id text;seen text[]:='{}';first_p text;begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role='admin' and status='active') or not atlas_private.financial_review_access(p_community_id,true) then raise exception 'Only an authorized active Admin can change financial coverage';end if;
 if p_request_id is null or coalesce(p_payload->>'firstFullMonth','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or length(trim(coalesce(p_payload->>'reason','')))<5 or coalesce(p_payload->>'effectiveDate','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$' or (p_payload->>'effectiveDate')::date>current_date then raise exception 'Effective coverage month, date and reason required';end if;
 hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('finance:'||p_community_id,0));
 select * into r from public.atlas_financial_coverage_policies where request_id=p_request_id;if found then if r.community_id<>p_community_id or r.content_hash<>hash or r.actor_id<>auth.uid() then raise exception 'Coverage request ID reused';end if;return r;end if;
 select policy_id into prior from public.atlas_financial_coverage_heads where community_id=p_community_id;if prior is distinct from p_expected_policy_id then raise exception 'Financial coverage changed in another session';end if;
 for o in select value from jsonb_array_elements(coalesce(p_payload->'periodOverrides','[]')) loop
  if coalesce(o->>'period','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or o->>'period'=any(seen) or coalesce(o->>'classification','') not in ('unavailable','partial_startup','prior_period_adjustment','full_month') or coalesce(o->>'reason','')='' then raise exception 'Each coverage exception requires one explicit period, classification and reason';end if;seen:=array_append(seen,o->>'period');
  if o->>'classification'='full_month' and o->>'period'<p_payload->>'firstFullMonth' and coalesce(o->>'approvedSourceHash','')!~'^[0-9a-f]{64}$' then raise exception 'A separate earlier full close requires the explicitly approved source hash';end if;
  for id in select jsonb_array_elements_text(coalesce(o->'retainedVersionIds','[]')) loop if not exists(select 1 from public.atlas_financial_close_versions where version_id=id::uuid and community_id=p_community_id and period_key=o->>'period') then raise exception 'Coverage evidence version does not match the community and period';end if;end loop;
 end loop;
 for o in select value from jsonb_array_elements(coalesce(p_payload->'carryIn','[]')) loop
  if coalesce(o->>'reportedPeriod','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or o->>'treatment' is distinct from 'source_ytd_only' or jsonb_typeof(o->'sourcePeriods') is distinct from 'array' or jsonb_array_length(o->'sourcePeriods')=0 or coalesce(o->>'reason','')='' then raise exception 'Carry-in evidence must disclose source periods and retain monthly actuals unchanged';end if;
  for id in select jsonb_array_elements_text(o->'sourcePeriods') loop if id!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or id>=o->>'reportedPeriod' then raise exception 'Carry-in source periods must precede the reported month';end if;end loop;
  for id in select jsonb_array_elements_text(coalesce(o->'versionIds','[]')) loop if not exists(select 1 from public.atlas_financial_close_versions where version_id=id::uuid and community_id=p_community_id) then raise exception 'Carry-in version community mismatch';end if;end loop;
 end loop;
 insert into public.atlas_financial_coverage_policies(community_id,previous_policy_id,request_id,content_hash,payload,actor_id) values(p_community_id,prior,p_request_id,hash,p_payload,auth.uid()) returning * into r;
 insert into public.atlas_financial_coverage_heads values(p_community_id,r.policy_id) on conflict(community_id) do update set policy_id=excluded.policy_id;
 first_p:=p_payload->>'firstFullMonth';select least(first_p,min(ov->>'period')) into first_p from jsonb_array_elements(coalesce(p_payload->'periodOverrides','[]'))ov where ov->>'classification'='full_month' and exists(select 1 from public.atlas_financial_close_versions v where v.community_id=p_community_id and v.period_key=ov->>'period' and v.source_hash=ov->>'approvedSourceHash');
 update public.atlas_communities set first_expected_financial_period=first_p,financial_coverage_reason=p_payload->>'reason' where community_id=p_community_id;
 perform atlas_private.project_finance(p_community_id);return r;
end;$$;

create or replace function atlas_private.finance_envelope(cid uuid,p text) returns jsonb language plpgsql stable set search_path='' as $$
declare v public.atlas_financial_close_versions; b public.atlas_approved_budget_versions;
 y integer:=left(p,4)::integer; m integer:=right(p,2)::integer; start_p text; fp text; fdate date;
 metric record; av numeric; bv numeric; ya numeric; yb numeric; x numeric; z numeric;
 fv public.atlas_financial_close_versions; fb public.atlas_approved_budget_versions;
 s jsonb:='{}'; ym jsonb:='{}'; close_ids jsonb:='{}'; budget_ids jsonb:='{}'; missing jsonb:='[]'; periods jsonb:='[]';
 latest text; complete_a boolean; complete_b boolean; first_expected text; applicable boolean; coverage_policy jsonb;
begin
 select c.* into v from public.atlas_financial_close_heads h join public.atlas_financial_close_versions c using(version_id) where h.community_id=cid and h.period_key=p and h.accounting_basis='accrual' and atlas_private.finance_coverage(cid,p,c.source_hash)->>'fullMonthAllowed'='true';
 coverage_policy:=atlas_private.finance_coverage(cid,p,v.source_hash);
 select * into b from public.atlas_approved_budget_versions where community_id=cid and calendar_year=y and m-1=any(covered_months) and effective_date<=current_date;
 start_p:=to_char(make_date(y-case when m<coalesce(b.fiscal_start_month,1) then 1 else 0 end,coalesce(b.fiscal_start_month,1),1),'YYYY-MM');
 select first_expected_financial_period into first_expected from public.atlas_communities where community_id=cid;
 applicable:=(first_expected is null or p>=first_expected) and coverage_policy->>'fullMonthAllowed'='true';
 start_p:=greatest(start_p,coalesce(first_expected,start_p));
 select max(period_key) into latest from public.atlas_financial_close_heads where community_id=cid and accounting_basis='accrual' and period_key between start_p and p and atlas_private.finance_coverage(cid,period_key,(select source_hash from public.atlas_financial_close_versions cv where cv.version_id=atlas_financial_close_heads.version_id))->>'fullMonthAllowed'='true';
 for fdate in select generate_series((start_p||'-01')::date,(p||'-01')::date,interval '1 month')::date loop
  fp:=to_char(fdate,'YYYY-MM');periods:=periods||to_jsonb(fp);
  select c.* into fv from public.atlas_financial_close_heads h join public.atlas_financial_close_versions c using(version_id) where h.community_id=cid and h.period_key=fp and h.accounting_basis='accrual' and atlas_private.finance_coverage(cid,fp,c.source_hash)->>'fullMonthAllowed'='true';
  if fv.version_id is null then missing:=missing||to_jsonb(fp);else close_ids:=close_ids||jsonb_build_object(fp,fv.version_id);end if;
  select * into fb from public.atlas_approved_budget_versions where community_id=cid and calendar_year=extract(year from fdate) and extract(month from fdate)::integer-1=any(covered_months) and effective_date<=current_date;
  if fb.version_id is not null then budget_ids:=budget_ids||jsonb_build_object(fp,fb.version_id);end if;
 end loop;
 for metric in select * from public.atlas_financial_metric_registry where registry_version='atlas-finance-v1' order by metric_key loop
  av:=atlas_private.finance_actual_metric(v,metric.metric_key,b.payload);
  bv:=case when metric.availability<>'source_not_supported' then atlas_private.finance_budget_metric(b.payload,metric.metric_key,m-1) end;
  s:=s||jsonb_build_object(metric.metric_key,atlas_private.finance_metric(av,bv,metric.favorable_direction,case when metric.availability='source_not_supported' then metric.definition when metric.availability='approved_gl_scope' and coalesce(jsonb_array_length(b.payload->'metricMappings'->metric.metric_key),0)=0 then 'Approved GL mapping unavailable' when metric.metric_key='cashFlow' and av is null then 'Reconciled cash flow control unavailable' end));
  if metric.availability='source_not_supported' then continue;end if;
  if not applicable then s:=s||jsonb_build_object(metric.metric_key,jsonb_build_object('actual',null,'budget',bv,'variance',null,'status',case when coverage_policy->>'policyId' is not null then 'unavailable' else 'not_applicable' end,'availability',case when coverage_policy->>'policyId' is not null then coverage_policy->>'classification' else 'not_applicable' end,'label',coalesce(coverage_policy->>'reason','Before first expected financial month')));end if;
  ya:=0;yb:=0;complete_a:=applicable;complete_b:=applicable;
  for fp in select jsonb_array_elements_text(periods) loop
   select * into fv from public.atlas_financial_close_versions where version_id=(close_ids->>fp)::uuid;
   select * into fb from public.atlas_approved_budget_versions where version_id=(budget_ids->>fp)::uuid;
   x:=atlas_private.finance_actual_metric(fv,metric.metric_key,fb.payload);
   z:=case when metric.availability<>'source_not_supported' then atlas_private.finance_budget_metric(fb.payload,metric.metric_key,right(fp,2)::integer-1) end;
   if x is null then complete_a:=false;else ya:=ya+x;end if;
   if z is null then complete_b:=false;else yb:=yb+z;end if;
  end loop;
  ym:=ym||jsonb_build_object(metric.metric_key,atlas_private.finance_metric(case when complete_a then ya end,case when complete_b then yb end,metric.favorable_direction));
 end loop;
 return s||jsonb_build_object('schemaVersion',1,'registryVersion','atlas-finance-v1','communityId',cid,'period',p,'periodBasis','calendar_month','accountingBasis','accrual','currency','USD',
 'actualCloseVersion',v.version_id,'budgetVersion',b.version_id,'scenarioId',b.scenario_id,'scenarioVersion',b.scenario_version,'fiscalYear',coalesce(b.fiscal_year,y),
 'sourceTimestamp',v.approved_at,'actualSource',v.source_file,'budgetSource',b.source_file,'budgetEffectiveDate',b.effective_date,'targetApprovalStatus',case when b.version_id is not null then 'approved' else 'missing' end,
 'occupancyPct',b.payload->'occupancyPct'->(m-1),'fiscalStartPeriod',start_p,'fiscalPeriods',periods,'closeVersions',close_ids,'budgetVersions',budget_ids,'latestClosedPeriod',latest,
 'firstExpectedFinancialPeriod',first_expected,'coveragePolicy',coverage_policy,'carryInDisclosure',coverage_policy->'carryIn','applicable',applicable,'missingPeriods',missing,'completeYtd',applicable and jsonb_array_length(missing)=0,'ytd',ym,'ytdGpr',ym->'gpr','ytdExpenses',ym->'expenses',
 'close',case when v.version_id is not null then to_jsonb(v)||jsonb_build_object('metrics',v.metrics||jsonb_build_object('netCashFlow',atlas_private.finance_actual_metric(v,'cashFlow',null))) end);
end;$$;

alter function atlas_private.reforecast_source(uuid,text[],uuid[],uuid) rename to reforecast_source_pre_coverage_policy;
create function atlas_private.reforecast_source(cid uuid,periods text[],budget_ids uuid[] default null,registry_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb;closes jsonb;actuals jsonb;monthly jsonb;excluded jsonb;notes jsonb;cutoff text;begin
 source:=atlas_private.reforecast_source_pre_coverage_policy(cid,periods,budget_ids,registry_id);
 select coalesce(jsonb_agg(v),'[]') into closes from jsonb_array_elements(source->'actuals'->'closeVersions')v where atlas_private.finance_coverage(cid,v->>'period',v->>'sourceHash')->>'fullMonthAllowed'='true';
 select coalesce(jsonb_agg(v),'[]') into actuals from jsonb_array_elements(source->'actuals'->'lines')v where exists(select 1 from jsonb_array_elements(closes)c where c->>'versionId'=v->>'closeVersionId');
 select coalesce(jsonb_agg(v),'[]') into monthly from jsonb_array_elements(source->'actuals'->'monthly')v where exists(select 1 from jsonb_array_elements(closes)c where c->>'versionId'=v->>'closeVersionId');
 select max(h.period_key) into cutoff from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.accounting_basis='accrual' and h.period_key<=(select max(p) from unnest(periods)p) and atlas_private.finance_coverage(cid,h.period_key,v.source_hash)->>'fullMonthAllowed'='true';
 select coalesce(jsonb_agg(p),'[]') into excluded from unnest(periods)p where atlas_private.finance_coverage(cid,p,(select source_hash from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=cid and h.period_key=p and h.accounting_basis='accrual'))->>'fullMonthAllowed'<>'true';
 select coalesce(jsonb_object_agg(p,atlas_private.finance_coverage(cid,p)),'{}') into notes from unnest(periods)p;
 source:=jsonb_set(source,'{actuals}',(source->'actuals')||jsonb_build_object('cutoffPeriod',cutoff,'closeVersions',closes,'lines',actuals,'monthly',monthly,'coveragePolicies',notes,'notApplicablePeriods',(select coalesce(jsonb_agg(distinct v),'[]') from jsonb_array_elements(coalesce(source->'actuals'->'notApplicablePeriods','[]')||excluded)v)));
 return source||jsonb_build_object('sourceVersion',encode(sha256(convert_to((source-'sourceVersion')::text,'UTF8')),'hex'));
end;$$;
create index financial_intake_workflow_community on public.atlas_financial_intake_workflows(community_id);
create index financial_intake_receipt_actor on public.atlas_financial_intake_receipts(actor_id);
create index financial_intake_receipt_prior on public.atlas_financial_intake_receipts(previous_receipt_id);
create index financial_coverage_scope on public.atlas_financial_coverage_policies(community_id,created_at desc);
revoke all on function atlas_private.financial_intake_access(uuid,uuid,boolean) from public,anon;
grant execute on function atlas_private.financial_intake_access(uuid,uuid,boolean) to authenticated;
revoke all on function atlas_private.finance_source_number(jsonb),atlas_private.finance_canonical_json(jsonb),atlas_private.finance_intake_validation(jsonb,uuid),atlas_private.finance_receipt(uuid,text,uuid,text,jsonb,jsonb,uuid,text,uuid,uuid[]),atlas_private.atlas_save_financial_package_review_legacy(uuid,jsonb),atlas_private.atlas_apply_financial_comparison_legacy(uuid,uuid,text),atlas_private.finance_coverage(uuid,text,text),atlas_private.approve_original_budget_validated(uuid,jsonb),atlas_private.finance_envelope(uuid,text),atlas_private.reforecast_source_pre_coverage_policy(uuid,text[],uuid[],uuid),atlas_private.reforecast_source(uuid,text[],uuid[],uuid) from public,anon,authenticated;
revoke all on function public.atlas_record_financial_intake(uuid,uuid,uuid,text,uuid,jsonb),public.atlas_save_financial_review_governed(uuid,uuid,uuid,jsonb),public.atlas_save_financial_package_review(uuid,jsonb),public.atlas_apply_financial_comparison(uuid,uuid,text),public.atlas_close_financial_review_governed(uuid,uuid,uuid,text,boolean),public.atlas_close_financial_review(uuid,uuid,text,boolean),public.atlas_approve_original_budget_governed(uuid,uuid,jsonb),public.atlas_approve_original_budget(uuid,jsonb),public.atlas_verify_finance_receipt(uuid,uuid,text),public.atlas_set_financial_coverage_policy(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.atlas_record_financial_intake(uuid,uuid,uuid,text,uuid,jsonb),public.atlas_save_financial_review_governed(uuid,uuid,uuid,jsonb),public.atlas_save_financial_package_review(uuid,jsonb),public.atlas_apply_financial_comparison(uuid,uuid,text),public.atlas_close_financial_review_governed(uuid,uuid,uuid,text,boolean),public.atlas_close_financial_review(uuid,uuid,text,boolean),public.atlas_approve_original_budget_governed(uuid,uuid,jsonb),public.atlas_approve_original_budget(uuid,jsonb),public.atlas_verify_finance_receipt(uuid,uuid,text),public.atlas_set_financial_coverage_policy(uuid,uuid,uuid,jsonb) to authenticated;
commit;
