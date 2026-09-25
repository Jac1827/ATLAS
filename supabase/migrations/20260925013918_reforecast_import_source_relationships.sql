-- Bind normalized source GL/month labels to immutable audited identifier/header
-- cells and prove numeric source coverage independently of selected exclusions.
begin;
create function atlas_private.reforecast_source_account(raw text)
returns text language plpgsql immutable set search_path='' as $$
declare token text[];label text;depth integer:=0;i integer;ch text;
begin
 token:=regexp_match(trim(raw),'^([0-9]{3,}(?:[-.][0-9]+)*)(.*)$');if token is null then return null;end if;label:=trim(token[2]);
 if label='' then return token[1];end if;
 if left(label,1)='(' then
  for i in 1..length(label) loop ch:=substr(label,i,1);if ch='(' then depth:=depth+1;elsif ch=')' then depth:=depth-1;end if;if depth<0 or depth=0 and i<length(label) then return null;end if;end loop;
  if depth<>0 or right(label,1)<>')' or trim(substr(label,2,length(label)-2))='' then return null;end if;return token[1];
 end if;
 if token[2]~'^\s+[-–]\s+.+' then return token[1];end if;return null;
end;$$;
create function atlas_private.reforecast_source_period(cell jsonb,date_system text)
returns text language plpgsql immutable set search_path='' as $$
declare raw text:=trim(cell->>'value');m text[];month integer;serial numeric;parsed date;
begin
 m:=regexp_match(raw,'^(20[0-9]{2})[-/](0?[1-9]|1[0-2])(?:[-/][0-9]{1,2}(?:T.*)?)?$');if m is not null then return m[1]||'-'||lpad(m[2],2,'0');end if;
 m:=regexp_match(raw,'^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[ -]+(20[0-9]{2})$','i');
 if m is not null then month:=array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],lower(left(m[1],3)));return m[2]||'-'||lpad(month::text,2,'0');end if;
 if jsonb_typeof(cell->'value')='number' and coalesce(cell->>'numberFormat','')~*'[yd]' and date_system in ('1900','1904') then serial:=(cell->>'value')::numeric;if serial>0 and serial<100000 then parsed:=(case when date_system='1904' then date '1904-01-01' else date '1899-12-30' end)+floor(serial)::integer;return to_char(parsed,'YYYY-MM');end if;end if;
 return null;
end;$$;
revoke all on function atlas_private.reforecast_source_account(text),atlas_private.reforecast_source_period(jsonb,text) from public,anon,authenticated;

create function atlas_private.validate_reforecast_source_relationships(upload jsonb,audit jsonb,mapping jsonb)
returns void language plpgsql stable set search_path='' as $$
declare cells jsonb;by_position jsonb;account_columns jsonb;lines jsonb;line jsonb;account jsonb;header jsonb;year_cell jsonb;month_cell jsonb;scenario_cell jsonb;identifier jsonb;selection jsonb;label_cell jsonb;pattern jsonb;patterns jsonb:='{}';columns jsonb:='{}';column_info jsonb;raw_cell jsonb;raw_line jsonb;raw_account jsonb;
 sheet text;address text;period text;scenario text;account_code text;account_column text;column_letters text;key text;id text;count_headers integer;header_row integer;bound boolean;step integer;date_system text:=audit->'inventory'->>'dateSystem';
begin
 if upload->>'parserVersion' is distinct from 'atlas-reforecast-xlsx/3' then raise exception 'Reparse the retained original workbook with the current parser and review its complete GL coverage before a new write';end if;
 if jsonb_typeof(mapping->'selectedLineIds') is distinct from 'array' then raise exception 'Reviewed source cells required';end if;
 select coalesce(jsonb_object_agg((s->>'name')||'!'||(c->>'address'),c),'{}'),coalesce(jsonb_object_agg(jsonb_build_array(s->>'name',c->>'row',c->>'column')::text,c),'{}') into cells,by_position from jsonb_array_elements(audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')c;
 select coalesce(jsonb_object_agg(jsonb_build_array(s->>'name',c->>'column')::text,true),'{}') into account_columns from jsonb_array_elements(audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')c where (c->>'row')::integer<=80 and trim(c->>'value')~*'^(GL|GL Code|GL Account|GL Account Code|Account|Account Code|Account Number|Account #|DynR-Account \(Expression\))$';
 select coalesce(jsonb_object_agg(l->>'id',l),'{}') into lines from jsonb_array_elements(upload->'lines')l;
 for id in select jsonb_array_elements_text(mapping->'selectedLineIds') loop
  line:=lines->id;sheet:=line->>'sheet';account:=cells->(sheet||'!'||(line->>'accountAddress'));raw_cell:=cells->id;
  if line is null or raw_cell is null or raw_cell->'row' is distinct from line->'row' or raw_cell->'column' is distinct from line->'column' or raw_cell->>'address' is distinct from line->>'address' or account is null or not(account_columns ? (jsonb_build_array(sheet,account->>'column')::text)) or account->'row' is distinct from line->'row' or (account->>'column')::integer>=(line->>'column')::integer or atlas_private.reforecast_source_account(account->>'value') is distinct from line->>'accountCode' then raise exception 'Source GL relationship does not match the audited account cell: %',id;end if;
  if jsonb_typeof(line->'identifiers') is distinct from 'array' or not exists(select 1 from jsonb_array_elements(line->'identifiers')v where v->>'address'=line->>'accountAddress' and v->'value'=account->'value') then raise exception 'Retain the audited account identifier relationship: %',id;end if;
  for identifier in select value from jsonb_array_elements(line->'identifiers') loop
   header:=cells->(sheet||'!'||(identifier->>'address'));
   if header is null or header->'row' is distinct from line->'row' or (header->>'column')::integer>=(line->>'column')::integer or header->'value' is distinct from identifier->'value' then raise exception 'Source row identifier differs from immutable audit: %',id;end if;
  end loop;
  if jsonb_typeof(line->'headerAddresses') is distinct from 'array' then raise exception 'Retained source period headers required: %',id;end if;count_headers:=jsonb_array_length(line->'headerAddresses');
  for address in select jsonb_array_elements_text(line->'headerAddresses') loop
   header:=cells->(sheet||'!'||address);
   if header is null or header->'column' is distinct from line->'column' or (header->>'row')::integer>=(line->>'row')::integer then raise exception 'Source month header must bind the same audited amount column: %',id;end if;
  end loop;
  year_cell:=cells->(sheet||'!'||(line->'headerAddresses'->>0));header_row:=(year_cell->>'row')::integer;
  if count_headers=3 then
   month_cell:=cells->(sheet||'!'||(line->'headerAddresses'->>1));scenario_cell:=cells->(sheet||'!'||(line->'headerAddresses'->>2));
   if header_row>30 or (month_cell->>'row')::integer<>header_row+1 or (scenario_cell->>'row')::integer<>header_row+2 or coalesce(year_cell->>'value','')!~'^20[0-9]{2}$' or coalesce(month_cell->>'value','')!~'^([1-9]|1[0-2])$' or jsonb_typeof(scenario_cell->'value') is distinct from 'string' then raise exception 'Unsupported or altered source year/month/scenario header relationship: %',id;end if;
   period:=(year_cell->>'value')||'-'||lpad(month_cell->>'value',2,'0');scenario:=trim(scenario_cell->>'value');
  elsif count_headers=1 then
   if header_row>80 then raise exception 'Unsupported source calendar header: %',id;end if;
   period:=atlas_private.reforecast_source_period(year_cell,date_system);scenario:=line->>'scenario';bound:=false;
   -- Simple tables obtain scenario from an audited named selection or from a
   -- nearby audited Scenario/PlanScenario label, never arbitrary source text.
   for selection in select value from jsonb_array_elements(coalesce(upload->'metadata'->'selections','[]')) where value->>'name' in ('Scenario','PlanScenario') and trim(value->>'value')=scenario loop
    header:=cells->((selection->>'sheet')||'!'||(selection->>'address'));
    if header is null or header->'value' is distinct from selection->'value' then continue;end if;
    if exists(select 1 from jsonb_array_elements(coalesce(audit->'inventory'->'definedNames','[]'))n where n->>'name'=selection->>'name' and n->>'reference'=selection->>'reference') then bound:=true;end if;
    for step in 1..3 loop label_cell:=by_position->(jsonb_build_array(selection->>'sheet',header->>'row',((header->>'column')::integer-step)::text)::text);if label_cell->>'value'=selection->>'name' then bound:=true;end if;end loop;
   end loop;
   if not bound then raise exception 'Source scenario lacks an audited selection/header relationship: %',id;end if;
  else raise exception 'Unsupported source period header relationship; reparse the retained original: %',id;
  end if;
  if period is null or period is distinct from line->>'period' or scenario is distinct from line->>'scenario' then raise exception 'Source period or scenario differs from immutable audited headers: %',id;end if;
  if audit->'authorityScope'->>'type'='selected_cells_and_dependencies' and exists(select 1 from jsonb_array_elements_text((line->'headerAddresses')||jsonb_build_array(line->>'accountAddress'))a where not(coalesce(audit->'authorityScope'->'requiredNodes','[]') ? (sheet||'!'||a))) then raise exception 'Selected source account/header is outside retained authority scope: %',id;end if;
  account_column:=regexp_replace(line->>'accountAddress','[0-9]+$','');key:=jsonb_build_array(sheet,header_row,count_headers,account_column,scenario)::text;
  patterns:=jsonb_set(patterns,array[key],jsonb_build_object('sheet',sheet,'headerRow',header_row,'count',count_headers,'accountColumn',account_column,'scenario',scenario),true);
 end loop;
 -- Scan raw audited headers for every reviewed month, then require normalized
 -- inventory rows for all raw numeric GL cells, even explicitly excluded rows.
 for pattern in select value from jsonb_each(patterns) loop
  sheet:=pattern->>'sheet';header_row:=(pattern->>'headerRow')::integer;count_headers:=(pattern->>'count')::integer;account_column:=pattern->>'accountColumn';scenario:=pattern->>'scenario';
  for year_cell in select value from jsonb_each(cells)q(k,value) where left(k,length(sheet)+1)=sheet||'!' and (value->>'row')::integer=header_row loop
   column_letters:=regexp_replace(year_cell->>'address','[0-9]+$','');
   if count_headers=3 then
    month_cell:=cells->(sheet||'!'||column_letters||(header_row+1));scenario_cell:=cells->(sheet||'!'||column_letters||(header_row+2));
    if coalesce(year_cell->>'value','')!~'^20[0-9]{2}$' or coalesce(month_cell->>'value','')!~'^([1-9]|1[0-2])$' or trim(scenario_cell->>'value') is distinct from scenario then continue;end if;
    period:=(year_cell->>'value')||'-'||lpad(month_cell->>'value',2,'0');
   else period:=atlas_private.reforecast_source_period(year_cell,date_system);end if;
   if not coalesce(mapping->'periods' ? period,false) then continue;end if;
   key:=jsonb_build_array(sheet,year_cell->>'column')::text;column_info:=jsonb_build_object('sheet',sheet,'period',period,'scenario',scenario,'accountColumn',account_column,'headerRow',header_row,'headerCount',count_headers);
   if columns ? key and columns->key is distinct from column_info then raise exception 'Ambiguous audited source column relationship';end if;columns:=jsonb_set(columns,array[key],column_info,true);
  end loop;
 end loop;
 for raw_cell,sheet in select c,s->>'name' from jsonb_array_elements(audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')c where jsonb_typeof(c->'value')='number' loop
  column_info:=columns->(jsonb_build_array(sheet,raw_cell->>'column')::text);if column_info is null or (raw_cell->>'row')::integer<=(column_info->>'headerRow')::integer+(case when column_info->>'headerCount'='3' then 2 else 0 end) then continue;end if;
  raw_account:=cells->(sheet||'!'||(column_info->>'accountColumn')||(raw_cell->>'row'));account_code:=atlas_private.reforecast_source_account(raw_account->>'value');if account_code is null then continue;end if;
  raw_line:=lines->(sheet||'!'||(raw_cell->>'address'));
  if raw_line is null or raw_line->>'accountCode' is distinct from account_code or raw_line->>'period' is distinct from column_info->>'period' or raw_line->>'scenario' is distinct from column_info->>'scenario' or raw_line->'amount' is distinct from raw_cell->'value' then raise exception 'Normalized workbook inventory omitted or changed a numeric audited GL/month; reparse and review complete source coverage: %',sheet||'!'||(raw_cell->>'address');end if;
 end loop;
end;$$;
revoke all on function atlas_private.validate_reforecast_source_relationships(jsonb,jsonb,jsonb) from public,anon,authenticated;

-- The lower-level validator is also reached by ordinary saves and historical
-- import selections. Validate only the active leaf call, avoiding duplicate work
-- as the existing history validator dispatches each retained current mapping.
alter function atlas_private.reforecast_import_issues_before_close_scope(jsonb,jsonb) rename to reforecast_import_issues_before_source_relationships;
create function atlas_private.reforecast_import_issues_before_close_scope(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;upload jsonb;audit jsonb;
begin
 result:=atlas_private.reforecast_import_issues_before_source_relationships(source,config);
 if jsonb_typeof(config->'importHistory')='array' and jsonb_array_length(config->'importHistory')>0 then return result;end if;
 if config->>'uploadId' is null then return result;end if;
 select payload into upload from public.atlas_reforecast_uploads where upload_id::text=config->>'uploadId' and community_id::text=source->>'communityId';
 if upload is null then return result;end if;
 audit:=atlas_private.resolve_workbook_audit(upload->'integrity',upload->'source'->>'sha256');
 perform atlas_private.validate_reforecast_source_relationships(upload,audit,config->'importMapping');return result;
end;$$;
revoke all on function atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb),atlas_private.reforecast_import_issues_before_close_scope(jsonb,jsonb) from public,anon,authenticated;
commit;
