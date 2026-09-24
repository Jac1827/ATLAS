-- New approvals require explicit planning scope, immutable workbook evidence and cell-level review.
-- Existing published/locked rows remain immutable and readable.
begin;
create or replace function atlas_private.planning_issue(code text,message text,context jsonb default '{}') returns jsonb language sql immutable set search_path='' as $$select jsonb_build_array(jsonb_build_object('code',code,'message',message,'severity','error')||context)$$;
create or replace function atlas_private.planning_authorized_reviewer(cid uuid,actor text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.atlas_user_profiles p where p.user_id::text=actor and p.status='active' and (p.role in ('admin','executive') or cid=any(coalesce(p.allowed_community_ids,'{}'))) and p.role in ('admin','executive','regional','finance','community_manager'));
$$;
create or replace function atlas_private.planning_review_valid(review jsonb,cid uuid,period text,after_value jsonb,integrity text default null) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(review->>'confirmed'='true' and length(trim(coalesce(review->>'reason','')))>=3 and atlas_private.planning_authorized_reviewer(cid,review->>'ownerId') and review->>'effectivePeriod'~'^20[0-9]{2}-(0[1-9]|1[0-2])$' and (period is null or review->>'effectivePeriod'=period) and coalesce(review->>'reviewedAt','')~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' and review ? 'before' and review ? 'after' and (after_value is null or review->'after'=after_value) and (integrity is null or review->>'integrityFingerprint'=integrity),false);
$$;
create or replace function atlas_private.planning_calendar_issues(calendar jsonb,periods jsonb,scenario text) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if coalesce(scenario,'')='' or coalesce(calendar->>'scenario','')='' or calendar->>'confirmed' is distinct from 'true' or coalesce(calendar->>'basis','') not in ('calendar','fiscal') or coalesce(calendar->>'startMonth','')!~'^(?:[1-9]|1[0-2])$' or calendar->>'basis'='calendar' and calendar->>'startMonth'<>'1' or calendar->>'scenario' is distinct from scenario or calendar->>'reviewedBy' is null or calendar->>'reviewedAt' is null or jsonb_typeof(calendar->'periods') is distinct from 'array' or calendar->'periods' is distinct from periods then
 return atlas_private.planning_issue('calendar_scope_required','Confirm calendar or fiscal basis, start month, reporting periods and exact scenario.');end if;return '[]';
end;$$;

create or replace function atlas_private.workbook_canonical_json(v jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;begin
 case jsonb_typeof(v)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||atlas_private.workbook_canonical_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(v);
 when 'array' then select '['||coalesce(string_agg(atlas_private.workbook_canonical_json(value),',' order by ord),'')||']' into result from jsonb_array_elements(v) with ordinality a(value,ord);
 when 'number' then result:=trim_scale(v::text::numeric)::text;
 else result:=v::text;end case;return result;end;$$;
create or replace function atlas_private.workbook_column_number(name text) returns integer language plpgsql immutable set search_path='' as $$declare n integer:=0;c text;begin foreach c in array regexp_split_to_array(upper(name),'') loop n:=n*26+ascii(c)-64;end loop;return n;end;$$;
create or replace function atlas_private.workbook_column_name(n integer) returns text language plpgsql immutable set search_path='' as $$declare result text:='';begin while n>0 loop n:=n-1;result:=chr(65+n%26)||result;n:=n/26;end loop;return result;end;$$;
create or replace function atlas_private.workbook_integrity_issues(audit jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare issues jsonb:='[]';sheet jsonb;cell jsonb;node jsonb;finding jsonb;edge jsonb;nodes jsonb;edges jsonb;required jsonb;scoped boolean;active boolean;id text;formula text;body text;token text[];target_sheet text;target text;ref text;first_col integer;last_col integer;first_row integer;last_row integer;c integer;r integer;count_cells integer:=0;count_formulas integer:=0;remaining text[];next_remaining text[];remaining_map jsonb;loops integer:=0;actual_hash text;defined jsonb;name_match text[];name_entry jsonb;named_target text;range_id text;range_node jsonb;fn text;quoted_names text[];quote_text text;quote_index integer;unmasked_body text;
begin
 if audit->>'schemaVersion' is distinct from 'atlas.workbook-integrity.v1' or jsonb_typeof(audit->'inventory'->'sheets') is distinct from 'array' or jsonb_typeof(audit->'graph'->'nodes') is distinct from 'array' or jsonb_typeof(audit->'graph'->'edges') is distinct from 'array' then return atlas_private.planning_issue('workbook_integrity_required','Complete workbook inventory and formula dependency evidence are required.');end if;
 actual_hash:=encode(sha256(convert_to(atlas_private.workbook_canonical_json(audit-'fingerprint'),'UTF8')),'hex');
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
revoke all on function atlas_private.workbook_canonical_json(jsonb),atlas_private.workbook_column_number(text),atlas_private.workbook_column_name(integer),atlas_private.workbook_integrity_issues(jsonb) from public,anon,authenticated;

create or replace function atlas_private.reforecast_planning_issues(source jsonb,config jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare issues jsonb:='[]';cid uuid:=(source->>'communityId')::uuid;over jsonb;entry jsonb;mapping jsonb;upload jsonb;finding jsonb;review jsonb;line jsonb;cell jsonb;row_review jsonb;source_row record;id text;cutoff text:=source->'actuals'->>'cutoffPeriod';
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
  upload:=jsonb_set(upload,'{integrity}',atlas_private.resolve_workbook_audit(upload->'integrity',upload->'source'->>'sha256'));
  if upload->'integrity'->'inventory'->>'sourceHash' is distinct from upload->'source'->>'sha256' then issues:=issues||atlas_private.planning_issue('workbook_hash_binding','The workbook integrity audit must cite the retained original file hash.');end if;
  issues:=issues||atlas_private.planning_calendar_issues(mapping->'calendar',mapping->'periods',mapping->>'sourceScenario');
  for finding in select v from jsonb_array_elements(coalesce(upload->'integrity'->'findings','[]'))v where v->>'severity'='review' loop
   select v into review from jsonb_array_elements(coalesce(mapping->'integrityReviews','[]'))v where v->>'findingId'=finding->>'id';
   if not atlas_private.planning_review_valid(review,cid,null,null,upload->'integrity'->>'fingerprint') then issues:=issues||atlas_private.planning_issue('workbook_finding_review_required','A non-critical workbook finding needs an explicit authorized review.',jsonb_build_object('findingId',finding->'id'));end if;
  end loop;
  for source_row in select s->>'name' sheet,(c->>'row')::integer row from jsonb_array_elements(coalesce(upload->'sheets','[]'))s cross join lateral jsonb_array_elements(coalesce(s->'cells','[]'))c where coalesce(c->>'formula','')<>'' or c->>'hasValue'='true' and c->>'value' is not null and c->>'value'<>'' group by s->>'name',c->>'row' loop
   select v into row_review from jsonb_array_elements(coalesce(mapping->'rowDispositions','[]'))v where v->>'sheet'=source_row.sheet and v->>'row'=source_row.row::text;
   if row_review is null or row_review->>'confirmed' is distinct from 'true' or coalesce(row_review->>'disposition','') not in ('included_leaf','subtotal_control','header','memo','supporting_column','duplicate','authorized_exclusion') or length(trim(coalesce(row_review->>'reason','')))<3 or not atlas_private.planning_authorized_reviewer(cid,row_review->>'ownerId') then issues:=issues||atlas_private.planning_issue('planning_row_disposition','Every populated source row needs exactly one reviewed disposition.',jsonb_build_object('sheet',source_row.sheet,'row',source_row.row));end if;
   if (select count(*) from jsonb_array_elements(coalesce(mapping->'rowDispositions','[]'))v where v->>'sheet'=source_row.sheet and v->>'row'=source_row.row::text)<>1 then issues:=issues||atlas_private.planning_issue('planning_row_disposition_duplicate','Source row disposition is missing or ambiguous.');end if;
  end loop;
  for id in select jsonb_array_elements_text(coalesce(mapping->'selectedLineIds','[]')) loop
   select v into line from jsonb_array_elements(coalesce(upload->'lines','[]'))v where v->>'id'=id;
   if line is null or line->>'scenario' is distinct from mapping->>'sourceScenario' or line->>'period'<=cutoff or line->>'sourceKind'='workbook_actual_evidence' then continue;end if;
   select c into cell from jsonb_array_elements(coalesce(upload->'sheets','[]'))s cross join lateral jsonb_array_elements(coalesce(s->'cells','[]'))c where s->>'name'=line->>'sheet' and c->>'address'=line->>'address';
   if cell is null or id is distinct from (line->>'sheet')||'!'||(line->>'address') or line->'amount' is distinct from cell->'value' or coalesce(line->>'formula','') is distinct from coalesce(cell->>'formula','') then issues:=issues||atlas_private.planning_issue('planning_source_coordinates','Mapped planning cells must reproduce their immutable source coordinates and value.',jsonb_build_object('sourceLineId',id));end if;
   if coalesce(line->>'formula','')='' and jsonb_typeof(line->'amount')='number' then
    select v into review from jsonb_array_elements(coalesce(mapping->'inputReviews','[]'))v where v->>'cellId'=id;
    if not atlas_private.planning_review_valid(review,cid,line->>'period',line->'amount',upload->'integrity'->>'fingerprint') then issues:=issues||atlas_private.planning_issue('planning_input_review_required','A populated planning constant needs its own reviewed input record.',jsonb_build_object('sourceLineId',id));end if;
   end if;
  end loop;
 end loop;return issues;
end;$$;

create or replace function atlas_private.reforecast_planning_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare issues jsonb;prior jsonb;over jsonb;previous jsonb;entry jsonb;review jsonb;old_reviews jsonb;blockers integer;
begin
 select r.payload into prior from public.atlas_reforecast_heads h join public.atlas_reforecast_revisions r using(revision_id) where h.scenario_id=new.scenario_id;
 if new.payload->'calendar' is distinct from prior->'calendar' and new.payload->'calendar'->>'confirmed'='true' and new.payload->'calendar'->>'reviewedBy' is distinct from auth.uid()::text then raise exception 'Calendar confirmation must be recorded by the signed-in authorized reviewer';end if;
 for over in select v from jsonb_array_elements(coalesce(new.payload->'overrides','[]'))v loop
  select v into previous from jsonb_array_elements(coalesce(prior->'overrides','[]'))v where v->>'period'=over->>'period' and v->>'accountCode'=over->>'accountCode';
  if over is distinct from previous and over->>'confirmed'='true' and over->>'ownerId' is distinct from auth.uid()::text then raise exception 'A new or changed cell review must identify the signed-in authorized owner';end if;
 end loop;
 old_reviews:=(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(coalesce(prior->'importHistory','[]')||jsonb_build_array(jsonb_build_object('mapping',prior->'importMapping')))e cross join lateral jsonb_array_elements(coalesce(e->'mapping'->'inputReviews','[]')||coalesce(e->'mapping'->'integrityReviews','[]')||coalesce(e->'mapping'->'rowDispositions','[]'))v);
 for entry in select v from jsonb_array_elements(coalesce(new.payload->'importHistory','[]')||jsonb_build_array(jsonb_build_object('mapping',new.payload->'importMapping')))v loop
  for review in select v from jsonb_array_elements(coalesce(entry->'mapping'->'inputReviews','[]')||coalesce(entry->'mapping'->'integrityReviews','[]')||coalesce(entry->'mapping'->'rowDispositions','[]'))v loop
   if not(old_reviews @> jsonb_build_array(review)) and review->>'ownerId' is distinct from auth.uid()::text then raise exception 'New workbook input and integrity reviews must identify the signed-in authorized owner';end if;
  end loop;
 end loop;
 issues:=atlas_private.reforecast_planning_issues(new.source,new.payload);
 new.snapshot:=jsonb_set(new.snapshot,'{diagnostics}',coalesce(new.snapshot->'diagnostics','[]')||issues);
 select count(*) into blockers from jsonb_array_elements(new.snapshot->'diagnostics')d where d->>'severity' in ('error','blocking');
 new.snapshot:=jsonb_set(new.snapshot,'{completeness,blockerCount}',to_jsonb(blockers));new.snapshot:=jsonb_set(new.snapshot,'{status}',to_jsonb(case when blockers>0 then 'action_required'::text else 'ready'::text end));
 if blockers>0 and new.action in ('ready','submit','approve','lock') then raise exception 'Resolve planning scope, workbook integrity and cell review blockers before approval';end if;
 if blockers>0 and new.action='reconcile' then new.status:='working_draft';end if;
 new.snapshot:=new.snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((new.snapshot-'fingerprint')::text,'UTF8')),'hex'));
 return new;
end;$$;
create trigger reforecast_planning_validation before insert on public.atlas_reforecast_revisions for each row execute function atlas_private.reforecast_planning_guard();
create or replace function atlas_private.reforecast_planning_publication_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare config jsonb;issues jsonb;
begin
 select payload into config from public.atlas_reforecast_revisions where revision_id=new.revision_id and community_id=new.community_id;
 issues:=atlas_private.reforecast_planning_issues(new.source,config);
 if jsonb_array_length(issues)>0 then raise exception 'Locked source is retained. Resolve planning governance in a new reviewed revision before publication';end if;
 return new;
end;$$;
create trigger reforecast_planning_publication_validation before insert on public.atlas_reforecast_publications for each row execute function atlas_private.reforecast_planning_publication_guard();
revoke all on function atlas_private.planning_issue(text,text,jsonb),atlas_private.planning_authorized_reviewer(uuid,text),atlas_private.planning_review_valid(jsonb,uuid,text,jsonb,text),atlas_private.planning_calendar_issues(jsonb,jsonb,text),atlas_private.reforecast_planning_issues(jsonb,jsonb),atlas_private.reforecast_planning_guard(),atlas_private.reforecast_planning_publication_guard() from public,anon,authenticated;

alter function public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) set schema atlas_private;
alter function atlas_private.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) rename to save_reforecast_pre_planning;
revoke all on function atlas_private.save_reforecast_pre_planning(uuid,uuid,integer,uuid,text,jsonb) from public,anon,authenticated;
create function public.atlas_save_reforecast_scenario(p_community_id uuid,p_scenario_id uuid,p_expected_revision integer,p_request_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rec public.atlas_reforecast_revisions;head public.atlas_reforecast_heads;
begin
 result:=atlas_private.save_reforecast_pre_planning(p_community_id,p_scenario_id,p_expected_revision,p_request_id,p_action,p_payload);
 select * into rec from public.atlas_reforecast_revisions where revision_id=(result->'revision'->>'revision_id')::uuid;
 update public.atlas_reforecast_heads set status=rec.status where scenario_id=rec.scenario_id and revision_id=rec.revision_id returning * into head;
 if head.scenario_id is null then select * into head from public.atlas_reforecast_heads where scenario_id=rec.scenario_id;end if;
 return jsonb_build_object('head',to_jsonb(head),'revision',to_jsonb(rec),'source',rec.source,'snapshot',rec.snapshot);
end;$$;
revoke all on function public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) from public,anon;
grant execute on function public.atlas_save_reforecast_scenario(uuid,uuid,integer,uuid,text,jsonb) to authenticated;

commit;
