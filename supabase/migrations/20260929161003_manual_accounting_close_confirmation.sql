-- A reviewer may know that Accounting closed the month without knowing its
-- historical close time. Record that confirmation separately from the retained
-- source generation time, which remains required evidence.
begin;

alter table public.atlas_month_end_attestations
 add column confirmation_mode text not null default 'verified_close_time',
 add column manual_closed_confirmed boolean,
 alter column accounting_closed_at drop not null,
 add constraint month_end_confirmation_evidence check (
  (confirmation_mode='verified_close_time' and accounting_closed_at is not null and manual_closed_confirmed is null)
  or (confirmation_mode='manual_closed_confirmation' and accounting_closed_at is null and manual_closed_confirmed is true)
 );

-- The existing precise-time RPC, table grants, immutable trigger, scoped reads,
-- source_generated_at NOT NULL, and all existing attestation values are retained.
create function public.atlas_confirm_month_end_close_manually(
 p_review_id uuid,p_source_generated_at timestamptz,p_closed_confirmed boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.atlas_financial_package_reviews;t public.atlas_month_end_attestations;role_name text;
begin
 select * into r from public.atlas_financial_package_reviews where review_id=p_review_id;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 if auth.uid() is null or r.review_id is null or role_name is null or role_name not in ('admin','executive','finance') or not atlas_private.financial_review_access(r.community_id,true) then
  raise exception 'Scoped Accounting, VP or Admin verification required';
 end if;
 if p_closed_confirmed is distinct from true or r.period_key>=to_char(current_date,'YYYY-MM')
    or p_source_generated_at is null or p_source_generated_at>now() or length(trim(coalesce(p_reason,'')))<5 then
  raise exception 'Explicitly confirm Accounting closed this month and verify the source generation time and reason';
 end if;
 -- created_at is the server's confirmation time. It is not an Accounting close
 -- date. Neither the expected 10th–15th window nor uploading implies closure.
 insert into public.atlas_month_end_attestations(
  review_id,community_id,actor_id,actor_role,accounting_closed_at,source_generated_at,reason,source_hash,confirmation_mode,manual_closed_confirmed
 ) values(r.review_id,r.community_id,auth.uid(),role_name,null,p_source_generated_at,trim(p_reason),r.source_hash,'manual_closed_confirmation',true)
 on conflict(review_id) do nothing returning * into t;
 if t.attestation_id is null then
  select * into t from public.atlas_month_end_attestations where review_id=r.review_id;
  if t.confirmation_mode is distinct from 'manual_closed_confirmation' or t.manual_closed_confirmed is distinct from true
     or t.accounting_closed_at is not null or t.source_generated_at is distinct from p_source_generated_at
     or t.reason is distinct from trim(p_reason) or t.source_hash is distinct from r.source_hash then
   raise exception 'This package already has immutable Accounting verification; correct it in a new package review';
  end if;
 end if;
 return to_jsonb(t);
end;$$;
revoke all on function public.atlas_confirm_month_end_close_manually(uuid,timestamptz,boolean,text) from public,anon,authenticated;
grant execute on function public.atlas_confirm_month_end_close_manually(uuid,timestamptz,boolean,text) to authenticated;

commit;
