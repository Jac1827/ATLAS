-- Governed, durable REVIEWED comparisons. This is not financial close or publication.
begin;
create table public.atlas_financial_comparison_versions (
 version_id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null,
 review_id uuid not null references public.atlas_financial_package_reviews(review_id),
 previous_version_id uuid references public.atlas_financial_comparison_versions(version_id),
 content_hash text not null, source_hash text not null, source_file text not null,
 accounting_basis text not null check(accounting_basis='accrual'),
 status text not null default 'Reviewed — not closed' check(status='Reviewed — not closed'),
 row_count integer not null, reason text, applied_by uuid not null references auth.users(id),
 applied_at timestamptz not null default now(),
 unique(community_id,period_key,content_hash)
);
create table public.atlas_financial_comparison_rows (
 version_id uuid not null references public.atlas_financial_comparison_versions(version_id),
 community_id uuid not null references public.atlas_communities(community_id),
 gl_code text not null, account_name text not null, section text,
 actual numeric not null, source_budget numeric, ytd_actual numeric, source_ytd_budget numeric, source_annual_budget numeric,
 source_location jsonb not null, primary key(version_id,gl_code)
);
create table public.atlas_financial_comparison_heads (
 community_id uuid not null references public.atlas_communities(community_id), period_key text not null,
 version_id uuid not null references public.atlas_financial_comparison_versions(version_id),
 primary key(community_id,period_key)
);
create index financial_comparison_period on public.atlas_financial_comparison_versions(community_id,period_key,applied_at desc);
create index financial_comparison_rows_scope on public.atlas_financial_comparison_rows(community_id,version_id);
alter table public.atlas_financial_comparison_versions enable row level security;
alter table public.atlas_financial_comparison_rows enable row level security;
alter table public.atlas_financial_comparison_heads enable row level security;
revoke all on public.atlas_financial_comparison_versions,public.atlas_financial_comparison_rows,public.atlas_financial_comparison_heads from public,anon,authenticated;
grant select on public.atlas_financial_comparison_versions,public.atlas_financial_comparison_rows,public.atlas_financial_comparison_heads to authenticated;
create policy comparison_versions_read on public.atlas_financial_comparison_versions for select to authenticated using(atlas_private.financial_review_access(community_id));
create policy comparison_rows_read on public.atlas_financial_comparison_rows for select to authenticated using(atlas_private.financial_review_access(community_id));
create policy comparison_heads_read on public.atlas_financial_comparison_heads for select to authenticated using(atlas_private.financial_review_access(community_id));
create function public.atlas_apply_financial_comparison(p_review_id uuid,p_expected_version_id uuid default null,p_reason text default null)
returns public.atlas_financial_comparison_versions language plpgsql security definer set search_path='' as $$
declare review public.atlas_financial_package_reviews; result public.atlas_financial_comparison_versions;
 current_id uuid; income_end bigint; expense_end bigint; noi_end bigint; field text;
 income numeric; expense numeric; source_income numeric; source_noi numeric; fingerprint text; n integer;
begin
 select * into review from public.atlas_financial_package_reviews where review_id=p_review_id;
 if review.review_id is null or not atlas_private.financial_review_access(review.community_id,true) then raise exception 'Financial comparison access denied'; end if;
 if review.accounting_basis<>'accrual' or jsonb_array_length(coalesce(review.certificate->'exceptions','[]'))<>0 then raise exception 'Resolve extraction exceptions before applying actuals';end if;
 -- Serialize one community/period; no unrelated community or whole-portfolio lock.
 perform pg_advisory_xact_lock(hashtextextended(review.community_id::text||review.period_key,0));
 select version_id into current_id from public.atlas_financial_comparison_heads where community_id=review.community_id and period_key=review.period_key;
 select min(ord) filter(where value->>'kind'='control' and value->>'accountName' ~* '^Total Income$'),
 min(ord) filter(where value->>'kind'='control' and value->>'accountName' ~* '^Total (Operating )?Expenses$'),
 min(ord) filter(where value->>'kind'='control' and value->>'accountName' ~* '^Net Operating Income( *\(NOI\))?$')
 into income_end,expense_end,noi_end from jsonb_array_elements(review.certificate->'rows') with ordinality as r(value,ord);
 expense_end:=coalesce(expense_end,noi_end);
 if income_end is null or noi_end is null or expense_end<=income_end then raise exception 'Income and NOI source controls are required';end if;
 foreach field in array array['actual','budget','ytdActual','ytdBudget','annualBudget'] loop
  if exists(select 1 from jsonb_array_elements(review.certificate->'rows') r where r->>'kind'='posting' and jsonb_typeof(r->'values'->field) is distinct from 'number') then raise exception 'Missing GL amount: %',field;end if;
  select sum(round((value->'values'->>field)::numeric,2)) filter(where ord<income_end and value->>'kind'='posting'),
  sum(round((value->'values'->>field)::numeric,2)) filter(where ord>income_end and ord<expense_end and value->>'kind'='posting'),
  max((value->'values'->>field)::numeric) filter(where ord=income_end),max((value->'values'->>field)::numeric) filter(where ord=noi_end)
  into income,expense,source_income,source_noi from jsonb_array_elements(review.certificate->'rows') with ordinality as r(value,ord);
  if income is null or expense is null or source_income is null or source_noi is null or round(income,2)<>round(source_income,2) or round(income-expense,2)<>round(source_noi,2) then raise exception 'Server reconciliation failed: %',field;end if;
 end loop;
 select count(*),encode(sha256(convert_to(jsonb_agg(jsonb_build_array(r->>'glCode',r->'values'->'actual',r->'values'->'budget',r->'values'->'ytdActual',r->'values'->'ytdBudget',r->'values'->'annualBudget') order by r->>'glCode')::text,'UTF8')),'hex') into n,fingerprint from jsonb_array_elements(review.certificate->'rows') r where r->>'kind'='posting';
 select * into result from public.atlas_financial_comparison_versions where community_id=review.community_id and period_key=review.period_key and content_hash=fingerprint;
 if result.version_id=current_id then return result;end if;
 if current_id is distinct from p_expected_version_id then raise exception 'Comparison changed in another session. Reload before applying';end if;
 if current_id is not null and length(trim(coalesce(p_reason,'')))<5 then raise exception 'A reason is required to replace a reviewed comparison; prior versions are preserved';end if;
 if result.version_id is not null then raise exception 'This matches a previous version. Review history instead of reverting implicitly';end if;
 insert into public.atlas_financial_comparison_versions(community_id,period_key,review_id,previous_version_id,content_hash,source_hash,source_file,accounting_basis,row_count,reason,applied_by)
 values(review.community_id,review.period_key,review.review_id,current_id,fingerprint,review.source_hash,review.source_file,review.accounting_basis,n,p_reason,auth.uid()) returning * into result;
 insert into public.atlas_financial_comparison_rows(version_id,community_id,gl_code,account_name,section,actual,source_budget,ytd_actual,source_ytd_budget,source_annual_budget,source_location)
 select result.version_id,review.community_id,r->>'glCode',r->>'accountName',r->>'section',(r->'values'->>'actual')::numeric,(r->'values'->>'budget')::numeric,(r->'values'->>'ytdActual')::numeric,(r->'values'->>'ytdBudget')::numeric,(r->'values'->>'annualBudget')::numeric,r->'source' from jsonb_array_elements(review.certificate->'rows') r where r->>'kind'='posting';
 insert into public.atlas_financial_comparison_heads values(review.community_id,review.period_key,result.version_id) on conflict(community_id,period_key) do update set version_id=excluded.version_id;
 return result;
end;$$;
revoke all on function public.atlas_apply_financial_comparison(uuid,uuid,text) from public,anon;
grant execute on function public.atlas_apply_financial_comparison(uuid,uuid,text) to authenticated;
commit;
