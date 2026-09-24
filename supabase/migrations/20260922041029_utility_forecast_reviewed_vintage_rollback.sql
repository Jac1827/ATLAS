begin;
create or replace function public.atlas_activate_utility_forecast(p_vintage uuid,p_expected uuid,p_reason text,p_rollback boolean default false) returns bigint language plpgsql security definer set search_path='' as $$
declare v public.atlas_utility_forecast_vintages; prior uuid; previous_date date; aid bigint;begin
 if not atlas_private.utility_admin() then raise exception 'Active Admin required';end if;
 select * into strict v from public.atlas_utility_forecast_vintages where id=p_vintage;
 perform pg_advisory_xact_lock(732719,v.fiscal_year);
 select vintage_id into prior from public.atlas_utility_forecast_activations where fiscal_year=v.fiscal_year order by id desc limit 1;
 if prior is distinct from p_expected then raise exception 'Active vintage changed. Reload preview';end if;
 if prior=p_vintage then select id into aid from public.atlas_utility_forecast_activations where fiscal_year=v.fiscal_year order by id desc limit 1;return aid;end if;
 select completed into previous_date from public.atlas_utility_forecast_vintages where id=prior;
 if previous_date>=v.completed and not p_rollback then raise exception 'A newer vintage is active';end if;
 if p_rollback and prior is null then raise exception 'No active vintage to roll back';end if;
 insert into public.atlas_utility_forecast_activations(fiscal_year,vintage_id,prior_vintage_id,reason,rollback,actor) values(v.fiscal_year,v.id,prior,p_reason,p_rollback,auth.uid()) returning id into aid;return aid;
end $$;
commit;
