begin;
create table public.atlas_workforce_heads (
 employee_id uuid primary key references public.atlas_employees(employee_id),
 version bigint not null default 1, changed_at timestamptz not null default clock_timestamp()
);
alter table public.atlas_workforce_heads enable row level security;
revoke all on public.atlas_workforce_heads from public,anon,authenticated;
grant select on public.atlas_workforce_heads to authenticated;
create policy workforce_heads_read on public.atlas_workforce_heads for select to authenticated using
 (exists(select 1 from public.atlas_employees e where e.employee_id=atlas_workforce_heads.employee_id));
create table atlas_private.workforce_revisions (
 event_id bigint generated always as identity primary key,
 employee_id uuid not null,version bigint not null,source_table text not null,
 actor uuid,changed_at timestamptz not null default clock_timestamp(),before_record jsonb,after_record jsonb,
 unique(employee_id,version)
);
revoke all on atlas_private.workforce_revisions from public,anon,authenticated;
create function atlas_private.workforce_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare eid uuid; v bigint; prior jsonb; current_record jsonb;
begin
 prior:=case when TG_OP<>'INSERT' then to_jsonb(old) end;
 current_record:=case when TG_OP<>'DELETE' then to_jsonb(new) end;
 if TG_OP='UPDATE' and (prior-'version'-'updated_at') is not distinct from (current_record-'version'-'updated_at') then return new;end if;
 eid:=coalesce((current_record->>'employee_id')::uuid,(prior->>'employee_id')::uuid);
 insert into public.atlas_workforce_heads(employee_id) values(eid)
 on conflict(employee_id) do update set version=atlas_workforce_heads.version+1,changed_at=clock_timestamp() returning version into v;
 insert into atlas_private.workforce_revisions(employee_id,version,source_table,actor,before_record,after_record)
 values(eid,v,TG_TABLE_NAME,auth.uid(),prior,current_record);
 return coalesce(new,old);
end;$$;
revoke all on function atlas_private.workforce_changed() from public,anon,authenticated;
create trigger employee_workforce_event after insert or update on public.atlas_employees for each row execute function atlas_private.workforce_changed();
create trigger assignment_workforce_event after insert or update or delete on public.atlas_employee_assignments for each row execute function atlas_private.workforce_changed();
insert into public.atlas_workforce_heads(employee_id) select employee_id from public.atlas_employees on conflict do nothing;
commit;
