-- Additive, immutable intake review. Does not promote accounting actuals or budgets.
begin;
create or replace function atlas_private.financial_review_access(cid uuid, writing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.atlas_user_profiles p
 join public.atlas_communities c on c.community_id=cid
 where p.user_id=auth.uid() and p.status='active' and c.deleted_at is null
 and public.atlas_can_access_community(cid)
 and not ('12'=any(coalesce(p.locked_tab_ids,'{}')))
 and not ('budget'=any(coalesce(p.locked_page_keys,'{}')))
 and (not writing or p.role in ('admin','centra','regional','finance','community_manager','executive')));
$$;
revoke all on function atlas_private.financial_review_access(uuid,boolean) from public,anon;
grant execute on function atlas_private.financial_review_access(uuid,boolean) to authenticated;
create table public.atlas_financial_package_reviews(
 review_id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null check(period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 source_property text not null,source_file text not null,source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 accounting_basis text not null check(accounting_basis in ('accrual','cash')),
 parser_version integer not null,content_hash text not null,
 certificate jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 status text not null default 'Import Review' check(status='Import Review'),
 unique(community_id,period_key,source_hash,content_hash));
create index financial_package_review_scope on public.atlas_financial_package_reviews(community_id,period_key,created_at desc);
alter table public.atlas_financial_package_reviews enable row level security;
revoke all on public.atlas_financial_package_reviews from public,anon,authenticated;
grant select on public.atlas_financial_package_reviews to authenticated;
create policy financial_package_review_read on public.atlas_financial_package_reviews for select to authenticated using(atlas_private.financial_review_access(community_id));
create function public.atlas_save_financial_package_review(p_community_id uuid,p_certificate jsonb)
returns public.atlas_financial_package_reviews language plpgsql security definer set search_path='' as $$
declare result public.atlas_financial_package_reviews; fp text; r jsonb; ids text[]:='{}'; k text; source_name text;
begin
 if not atlas_private.financial_review_access(p_community_id,true) then raise exception 'Financial review access denied';end if;
 if p_certificate is null or octet_length(p_certificate::text)>2097152 or jsonb_typeof(p_certificate->'rows') is distinct from 'array'
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
revoke all on function public.atlas_save_financial_package_review(uuid,jsonb) from public,anon;
grant execute on function public.atlas_save_financial_package_review(uuid,jsonb) to authenticated;
-- Owner-approved crosswalk, resolved by canonical name rather than environment-specific UUID.
insert into public.atlas_community_aliases(community_id,alias,source_module,active)
select c.community_id,'Ruston','owner-approved-financial-package-2026-09-21',true from public.atlas_communities c
where c.canonical_name='the preserve at tech' and c.deleted_at is null
and not exists(select 1 from public.atlas_community_aliases a where lower(a.alias)='ruston' and a.active);
commit;
