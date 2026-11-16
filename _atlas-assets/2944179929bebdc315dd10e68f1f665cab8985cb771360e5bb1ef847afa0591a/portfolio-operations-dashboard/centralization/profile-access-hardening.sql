-- Authorization fields are managed through reviewed Admin RPCs, never self-profile writes.
-- Existing access assignments remain unchanged. Empty Bonus permissions retain role defaults.
begin;

alter table public.atlas_user_profiles add column if not exists bonus_permissions text[] not null default '{}';
alter table public.atlas_user_access_invites add column if not exists bonus_permissions text[] not null default '{}';

create function atlas_private.access_bonus_permissions_valid(permissions text[]) returns boolean
language sql immutable set search_path='' as $$
 select permissions is not null and cardinality(permissions)<=13
 and array_position(permissions,null) is null
 and permissions <@ array['view_bonus_module','view_own_bonus','view_own_region','view_portfolio','edit_bonus_plans','run_calculations','approve_bonuses','override_calculations','view_salary','export_approval_reports','export_payroll_reports','finalize_period','reopen_period']::text[]
 and cardinality(permissions)=(select count(distinct p) from unnest(permissions)p);
$$;
alter table public.atlas_user_profiles add constraint atlas_profile_bonus_permissions_valid check(atlas_private.access_bonus_permissions_valid(bonus_permissions));
alter table public.atlas_user_access_invites add constraint atlas_invite_bonus_permissions_valid check(atlas_private.access_bonus_permissions_valid(bonus_permissions));
revoke all on function atlas_private.access_bonus_permissions_valid(text[]) from public,anon,authenticated;
-- Pure, immutable CHECK validation has no data access and must run during self-profile edits.
grant execute on function atlas_private.access_bonus_permissions_valid(text[]) to authenticated,service_role;

-- Revoke both table-level and any old column-level grants. RLS alone cannot restrict fields.
revoke insert,update,delete,truncate,references,trigger on public.atlas_user_profiles,public.atlas_user_access_invites from public,anon,authenticated;
do $$declare field record;begin
 for field in select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('atlas_user_profiles','atlas_user_access_invites') loop
 execute format('revoke insert(%I),update(%I),references(%I) on public.%I from public,anon,authenticated',field.column_name,field.column_name,field.column_name,field.table_name);
 end loop;
end;$$;
grant update(display_name,profile_image_url,updated_at) on public.atlas_user_profiles to authenticated;
-- Keep existing scoped SELECT policies and legitimate security-definer Admin/claim flows.

-- Qualify columns in the existing self-edit API so output parameters cannot shadow them.
create or replace function public.atlas_update_current_profile(p_display_name text default null,p_profile_image_url text default null)
returns table(user_id uuid,email text,display_name text,profile_image_url text,role text,status text)
language plpgsql security invoker set search_path='' as $$
declare profile public.atlas_user_profiles;
begin
 if auth.uid() is null then raise exception 'Authentication is required before updating the Atlas profile' using errcode='28000';end if;
 update public.atlas_user_profiles p set display_name=coalesce(nullif(trim(p_display_name),''),p.display_name),
 profile_image_url=nullif(trim(coalesce(p_profile_image_url,'')),''),updated_at=now()
 where p.user_id=auth.uid() and p.status='active' returning p.* into profile;
 if profile.user_id is null then raise exception 'An active Atlas user profile is required' using errcode='42501';end if;
 insert into public.atlas_audit_log(actor_user_id,action,entity_table,entity_id,source_module,after_payload)
 values(auth.uid(),'profile_updated','atlas_user_profiles',profile.user_id::text,'user_profile',jsonb_build_object('display_name',profile.display_name,'profile_image_url',profile.profile_image_url));
 return query select profile.user_id,profile.email,profile.display_name,profile.profile_image_url,profile.role,profile.status;
end;$$;

alter function public.atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) rename to atlas_admin_upsert_user_access_before_permissions;
alter function public.atlas_admin_upsert_user_access_before_permissions(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) set schema atlas_private;
revoke all on function atlas_private.atlas_admin_upsert_user_access_before_permissions(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) from public,anon,authenticated;
create function public.atlas_admin_upsert_user_access(
 p_email text,p_display_name text,p_role text,p_status text default 'pending',p_employee_id uuid default null,
 p_allowed_community_ids uuid[] default '{}',p_allowed_market_values text[] default '{}',p_allowed_region_values text[] default '{}',
 p_locked_tab_ids text[] default '{}',p_locked_page_keys text[] default '{}',p_access_notes text default null,p_bonus_permissions text[] default null
) returns table(email text,profile_user_id uuid,invite_id uuid,status text,role text)
language plpgsql security definer set search_path='' as $$
declare saved record;prior_permissions text[];
begin
 if auth.uid() is null or not public.atlas_has_role(array['admin']) then raise exception 'Only an active Atlas Admin can manage user access' using errcode='42501';end if;
 if p_bonus_permissions is not null and not atlas_private.access_bonus_permissions_valid(p_bonus_permissions) then raise exception 'Bonus permissions must be unique supported permission identifiers' using errcode='22023';end if;
 select * into saved from atlas_private.atlas_admin_upsert_user_access_before_permissions(p_email,p_display_name,p_role,p_status,p_employee_id,p_allowed_community_ids,p_allowed_market_values,p_allowed_region_values,p_locked_tab_ids,p_locked_page_keys,p_access_notes);
 if p_bonus_permissions is not null then
 select i.bonus_permissions into prior_permissions from public.atlas_user_access_invites i where i.invite_id=saved.invite_id for update;
 update public.atlas_user_access_invites i set bonus_permissions=p_bonus_permissions,updated_at=now() where i.invite_id=saved.invite_id;
 update public.atlas_user_profiles p set bonus_permissions=p_bonus_permissions,updated_at=now() where p.user_id=saved.profile_user_id;
 insert into public.atlas_audit_log(actor_user_id,action,entity_table,entity_id,source_module,before_payload,after_payload,metadata)
 values(auth.uid(),'bonus_permissions_reviewed','atlas_user_access_invites',saved.invite_id::text,'user_access',to_jsonb(prior_permissions),to_jsonb(p_bonus_permissions),jsonb_build_object('profile_user_id',saved.profile_user_id));
 end if;
 return query select saved.email,saved.profile_user_id,saved.invite_id,saved.status,saved.role;
end;$$;

-- Claim only a current Admin-authored invite for the canonical authenticated email.
create or replace function public.atlas_claim_invited_profile(p_display_name text default null)
returns table(user_id uuid,email text,display_name text,role text,status text)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();verified_email text;invite public.atlas_user_access_invites;profile public.atlas_user_profiles;
begin
 if actor is null then raise exception 'Authentication is required before claiming Atlas access' using errcode='28000';end if;
 select lower(u.email) into verified_email from auth.users u where u.id=actor;
 if nullif(verified_email,'') is null then raise exception 'The authenticated user does not have an email address' using errcode='22023';end if;
 select i.* into invite from public.atlas_user_access_invites i where lower(i.email)=verified_email and i.status in ('pending','active') order by i.updated_at desc limit 1 for update;
 if invite.invite_id is null or (invite.claimed_user_id is not null and invite.claimed_user_id<>actor) or (invite.auth_user_id is not null and invite.auth_user_id<>actor) then raise exception 'No active Atlas access invite was found for this identity' using errcode='42501';end if;
 if not atlas_private.access_bonus_permissions_valid(invite.bonus_permissions) then raise exception 'Verified Admin invite permissions required' using errcode='42501';end if;
 insert into public.atlas_user_profiles(user_id,email,display_name,role,status,employee_id,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,access_notes,account_status,last_access_reviewed_at,bonus_permissions)
 values(actor,verified_email,coalesce(nullif(trim(p_display_name),''),invite.display_name,verified_email),invite.role,'active',invite.employee_id,invite.allowed_community_ids,invite.allowed_market_values,invite.allowed_region_values,invite.locked_tab_ids,invite.locked_page_keys,invite.access_notes,'active',now(),invite.bonus_permissions)
 on conflict on constraint atlas_user_profiles_pkey do update set email=excluded.email,display_name=excluded.display_name,role=excluded.role,status=excluded.status,employee_id=excluded.employee_id,allowed_community_ids=excluded.allowed_community_ids,allowed_market_values=excluded.allowed_market_values,allowed_region_values=excluded.allowed_region_values,locked_tab_ids=excluded.locked_tab_ids,locked_page_keys=excluded.locked_page_keys,access_notes=excluded.access_notes,account_status='active',last_access_reviewed_at=now(),updated_at=now(),bonus_permissions=excluded.bonus_permissions
 returning * into profile;
 update public.atlas_user_access_invites i set status='active',access_status='active',account_status='active',claimed_user_id=actor,claimed_at=coalesce(i.claimed_at,now()),invitation_accepted_at=coalesce(i.invitation_accepted_at,now()),auth_user_id=coalesce(i.auth_user_id,actor),last_invite_error=null,updated_at=now() where i.invite_id=invite.invite_id;
 insert into public.atlas_audit_log(actor_user_id,action,entity_table,entity_id,source_module,before_payload,after_payload,metadata)
 values(actor,'access_invite_claimed','atlas_user_profiles',actor::text,'user_access',to_jsonb(invite),to_jsonb(profile),jsonb_build_object('invite_id',invite.invite_id));
 return query select profile.user_id,profile.email,profile.display_name,profile.role,profile.status;
end;$$;

revoke all on function public.atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text,text[]),public.atlas_claim_invited_profile(text) from public,anon;
grant execute on function public.atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text,text[]),public.atlas_claim_invited_profile(text) to authenticated;
commit;
