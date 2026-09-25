-- Preserve the complete canonical evidence and every independent dependency
-- check. Scalar values are serialized inline, avoiding one PL/pgSQL invocation
-- per scalar. Sorting, escaping, number normalization and hashes are unchanged.
begin;
create or replace function atlas_private.workbook_canonical_json(v jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;begin
 case jsonb_typeof(v)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||case jsonb_typeof(value) when 'object' then atlas_private.workbook_canonical_json(value) when 'array' then atlas_private.workbook_canonical_json(value) when 'number' then trim_scale(value::text::numeric)::text else value::text end,',' order by key collate "C"),'')||'}' into result from jsonb_each(v);
 when 'array' then select '['||coalesce(string_agg(case jsonb_typeof(value) when 'object' then atlas_private.workbook_canonical_json(value) when 'array' then atlas_private.workbook_canonical_json(value) when 'number' then trim_scale(value::text::numeric)::text else value::text end,',' order by ord),'')||']' into result from jsonb_array_elements(v) with ordinality a(value,ord);
 when 'number' then result:=trim_scale(v::text::numeric)::text;
 else result:=v::text;end case;return result;end;$$;

-- This helper is owner-only. A public caller cannot supply an asserted hash.
-- atlas_save_workbook_audit computes the independent hash before calling it;
-- all other validation paths use the hashing wrapper below. Validation logic is
-- identical to the prior function after the fingerprint computation.
create or replace function atlas_private.workbook_integrity_issues_verified(audit jsonb,verified_fingerprint text) returns jsonb language plpgsql immutable set search_path='' as $$
declare issues jsonb:='[]';sheet jsonb;cell jsonb;node jsonb;finding jsonb;edge jsonb;nodes jsonb;edges jsonb;required jsonb;scoped boolean;active boolean;id text;formula text;body text;token text[];target_sheet text;target text;ref text;first_col integer;last_col integer;first_row integer;last_row integer;c integer;r integer;count_cells integer:=0;count_formulas integer:=0;remaining text[];next_remaining text[];remaining_map jsonb;loops integer:=0;actual_hash text;defined jsonb;name_match text[];name_entry jsonb;named_target text;range_id text;range_node jsonb;fn text;quoted_names text[];quote_text text;quote_index integer;unmasked_body text;
begin
 if audit->>'schemaVersion' is distinct from 'atlas.workbook-integrity.v1' or jsonb_typeof(audit->'inventory'->'sheets') is distinct from 'array' or jsonb_typeof(audit->'graph'->'nodes') is distinct from 'array' or jsonb_typeof(audit->'graph'->'edges') is distinct from 'array' then return atlas_private.planning_issue('workbook_integrity_required','Complete workbook inventory and formula dependency evidence are required.');end if;
 actual_hash:=verified_fingerprint;
 if actual_hash is null or actual_hash!~'^[a-f0-9]{64}$' then raise exception 'Independently verified workbook fingerprint required';end if;
 if actual_hash is distinct from audit->>'fingerprint' then return atlas_private.planning_issue('workbook_fingerprint_mismatch','The retained workbook inventory fingerprint failed independent validation.');end if;
 if audit->'inventory'->>'packageMetadataAvailable' is distinct from 'true' then issues:=issues||atlas_private.planning_issue('workbook_package_required','Retain original workbook package metadata before approval.');end if;
 -- A declared critical defect is already sufficient to prohibit approval. Preserve the complete audit,
 -- but avoid expensive dependency expansion for evidence that cannot pass. Cleared audits are independently checked below.
 if exists(select 1 from jsonb_array_elements(coalesce(audit->'findings','[]'))f where f->>'severity'='blocking') then
  return issues||(select jsonb_agg(jsonb_build_object('code','workbook_'||(f->>'code'),'severity','error','message',coalesce(f->>'reason','Workbook integrity blocker'),'findingId',f->'id')) from jsonb_array_elements(audit->'findings')f where f->>'severity'='blocking');
 end if;
 if jsonb_array_length(audit->'graph'->'nodes')>750000 or jsonb_array_length(audit->'graph'->'edges')>500000 then return issues||atlas_private.planning_issue('workbook_graph_limit','Workbook graph exceeds complete validation bounds.');end if;
 select coalesce(jsonb_object_agg(v->>'id',v),'{}') into nodes from jsonb_array_elements(audit->'graph'->'nodes')v;
 select coalesce(jsonb_object_agg(e.id,e.targets),'{}') into edges from (select v->>'from' id,jsonb_object_agg(v->>'to',true) targets from jsonb_array_elements(audit->'graph'->'edges')v group by v->>'from')e;
 scoped:=audit->'authorityScope'->>'type'='selected_cells_and_dependencies';required:=coalesce(audit->'authorityScope'->'requiredNodes','[]');
 if scoped then
  if jsonb_array_length(coalesce(audit->'authorityScope'->'selectedCells','[]'))=0 or exists(select 1 from jsonb_array_elements_text(audit->'authorityScope'->'selectedCells')v where not(required ? v)) then issues:=issues||atlas_private.planning_issue('workbook_scope_invalid','Every authoritative source cell must belong to the retained dependency scope.');end if;
  if exists(select 1 from jsonb_array_elements(audit->'graph'->'edges')e where required ? (e->>'from') and not(required ? (e->>'to'))) then issues:=issues||atlas_private.planning_issue('workbook_scope_incomplete','Authoritative scope omitted a formula dependency.');end if;
 end if;
 for sheet in select v from jsonb_array_elements(audit->'inventory'->'sheets')v loop
  for cell in select v from jsonb_array_elements(coalesce(sheet->'cells','[]'))v loop
   count_cells:=count_cells+1;id:=(sheet->>'name')||'!'||(cell->>'address');node:=nodes->id;active:=not coalesce(scoped,false) or required ? id;
   if cell->>'id' is distinct from id or node is null or node->>'sheet' is distinct from sheet->>'name' or node->>'address' is distinct from cell->>'address' or coalesce(node->>'formula','') is distinct from coalesce(cell->>'formula','') then issues:=issues||atlas_private.planning_issue('workbook_node_binding','A workbook source cell does not match its retained dependency node.',jsonb_build_object('cellId',id));end if;
   if coalesce(cell->>'formula','')<>'' then count_formulas:=count_formulas+1;end if;
   if active and (cell->>'type'='e' or cell->>'value'~'^#(REF!|DIV/0!|VALUE!|NAME\?|N/A|NUM!|NULL!|SPILL!|CALC!)') then issues:=issues||atlas_private.planning_issue('workbook_cell_error','An authoritative source cell contains an Excel error.',jsonb_build_object('cellId',id));end if;
   if active and coalesce(cell->>'formula','')<>'' and (cell->>'cachePresent' is distinct from 'true' or cell->'cachedValue' is distinct from cell->'value' or cell->>'cachedValue' is null) then issues:=issues||atlas_private.planning_issue('workbook_cache_missing','An authoritative formula has no retained result.',jsonb_build_object('cellId',id));end if;
  end loop;
 end loop;
 if (audit->'summary'->>'populatedCells')::integer is distinct from count_cells or (audit->'summary'->>'formulas')::integer is distinct from count_formulas then issues:=issues||atlas_private.planning_issue('workbook_inventory_count','Workbook cell/formula counts do not match the complete retained inventory.');end if;
 if exists(select 1 from jsonb_array_elements(audit->'graph'->'nodes')n group by n->>'id' having count(*)>1) then issues:=issues||atlas_private.planning_issue('workbook_duplicate_node','Dependency node identifiers must be unique.');end if;
 for defined in select v from jsonb_array_elements(coalesce(audit->'inventory'->'definedNames','[]'))v loop
  id:='@name:'||coalesce(defined->>'sheet','*')||'!'||(defined->>'name');if nodes->id is null or nodes->id->>'formula' is distinct from defined->>'reference' then issues:=issues||atlas_private.planning_issue('workbook_name_binding','An inventoried defined name is missing or changed in the dependency graph.',jsonb_build_object('name',defined->'name'));end if;
 end loop;
 for node in select v from jsonb_array_elements(audit->'graph'->'nodes')v where coalesce(v->>'formula','')<>'' loop
  id:=node->>'id';active:=not coalesce(scoped,false) or required ? id;continue when not active;formula:=node->>'formula';body:=regexp_replace(formula,'"([^"]|"")*"','','g');unmasked_body:=body;quoted_names:='{}';quote_index:=0;
  for name_match in select regexp_matches(body,'(''([^'']|'''')+''!)','g') loop quote_text:=name_match[1];if not(quote_text=any(quoted_names)) then quote_index:=quote_index+1;quoted_names:=array_append(quoted_names,quote_text);body:=replace(body,quote_text,'__ATLAS_QUOTED_'||quote_index||'__!');end if;end loop;
  if active and (body~*'#(REF!|NAME\?)' or unmasked_body~*'\[[^]]+\][^!]*!|(?:https?|file)://'  or body~*'\m(INDIRECT|OFFSET|EVALUATE|CALL|REGISTER[.]ID|GET[.]CELL|GET[.]WORKBOOK|EXEC|RTD|WEBSERVICE|CUBEVALUE|CUBEMEMBER|STOCKHISTORY|LAMBDA|LET|MAP|REDUCE|SCAN|MAKEARRAY)\s*\(') then issues:=issues||atlas_private.planning_issue('workbook_unsafe_dependency','An authoritative formula contains a broken, external or dynamic dependency.',jsonb_build_object('cellId',id));end if;
  for name_match in select regexp_matches(body,'([A-Za-z_][A-Za-z0-9_.]*)\s*\(','g') loop
   fn:=regexp_replace(upper(name_match[1]),'^(_XLFN[.]|_XLWS[.])+','');
   if active and fn not in ('ABS','ACOS','ACOSH','ACOT','ACOTH','AGGREGATE','AND','ARABIC','AREAS','ASIN','ASINH','ATAN','ATAN2','ATANH','AVEDEV','AVERAGE','AVERAGEA','AVERAGEIF','AVERAGEIFS','BASE','BESSELI','BESSELJ','BESSELK','BESSELY','BETA.DIST','BETA.INV','BIN2DEC','BIN2HEX','BIN2OCT','BINOM.DIST','BINOM.INV','BITAND','BITLSHIFT','BITOR','BITRSHIFT','BITXOR','CEILING','CEILING.MATH','CEILING.PRECISE','CELL','CHAR','CHOOSE','CHOOSECOLS','CHOOSEROWS','CLEAN','CODE','COLUMN','COLUMNS','COMBIN','COMBINA','CONCAT','CONCATENATE','CONFIDENCE','CONFIDENCE.NORM','CONVERT','CORREL','COS','COSH','COT','COTH','COUNT','COUNTA','COUNTBLANK','COUNTIF','COUNTIFS','COUPDAYBS','COUPDAYS','COUPDAYSNC','COUPNCD','COUPNUM','COUPPCD','COVAR','COVARIANCE.P','COVARIANCE.S','CSC','CSCH','CUMIPMT','CUMPRINC','DATE','DATEDIF','DATEVALUE','DAY','DAYS','DAYS360','DB','DDB','DEC2BIN','DEC2HEX','DEC2OCT','DECIMAL','DEGREES','DISC','DOLLAR','DOLLARDE','DOLLARFR','DROP','EDATE','EFFECT','ENCODEURL','EOMONTH','ERF','ERFC','ERROR.TYPE','EVEN','EXACT','EXP','EXPAND','EXPON.DIST','FACT','FACTDOUBLE','FALSE','FILTER','FILTERXML','FIND','FINDB','FISHER','FISHERINV','FIXED','FLOOR','FLOOR.MATH','FLOOR.PRECISE','FORECAST','FORECAST.LINEAR','FORMULATEXT','FREQUENCY','FV','FVSCHEDULE','GAMMA','GAMMALN','GCD','GEOMEAN','GESTEP','GROWTH','HARMEAN','HLOOKUP','HOUR','HSTACK','HYPERLINK','IF','IFERROR','IFNA','IFS','IMABS','IMAGINARY','INDEX','INT','INTERCEPT','IPMT','IRR','ISBLANK','ISERR','ISERROR','ISEVEN','ISFORMULA','ISLOGICAL','ISNA','ISNONTEXT','ISNUMBER','ISODD','ISREF','ISTEXT','ISOWEEKNUM','LARGE','LCM','LEFT','LEFTB','LEN','LENB','LINEST','LN','LOG','LOG10','LOGEST','LOOKUP','LOWER','MATCH','MAX','MAXA','MAXIFS','MDETERM','MDURATION','MEDIAN','MID','MIDB','MIN','MINA','MINIFS','MINUTE','MIRR','MMULT','MOD','MODE','MODE.MULT','MODE.SNGL','MONTH','MROUND','MULTINOMIAL','MUNIT','N','NA','NETWORKDAYS','NETWORKDAYS.INTL','NOMINAL','NORM.DIST','NORM.INV','NORM.S.DIST','NORM.S.INV','NOT','NOW','NPER','NPV','NUMBERVALUE','ODD','OR','PERCENTILE','PERCENTILE.EXC','PERCENTILE.INC','PERCENTRANK','PERMUT','PI','PMT','POISSON','POWER','PPMT','PRICE','PRICEDISC','PRICEMAT','PROB','PRODUCT','PROPER','PV','QUARTILE','QUARTILE.EXC','QUARTILE.INC','QUOTIENT','RADIANS','RAND','RANDBETWEEN','RANK','RANK.EQ','RANK.AVG','RATE','REPLACE','REPLACEB','REPT','RIGHT','RIGHTB','ROMAN','ROUND','ROUNDDOWN','ROUNDUP','ROW','ROWS','RRI','SEARCH','SEARCHB','SEC','SECH','SECOND','SEQUENCE','SERIESSUM','SHEET','SHEETS','SIGN','SIN','SINH','SKEW','SLN','SLOPE','SMALL','SORT','SORTBY','SQRT','SQRTPI','STANDARDIZE','STDEV','STDEV.P','STDEV.S','STDEVA','STDEVP','STDEVPA','STEYX','SUBSTITUTE','SUBTOTAL','SUM','SUMIF','SUMIFS','SUMPRODUCT','SUMSQ','SUMX2MY2','SUMX2PY2','SUMXMY2','SWITCH','SYD','T','TAKE','TAN','TANH','TBILLEQ','TBILLPRICE','TBILLYIELD','TEXT','TEXTAFTER','TEXTBEFORE','TEXTJOIN','TEXTSPLIT','TIME','TIMEVALUE','TODAY','TOCOL','TOROW','TRANSPOSE','TREND','TRIM','TRIMMEAN','TRUE','TRUNC','TYPE','UNICHAR','UNICODE','UNIQUE','UPPER','VALUE','VAR','VAR.P','VAR.S','VARA','VARP','VARPA','VDB','VLOOKUP','VSTACK','WEEKDAY','WEEKNUM','WORKDAY','WORKDAY.INTL','WRAPCOLS','WRAPROWS','XIRR','XLOOKUP','XMATCH','XNPV','XOR','YEAR','YEARFRAC','YIELD','YIELDDISC','YIELDMAT') then issues:=issues||atlas_private.planning_issue('workbook_unsupported_function','A formula function cannot be independently certified.',jsonb_build_object('cellId',id,'function',fn));end if;
  end loop;
  body:=regexp_replace(body,'[A-Za-z_][A-Za-z0-9_.]*\s*\(','(','g');
  body:=regexp_replace(body,'(^|[^A-Za-z0-9_.])([0-9]+([.][0-9]*)?|[.][0-9]+)[Ee][+-]?[0-9]+(?=[^A-Za-z0-9_]|$)','\1','g');
  if cardinality(quoted_names)>0 then for quote_index in 1..cardinality(quoted_names) loop body:=replace(body,'__ATLAS_QUOTED_'||quote_index||'__!',quoted_names[quote_index]);end loop;end if;
  for token in select regexp_matches(body,'(?:((''([^'']|'''')+''|[A-Za-z_][A-Za-z0-9_. ]*)!))?(\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)(?::(\$?[A-Za-z]{1,3}\$?[1-9][0-9]*))?','g') loop
   target_sheet:=coalesce(nullif(token[2],''),node->>'sheet');if left(target_sheet,1)='''' then target_sheet:=replace(substr(target_sheet,2,length(target_sheet)-2),'''''','''');end if;
   select s->>'name' into target_sheet from jsonb_array_elements(audit->'inventory'->'sheets')s where lower(s->>'name')=lower(target_sheet);
   if target_sheet is null then if active then issues:=issues||atlas_private.planning_issue('workbook_missing_sheet','Formula refers to an unavailable worksheet.',jsonb_build_object('cellId',id));end if;continue;end if;
   ref:=replace(token[4],'$','');first_col:=atlas_private.workbook_column_number(regexp_replace(ref,'[0-9]','','g'));first_row:=regexp_replace(ref,'[A-Za-z]','','g')::integer;
   ref:=replace(coalesce(token[5],token[4]),'$','');last_col:=atlas_private.workbook_column_number(regexp_replace(ref,'[0-9]','','g'));last_row:=regexp_replace(ref,'[A-Za-z]','','g')::integer;
   if first_col<>last_col or first_row<>last_row then
    range_id:='@range:'||target_sheet||'!'||atlas_private.workbook_column_name(least(first_col,last_col))||least(first_row,last_row)||':'||atlas_private.workbook_column_name(greatest(first_col,last_col))||greatest(first_row,last_row);
    if active and (nodes->range_id is null or not coalesce(edges->id ? range_id,false)) then issues:=issues||atlas_private.planning_issue('workbook_range_dependency_omitted','An authoritative formula omitted its exact bounded range dependency.',jsonb_build_object('cellId',id,'dependency',range_id));end if;
   else
    target:=target_sheet||'!'||atlas_private.workbook_column_name(first_col)||first_row;
    if active and not coalesce((edges->id) ? target,false) then issues:=issues||atlas_private.planning_issue('workbook_dependency_omitted','A raw formula dependency is missing from the graph.',jsonb_build_object('cellId',id,'dependency',target));end if;
   end if;
  end loop;
  -- Every defined-name token must retain its exact graph dependency. Names are resolved in worksheet scope first.
  body:=regexp_replace(body,'(?:((''([^'']|'''')+''|[A-Za-z_][A-Za-z0-9_. ]*)!))?(\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)(?::(\$?[A-Za-z]{1,3}\$?[1-9][0-9]*))?','','g');
  body:=regexp_replace(body,'(?:((''([^'']|'''')+''|[A-Za-z_][A-Za-z0-9_. ]*)!))?(\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[1-9][0-9]*:\$?[1-9][0-9]*)','','g');
  for name_match in select regexp_matches(body,'[A-Za-z_][A-Za-z0-9_.]*','g') loop
   if upper(name_match[1]) in ('TRUE','FALSE','E') then continue;end if;
   select d into name_entry from jsonb_array_elements(coalesce(audit->'inventory'->'definedNames','[]'))d where lower(d->>'name')=lower(name_match[1]) and (d->>'sheet' is null or d->>'sheet'=node->>'sheet') order by (d->>'sheet' is not null) desc limit 1;
   if name_entry is not null then named_target:='@name:'||coalesce(name_entry->>'sheet','*')||'!'||(name_entry->>'name');if active and not coalesce(edges->id ? named_target,false) then issues:=issues||atlas_private.planning_issue('workbook_named_dependency_omitted','An authoritative formula omitted a defined-name dependency.',jsonb_build_object('cellId',id,'name',name_match[1]));end if;
   elsif active and body!~'\[' then issues:=issues||atlas_private.planning_issue('workbook_undefined_name','An authoritative formula contains an unresolved named dependency.',jsonb_build_object('cellId',id,'name',name_match[1]));end if;
  end loop;
 end loop;
 -- An interned range must bind every populated source cell inside its exact bounds.
 for range_node in select v from jsonb_array_elements(audit->'graph'->'nodes')v where v->>'kind'='range' loop
  id:=range_node->>'id';active:=not coalesce(scoped,false) or required ? id;
  first_col:=atlas_private.workbook_column_number(regexp_replace(range_node->>'start','[0-9]','','g'));first_row:=regexp_replace(range_node->>'start','[A-Za-z]','','g')::integer;
  last_col:=atlas_private.workbook_column_number(regexp_replace(range_node->>'end','[0-9]','','g'));last_row:=regexp_replace(range_node->>'end','[A-Za-z]','','g')::integer;
  if id is distinct from '@range:'||(range_node->>'sheet')||'!'||(range_node->>'start')||':'||(range_node->>'end') or first_col>last_col or first_row>last_row then issues:=issues||atlas_private.planning_issue('workbook_range_binding','Range bounds do not match their canonical node identifier.');continue;end if;
  continue when not active;
  for cell in select sc.value from jsonb_array_elements(audit->'inventory'->'sheets')s cross join lateral jsonb_array_elements(s->'cells')sc(value) where s->>'name'=range_node->>'sheet' and (sc.value->>'row')::integer between first_row and last_row and (sc.value->>'column')::integer between first_col and last_col loop
   if active and not coalesce(edges->id ? (cell->>'id'),false) then issues:=issues||atlas_private.planning_issue('workbook_range_cell_omitted','An authoritative range omitted a populated source cell.',jsonb_build_object('rangeId',id,'cellId',cell->'id'));end if;
  end loop;
 end loop;
 for edge in select v from jsonb_array_elements(audit->'graph'->'edges')v loop
  if not(nodes ? (edge->>'from')) or not(nodes ? (edge->>'to')) then issues:=issues||atlas_private.planning_issue('workbook_edge_invalid','Dependency edge references a missing graph node.');end if;
 end loop;
 -- Repeatedly remove nodes with no remaining formula dependencies. Residue proves a cycle.
 select array_agg(n->>'id') into remaining from jsonb_array_elements(audit->'graph'->'nodes')n where (coalesce(n->>'formula','')<>'' or n->>'kind'='range') and (not coalesce(scoped,false) or required ? (n->>'id'));
 while cardinality(remaining)>0 loop
  select jsonb_object_agg(u.node_id,true) into remaining_map from unnest(remaining)u(node_id);
  select array_agg(u.node_id) into next_remaining from unnest(remaining)u(node_id) where exists(select 1 from jsonb_object_keys(coalesce(edges->u.node_id,'{}'))t(target_id) where remaining_map ? t.target_id);
  exit when coalesce(cardinality(next_remaining),0)=0;
  if cardinality(next_remaining)=cardinality(remaining) then
   if exists(select 1 from unnest(next_remaining)n where coalesce(nodes->n->>'formula','')~*'\m(IF|IFERROR|IFNA|IFS|SWITCH|CHOOSE|LOOKUP|VLOOKUP|HLOOKUP|XLOOKUP|INDEX|MATCH|XMATCH|FILTER)\s*\(') then issues:=issues||atlas_private.planning_issue('workbook_conditional_dependency_cycle','A conservative dependency cycle crosses a conditional or lookup range. This does not prove Excel executes a circular reference; normalized dependencies must resolve it before approval.');
   else issues:=issues||atlas_private.planning_issue('workbook_circular_dependency','A direct or indirect formula cycle prevents approval.');end if;exit;end if;
  remaining:=next_remaining;loops:=loops+1;if loops>10000 then issues:=issues||atlas_private.planning_issue('workbook_cycle_bound','The dependency chain exceeds complete validation bounds.');exit;end if;
 end loop;
 for finding in select v from jsonb_array_elements(coalesce(audit->'findings','[]'))v where v->>'severity'='blocking' loop issues:=issues||atlas_private.planning_issue('workbook_'||(finding->>'code'),coalesce(finding->>'reason','Workbook integrity blocker'),jsonb_build_object('findingId',finding->'id'));end loop;
 return issues;
end;$$;

create or replace function atlas_private.workbook_integrity_issues(audit jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare fp text;
begin
 if audit->>'schemaVersion' is distinct from 'atlas.workbook-integrity.v1' or jsonb_typeof(audit->'inventory'->'sheets') is distinct from 'array' or jsonb_typeof(audit->'graph'->'nodes') is distinct from 'array' or jsonb_typeof(audit->'graph'->'edges') is distinct from 'array' then return atlas_private.planning_issue('workbook_integrity_required','Complete workbook inventory and formula dependency evidence are required.');end if;
 fp:=encode(sha256(convert_to(atlas_private.workbook_canonical_json(audit-'fingerprint'),'UTF8')),'hex');
 return atlas_private.workbook_integrity_issues_verified(audit,fp);
end;$$;

create or replace function public.atlas_save_workbook_audit(p_community_id uuid,p_source_hash text,p_audit jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.atlas_workbook_audits; fp text;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role in ('admin','executive','regional','finance','community_manager')) then raise exception 'Authorized workbook uploader required';end if;
 if p_request_id is null or p_source_hash!~'^[a-f0-9]{64}$' or p_audit->>'schemaVersion' is distinct from 'atlas.workbook-integrity.v1' or octet_length(p_audit::text)>134217728 or jsonb_typeof(p_audit->'inventory'->'sheets') is distinct from 'array' then raise exception 'Complete workbook audit and source hash required (128 MB maximum)';end if;
 fp:=encode(sha256(convert_to(atlas_private.workbook_canonical_json(p_audit-'fingerprint'),'UTF8')),'hex');
 if p_audit->>'fingerprint' is distinct from fp or (p_audit->'inventory'->>'sourceHash' is distinct from p_source_hash) then raise exception 'Workbook audit fingerprint does not match retained evidence';end if;
 select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and request_id=p_request_id;
 if found and (a.source_hash<>p_source_hash or a.fingerprint<>fp) then raise exception 'Workbook request ID reused with different evidence';end if;
 if a.audit_id is null then select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and source_hash=p_source_hash and fingerprint=fp;end if;
 if a.audit_id is null then insert into public.atlas_workbook_audits(source_hash,fingerprint,owner_id,request_id,evidence,server_validation) values(p_source_hash,fp,auth.uid(),p_request_id,p_audit,atlas_private.workbook_integrity_issues_verified(p_audit,fp)) on conflict(owner_id,source_hash,fingerprint) do nothing returning * into a;if a.audit_id is null then select * into a from public.atlas_workbook_audits where owner_id=auth.uid() and source_hash=p_source_hash and fingerprint=fp;end if;end if;
 if p_community_id is not null then perform public.atlas_bind_workbook_audit(a.audit_id,p_community_id);end if;
 return jsonb_build_object('audit_id',a.audit_id,'source_hash',a.source_hash,'fingerprint',a.fingerprint,'owner_id',a.owner_id,'created_at',a.created_at);
end;$$;
revoke all on function atlas_private.workbook_canonical_json(jsonb),atlas_private.workbook_integrity_issues(jsonb),atlas_private.workbook_integrity_issues_verified(jsonb,text) from public,anon,authenticated;
revoke all on function public.atlas_save_workbook_audit(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.atlas_save_workbook_audit(uuid,text,jsonb,uuid) to authenticated;

-- Read committed upload status without a row/advisory lock and without writing.
-- An unfinished request is not proof of failure; callers keep its original ID.
create function atlas_private.read_workbook_audit_upload_receipt(p_community_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u atlas_private.workbook_audit_uploads;receipt jsonb;chunks jsonb;
begin
 if auth.uid() is null or not atlas_private.workbook_upload_authorized(p_community_id) then raise exception 'Authorized workbook uploader and community required';end if;
 if p_request_id is null or coalesce(p_manifest_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'Exact workbook request and manifest required';end if;
 select * into u from atlas_private.workbook_audit_uploads where owner_id=auth.uid() and request_id=p_request_id;
 if not found then return null;end if;
 if u.community_id is distinct from p_community_id or u.manifest_hash is distinct from p_manifest_hash then raise exception 'Workbook request manifest or scope mismatch';end if;
 if u.audit_id is not null then
  perform atlas_private.authorize_workbook_audit_read(u.audit_id);
  select jsonb_build_object('audit_id',a.audit_id,'source_hash',a.source_hash,'fingerprint',a.fingerprint,'manifest_hash',u.manifest_hash) into receipt from public.atlas_workbook_audits a where a.audit_id=u.audit_id;
  if receipt is null then raise exception 'Finalized workbook receipt is unavailable';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('stream',c.stream,'chunk_index',c.chunk_index,'sha256',c.sha256,'byte_length',octet_length(c.payload)) order by c.stream,c.chunk_index),'[]'::jsonb) into chunks from atlas_private.workbook_audit_chunks c where c.upload_id=u.upload_id;
 return jsonb_build_object('upload_id',u.upload_id,'manifest_hash',u.manifest_hash,'audit_id',u.audit_id,'canceled',u.canceled_at is not null,'retry_request_id',u.retry_request_id,'receipt',receipt,'chunks',chunks);
end;$$;
create function public.atlas_read_workbook_audit_upload_receipt(p_community_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language sql stable security invoker set search_path='' as $$ select atlas_private.read_workbook_audit_upload_receipt(p_community_id,p_request_id,p_manifest_hash) $$;
revoke all on function atlas_private.read_workbook_audit_upload_receipt(uuid,uuid,text),public.atlas_read_workbook_audit_upload_receipt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function atlas_private.read_workbook_audit_upload_receipt(uuid,uuid,text),public.atlas_read_workbook_audit_upload_receipt(uuid,uuid,text) to authenticated;

commit;
