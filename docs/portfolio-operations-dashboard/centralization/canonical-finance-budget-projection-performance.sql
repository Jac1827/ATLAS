begin;
-- Expand the approved rows once per metric, not once per mapped GL.
-- Preserve explicit zero, signs, and all-or-unavailable coverage.
create or replace function atlas_private.finance_budget_metric(b jsonb,k text,m integer)
returns numeric language sql immutable set search_path='' as $$
 with amounts as materialized (
  select r->>'glCode' as gl_code,(r->'monthly'->>m)::numeric as amount
  from jsonb_array_elements(coalesce(b->'rows','[]'::jsonb)) r
 ), mapping as (
  select p->>'glCode' as gl_code,(p->>'factor')::numeric as factor
  from jsonb_array_elements(coalesce(b->'metricMappings'->k,'[]'::jsonb)) p
 )
 select case when count(*)>0 and count(a.amount)=count(*)
  then sum(a.amount*p.factor) else null end
 from mapping p left join amounts a using(gl_code);
$$;
revoke all on function atlas_private.finance_budget_metric(jsonb,text,integer) from public,anon,authenticated;
commit;
