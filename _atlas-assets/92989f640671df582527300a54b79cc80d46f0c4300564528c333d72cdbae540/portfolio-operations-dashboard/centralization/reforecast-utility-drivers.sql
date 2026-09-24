-- Utility recommendations stay separate from actuals and are verified again before publication.
begin;
create or replace function atlas_private.reforecast_utility_issues(source jsonb,config jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare issues jsonb:='[]';driver jsonb;s jsonb;relationship jsonb;registry jsonb;vintage jsonb;rate_row jsonb;close_row jsonb;coverage jsonb;over jsonb;component jsonb;types text[];typ text;period text;code text;source_period text;rate numeric;weight numeric;total_rate numeric;total_weight numeric;actual numeric;expected numeric;matches integer;idx integer;
begin
 if jsonb_typeof(coalesce(config->'utilityDrivers','[]'))<>'array' then raise exception 'Utility drivers must be an array';end if;
 if jsonb_array_length(coalesce(config->'utilityDrivers','[]'))=0 then
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->'source'->>'kind'='utility_forecast') then return jsonb_build_array(jsonb_build_object('code','utility_driver_unlinked','severity','error','message','A utility override must retain its accepted reviewed provider driver.'));end if;return issues;end if;
 if to_regclass('public.atlas_utility_forecast_vintages') is null or to_regclass('public.atlas_utility_forecast_rows') is null or to_regclass('public.atlas_utility_forecast_activations') is null then return jsonb_build_array(jsonb_build_object('code','utility_source_unavailable','severity','error','message','The governed utility source ledger is unavailable.'));end if;
 select payload into registry from public.atlas_reforecast_registries where community_id=(source->>'communityId')::uuid and version_id=(source->'registry'->>'version')::uuid;
 if exists(select 1 from jsonb_array_elements(config->'utilityDrivers')d group by d->>'period',d->>'accountCode' having count(*)>1) then raise exception 'One utility driver per GL and full month is required';end if;
 for driver in select value from jsonb_array_elements(config->'utilityDrivers') loop
 begin
 period:=driver->>'period';code:=driver->>'accountCode';s:=driver->'source';source_period:=to_char((period||'-01')::date-interval '1 year','YYYY-MM');
 if coalesce(period,'')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' or not(config->'periods' ? period) or coalesce(code,'')='' or source->'lockedPeriods' ? period then raise exception 'Utility driver must target an editable included full month';end if;
 if coalesce(driver->>'id','')='' or coalesce(driver->>'reviewedBy','')='' or coalesce(driver->>'reviewedAt','')='' or length(trim(coalesce(driver->>'reason','')))<3 or s->>'kind' is distinct from 'utility_forecast' then raise exception 'An explicit utility review actor, time, reason and source are required';end if;
 perform (driver->>'reviewedAt')::timestamptz;
 if jsonb_typeof(driver->'amount') is distinct from 'number' or jsonb_typeof(s->'monthlyRate') is distinct from 'number' or jsonb_typeof(s->'historicalAmount') is distinct from 'number' then raise exception 'Utility amount, provider rate and historical amount must be present numeric evidence';end if;
 select count(*),jsonb_agg(r)->0 into matches,relationship from jsonb_array_elements(coalesce(registry->'utilityRelationships',registry->'relationships','[]'))r where r->>'accountCode'=code or r->>'expenseAccount'=code or r->>'incomeAccount'=code;
 if matches<>1 or relationship->>'relationship'='separate_income' or code='5956' then raise exception 'Utility GL relationship is absent, ambiguous, or separate setup/provider-credit income';end if;
 if not exists(select 1 from jsonb_array_elements(registry->'accounts')a where a->>'accountCode'=code and coalesce(a->>'identifier',a->>'nature') in ('income','contra_income','expense') and (a->>'retiredAfter' is null or a->>'retiredAfter'>=period)) then raise exception 'Utility GL needs an effective approved classification';end if;
 types:=case relationship->>'utility' when 'electricity' then array['electricity'] when 'gas' then array['natural_gas'] when 'natural_gas' then array['natural_gas'] when 'water' then array['water'] when 'sewer' then array['sewer'] when 'water_sewer' then array['water','sewer'] else null end;
 if types is null then raise exception 'Provider utility type is unavailable';end if;
 select count(*),jsonb_agg(to_jsonb(v))->0 into matches,vintage from public.atlas_utility_forecast_vintages v join (select distinct on(fiscal_year) fiscal_year,vintage_id from public.atlas_utility_forecast_activations order by fiscal_year,id desc)a on a.vintage_id=v.id where v.metadata->'periods' ? period;
 if matches<>1 or vintage->>'id' is distinct from s->>'vintageId' or vintage->>'source_hash' is distinct from s->>'sourceHash' then raise exception 'Provider vintage is unavailable, ambiguous or superseded';end if;
 select ordinality::integer-1 into idx from jsonb_array_elements_text(vintage->'metadata'->'periods') with ordinality p where value=period;
 if s->>'type' is distinct from array_to_string(types,'_') or jsonb_array_length(coalesce(s->'components','[]'))<>cardinality(types) then raise exception 'Utility component lineage is incomplete';end if;
 total_rate:=0;total_weight:=0;
 foreach typ in array types loop
 select count(*),jsonb_agg(to_jsonb(r))->0 into matches,rate_row from public.atlas_utility_forecast_rows r where r.vintage_id=(vintage->>'id')::uuid and r.community_id=(source->>'communityId')::uuid and r.utility=typ;
 if matches<>1 or rate_row->>'cancelled' is distinct from 'false' or rate_row->'payload'->>'status' is distinct from 'Eligible' or jsonb_typeof(rate_row->'payload'->'monthly'->idx) is distinct from 'number' then raise exception 'Provider rate is blank, ineligible, cancelled, or unavailable';end if;
 rate:=(rate_row->'payload'->'monthly'->>idx)::numeric;weight:=1;
 if cardinality(types)>1 then
 if relationship->'allocation'->>'reviewed' is distinct from 'true' or coalesce(relationship->'allocation'->>'source','')='' or jsonb_typeof(relationship->'allocation'->typ) is distinct from 'number' then raise exception 'Combined water/sewer requires reviewed allocation evidence';end if;
 weight:=(relationship->'allocation'->>typ)::numeric;if weight<0 then raise exception 'Utility allocation cannot be negative';end if;end if;
 select value into component from jsonb_array_elements(s->'components') where value->>'type'=typ;
 if component->>'sheet' is distinct from rate_row->>'sheet' or (component->>'row')::integer is distinct from (rate_row->>'source_row')::integer or (component->>'monthlyRate')::numeric is distinct from rate or (component->>'weight')::numeric is distinct from weight then raise exception 'Provider source row, monthly rate or reviewed allocation changed';end if;
 total_rate:=total_rate+rate*weight;total_weight:=total_weight+weight;
 end loop;
 if total_weight<=0 then raise exception 'Reviewed allocation must have a positive total';end if;rate:=total_rate/total_weight;
 if abs(rate-(s->>'monthlyRate')::numeric)>0.000000000001 or s->>'sourcePeriod' is distinct from source_period or s->>'registryVersionId' is distinct from source->'registry'->>'version' or s->>'sheet' is distinct from s->'components'->0->>'sheet' or s->'row' is distinct from s->'components'->0->'row' then raise exception 'Utility driver month, rate or registry lineage differs';end if;
 select to_jsonb(v) into close_row from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=(source->>'communityId')::uuid and h.period_key=source_period and h.accounting_basis='accrual';
 if close_row->>'status' is distinct from 'closed' or close_row->>'coverage' is distinct from 'full_month' or close_row->>'version_id' is distinct from s->>'closeVersionId' or close_row->>'source_hash' is distinct from s->>'closeSourceHash' then raise exception 'Prior-year actuals are missing, partial, reopened or superseded';end if;
 if to_regprocedure('atlas_private.finance_coverage(uuid,text,text)') is not null then
 execute 'select atlas_private.finance_coverage($1,$2,$3)' into coverage using (source->>'communityId')::uuid,source_period,close_row->>'source_hash';
 if coverage->>'fullMonthAllowed' is distinct from 'true' then raise exception 'Prior-year actuals are excluded by the governed full-month coverage policy';end if;end if;
 select count(*),sum(r.actual) into matches,actual from public.atlas_financial_close_rows r where r.version_id=(close_row->>'version_id')::uuid and r.gl_code=code;
 if matches<>1 or actual is null or actual is distinct from (s->>'historicalAmount')::numeric then raise exception 'The prior-year GL actual is unavailable or differs';end if;
 expected:=round(actual*(1+rate),2);
 select value into over from jsonb_array_elements(coalesce(config->'overrides','[]')) where value->>'period'=period and value->>'accountCode'=code;
 if (driver->>'amount')::numeric is distinct from expected or over->'source'->>'kind' is distinct from 'utility_forecast' or over->'source' is distinct from s or (over->>'amount')::numeric is distinct from expected then raise exception 'The utility override does not equal the independently calculated governed amount';end if;
 exception when others then issues:=issues||jsonb_build_array(jsonb_build_object('code','utility_evidence_required','severity','error','period',period,'accountCode',code,'message',sqlerrm));
 end;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(config->'overrides','[]'))o where o->'source'->>'kind'='utility_forecast' and not exists(select 1 from jsonb_array_elements(config->'utilityDrivers')d where d->>'period'=o->>'period' and d->>'accountCode'=o->>'accountCode')) then issues:=issues||jsonb_build_array(jsonb_build_object('code','utility_driver_unlinked','severity','error','message','A utility override has no corresponding accepted driver.'));end if;
 return issues;
end;$$;
create or replace function atlas_private.reforecast_utility_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare issues jsonb;blockers integer;driver jsonb;prior jsonb;old_payload jsonb;
begin
 select payload into old_payload from public.atlas_reforecast_revisions where scenario_id=new.scenario_id order by revision desc limit 1;
 for driver in select value from jsonb_array_elements(coalesce(new.payload->'utilityDrivers','[]')) loop
 select value into prior from jsonb_array_elements(coalesce(old_payload->'utilityDrivers','[]')) where value->>'id'=driver->>'id';
 if driver is distinct from prior and driver->>'reviewedBy' is distinct from auth.uid()::text then raise exception 'Changed utility drivers require review by the signed-in scoped editor';end if;end loop;
 issues:=atlas_private.reforecast_utility_issues(new.source,new.payload);
 new.snapshot:=new.snapshot||jsonb_build_object('utilityDrivers',coalesce(new.payload->'utilityDrivers','[]'),'diagnostics',coalesce(new.snapshot->'diagnostics','[]')||issues);
 select count(*) into blockers from jsonb_array_elements(new.snapshot->'diagnostics')d where d->>'severity' in ('error','blocking');
 new.snapshot:=jsonb_set(new.snapshot,'{completeness,blockerCount}',to_jsonb(blockers));new.snapshot:=jsonb_set(new.snapshot,'{status}',to_jsonb(case when blockers>0 then 'action_required'::text else 'ready'::text end));
 if blockers>0 and new.action in ('ready','submit','approve','lock') then raise exception 'Resolve reviewed utility evidence blockers before approval';end if;
 if blockers>0 and new.action='reconcile' then new.status:='working_draft';end if;
 new.snapshot:=new.snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((new.snapshot-'fingerprint')::text,'UTF8')),'hex'));return new;
end;$$;
create trigger zzz_reforecast_utility_validation before insert on public.atlas_reforecast_revisions for each row execute function atlas_private.reforecast_utility_guard();
revoke all on function atlas_private.reforecast_utility_issues(jsonb,jsonb),atlas_private.reforecast_utility_guard() from public,anon,authenticated;
commit;
