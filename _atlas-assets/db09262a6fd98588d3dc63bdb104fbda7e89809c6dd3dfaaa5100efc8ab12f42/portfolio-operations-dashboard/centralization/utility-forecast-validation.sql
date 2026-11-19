begin;
alter table public.atlas_utility_forecast_files add column if not exists validation jsonb;
update public.atlas_utility_forecast_files f set validation=jsonb_build_object('validation',v.metadata->'validation','reconciliation',v.metadata->'reconciliation') from public.atlas_utility_forecast_vintages v where v.id=f.vintage_id and f.validation is null;
alter table public.atlas_utility_forecast_files alter column validation set not null;
update public.atlas_utility_forecast_vintages set metadata=(metadata-'validation'-'reconciliation')||jsonb_build_object('validation',jsonb_build_object('errors',metadata->'validation'->'errors','warningCount',jsonb_array_length(metadata->'validation'->'warnings')),'reconciliation',(metadata->'reconciliation')-'changes');
create or replace function public.atlas_import_utility_forecast(p_forecast jsonb,p_source text) returns uuid language plpgsql security definer set search_path='' as $$
declare vid uuid; r jsonb; avg_value numeric; n integer; seen text[]='{}'; row_key text; periods text[]; begin
 if not atlas_private.utility_admin() then raise exception 'Active Admin required to import shared forecasts'; end if;
 if encode(sha256(decode(p_source,'base64')),'hex')<>p_forecast->>'fileHash' then raise exception 'Source workbook hash mismatch';end if;
 if p_forecast->>'schemaVersion' is distinct from '1' or jsonb_typeof(p_forecast->'rows') is distinct from 'array' or coalesce(jsonb_array_length(p_forecast->'rows'),0) not between 1 and 10000 then raise exception 'Invalid forecast schema'; end if;
 if coalesce(jsonb_array_length(p_forecast->'validation'->'errors'),-1)<>0 then raise exception 'Resolve validation errors first'; end if;
 if jsonb_array_length(p_forecast->'periods')<>12 or (p_forecast->>'start')::date+interval '11 months'<> date_trunc('month',(p_forecast->>'end')::date) then raise exception 'Invalid fiscal period'; end if;
 select array_agg(to_char((p_forecast->>'start')::date + i*interval '1 month','YYYY-MM') order by i) into periods from generate_series(0,11) i;
 if to_jsonb(periods)<>p_forecast->'periods' then raise exception 'Distinct consecutive fiscal months required'; end if;
 select id into vid from public.atlas_utility_forecast_vintages where source_hash=p_forecast->>'fileHash';if vid is not null then return vid;end if;
 insert into public.atlas_utility_forecast_vintages(fiscal_year,source_file,source_hash,completed,metadata,created_by)
 values((p_forecast->>'fiscalYear')::integer,p_forecast->>'fileName',p_forecast->>'fileHash',(p_forecast->>'completed')::date,(p_forecast-'rows'-'validation'-'reconciliation')||jsonb_build_object('validation',jsonb_build_object('errors',p_forecast->'validation'->'errors','warningCount',jsonb_array_length(p_forecast->'validation'->'warnings')),'reconciliation',(p_forecast->'reconciliation')-'changes'),auth.uid()) returning id into vid;
 insert into public.atlas_utility_forecast_files(vintage_id,content,validation) values(vid,decode(p_source,'base64'),jsonb_build_object('validation',p_forecast->'validation','reconciliation',p_forecast->'reconciliation'));
 for r in select value from jsonb_array_elements(p_forecast->'rows') loop
  row_key=lower(regexp_replace(r->>'property','[^a-zA-Z0-9]','','g'))||'|'||(r->>'type');
  if row_key=any(seen) then raise exception 'Duplicate property/utility';end if;seen=array_append(seen,row_key);
  if coalesce(jsonb_array_length(r->'monthly'),0)<>12 or nullif(r->>'status','') is null or nullif(r->>'city','') is null or (r->>'state') !~ '^[A-Z]{2}$' or nullif(r->>'provider','') is null then raise exception 'Invalid row location, provider or months';end if;
  if r->>'status'='Eligible' and not (r->>'cancelled')::boolean then
   select count(*),avg(value::text::numeric) into n,avg_value from jsonb_array_elements(r->'monthly') where jsonb_typeof(value)='number';
   if n<>12 or (r->>'annual') is null or (r->>'reportedAnnual') is null or abs(avg_value-(r->>'annual')::numeric)>0.00000001 or abs(avg_value-(r->>'reportedAnnual')::numeric)>0.0005 or exists(select 1 from jsonb_array_elements(r->'monthly') where value::text::numeric< -1) then raise exception 'Forecast percentages do not reconcile';end if;
  elsif exists(select 1 from jsonb_array_elements(r->'monthly') where value<>'null'::jsonb) then raise exception 'Ineligible forecasts must remain unavailable';end if;
  insert into public.atlas_utility_forecast_rows values(vid,r->>'sheet',(r->>'row')::integer,(r->>'communityId')::uuid,r->>'type',(r->>'cancelled')::boolean,r);
 end loop;return vid;
end $$;

create unique index if not exists atlas_utility_actual_source_once on public.atlas_utility_actuals(community_id,period_key,utility,provider,(source->>'hash'));
commit;
