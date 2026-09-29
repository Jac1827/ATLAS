-- Correct only the new manual-close RPC's inherited public-schema default grant.
-- Preserve the reviewed function body, all existing RPCs and database defaults.
begin;
do $guard$
begin
 if not exists (
  select 1 from pg_proc p
  where p.oid=to_regprocedure('public.atlas_confirm_month_end_close_manually(uuid,timestamptz,boolean,text)')
   and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f7fd625a3df7556ef32bc53a5d7385200abcdf1bc4c892a780c840a5d813c987'
 ) then
  raise exception 'Audited manual month-end confirmation function differs or is missing';
 end if;
end;
$guard$;
revoke execute on function public.atlas_confirm_month_end_close_manually(uuid,timestamptz,boolean,text) from service_role;
commit;
