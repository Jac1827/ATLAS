-- Complete workbook evidence is stored once; receipts retain a verified reference.
create table public.atlas_workbook_audits(
 audit_id uuid primary key default gen_random_uuid(),source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 owner_id uuid not null references auth.users(id),request_id uuid not null,evidence jsonb not null,server_validation jsonb not null,created_at timestamptz not null default now(),
 unique(owner_id,source_hash,fingerprint),unique(owner_id,request_id)
);
create table public.atlas_workbook_audit_scopes(audit_id uuid not null references public.atlas_workbook_audits(audit_id),community_id uuid not null references public.atlas_communities(community_id),assigned_by uuid not null references auth.users(id),assigned_at timestamptz not null default now(),primary key(audit_id,community_id));
alter table public.atlas_workbook_audits enable row level security;
alter table public.atlas_workbook_audit_scopes enable row level security;
revoke all on public.atlas_workbook_audits,public.atlas_workbook_audit_scopes from public,anon,authenticated;
grant select on public.atlas_workbook_audits,public.atlas_workbook_audit_scopes to authenticated;
create policy audit_scope_read on public.atlas_workbook_audit_scopes for select to authenticated using(atlas_private.command_access(community_id) or atlas_private.reforecast_access(community_id,'read'));
create policy audit_evidence_read on public.atlas_workbook_audits for select to authenticated using(owner_id=auth.uid() or exists(select 1 from public.atlas_workbook_audit_scopes s where s.audit_id=atlas_workbook_audits.audit_id and (atlas_private.command_access(s.community_id) or atlas_private.reforecast_access(s.community_id,'read'))));
create trigger workbook_audit_immutable before update or delete on public.atlas_workbook_audits for each row execute function atlas_private.finance_immutable();
create trigger workbook_audit_scope_immutable before update or delete on public.atlas_workbook_audit_scopes for each row execute function atlas_private.finance_immutable();

create function public.atlas_bind_workbook_audit(p_audit_id uuid,p_community_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.atlas_workbook_audits;
begin
 select * into a from public.atlas_workbook_audits where audit_id=p_audit_id;
 if auth.uid() is null or a.audit_id is null or not (atlas_private.command_access(p_community_id) or atlas_private.reforecast_access(p_community_id,'edit')) or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role in ('admin','executive','regional','finance','community_manager')) then raise exception 'Authorized workbook community assignment required';end if;
 if a.owner_id<>auth.uid() and not exists(select 1 from public.atlas_workbook_audit_scopes s where s.audit_id=a.audit_id and (atlas_private.command_access(s.community_id) or atlas_private.reforecast_access(s.community_id,'read'))) then raise exception 'Workbook evidence is outside your authorized scope';end if;
 insert into public.atlas_workbook_audit_scopes(audit_id,community_id,assigned_by) values(a.audit_id,p_community_id,auth.uid()) on conflict do nothing;return a.audit_id;
end;$$;
create function public.atlas_save_workbook_audit(p_community_id uuid,p_source_hash text,p_audit jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.atlas_workbook_audits; fp text;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role in ('admin','executive','regional','finance','community_manager')) then raise exception 'Authorized workbook uploader required';end if;
 if p_request_id is null or p_source_hash!~'^[a-f0-9]{64}$' or p_audit->>'schemaVersion' is distinct from 'atlas.workbook-integrity.v1' or octet_length(p_audit::text)>134217728 or jsonb_typeof(p_audit->'inventory'->'sheets') is distinct from 'array' then raise exception 'Complete workbook audit and source hash required (128 MB maximum)';end if;
 fp:=encode(sha256(convert_to(atlas_private.workbook_canonical_json(p_audit-'fingerprint'),'UTF8')),'hex');
 if p_audit->>'fingerprint' is distinct from fp or (p_audit->'inventory'->>'sourceHash' is distinct from p_source_hash) then raise exception 'Workbook audit fingerprint does not match retained evidence';end if;
 select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and request_id=p_request_id;
 if found and (a.source_hash<>p_source_hash or a.fingerprint<>fp) then raise exception 'Workbook request ID reused with different evidence';end if;
 if a.audit_id is null then select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and source_hash=p_source_hash and fingerprint=fp;end if;
 if a.audit_id is null then insert into public.atlas_workbook_audits(source_hash,fingerprint,owner_id,request_id,evidence,server_validation) values(p_source_hash,fp,auth.uid(),p_request_id,p_audit,atlas_private.workbook_integrity_issues(p_audit)) on conflict(owner_id,source_hash,fingerprint) do nothing returning * into a;if a.audit_id is null then select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and source_hash=p_source_hash and fingerprint=fp;end if;end if;
 if p_community_id is not null then perform public.atlas_bind_workbook_audit(a.audit_id,p_community_id);end if;
 return jsonb_build_object('audit_id',a.audit_id,'source_hash',a.source_hash,'fingerprint',a.fingerprint,'owner_id',a.owner_id,'created_at',a.created_at);
end;$$;
create function atlas_private.resolve_workbook_audit(r jsonb,source_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.atlas_workbook_audits;
begin
 if r->>'auditId' is null then if r->'inventory'->>'sourceHash' is distinct from source_hash then raise exception 'Workbook audit source hash mismatch';end if;return r;end if;
 select * into a from public.atlas_workbook_audits where audit_id=(r->>'auditId')::uuid;
 if a.audit_id is null or a.source_hash is distinct from source_hash or a.fingerprint is distinct from r->>'fingerprint' or (auth.uid() is not null and a.owner_id<>auth.uid() and not exists(select 1 from public.atlas_workbook_audit_scopes s where s.audit_id=a.audit_id and (atlas_private.command_access(s.community_id) or atlas_private.reforecast_access(s.community_id,'read')))) then raise exception 'Workbook audit source, fingerprint or authorization mismatch';end if;
 return a.evidence;
end;$$;
revoke all on function public.atlas_bind_workbook_audit(uuid,uuid),public.atlas_save_workbook_audit(uuid,text,jsonb,uuid),atlas_private.resolve_workbook_audit(jsonb,text) from public,anon,authenticated;
grant execute on function public.atlas_bind_workbook_audit(uuid,uuid),public.atlas_save_workbook_audit(uuid,text,jsonb,uuid) to authenticated;

-- Static workbook validation is computed once at insert. Immutable rows make
-- its result safe to reuse for every workflow transition and publication retry.
create function atlas_private.workbook_audit_issues(r jsonb,source_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare audit jsonb;result jsonb;
begin
 audit:=atlas_private.resolve_workbook_audit(r,source_hash);
 if r->>'auditId' is null then return atlas_private.workbook_integrity_issues(audit);end if;
 select server_validation into result from public.atlas_workbook_audits where audit_id=(r->>'auditId')::uuid;
 if result is null then raise exception 'Workbook server validation is unavailable';end if;
 return result;
end;$$;
revoke all on function atlas_private.workbook_audit_issues(jsonb,text) from public,anon,authenticated;

alter function atlas_private.finance_intake_validation(jsonb,uuid) rename to finance_intake_validation_pre_workbook;
create function atlas_private.finance_intake_validation(c jsonb,cid uuid default null) returns jsonb language plpgsql stable set search_path='' as $$
declare v jsonb:=atlas_private.finance_intake_validation_pre_workbook(c,cid); e jsonb:=c->'intakeEvidence';g jsonb:=e->'governance';audit jsonb;issues jsonb:='[]';r jsonb;m jsonb;leaf_count integer;mapping_count integer;expected_factor integer;revenue_factors jsonb;noi_factors jsonb;cash_factors jsonb;row_key text;
begin
 if g->>'schemaVersion' is distinct from 'atlas-monthly-governance/1' or g->>'confirmed' is distinct from 'true' then issues:=issues||jsonb_build_array(jsonb_build_object('code','monthly_governance_required'));end if;
 if coalesce(g->>'reportingBasis','') not in ('calendar','fiscal') or coalesce(g->>'fiscalStartMonth','')!~'^(1[0-2]|[1-9])$' or (g->>'reportingBasis'='calendar' and g->>'fiscalStartMonth'<>'1') or g->>'scenario' is distinct from 'actuals' or g->>'accountingBasis' is distinct from c->'metadata'->>'basis' or g->>'currency' is distinct from 'USD' then issues:=issues||jsonb_build_array(jsonb_build_object('code','reporting_basis_scenario_currency_required'));end if;
 if g->>'mappingVersion' is distinct from e->>'mappingVersion' or g->'review'->>'owner' is distinct from e->>'confirmedBy' or coalesce(g->'review'->>'owner','')='' or g->'review'->>'effectivePeriod' is distinct from c->'metadata'->>'period' or length(trim(coalesce(g->'review'->>'reason','')))<10 or coalesce(g->'review'->>'at','')='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','mapping_review_owner_reason_period'));end if;
 select count(*) into leaf_count from jsonb_array_elements(coalesce(c->'rows','[]')) x where x->>'kind'='posting';select count(*) into mapping_count from jsonb_array_elements(coalesce(g->'mappings','[]'));
 if leaf_count<>mapping_count or exists(select 1 from jsonb_array_elements(coalesce(g->'mappings','[]')) x group by x->>'sourceRowId' having count(*)<>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','complete_unique_leaf_mappings_required'));end if;
 select value->'factors' into revenue_factors from jsonb_array_elements(coalesce(e->'hierarchy','[]')) where value->>'metricKey'='revenue';
 select value->'factors' into noi_factors from jsonb_array_elements(coalesce(e->'hierarchy','[]')) where value->>'metricKey'='noi';
 select value->'factors' into cash_factors from jsonb_array_elements(coalesce(e->'hierarchy','[]')) where value->>'metricKey'='cashFlow';
 for r in select value from jsonb_array_elements(coalesce(c->'rows','[]')) where value->>'kind'='posting' loop
  select value into m from jsonb_array_elements(coalesce(g->'mappings','[]')) where value->>'sourceRowId'=r->'source'->>'rowId';
  if m is null or m->>'glCode' is distinct from r->>'glCode' or m->'source'->>'sheet' is distinct from r->'source'->>'sheet' or m->'source'->>'row' is distinct from r->'source'->>'row' or m->'source'->>'address' is distinct from r->'source'->'cells'->>'actual' or coalesce(m->>'nature','') not in ('income','contra_income','expense','below_noi','capital','debt') or coalesce(m->>'placement','') not in ('above_noi','below_noi') or coalesce(m->>'signMultiplier','') not in ('1','-1') then issues:=issues||jsonb_build_array(jsonb_build_object('code','account_interpretation_required','rowId',r->'source'->>'rowId'));end if;
  row_key:=r->'source'->>'rowId';
  if revenue_factors ? row_key then expected_factor:=(revenue_factors->>row_key)::integer;
   if m->>'nature' not in ('income','contra_income') or m->>'placement'<>'above_noi' then issues:=issues||jsonb_build_array(jsonb_build_object('code','mapping_differs_from_reconciled_controls','rowId',row_key));end if;
  elsif noi_factors ? row_key then expected_factor:=-(noi_factors->>row_key)::integer;
   if m->>'nature'<>'expense' or m->>'placement'<>'above_noi' then issues:=issues||jsonb_build_array(jsonb_build_object('code','mapping_differs_from_reconciled_controls','rowId',row_key));end if;
  else expected_factor:=case when cash_factors ? row_key then -(cash_factors->>row_key)::integer else 1 end;
   if m->>'nature' not in ('below_noi','capital','debt') or m->>'placement'<>'below_noi' then issues:=issues||jsonb_build_array(jsonb_build_object('code','mapping_differs_from_reconciled_controls','rowId',row_key));end if;
  end if;
  if m->>'signMultiplier' is distinct from expected_factor::text then issues:=issues||jsonb_build_array(jsonb_build_object('code','mapping_sign_does_not_reconcile','rowId',row_key));end if;
 end loop;
 if lower(c->>'sourceFile') like '%.xlsx' then
  audit:=atlas_private.resolve_workbook_audit(e->'workbookAudit',c->>'sourceHash');issues:=issues||atlas_private.workbook_audit_issues(e->'workbookAudit',c->>'sourceHash');
  if g->>'auditFingerprint' is distinct from audit->>'fingerprint' or (jsonb_array_length(coalesce(audit->'findings','[]'))>0 and g->>'findingsReviewed' is distinct from 'true') then issues:=issues||jsonb_build_array(jsonb_build_object('code','workbook_audit_review_required'));end if;
  if exists(select 1 from jsonb_array_elements(c->'rows') source_row where not coalesce(audit->'authorityScope'->'selectedCells','[]') ? ((source_row->'source'->>'sheet')||'!'||(source_row->'source'->'cells'->>'actual'))) then issues:=issues||jsonb_build_array(jsonb_build_object('code','monthly_dependency_scope_incomplete'));end if;
  if exists(
   select 1 from jsonb_array_elements(audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')cell
   where exists(select 1 from jsonb_array_elements(e->'selectedActualColumns')col where col->>'sheet'=s->>'name' and (cell->>'row')::integer<=(col->>'headerRow')::integer)
    or (cell->>'column' in ('1','2') and exists(select 1 from jsonb_array_elements(c->'rows')row where row->'source'->>'sheet'=s->>'name' and row->'source'->>'row'=cell->>'row'))
   group by cell having not(coalesce(audit->'authorityScope'->'selectedCells','[]') ? (cell->>'id'))
  ) then issues:=issues||jsonb_build_array(jsonb_build_object('code','monthly_identity_period_scope_incomplete'));end if;
 end if;
 return v||jsonb_build_object('issues',coalesce(v->'issues','[]')||issues,'exceptionCount',coalesce((v->>'exceptionCount')::int,0)+jsonb_array_length(issues),'mappingReady',(v->>'mappingReady')::boolean and jsonb_array_length(issues)=0,'reconciled',(v->>'reconciled')::boolean and jsonb_array_length(issues)=0);
end;$$;
revoke all on function atlas_private.finance_intake_validation_pre_workbook(jsonb,uuid),atlas_private.finance_intake_validation(jsonb,uuid) from public,anon,authenticated;

create or replace function public.atlas_read_finance(p_community_ids uuid[],p_periods text[])
returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(cardinality(p_community_ids),0) not between 1 and 100 or coalesce(cardinality(p_periods),0) not between 1 and 24 or cardinality(p_community_ids)*cardinality(p_periods)>1200 or exists(select 1 from unnest(p_periods) p where p is null or p !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'Invalid finance read scope';end if;
 return query select f.community_id,f.period_key,f.fiscal_year,f.publication_id,
 f.summary||jsonb_build_object('actualContentHash',v.content_hash,'budgetContentHash',b.content_hash,'publicationId',f.publication_id,'coverageContentHash',cp.content_hash,'close',case when v.version_id is not null then
 jsonb_build_object('version_id',v.version_id,'content_hash',v.content_hash,'comparison_version_id',v.comparison_version_id,'community_id',v.community_id,'period_key',v.period_key,'status',v.status,'coverage',v.coverage,'accounting_basis',v.accounting_basis,'source_file',v.source_file,'source_hash',v.source_hash,'approved_by',v.approved_by,'approved_at',v.approved_at,'revision',v.revision,'row_count',v.row_count,
 'metrics',jsonb_build_object('grossPotentialRent',f.summary->'gpr'->'actual','netRentalIncome',f.summary->'netRentalIncome'->'actual','totalIncome',f.summary->'revenue'->'actual','operatingExpenses',f.summary->'expenses'->'actual','netOperatingIncome',f.summary->'noi'->'actual','netCashFlow',f.summary->'cashFlow'->'actual')) end)
 from public.atlas_command_financial_summaries f
 left join public.atlas_financial_close_versions v on v.version_id=(f.summary->>'actualCloseVersion')::uuid
 left join public.atlas_approved_budget_versions b on b.version_id=(f.summary->>'budgetVersion')::uuid
 left join public.atlas_financial_coverage_policies cp on cp.policy_id=(f.summary->'coveragePolicy'->>'policyId')::uuid
 where f.community_id=any(p_community_ids) and f.period_key=any(p_periods) and f.summary->>'registryVersion'='atlas-finance-v1' and atlas_private.command_access(f.community_id);
end;$$;

-- Bind the human mapping attestation to its durable review creator, not a client-supplied name.
create function atlas_private.financial_mapping_reviewer_guard() returns trigger language plpgsql set search_path='' as $$
declare prior public.atlas_financial_package_reviews;current_audit jsonb;prior_audit jsonb;
begin
 if new.certificate->'intakeEvidence'->'governance'->'review'->>'owner' is distinct from new.created_by::text or new.created_by is distinct from auth.uid() then raise exception 'The mapping review must be recorded by its signed-in owner';end if;
 if lower(new.source_file) like '%.xlsx' then
  select * into prior from public.atlas_financial_package_reviews where community_id=new.community_id and period_key=new.period_key order by created_at desc limit 1;
  if prior.review_id is not null and prior.source_hash<>new.source_hash and prior.certificate->'intakeEvidence'->'workbookAudit'->>'fingerprint' is not null then
   current_audit:=atlas_private.resolve_workbook_audit(new.certificate->'intakeEvidence'->'workbookAudit',new.source_hash);
   prior_audit:=atlas_private.resolve_workbook_audit(prior.certificate->'intakeEvidence'->'workbookAudit',prior.source_hash);
   if current_audit->>'previousFingerprint' is distinct from prior_audit->>'fingerprint' then raise exception 'Compare this re-import against the latest immutable workbook review before saving';end if;
   if exists(
    with old_cells as (select cell from jsonb_array_elements(prior_audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')cell),
    new_cells as (select cell from jsonb_array_elements(current_audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')cell)
    select 1 from old_cells o left join new_cells n on n.cell->>'id'=o.cell->>'id'
    where (current_audit->'authorityScope'->'requiredNodes') ? (o.cell->>'id') and
     ((o.cell->>'formula' is not null and o.cell->>'formula' is distinct from n.cell->>'formula') or
      (jsonb_typeof(o.cell->'value')='number' and jsonb_typeof(n.cell->'value')='number' and (o.cell->>'value')::numeric*(n.cell->>'value')::numeric<0))
   ) then raise exception 'Re-import changed a required formula, replaced a formula with a hardcode, or reversed a source sign. Reconcile the source before approval';end if;
  end if;
 end if;
 return new;
end;$$;
revoke all on function atlas_private.financial_mapping_reviewer_guard() from public,anon,authenticated;
create trigger financial_mapping_reviewer_guard before insert on public.atlas_financial_package_reviews for each row execute function atlas_private.financial_mapping_reviewer_guard();
