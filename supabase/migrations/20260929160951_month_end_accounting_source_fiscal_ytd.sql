-- Fiscal YTD operational review uses the current Accounting package's exact
-- cumulative column. Monthly close coverage, budgets, prior reviews and receipts
-- remain immutable. No source-YTD amount is allocated into monthly close rows.
begin;

do $guard$ declare body text;begin
 select prosrc into body from pg_proc where oid=to_regprocedure('atlas_private.month_end_review(uuid)');
 if body is null or encode(sha256(convert_to(body,'UTF8')),'hex')<>'a560708b9d45b272969dbf1826093164e7e44f71febe7bdfcc59f49eeed1a13a' then
  raise exception 'Month-end source-YTD prerequisite changed; review the existing function before migration';
 end if;
end;$guard$;

create function atlas_private.month_end_source_ytd(c jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare e jsonb:=c->'intakeEvidence'; r jsonb; inventory jsonb; cell jsonb;
 col jsonb; node jsonb; child text; entry jsonb; row_index jsonb; inventory_index jsonb;
 issues jsonb:='[]'; checks jsonb:='[]'; total numeric; amount numeric; factor numeric;
 source_total numeric; passed boolean; seen text[]; leaf_count integer:=0; validated jsonb;
 audit_issues jsonb;
 metrics jsonb:='{}'; control_ids jsonb:='{}'; expense_control jsonb;
 audit jsonb;audit_cells jsonb;audit_cell jsonb;header_cell jsonb;group_cell jsonb;identity_cell jsonb;label_cell jsonb;identity_header jsonb;label_header jsonb;
 is_workbook boolean:=lower(c->>'sourceFile') like '%.xlsx' or jsonb_typeof(e->'workbookAudit')='object'
  or exists(select 1 from jsonb_array_elements(c->'rows') v where v->'columnMapping'->'ytdActual'->>'type'='ytd_actual');
 cell_id text;header_id text;group_id text;header_row integer;column_number integer;ytd_parts text[];start_month integer;end_month integer;
begin
 -- Reuse the existing complete monthly intake validation before reading its
 -- separately retained YTD evidence. Client flags/check results are not authority.
 validated:=atlas_private.finance_intake_validation(c,null);
 if validated->>'reconciled' is distinct from 'true' then
  issues:=issues||jsonb_build_array(jsonb_build_object('code','monthly_source_evidence_invalid','issues',validated->'issues'));
 end if;
 if c->'metadata'->>'basis' is distinct from 'accrual'
    or coalesce(c->'metadata'->>'ytdStart','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or coalesce(c->'metadata'->>'period','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or c->'metadata'->>'ytdStart'>c->'metadata'->>'period' then
  issues:=issues||jsonb_build_array(jsonb_build_object('code','fiscal_ytd_source_period_required'));
 end if;
 if is_workbook then
  -- Inline evidence is never authority for this additional financial input.
  if coalesce(e->'workbookAudit'->>'auditId','')='' then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_retained_audit_required'));
  else
   audit:=atlas_private.resolve_workbook_audit(e->'workbookAudit',c->>'sourceHash');
   -- Worksheet authority is identified from retained evidence as well as the
   -- filename. Renaming a workbook must not bypass its immutable dependency
   -- validation or the review bound to that exact audit fingerprint.
   audit_issues:=atlas_private.workbook_audit_issues(e->'workbookAudit',c->>'sourceHash');
   if jsonb_array_length(audit_issues)>0 then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_audit_dependency_invalid','issues',audit_issues));
   end if;
   if e->'governance'->>'auditFingerprint' is distinct from audit->>'fingerprint'
      or (jsonb_array_length(coalesce(audit->'findings','[]'))>0 and e->'governance'->>'findingsReviewed' is distinct from 'true') then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_audit_review_required'));
   end if;
   if not exists(select 1 from public.atlas_workbook_audit_scopes a where a.audit_id=(e->'workbookAudit'->>'auditId')::uuid and a.community_id::text=e->>'communityId') then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_audit_community_scope_required'));
   end if;
   if audit->'authorityScope'->>'type' is distinct from 'selected_cells_and_dependencies' then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_dependency_scope_required'));
   end if;
   if exists(select 1 from jsonb_array_elements(audit->'inventory'->'sheets') sh cross join lateral jsonb_array_elements(sh->'cells') ac group by ac->>'id' having count(*)<>1) then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_duplicate_audit_cell'));
   end if;
   select jsonb_object_agg(ac->>'id',ac) into audit_cells from jsonb_array_elements(audit->'inventory'->'sheets') sh cross join lateral jsonb_array_elements(sh->'cells') ac;
  end if;
 end if;
 select jsonb_object_agg(v->'source'->>'rowId',v) into row_index from jsonb_array_elements(c->'rows')v;
 select jsonb_object_agg(v->>'id',v) into inventory_index from jsonb_array_elements(e->'rowInventory')v;
 for r in select value from jsonb_array_elements(c->'rows') loop
  inventory:=inventory_index->(r->'source'->>'rowId');col:=r->'columnMapping'->'ytdActual';
  if r->>'kind'='posting' then leaf_count:=leaf_count+1;end if;
  if jsonb_typeof(r->'values'->'ytdActual') is distinct from 'number' then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_value_missing','sourceRowId',r->'source'->>'rowId','glCode',r->>'glCode'));
   continue;
  end if;
  -- Worksheets identify an explicit YTD Actual column; retained PDF certificates
  -- name the fifth printed column ytd_supporting because it creates no monthly
  -- close. That existing name does not make the verified YTD number a budget.
  if col is null or inventory->'columnMapping'->'ytdActual' is distinct from col
     or col->>'sheet' is distinct from r->'source'->>'sheet'
     or col->>'column'=r->'columnMapping'->'actual'->>'column'
     or coalesce(col->>'column','')='' or coalesce(r->'source'->'cells'->>'ytdActual','')=''
     or not coalesce(col->>'type'='ytd_actual' or
       (col->>'type'='ytd_supporting' and col->>'header'='ytdActual'
        and col->>'method'='printed_nine_column_budget_comparison' and col->>'column'='text-column-5'),false) then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_column_unverified','sourceRowId',r->'source'->>'rowId'));
  end if;
  select count(*)=1 into passed from jsonb_array_elements(coalesce(inventory->'rawCells','[]'))v
   where v->>'address'=r->'source'->'cells'->>'ytdActual';
  cell:=null;
  if passed then select v into cell from jsonb_array_elements(inventory->'rawCells')v
   where v->>'address'=r->'source'->'cells'->>'ytdActual';end if;
  if not passed or cell->>'column' is distinct from col->>'column' or cell->>'type'='e' or (cell ? 'formula' and cell->>'hasCachedValue' is distinct from 'true')
     or atlas_private.finance_source_number(cell->'value') is distinct from (r->'values'->>'ytdActual')::numeric then
   issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_raw_value_mismatch','sourceRowId',r->'source'->>'rowId'));
  end if;
  if is_workbook then
   cell_id:=(r->'source'->>'sheet')||'!'||(r->'source'->'cells'->>'ytdActual');audit_cell:=audit_cells->cell_id;
   if audit_cell is null or r->'source'->'cells'->>'ytdActual' is distinct from (col->>'column')||(r->'source'->>'row') or not coalesce(audit->'authorityScope'->'selectedCells' ? cell_id,false)
      or not coalesce(audit->'authorityScope'->'requiredNodes' ? cell_id,false)
      or atlas_private.finance_source_number(audit_cell->'value') is distinct from (r->'values'->>'ytdActual')::numeric
      or audit_cell->>'type'='e' or coalesce(audit_cell->>'formula','') is distinct from coalesce(cell->>'formula','')
      or (coalesce(audit_cell->>'formula','')<>'' and (audit_cell->>'cachePresent' is distinct from 'true' or audit_cell->'cachedValue' is distinct from audit_cell->'value')) then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_audit_cell_mismatch','sourceRowId',r->'source'->>'rowId'));
   end if;
   header_row:=case when col->>'headerRow'~'^[1-9][0-9]{0,4}$' then (col->>'headerRow')::integer end;
   column_number:=case when col->>'column'~'^[A-Z]{1,3}$' then atlas_private.workbook_column_number(col->>'column') end;
   header_id:=(r->'source'->>'sheet')||'!'||(col->>'column')||header_row;header_cell:=audit_cells->header_id;group_cell:=null;
   -- Reconstruct the parser's inherited group header from immutable header
   -- cells. A forged YTD label over another retained numeric column is rejected.
   select ac into group_cell from jsonb_each(audit_cells) a(k,ac)
    where ac->>'sheet'=r->'source'->>'sheet' and (ac->>'row')::integer=header_row-1
     and (ac->>'column')::integer<=column_number and coalesce(trim(ac->>'value'),'')<>'' order by (ac->>'column')::integer desc limit 1;
   select ac into identity_header from jsonb_each(audit_cells) a(k,ac)
    where ac->>'sheet'=r->'source'->>'sheet' and (ac->>'row')::integer=header_row and trim(ac->>'value')~*'^Account( Code)?$' order by (ac->>'column')::integer limit 1;
   select ac into label_header from jsonb_each(audit_cells) a(k,ac)
    where ac->>'sheet'=r->'source'->>'sheet' and (ac->>'row')::integer=header_row and trim(ac->>'value')~*'^Account Name$' order by (ac->>'column')::integer limit 1;
   identity_cell:=audit_cells->regexp_replace(identity_header->>'id','[0-9]+$',r->'source'->>'row');
   label_cell:=audit_cells->regexp_replace(label_header->>'id','[0-9]+$',r->'source'->>'row');
   if identity_header is null or label_header is null
      or regexp_replace(trim(coalesce(identity_cell->>'value','')),'\s+',' ','g') is distinct from coalesce(r->>'glCode','')
      or regexp_replace(trim(coalesce(label_cell->>'value','')),'\s+',' ','g') is distinct from r->>'accountName'
      or (identity_cell is not null and (not coalesce(audit->'authorityScope'->'selectedCells' ? (identity_cell->>'id'),false) or not coalesce(audit->'authorityScope'->'requiredNodes' ? (identity_cell->>'id'),false)))
      or not coalesce(audit->'authorityScope'->'selectedCells' ? (label_cell->>'id'),false)
      or not coalesce(audit->'authorityScope'->'requiredNodes' ? (label_cell->>'id'),false) then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_audit_row_identity_mismatch','sourceRowId',r->'source'->>'rowId'));
   end if;
   group_id:=group_cell->>'id';
   ytd_parts:=regexp_match(coalesce(group_cell->>'value',''),'YTD\s*\(\s*([A-Za-z]+)\s+(20[0-9]{2})\s*[-–]\s*([A-Za-z]+)\s+(20[0-9]{2})\s*\)','i');
   start_month:=array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],lower(left(ytd_parts[1],3)));
   end_month:=array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],lower(left(ytd_parts[3],3)));
   if col->>'type' is distinct from 'ytd_actual' or lower(trim(coalesce(header_cell->>'value',''))) is distinct from 'actual'
      or col->>'groupHeader' is distinct from group_cell->>'value'
      or col->>'rawHeader' is distinct from regexp_replace(trim(header_cell->>'value'),'\s+',' ','g')
      or header_row is null or header_row<=1 or column_number is null
      or (ytd_parts[2]||'-'||lpad(start_month::text,2,'0')) is distinct from c->'metadata'->>'ytdStart'
      or (ytd_parts[4]||'-'||lpad(end_month::text,2,'0')) is distinct from c->'metadata'->>'period'
      or not coalesce(audit->'authorityScope'->'selectedCells' ? header_id,false)
      or not coalesce(audit->'authorityScope'->'selectedCells' ? group_id,false)
      or not coalesce(audit->'authorityScope'->'requiredNodes' ? header_id,false)
      or not coalesce(audit->'authorityScope'->'requiredNodes' ? group_id,false) then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_audit_header_scope_mismatch','sourceRowId',r->'source'->>'rowId'));
   end if;
  end if;
 end loop;
 if leaf_count=0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_no_posting_rows'));end if;
 -- Recompute every retained bounded control from the YTD leaf values and its
 -- already validated source dependency factors, not the client check.passed flag.
 for node in select value from jsonb_array_elements(e->'hierarchy') loop
  total:=0;seen:='{}';passed:=true;
  entry:=row_index->(node->>'sourceRowId');
  source_total:=case when jsonb_typeof(entry->'values'->'ytdActual')='number' then (entry->'values'->>'ytdActual')::numeric end;
  if source_total is null or jsonb_array_length(coalesce(node->'childRowIds','[]'))=0 then passed:=false;end if;
  for child in select jsonb_array_elements_text(coalesce(node->'childRowIds','[]')) loop
   entry:=row_index->child;
   amount:=case when jsonb_typeof(entry->'values'->'ytdActual')='number' then (entry->'values'->>'ytdActual')::numeric end;
   factor:=case when node->'factors'->>child in ('1','-1') then (node->'factors'->>child)::numeric end;
   if entry->>'kind' is distinct from 'posting' or child=any(seen) or amount is null or factor is null then passed:=false;
   else total:=total+round(amount,2)*factor;end if;seen:=array_append(seen,child);
  end loop;
  if source_total is null or abs(total-round(source_total,2))>0.01 then passed:=false;end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('sourceRowId',node->>'sourceRowId','field','ytdActual','source',source_total,'calculated',total,'passed',passed));
  if not passed then issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_control_mismatch','sourceRowId',node->>'sourceRowId'));end if;
  if passed and node->>'metricKey' in ('revenue','expenses','noi') then
   if metrics ? (node->>'metricKey') then issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_duplicate_metric_control','metric',node->>'metricKey'));end if;
   metrics:=metrics||jsonb_build_object(node->>'metricKey',round(source_total,2));
   control_ids:=control_ids||jsonb_build_object(node->>'metricKey',node->>'sourceRowId');
  end if;
 end loop;
 if metrics ? 'expenses' then
  expense_control:=jsonb_build_object('method','reconciled_source_control','sourceRowIds',jsonb_build_array(control_ids->>'expenses'),'sourceAmount',metrics->'expenses');
 elsif metrics ? 'revenue' and metrics ? 'noi' then
  metrics:=metrics||jsonb_build_object('expenses',(metrics->>'revenue')::numeric-(metrics->>'noi')::numeric);
  expense_control:=jsonb_build_object('method','reconciled_revenue_less_noi','sourceRowIds',jsonb_build_array(control_ids->>'revenue',control_ids->>'noi'),'sourceIncome',metrics->'revenue','sourceNoi',metrics->'noi','sourceAmount',metrics->'expenses');
 else issues:=issues||jsonb_build_array(jsonb_build_object('code','source_ytd_expense_control_missing'));end if;
 return jsonb_build_object('schemaVersion',1,'ready',jsonb_array_length(issues)=0,'field','ytdActual',
  'sourceHash',c->>'sourceHash','period',c->'metadata'->>'period','ytdStart',c->'metadata'->>'ytdStart',
  'postingRowCount',leaf_count,'issues',issues,'checks',checks,'metrics',metrics,'expenseControl',expense_control);
end;$$;
revoke all on function atlas_private.month_end_source_ytd(jsonb) from public,anon,authenticated;

create or replace function atlas_private.month_end_review(p_review_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_financial_package_reviews;cal jsonb;periods text[];start_date date;baselines jsonb;line jsonb;mapping jsonb;source_row jsonb;rows jsonb:='[]';blockers jsonb:='[]';a numeric;b numeric;n integer;expected integer;gl text;item jsonb;hash text;latest_state text;ytd jsonb;source_category text; baseline jsonb; baseline_lines jsonb; baseline_metrics jsonb;
 expense_actual numeric;expense_budget numeric:=0;baseline_ready boolean:=true;baseline_months jsonb:='[]';
 numeric_cells integer:=0;blank_cells integer:=0;missing_cells integer:=0;monthly_blank integer;monthly_missing integer;
begin
 select * into r from public.atlas_financial_package_reviews where review_id=p_review_id;
 if auth.uid() is null or r.review_id is null or not atlas_private.command_access(r.community_id) then raise exception 'Month-end review access denied';end if;
 if to_regprocedure('atlas_private.budget_calendar(uuid)') is null then raise exception 'Verified Community Settings calendar is unavailable';end if;
 execute 'select atlas_private.budget_calendar($1)' into cal using r.community_id;
 if cal->>'verified' is distinct from 'true' then raise exception 'Resolve Community Settings calendar before month-end review';end if;
 start_date:=make_date(left(r.period_key,4)::int-case when right(r.period_key,2)::int<(cal->>'startMonth')::int then 1 else 0 end,(cal->>'startMonth')::int,1);
 select array_agg(to_char(d,'YYYY-MM') order by d) into periods from generate_series(start_date,(r.period_key||'-01')::date,interval '1 month')d;
 if r.certificate->'metadata'->>'ytdStart' is distinct from periods[1] then blockers:=blockers||'"Source YTD period does not match verified Community Settings"'::jsonb;end if;
 if r.certificate->'intakeEvidence'->'governance'->>'fiscalStartMonth' is distinct from cal->>'startMonth' then blockers:=blockers||'"Reviewed source calendar conflicts with verified Community Settings"'::jsonb;end if;
 if not exists(select 1 from public.atlas_month_end_attestations t where t.review_id=r.review_id) then blockers:=blockers||'"Accounting close and source generation verification required"'::jsonb;end if;
 if r.period_key>=to_char(current_date,'YYYY-MM') then blockers:=blockers||'"Accounting month has not ended"'::jsonb;end if;
 baselines:=public.atlas_reforecast_effective_baseline(array[r.community_id],periods);
 if jsonb_array_length(baselines)<>cardinality(periods) or exists(select 1 from jsonb_array_elements(baselines)x where x->>'verified' is distinct from 'true' or x->>'status' is distinct from 'available') then blockers:=blockers||'"Latest VP-approved baseline is unavailable for one or more fiscal YTD periods"'::jsonb;end if;
 -- Baseline completeness and null semantics stay with the existing governed
 -- metric calculator. Summaries use the same full fiscal months as source YTD;
 -- approved null cells are disclosed and are never rewritten into row zeros.
 if jsonb_array_length(baselines)<>cardinality(periods) then baseline_ready:=false;end if;
 if (select count(distinct v->>'period') from jsonb_array_elements(baselines)v where v->>'period'=any(periods))<>cardinality(periods) then baseline_ready:=false;end if;
 for baseline in select value from jsonb_array_elements(baselines) loop
  if baseline->>'verified' is distinct from 'true' or baseline->>'status' is distinct from 'available'
     or baseline->>'approved' is distinct from 'true' or baseline->>'locked' is distinct from 'true'
     or coalesce(baseline->>'versionId','')='' or coalesce(baseline->>'contentHash','')=''
     or not(baseline->>'period'=any(periods)) then baseline_ready:=false;end if;
  select coalesce(jsonb_agg(v||jsonb_build_object('mappingValid',v->>'mappingValid' is distinct from 'false' and v->>'nature' is not null and v->>'placement' is not null)),'[]')
   into baseline_lines from jsonb_array_elements(coalesce(baseline->'lines','[]'))v;
  select count(*) filter(where jsonb_typeof(v->'amount')='number'),
   count(*) filter(where v->'amount'='null'::jsonb and (v->>'legitimateBlank'='true' or (v->>'disposition'='outside_forecast_scope' and v->>'sourceScopeExclusionConfirmed'='true'))),
   count(*) filter(where jsonb_typeof(v->'amount') is distinct from 'number' and not coalesce(v->'amount'='null'::jsonb and (v->>'legitimateBlank'='true' or (v->>'disposition'='outside_forecast_scope' and v->>'sourceScopeExclusionConfirmed'='true')),false))
   into n,monthly_blank,monthly_missing from jsonb_array_elements(baseline_lines)v;
  numeric_cells:=numeric_cells+n;blank_cells:=blank_cells+monthly_blank;missing_cells:=missing_cells+monthly_missing;
  -- Null dispositions are only inherited from an exact approved publication.
  if monthly_blank>0 and (baseline->>'sourceType' is distinct from 'approved_reforecast' or coalesce(baseline->>'publicationId','')='') then baseline_ready:=false;end if;
  baseline_metrics:=atlas_private.reforecast_metric(baseline_lines,'amount');
  if jsonb_typeof(baseline_metrics->'expenses') is distinct from 'number' or monthly_missing>0 then baseline_ready:=false;
  else expense_budget:=expense_budget+(baseline_metrics->>'expenses')::numeric;end if;
  baseline_months:=baseline_months||jsonb_build_array(jsonb_build_object('period',baseline->>'period','sourceType',baseline->>'sourceType','versionId',baseline->>'versionId','publicationId',baseline->>'publicationId','contentHash',baseline->>'contentHash','numericCellCount',n,'intentionalBlankCellCount',monthly_blank,'missingCellCount',monthly_missing));
 end loop;
 if not baseline_ready then blockers:=blockers||'"Complete verified fiscal YTD baseline amounts or approved null dispositions are required"'::jsonb;expense_budget:=null;end if;
 ytd:=atlas_private.month_end_source_ytd(r.certificate);
 if ytd->>'ready' is distinct from 'true' then blockers:=blockers||'"Accounting fiscal YTD source evidence is incomplete or unreconciled"'::jsonb;end if;
 for gl in select distinct code from (
  select value->>'glCode' code from jsonb_array_elements(r.certificate->'rows') where value->>'kind'='posting'
  union select l->>'accountCode' from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l
 )q where code is not null order by code loop
  select value into mapping from jsonb_array_elements(r.certificate->'intakeEvidence'->'governance'->'mappings') where value->>'glCode'=gl;
  select value into source_row from jsonb_array_elements(r.certificate->'rows') where value->>'glCode'=gl and value->>'kind'='posting';
  select l into line from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l where l->>'accountCode'=gl order by x->>'period' desc limit 1;
  select count(*),sum((l->>'amount')::numeric) into n,b from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l where l->>'accountCode'=gl and jsonb_typeof(l->'amount')='number';
  if n<>cardinality(periods) then b:=null;end if;
  if exists(select 1 from jsonb_array_elements(baselines)x cross join lateral jsonb_array_elements(coalesce(x->'lines','[]'))l where l->>'accountCode'=gl and (l->>'nature' is distinct from line->>'nature' or l->>'category' is distinct from line->>'category')) then blockers:=blockers||jsonb_build_array('Conflicting approved account mappings for GL '||gl);end if;
  -- A reconciled Accounting YTD column is cumulative source evidence. It never
  -- creates January/February monthly actuals or changes coverage eligibility.
  a:=null;
  source_category:=coalesce(nullif(mapping->>'category',''),nullif(line->>'category',''));
  if source_row is not null then
   if (select count(*) from jsonb_array_elements(coalesce(r.certificate->'intakeEvidence'->'governance'->'mappings','[]')) m where m->>'glCode'=gl)<>1
      or coalesce(mapping->>'nature','') not in ('income','contra_income','expense','below_noi','capital','debt')
      or coalesce(mapping->>'signMultiplier','') not in ('1','-1') or source_category is null then
    blockers:=blockers||jsonb_build_array('Reviewed Accounting account nature, sign and category required for GL '||gl);
   elsif ytd->>'ready'='true' and jsonb_typeof(source_row->'values'->'ytdActual')='number' then
    a:=(source_row->'values'->>'ytdActual')::numeric*(mapping->>'signMultiplier')::numeric;
   end if;
  end if;
  if mapping->>'nature' is distinct from line->>'nature' and mapping is not null and line is not null then blockers:=blockers||jsonb_build_array('Actual and approved baseline account nature conflict for GL '||gl);end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('glCode',gl,'accountName',coalesce(source_row->>'accountName',line->>'accountName',line->>'name'),'nature',coalesce(mapping->>'nature',line->>'nature'),'category',source_category,'actual',a,'budget',b,'budgetMissing',b is null,'actualBasis','accounting_source_fiscal_ytd','actualSource',case when source_row is not null then jsonb_build_object('reviewId',r.review_id,'sourceHash',r.source_hash,'contentHash',r.content_hash,'period',r.period_key,'ytdStart',r.certificate->'metadata'->>'ytdStart','sourceRowId',source_row->'source'->>'rowId','sourceLocation',source_row->'source','field','ytdActual') end));
 end loop;
 item:=atlas_private.month_end_calculate(jsonb_build_object('reviewId',r.review_id,'communityId',r.community_id,'period',r.period_key,'periods',periods,'calendar',cal,'sourceHash',r.source_hash,'baselines',baselines,'rows',rows,'blockers',blockers,'actualBasis','accounting_source_fiscal_ytd','sourceYtd',ytd,'sourceContentHash',r.content_hash));
 expense_actual:=case when ytd->>'ready'='true' then (ytd->'metrics'->>'expenses')::numeric end;
 item:=item||jsonb_build_object('expenseActual',expense_actual,'expenseBudget',expense_budget,
  'expenseVariancePct',case when expense_actual is not null and expense_budget<>0 then (expense_actual-expense_budget)/abs(expense_budget) end,
  'reforecastRecommended',coalesce(expense_actual is not null and expense_budget>0 and (expense_actual-expense_budget)/expense_budget>0.35,false),
  'expenseActualSource',jsonb_build_object('reviewId',r.review_id,'sourceHash',r.source_hash,'contentHash',r.content_hash,'period',r.period_key,'ytdStart',periods[1],'control',ytd->'expenseControl'),
  'expenseBudgetSource',jsonb_build_object('basis','latest_approved_baseline_known_values','periods',periods,'monthly',baseline_months),
  'baselineCoverage',jsonb_build_object('complete',baseline_ready,'numericCellCount',numeric_cells,'intentionalBlankCellCount',blank_cells,'missingCellCount',missing_cells));
 hash:=encode(sha256(convert_to(item::text,'UTF8')),'hex');return item||jsonb_build_object('fingerprint',hash);
end;$$;

commit;
