-- Only typed raw row extraction changes. Every global source, node, edge,
-- range and scope invariant remains identical to the applied validator.
-- Preserve explicit JSON-null versus absent cells on the rare null path.
-- Valid sheet arrays use narrow recordsets without copying layout metadata.
-- Complete raw evidence and runtime cell projection behavior are unchanged.
-- This migration does not activate the projected finalizer or resolver.
begin;
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('atlas_private.workbook_global_validation_raw(json)'::regprocedure);
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION atlas_private.workbook_global_validation_raw(', 'CREATE OR REPLACE FUNCTION atlas_private.workbook_global_validation_raw_before_typed(');
 if position('FUNCTION atlas_private.workbook_global_validation_raw_before_typed(' in definition)=0 then raise exception 'Prior raw workbook validator definition not found';end if;
 execute definition;
end;$$;
revoke all on function atlas_private.workbook_global_validation_raw_before_typed(json) from public,anon,authenticated;

create or replace function atlas_private.workbook_global_validation_raw(p_audit json) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; scoped boolean:=coalesce(p_audit->'authorityScope'->>'type'='selected_cells_and_dependencies',false);
begin
 if p_audit->>'schemaVersion' is distinct from 'atlas.workbook-integrity.v1'
 or json_typeof(p_audit->'inventory'->'sheets') is distinct from 'array'
 or json_typeof(p_audit->'graph'->'nodes') is distinct from 'array'
 or json_typeof(p_audit->'graph'->'edges') is distinct from 'array' then
  raise exception 'Complete workbook inventory and dependency graph required';
 end if;
 with sheets as materialized (select s.name,case when s.cells is null then ((p_audit#>'{inventory,sheets}')->(s.ordinality-1)::integer)->'cells' else s.cells end cells from rows from (json_to_recordset(p_audit#>'{inventory,sheets}') as (name text,cells json)) with ordinality as s(name,cells,ordinality)),
 cells as materialized (select s.name sheet,c.id,c.address,c.formula,c."row" row_number,c."column" column_number from sheets s cross join lateral json_to_recordset(s.cells) as c(id text,address text,formula text,"row" integer,"column" integer)),
 nodes as materialized (select n.id,n.sheet,n.address,n.formula,n.kind,n.start first,n."end" last from json_to_recordset(p_audit#>'{graph,nodes}') as n(id text,sheet text,address text,formula text,kind text,start text,"end" text)),
 edges as materialized (select e."from" src,e."to" dst from json_to_recordset(p_audit#>'{graph,edges}') as e("from" text,"to" text)),
 required as materialized (select value id from json_array_elements_text(coalesce(p_audit->'authorityScope'->'requiredNodes','[]'::json))),
 selected as materialized (select value id from json_array_elements_text(coalesce(p_audit->'authorityScope'->'selectedCells','[]'::json))),
 names as materialized (select d.name,'@name:'||coalesce(d.sheet,'*')||'!'||d.name id,d.reference from json_to_recordset(coalesce(p_audit#>'{inventory,definedNames}','[]'::json)) as d(name text,sheet text,reference text)),
 ranges as materialized (select n.*,case when first~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then atlas_private.workbook_column_number(regexp_replace(first,'[0-9]','','g')) end c1,case when first~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then regexp_replace(first,'[A-Za-z]','','g')::integer end r1,case when last~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then atlas_private.workbook_column_number(regexp_replace(last,'[0-9]','','g')) end c2,case when last~'^[A-Za-z]{1,3}[1-9][0-9]{0,6}$' then regexp_replace(last,'[A-Za-z]','','g')::integer end r2 from nodes n where kind='range'),
 active_ranges as materialized (select r.* from ranges r join required a on a.id=r.id where scoped),
 range_members as materialized (select r.id src,c.id dst from active_ranges r join cells c on c.sheet=r.sheet and c.row_number between r.r1 and r.r2 and c.column_number between r.c1 and r.c2 where scoped),
 counts as (select (select count(*) from cells) cells,(select count(*) from cells where coalesce(formula,'')<>'') formulas,(select count(*) from nodes) nodes,(select count(*) from edges) edges,(select count(*) from sheets) sheets),
 defects(code,message) as (
 select 'workbook_graph_limit','Workbook graph exceeds complete validation bounds.' from counts where nodes>750000 or edges>500000
 union all select 'workbook_node_binding','A workbook source cell does not match its retained dependency node.' where exists(select 1 from cells c left join nodes n on n.id=c.sheet||'!'||(c.address) where c.id is distinct from c.sheet||'!'||(c.address) or n.id is null or n.sheet is distinct from c.sheet or n.address is distinct from c.address or coalesce(n.formula,'') is distinct from coalesce(c.formula,''))
 union all select 'workbook_inventory_count','Workbook cell/formula counts do not match the complete retained inventory.' from counts where (p_audit->'summary'->>'populatedCells')::integer is distinct from cells or (p_audit->'summary'->>'formulas')::integer is distinct from formulas
 union all select 'workbook_duplicate_node','Dependency node identifiers must be unique.' where exists(select 1 from nodes group by id having count(*)>1) or exists(select 1 from nodes where id is null)
 union all select 'workbook_duplicate_cell','Source cell identifiers must be unique.' where exists(select 1 from cells group by id having count(*)>1)
 union all select 'workbook_name_binding','An inventoried defined name is missing or changed in the dependency graph.' where (select count(*) from names d left join nodes n on n.id=d.id where n.id is null or n.formula is distinct from d.reference)>0
 union all select 'workbook_edge_invalid','Dependency edge references a missing graph node.' where exists(select 1 from edges e left join nodes a on a.id=e.src left join nodes b on b.id=e.dst where a.id is null or b.id is null)
 union all select 'workbook_range_binding','Range bounds do not match their canonical node identifier.' where exists(select 1 from ranges where id is distinct from '@range:'||sheet||'!'||first||':'||last or c1 is null or c2 is null or r1 is null or r2 is null or c1>c2 or r1>r2)
 union all select 'workbook_scope_invalid','Every authoritative source cell must belong to the retained dependency scope.' where scoped and (json_array_length(coalesce(p_audit->'authorityScope'->'selectedCells','[]'::json))=0 or exists(select 1 from selected s left join required r on r.id=s.id left join cells c on c.id=s.id where r.id is null or c.id is null) or exists(select 1 from required r left join nodes n on n.id=r.id where n.id is null))
 union all select 'workbook_scope_incomplete','Authoritative scope omitted a formula dependency.' where scoped and exists(select 1 from edges e join required r on r.id=e.src left join required t on t.id=e.dst where t.id is null)
 union all select 'workbook_range_cell_omitted','An authoritative range omitted a populated source cell.' where scoped and exists(select 1 from range_members r left join edges e on e.src=r.src and e.dst=r.dst where e.src is null)
 )
 select jsonb_build_object('issues',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'severity','error','message',message)),'[]'::jsonb) from defects),'counts',to_jsonb(counts)) into result from counts;
 return result;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then
 -- json_to_recordset requires object elements. Legacy raw extraction returned
 -- an approval-blocking issue for some malformed elements instead of raising.
 -- Preserve that exact outcome, and the original errors, without an additional
 -- complete shape scan on every valid workbook. This path remains private.
 return atlas_private.workbook_global_validation_raw_before_typed(p_audit);
end;$$;


revoke all on function atlas_private.workbook_global_validation_raw(json) from public,anon,authenticated;
commit;
