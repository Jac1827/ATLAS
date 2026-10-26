-- Governed Bonus setup and approval. Recording an external payment never transfers money.
-- Existing retained receipts are preserved; no employee eligibility or business plan is seeded.
begin;
alter table public.atlas_employees add column if not exists bonus_eligible boolean not null default false;
alter table public.atlas_employees add column if not exists bonus_effective_date date;
alter table public.atlas_incentive_plans add column if not exists workflow_config jsonb;

create table atlas_private.bonus_plan_versions (
 plan_id uuid not null references public.atlas_incentive_plans(incentive_plan_id),version integer not null,
 payload jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(plan_id,version));
create table atlas_private.bonus_workflow_heads (
 run_id uuid primary key references public.atlas_bonus_calculation_runs(bonus_calculation_run_id),revision integer not null,
 status text not null check(status in ('draft','review','approved','locked','paid','voided')),
 assignment_id uuid not null references public.atlas_employee_assignments(assignment_id),plan_id uuid not null references public.atlas_incentive_plans(incentive_plan_id),
 community_id uuid not null references public.atlas_communities(community_id),period_key text not null,
 created_by uuid not null references auth.users(id),updated_at timestamptz not null default now());
create table atlas_private.bonus_workflow_subjects (
 assignment_id uuid not null references public.atlas_employee_assignments(assignment_id),period_key text not null,
 run_id uuid not null unique references atlas_private.bonus_workflow_heads(run_id),employee_id uuid not null references public.atlas_employees(employee_id),primary key(assignment_id,period_key),unique(employee_id,period_key));
create table atlas_private.bonus_workflow_events (
 event_id uuid primary key default gen_random_uuid(),run_id uuid references atlas_private.bonus_workflow_heads(run_id),
 entity_id uuid not null,action text not null,revision integer,actor_id uuid not null references auth.users(id),
 detail jsonb not null,created_at timestamptz not null default now());
create table atlas_private.bonus_external_payments (
 run_id uuid primary key references atlas_private.bonus_workflow_heads(run_id),reference text not null,
 paid_date date not null,amount numeric(14,2) not null,actor_id uuid not null references auth.users(id),reason text not null,recorded_at timestamptz not null default now(),
 unique(reference));
create table atlas_private.bonus_workflow_requests (
 request_id uuid primary key,actor_id uuid not null,request_hash text not null,result jsonb not null,created_at timestamptz not null default now());
create table atlas_private.bonus_eligibility_write (
 transaction_id xid8 not null,employee_id uuid not null,primary key(transaction_id,employee_id));
revoke all on atlas_private.bonus_plan_versions,atlas_private.bonus_workflow_heads,atlas_private.bonus_workflow_subjects,atlas_private.bonus_workflow_events,atlas_private.bonus_external_payments,atlas_private.bonus_workflow_requests,atlas_private.bonus_eligibility_write from public,anon,authenticated;

create function atlas_private.bonus_access(cid uuid,permission text default 'view_bonus_module') returns boolean language plpgsql stable security definer set search_path='' as $$
declare profile jsonb;role_name text;explicit_permissions jsonb;defaults text[];
begin
 select to_jsonb(p) into profile from public.atlas_user_profiles p where p.user_id=auth.uid() and p.status='active';
 if profile is null or coalesce(profile->'locked_tab_ids','[]') ? '9' or coalesce(profile->'locked_page_keys','[]') ? 'bonus' then return false;end if;
 role_name:=profile->>'role';
 if role_name not in ('admin','centra','people','executive','regional','bonus','finance','community_manager') then return false;end if;
 if cid is not null and not public.atlas_can_access_community(cid) then return false;end if;
 explicit_permissions:=coalesce(profile->'bonus_permissions','[]');
 if jsonb_array_length(explicit_permissions)>0 then return explicit_permissions ? 'view_bonus_module' and explicit_permissions ? permission;end if;
 defaults:=case role_name
 when 'admin' then array['view_bonus_module','edit_bonus_plans','run_calculations','approve_bonuses','finalize_period']
 when 'centra' then array['view_bonus_module','edit_bonus_plans','run_calculations','approve_bonuses','finalize_period']
 when 'people' then array['view_bonus_module','edit_bonus_plans','run_calculations','approve_bonuses','finalize_period']
 when 'executive' then array['view_bonus_module','run_calculations','approve_bonuses','finalize_period']
 when 'regional' then array['view_bonus_module','approve_bonuses']
 when 'bonus' then array['view_bonus_module','edit_bonus_plans','run_calculations','approve_bonuses']
 when 'finance' then array['view_bonus_module','run_calculations']
 else array['view_bonus_module'] end;
 return permission=any(defaults);
end;$$;

-- Recompute every numeric value from canonical monthly summaries and the effective baseline.
-- Unsupported/nonfinancial metrics, salary plans, partial quarters and discretionary overrides are blocked.
create function atlas_private.bonus_calculate(assignment_id uuid,plan_id uuid,period_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment public.atlas_employee_assignments;employee public.atlas_employees;plan public.atlas_incentive_plans;config jsonb;starts date;ends date;months text[];month text;baselines jsonb;baseline jsonb;summary jsonb;close_id uuid;close_hash text;metric jsonb;metric_key text;monthly jsonb:='[]';actual numeric;target numeric;variance numeric;attainment numeric;ratio numeric;potential numeric;earned numeric;payout_pct numeric;total numeric:=0;results jsonb:='[]';evidence jsonb;retained jsonb;line jsonb;period jsonb;close_ids jsonb:='[]';snapshot_hash text;
begin
 if period_key !~ '^20[0-9]{2}-Q[1-4]$' or period_key is null then raise exception 'Exact calendar quarter required';end if;
 starts:=make_date(left(period_key,4)::int,(right(period_key,1)::int-1)*3+1,1);ends:=(starts+interval '3 months'-interval '1 day')::date;
 select * into assignment from public.atlas_employee_assignments a where a.assignment_id=bonus_calculate.assignment_id and a.deleted_at is null for share;
 if assignment.assignment_id is null or not atlas_private.bonus_access(assignment.community_id) then raise exception 'Scoped canonical assignment required';end if;
 select * into employee from public.atlas_employees e where e.employee_id=assignment.employee_id and e.deleted_at is null for share;
 select * into plan from public.atlas_incentive_plans p where p.incentive_plan_id=plan_id and p.deleted_at is null for share;
 config:=plan.workflow_config;
 if plan.incentive_plan_id is null or config is null or not exists(select 1 from atlas_private.bonus_plan_versions v where v.plan_id=plan.incentive_plan_id and v.version=plan.version and v.payload-'id'-'version'=config) then raise exception 'A governed, versioned Bonus plan is required';end if;
 if employee.employee_id is null or employee.bonus_eligible is not true or lower(employee.status)<>'active' or lower(assignment.employment_status)<>'active' or employee.bonus_effective_date is null or employee.bonus_effective_date>starts then raise exception 'Explicit active employee Bonus eligibility must cover the entire quarter';end if;
 if assignment.effective_start>starts or (assignment.effective_end is not null and assignment.effective_end<ends) or plan.effective_start>starts or (plan.effective_end is not null and plan.effective_end<ends) or assignment.role_id is distinct from plan.role_id or not (plan.eligibility_rules->'communityIds' ? assignment.community_id::text) then raise exception 'Plan and assignment must match role/community and cover the full quarter; partial-quarter proration is not yet supported';end if;
 if exists(select 1 from public.atlas_employee_assignments other where other.employee_id=employee.employee_id and other.assignment_id<>assignment.assignment_id and other.deleted_at is null and lower(other.employment_status)='active' and other.effective_start<=ends and (other.effective_end is null or other.effective_end>=starts)) then raise exception 'Overlapping employee assignments require a reviewed allocation; duplicate quarterly payouts are blocked';end if;
 select array_agg(to_char(d,'YYYY-MM') order by d) into months from generate_series(starts,ends,interval '1 month')d;
 baselines:=public.atlas_reforecast_effective_baseline(array[assignment.community_id],months);
 foreach month in array months loop
 select value into baseline from jsonb_array_elements(baselines)b where b->>'communityId'=assignment.community_id::text and b->>'period'=month;
 if baseline->>'status' is distinct from 'available' or baseline->>'verified' is distinct from 'true' then raise exception 'Verified effective baseline unavailable for %: %',month,coalesce(baseline->>'reason','missing');end if;
 select h.version_id,v.source_hash into close_id,close_hash from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=assignment.community_id and h.period_key=month and h.accounting_basis='accrual' for share of h;
 if close_id is null or not atlas_private.reforecast_close_eligible(assignment.community_id,month,close_hash) then raise exception 'Full governed actual close unavailable for %',month;end if;
 select f.summary into summary from public.atlas_command_financial_summaries f where f.community_id=assignment.community_id and f.period_key=month for share;
 if summary->>'registryVersion' is distinct from 'atlas-finance-v1' or summary->>'actualCloseVersion' is distinct from close_id::text then raise exception 'Canonical financial summary is missing or stale for %',month;end if;
 summary:=atlas_private.reforecast_finance_summary(summary,baseline);
 monthly:=monthly||jsonb_build_array(jsonb_build_object('period',month,'summary',summary));close_ids:=close_ids||jsonb_build_array(close_id);
 end loop;
 snapshot_hash:=encode(sha256(convert_to(monthly::text,'UTF8')),'hex');
 evidence:=jsonb_build_object('periods',months,'baselineEvidence',baselines,'actualCloseVersions',close_ids,'snapshotFingerprint',snapshot_hash,'financialSnapshot',jsonb_build_object('identity',jsonb_build_object('communityId',assignment.community_id),'months',monthly));
 for metric in select value from jsonb_array_elements(plan.metric_rules) loop
 metric_key:=case metric->>'metricKey' when 'budget_attainment' then 'expenses' when 'cash_flow' then 'cashFlow' else metric->>'metricKey' end;
 if metric_key not in ('revenue','expenses','noi','cashFlow') or metric->>'payoutStructure' is distinct from 'weighted_scorecard' then raise exception 'Unsupported metric evaluator';end if;
 actual:=0;target:=0;
 for summary in select value->'summary' from jsonb_array_elements(monthly) loop
 actual:=actual+atlas_private.bonus_number(summary->metric_key->'actual','Closed actual',-1000000000000,1000000000000);
 target:=target+atlas_private.bonus_number(summary->metric_key->'activeBaseline','Effective baseline',-1000000000000,1000000000000);end loop;
 if target=0 then raise exception 'Zero baseline has no defined attainment for %; explicit plan policy required',metric_key;end if;
 variance:=actual-target;attainment:=100+(case when metric_key='expenses' then -1 else 1 end)*variance/abs(target)*100;
 ratio:=attainment/(metric->>'goal')::numeric*100;
 select coalesce(max((b->>'payoutPct')::numeric),0) into payout_pct from jsonb_array_elements(metric->'thresholdCurve')b where ratio>=(b->>'thresholdPct')::numeric;
 potential:=(config->>'targetBonus')::numeric*(metric->>'weight')::numeric/100;
 earned:=round(potential*payout_pct/100,2);total:=total+earned;
 results:=results||jsonb_build_array(jsonb_build_object('metric',metric,'actual',attainment,'rawActual',actual,'baseline',target,'variance',variance,'ratio',ratio,'payoutPct',payout_pct,'potential',potential,'earned',earned,'financialEvidence',evidence));
 end loop;
 total:=round(least(round(total,2),(config->>'maximumPayout')::numeric),2);
 period:=jsonb_build_object('periodKey',period_key,'start',starts,'end',ends);
 retained:=jsonb_build_object('employee',jsonb_build_object('employeeId',employee.employee_id,'name',employee.full_name,'assignmentId',assignment.assignment_id,'assignmentVersion',assignment.version,'employeeVersion',employee.version,'communityId',assignment.community_id,'roleId',assignment.role_id,'active',true,'bonusEligible',true,'effectiveStart',assignment.effective_start,'effectiveEnd',assignment.effective_end),'plan',config||jsonb_build_object('id',plan.incentive_plan_id,'version',plan.version),'period',period,'metricResults',results,'unresolvedCritical',false,'finalPayout',total,'proposedPayout',total,'maximumPotential',config->'maximumPayout','calculationVersion','atlas-bonus-financial-v1');
 line:=jsonb_build_object('employee_id',employee.employee_id,'assignment_id',assignment.assignment_id,'incentive_plan_id',plan.incentive_plan_id,'metric_key','total','metric_source_table','atlas_command_financial_summaries','payout_amount',total,'retainedRow',retained);
 if not atlas_private.reforecast_bonus_eligibility_current(jsonb_build_object('employee_id',employee.employee_id,'assignment_id',assignment.assignment_id,'incentive_plan_id',plan.incentive_plan_id,'line_payload',line),jsonb_build_object('start_date',starts,'end_date',ends)) or not atlas_private.reforecast_bonus_finance_current(line,assignment.community_id,jsonb_build_object('start_date',starts,'end_date',ends)) then raise exception 'Canonical calculation proof could not be verified';end if;
 return jsonb_build_object('calculationVersion','atlas-bonus-financial-v1','period',period,'communityId',assignment.community_id,'totalPayout',total,'lines',jsonb_build_array(line),'exceptions','[]'::jsonb);
end;$$;
create function atlas_private.bonus_request(id uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior atlas_private.bonus_workflow_requests;
begin
 if id is null or auth.uid() is null then raise exception 'Authenticated request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(id::text,731));
 select * into prior from atlas_private.bonus_workflow_requests where request_id=id;
 if prior.request_id is not null then
 if prior.actor_id<>auth.uid() or prior.request_hash<>encode(sha256(convert_to(body::text,'UTF8')),'hex') then raise exception 'Request ID already belongs to a different operation';end if;
 if body->>'op'='run' and not atlas_private.bonus_access((prior.result->>'communityId')::uuid) then raise exception 'Cached Bonus result is outside current community access';end if;
 if body->>'op'='plan' and exists(select 1 from jsonb_array_elements_text(prior.result->'eligibilityRules'->'communityIds')cid where not atlas_private.bonus_access(cid::uuid,'edit_bonus_plans')) then raise exception 'Cached plan is outside current community access';end if;
 if body->>'op'='eligibility' and (not exists(select 1 from public.atlas_employee_assignments a where a.employee_id=(prior.result->>'employeeId')::uuid and a.deleted_at is null) or exists(select 1 from public.atlas_employee_assignments a where a.employee_id=(prior.result->>'employeeId')::uuid and a.deleted_at is null and not atlas_private.bonus_access(a.community_id,'edit_bonus_plans'))) then raise exception 'Cached employee eligibility is outside current community access';end if;
 return prior.result;end if;return null;
end;$$;
create function atlas_private.bonus_finish(id uuid,body jsonb,result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin insert into atlas_private.bonus_workflow_requests values(id,auth.uid(),encode(sha256(convert_to(body::text,'UTF8')),'hex'),result,now());return result;end;$$;
create function atlas_private.bonus_reason(payload jsonb) returns void language plpgsql immutable set search_path='' as $$
begin if jsonb_typeof(payload) is distinct from 'object' or length(trim(coalesce(payload->>'reason',''))) not between 3 and 2000 then raise exception 'A review reason of 3 to 2000 characters is required';end if;end;$$;
create function atlas_private.bonus_number(value jsonb,label text,minimum numeric default 0,maximum numeric default 100000000) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if jsonb_typeof(value) is distinct from 'number' then raise exception '% must be an explicit finite number',label;end if;
 n:=value::text::numeric;if n::text in ('NaN','Infinity','-Infinity') or n<minimum or n>maximum then raise exception '% is outside the supported range',label;end if;return n;
end;$$;

create function atlas_private.bonus_validate_plan(payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare metric jsonb;band jsonb;rules jsonb;cid text;key text;weight numeric:=0;metrics jsonb:='[]';bands jsonb;previous_threshold numeric;previous_payout numeric;n numeric;p numeric;starts date;ends date;selected_role uuid;
begin
 perform atlas_private.bonus_reason(payload);
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 160 then raise exception 'Plan name required';end if;
 starts:=(payload->>'effectiveStart')::date;ends:=nullif(payload->>'effectiveEnd','')::date;selected_role:=nullif(payload->>'roleId','')::uuid;
 if starts is null or (ends is not null and ends<starts) or selected_role is null or not exists(select 1 from public.atlas_roles r where r.role_id=selected_role and r.active) then raise exception 'Valid effective dates and an active canonical role are required';end if;
 perform atlas_private.bonus_number(payload->'targetBonus','Quarterly target');perform atlas_private.bonus_number(payload->'maximumPayout','Maximum payout');
 if (payload->>'targetBonus')::numeric<>round((payload->>'targetBonus')::numeric,2) or (payload->>'maximumPayout')::numeric<>round((payload->>'maximumPayout')::numeric,2) then raise exception 'Currency targets and caps must use whole cents';end if;
 if coalesce(payload->>'payoutCadence','Quarterly')<>'Quarterly' or coalesce((payload->>'targetBonusPercent')::numeric,0)<>0 then raise exception 'Only full-quarter fixed-target financial scorecards are currently supported';end if;
 rules:=payload->'eligibilityRules';
 if jsonb_typeof(rules) is distinct from 'object' or rules->>'requireBonusEligible' is distinct from 'true' or jsonb_typeof(rules->'communityIds') is distinct from 'array' or jsonb_array_length(rules->'communityIds') not between 1 and 100 then raise exception 'Explicit eligibility and at least one canonical community are required';end if;
 for key in select jsonb_object_keys(rules) loop if key not in ('requireBonusEligible','communityIds') then raise exception 'Unsupported eligibility rule: %',key;end if;end loop;
 for cid in select jsonb_array_elements_text(rules->'communityIds') loop
 if not atlas_private.bonus_access(cid::uuid,'edit_bonus_plans') or not exists(select 1 from public.atlas_communities c where c.community_id=cid::uuid and c.deleted_at is null) then raise exception 'Plan community setup access denied';end if;end loop;
 if jsonb_typeof(payload->'metrics') is distinct from 'array' or jsonb_array_length(payload->'metrics') not between 1 and 10 then raise exception 'One to ten financial metrics are required';end if;
 for metric in select value from jsonb_array_elements(payload->'metrics') loop
 if coalesce(metric->>'id','')='' or metric->>'metricKey' not in ('revenue','expenses','noi','cash_flow','budget_attainment') or metric->>'metricKey' is null then raise exception 'Unsupported metric; canonical quarterly financial metrics only';end if;
 if coalesce(metric->>'payoutStructure','weighted_scorecard')<>'weighted_scorecard' or coalesce(metric->>'scope','property')<>'property' or coalesce(metric->>'cadence','Quarterly')<>'Quarterly' or coalesce(metric->>'inputType','automatic')<>'automatic' then raise exception 'Unsupported payout structure, scope, cadence or source';end if;
 weight:=weight+atlas_private.bonus_number(metric->'weight','Metric weight',0,100);perform atlas_private.bonus_number(metric->'goal','Attainment goal',0.000001,10000);
 if jsonb_typeof(metric->'thresholdCurve') is distinct from 'array' or jsonb_array_length(metric->'thresholdCurve') not between 1 and 30 then raise exception 'Explicit threshold curve required';end if;
 bands:='[]';previous_threshold:=null;previous_payout:=null;
 for band in select value from jsonb_array_elements(metric->'thresholdCurve') order by (value->>'thresholdPct')::numeric loop
 n:=atlas_private.bonus_number(band->'thresholdPct','Threshold',0,10000);p:=atlas_private.bonus_number(band->'payoutPct','Payout percent',0,100);
 if n=previous_threshold or p<previous_payout then raise exception 'Thresholds must be distinct and payout must not decrease';end if;
 bands:=bands||jsonb_build_array(jsonb_build_object('thresholdPct',n,'payoutPct',p));previous_threshold:=n;previous_payout:=p;end loop;
 metric:=jsonb_build_object('id',metric->>'id','name',coalesce(metric->>'name',metric->>'metricKey'),'metricKey',metric->>'metricKey','weight',metric->'weight','goal',metric->'goal','thresholdCurve',bands,'payoutStructure','weighted_scorecard','scope','property','cadence','Quarterly','inputType','automatic','favorable',case when metric->>'metricKey' in ('expenses','budget_attainment') then 'lower' else 'higher' end);
 metrics:=metrics||jsonb_build_array(metric);end loop;
 if weight<>100 or exists(select 1 from jsonb_array_elements(metrics)m group by m->>'id' having count(*)<>1) then raise exception 'Unique metric IDs and weights totaling 100 are required';end if;
 return jsonb_build_object('name',trim(payload->>'name'),'roleId',selected_role,'effectiveStart',starts,'effectiveEnd',ends,'targetBonus',payload->'targetBonus','maximumPayout',payload->'maximumPayout','payoutCadence','Quarterly','targetBonusPercent',0,'status','active','eligibilityRules',rules,'metrics',metrics,'reason',trim(payload->>'reason'));
end;$$;

create function public.atlas_bonus_plan_save(p_plan_id uuid,p_expected_version integer,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare body jsonb:=jsonb_build_object('op','plan','id',p_plan_id,'expected',p_expected_version,'payload',p_payload);cached jsonb;normalized jsonb;plan public.atlas_incentive_plans;next_version integer;cid text;
begin
 if not atlas_private.bonus_access(null,'edit_bonus_plans') then raise exception 'Bonus plan setup access denied';end if;
 cached:=atlas_private.bonus_request(p_request_id,body);if cached is not null then return cached;end if;
 normalized:=atlas_private.bonus_validate_plan(p_payload);
 if p_plan_id is not null then
 select * into plan from public.atlas_incentive_plans where incentive_plan_id=p_plan_id and deleted_at is null for update;
 if plan.incentive_plan_id is null or plan.version is distinct from p_expected_version then raise exception 'Plan version changed; reload before saving';end if;
 if jsonb_typeof(plan.eligibility_rules->'communityIds') is distinct from 'array' then raise exception 'Legacy plan requires reviewed canonical scope before migration';end if;
 for cid in select jsonb_array_elements_text(plan.eligibility_rules->'communityIds') loop if not atlas_private.bonus_access(cid::uuid,'edit_bonus_plans') then raise exception 'Existing plan scope denied';end if;end loop;
 next_version:=plan.version+1;
 update public.atlas_incentive_plans set plan_name=normalized->>'name',role_id=(normalized->>'roleId')::uuid,effective_start=(normalized->>'effectiveStart')::date,effective_end=(normalized->>'effectiveEnd')::date,eligibility_rules=normalized->'eligibilityRules',metric_rules=normalized->'metrics',workflow_config=normalized,version=version+1,updated_at=now(),source_hash=encode(sha256(convert_to(normalized::text,'UTF8')),'hex') where incentive_plan_id=p_plan_id;
 else
 if p_expected_version is distinct from 0 then raise exception 'New plan expected version must be zero';end if;
 next_version:=1;p_plan_id:=gen_random_uuid();
 insert into public.atlas_incentive_plans(incentive_plan_id,plan_name,role_id,effective_start,effective_end,eligibility_rules,metric_rules,workflow_config,source_hash) values(p_plan_id,normalized->>'name',(normalized->>'roleId')::uuid,(normalized->>'effectiveStart')::date,(normalized->>'effectiveEnd')::date,normalized->'eligibilityRules',normalized->'metrics',normalized,encode(sha256(convert_to(normalized::text,'UTF8')),'hex'));
 end if;
 normalized:=normalized||jsonb_build_object('id',p_plan_id,'version',next_version);
 insert into atlas_private.bonus_plan_versions values(p_plan_id,next_version,normalized,auth.uid(),now());
 insert into atlas_private.bonus_workflow_events(entity_id,action,revision,actor_id,detail) values(p_plan_id,'plan_saved',next_version,auth.uid(),normalized);
 return atlas_private.bonus_finish(p_request_id,body,normalized);
end;$$;

create function atlas_private.bonus_eligibility_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and (new.bonus_eligible or new.bonus_effective_date is not null)) or (tg_op='UPDATE' and (new.bonus_eligible,new.bonus_effective_date) is distinct from (old.bonus_eligible,old.bonus_effective_date)) then
 if not exists(select 1 from atlas_private.bonus_eligibility_write where transaction_id=pg_current_xact_id() and employee_id=new.employee_id) then raise exception 'Bonus eligibility must be explicitly saved through the governed setup workflow';end if;end if;
 return new;end;$$;
create trigger bonus_eligibility_governed before insert or update on public.atlas_employees for each row execute function atlas_private.bonus_eligibility_guard();
create function public.atlas_bonus_eligibility_save(p_employee_id uuid,p_expected_version integer,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare body jsonb:=jsonb_build_object('op','eligibility','id',p_employee_id,'expected',p_expected_version,'payload',p_payload);cached jsonb;employee public.atlas_employees;result jsonb;
begin
 if not atlas_private.bonus_access(null,'edit_bonus_plans') or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and role in ('admin','centra','people')) then raise exception 'People eligibility setup access denied';end if;
 cached:=atlas_private.bonus_request(p_request_id,body);if cached is not null then return cached;end if;perform atlas_private.bonus_reason(p_payload);
 if jsonb_typeof(p_payload->'bonusEligible') is distinct from 'boolean' or ((p_payload->>'bonusEligible')::boolean and nullif(p_payload->>'bonusEffectiveDate','') is null) then raise exception 'Explicit eligibility and effective date required';end if;
 select * into employee from public.atlas_employees where employee_id=p_employee_id and deleted_at is null for update;
 if employee.employee_id is null or employee.version is distinct from p_expected_version then raise exception 'Employee version changed; reload before saving';end if;
 if not exists(select 1 from public.atlas_employee_assignments a where a.employee_id=p_employee_id and a.deleted_at is null) or exists(select 1 from public.atlas_employee_assignments a where a.employee_id=p_employee_id and a.deleted_at is null and not atlas_private.bonus_access(a.community_id,'edit_bonus_plans')) then raise exception 'All employee assignment communities must be in scope';end if;
 insert into atlas_private.bonus_eligibility_write values(pg_current_xact_id(),p_employee_id);
 update public.atlas_employees set bonus_eligible=(p_payload->>'bonusEligible')::boolean,bonus_effective_date=nullif(p_payload->>'bonusEffectiveDate','')::date,version=version+1,updated_at=now() where employee_id=p_employee_id returning jsonb_build_object('employeeId',employee_id,'employeeVersion',version,'bonusEligible',bonus_eligible,'bonusEffectiveDate',bonus_effective_date) into result;
 delete from atlas_private.bonus_eligibility_write where transaction_id=pg_current_xact_id() and employee_id=p_employee_id;
 insert into atlas_private.bonus_workflow_events(entity_id,action,revision,actor_id,detail) values(p_employee_id,'eligibility_saved',(result->>'employeeVersion')::int,auth.uid(),result||jsonb_build_object('reason',p_payload->>'reason','previousEligible',employee.bonus_eligible,'previousEffectiveDate',employee.bonus_effective_date));
 return atlas_private.bonus_finish(p_request_id,body,result);
end;$$;

create function atlas_private.bonus_run_result(id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h atlas_private.bonus_workflow_heads;r public.atlas_bonus_calculation_runs;payment jsonb;events jsonb;
begin
 select * into h from atlas_private.bonus_workflow_heads where run_id=id;
 if h.run_id is null or not atlas_private.bonus_access(h.community_id) then raise exception 'Bonus run read access denied';end if;
 select * into r from public.atlas_bonus_calculation_runs where bonus_calculation_run_id=id;
 select jsonb_build_object('externalReference',p.reference,'paidDate',p.paid_date,'amount',p.amount,'recordedBy',p.actor_id,'recordedAt',p.recorded_at,'reason',p.reason) into payment from atlas_private.bonus_external_payments p where p.run_id=id;
 select coalesce(jsonb_agg(jsonb_build_object('id',event_id,'action',action,'revision',revision,'actorId',actor_id,'at',created_at,'reason',detail->>'reason') order by created_at,event_id),'[]') into events from atlas_private.bonus_workflow_events where run_id=id;
 return jsonb_build_object('runId',id,'revision',h.revision,'status',h.status,'communityId',h.community_id,'period',r.inputs->'period','employeeId',r.inputs->'lines'->0->'employee_id','assignmentId',h.assignment_id,'planId',h.plan_id,'totalPayout',r.total_payout,'calculation',r.inputs->'lines'->0->'retainedRow','events',events,'payment',payment,'createdBy',h.created_by,'calculatedBy',r.calculated_by,'approvedBy',r.approved_by,'approvedAt',r.approved_at,'calculationHash',r.calculation_hash);
end;$$;

-- Brief read locks keep source changes from racing an approval/lock transaction.
create function atlas_private.bonus_source_lock() returns void language plpgsql security definer set search_path='' as $$
declare name text;
begin
 foreach name in array array['atlas_financial_close_heads','atlas_command_financial_summaries','atlas_approved_budget_versions','atlas_reforecast_active_heads','atlas_reforecast_events','atlas_reforecast_source_reviews','atlas_reforecast_registry_heads','atlas_utility_forecast_activations','atlas_contracts','atlas_financial_coverage_heads','atlas_financial_coverage_policies'] loop
 if to_regclass('public.'||name) is not null then execute format('lock table public.%I in share mode',name);end if;end loop;
end;$$;

create function public.atlas_bonus_workflow(p_run_id uuid,p_action text,p_expected_revision integer,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare body jsonb:=jsonb_build_object('op','run','id',p_run_id,'action',p_action,'expected',p_expected_revision,'payload',p_payload);cached jsonb;h atlas_private.bonus_workflow_heads;r public.atlas_bonus_calculation_runs;assignment public.atlas_employee_assignments;period public.atlas_bonus_periods;calculation jsonb;line jsonb;hash text;required_permission text;result jsonb;reference text;paid_date date;amount numeric;event_detail jsonb;key text;
begin
 if p_action not in ('draft','recalculate','submit','approve','lock','void','record_external_payment') or p_action is null then raise exception 'Unsupported Bonus workflow action';end if;
 required_permission:=case when p_action='approve' then 'approve_bonuses' when p_action in ('lock','record_external_payment') then 'finalize_period' else 'run_calculations' end;
 if not atlas_private.bonus_access(null,required_permission) then raise exception 'Bonus workflow action access denied';end if;
 cached:=atlas_private.bonus_request(p_request_id,body);if cached is not null then return cached;end if;perform atlas_private.bonus_reason(p_payload);
 for key in select jsonb_object_keys(p_payload) loop
 if not (key=any(case when p_action='draft' then array['reason','assignmentId','planId','periodKey'] when p_action='record_external_payment' then array['reason','externalReference','paidDate','amount'] else array['reason'] end)) then raise exception 'Unsupported workflow field %; browser payout and override claims are not accepted',key;end if;end loop;
 if p_action in ('draft','recalculate','submit','approve','lock') then perform atlas_private.bonus_source_lock();end if;
 if p_action='draft' then
 if p_run_id is not null or p_expected_revision is distinct from 0 then raise exception 'A new calculation requires no run ID and expected revision zero';end if;
 select * into assignment from public.atlas_employee_assignments where assignment_id=(p_payload->>'assignmentId')::uuid and deleted_at is null for share;
 if assignment.assignment_id is null or not atlas_private.bonus_access(assignment.community_id,required_permission) then raise exception 'Calculation assignment access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(assignment.employee_id::text||coalesce(p_payload->>'periodKey',''),732));
 if exists(select 1 from atlas_private.bonus_workflow_subjects s where s.employee_id=assignment.employee_id and s.period_key=p_payload->>'periodKey') then raise exception 'An active calculation already exists for this assignment and quarter; reload or recalculate it';end if;
 calculation:=atlas_private.bonus_calculate(assignment.assignment_id,(p_payload->>'planId')::uuid,p_payload->>'periodKey');
 insert into public.atlas_bonus_periods(period_key,year,quarter,start_date,end_date,status) values(p_payload->>'periodKey',left(p_payload->>'periodKey',4)::int,right(p_payload->>'periodKey',2),(calculation->'period'->>'start')::date,(calculation->'period'->>'end')::date,'open') on conflict(period_key) do nothing;
 select * into period from public.atlas_bonus_periods where period_key=p_payload->>'periodKey' for update;
 if period.status<>'open' or period.start_date is distinct from (calculation->'period'->>'start')::date or period.end_date is distinct from (calculation->'period'->>'end')::date then raise exception 'The canonical period is retained or has conflicting dates';end if;
 p_run_id:=gen_random_uuid();hash:=encode(sha256(convert_to(calculation::text,'UTF8')),'hex');
 insert into public.atlas_bonus_calculation_runs(bonus_calculation_run_id,bonus_period_id,community_id,status,calculation_hash,calculated_by,total_payout,inputs,exceptions) values(p_run_id,period.bonus_period_id,assignment.community_id,'draft',hash,auth.uid(),(calculation->>'totalPayout')::numeric,calculation,'[]');
 insert into atlas_private.bonus_workflow_heads values(p_run_id,1,'draft',assignment.assignment_id,(p_payload->>'planId')::uuid,assignment.community_id,p_payload->>'periodKey',auth.uid(),now());
 insert into atlas_private.bonus_workflow_subjects values(assignment.assignment_id,p_payload->>'periodKey',p_run_id,assignment.employee_id);
 else
 select * into h from atlas_private.bonus_workflow_heads where run_id=p_run_id for update;
 if h.run_id is null or not atlas_private.bonus_access(h.community_id,required_permission) then raise exception 'Scoped governed Bonus run required';end if;
 if h.revision is distinct from p_expected_revision then raise exception 'Calculation revision changed; reload before continuing';end if;
 select * into r from public.atlas_bonus_calculation_runs where bonus_calculation_run_id=p_run_id for update;
 select * into period from public.atlas_bonus_periods where bonus_period_id=r.bonus_period_id for update;
 if p_action in ('approve','lock','record_external_payment') and exists(select 1 from public.atlas_user_profiles p join public.atlas_employee_assignments a on a.assignment_id=h.assignment_id where p.user_id=auth.uid() and nullif(to_jsonb(p)->>'employee_id','')::uuid=a.employee_id) then raise exception 'A reviewer cannot approve, lock or record payment for their own Bonus';end if;
 if p_action='record_external_payment' then
 if h.status<>'locked' or r.status<>'locked' or r.approved_by is null or r.approved_at is null or not atlas_private.bonus_managed_receipt_valid(p_run_id) then raise exception 'An approved locked calculation with verified retained evidence is required before recording an external payment';end if;
 reference:=trim(coalesce(p_payload->>'externalReference',''));paid_date:=nullif(p_payload->>'paidDate','')::date;amount:=atlas_private.bonus_number(p_payload->'amount','External payment amount');
 if length(reference) not between 3 and 200 or paid_date is null or paid_date>current_date or paid_date<period.end_date or amount<>r.total_payout then raise exception 'Payment reference, date after quarter end, and exact approved amount are required';end if;
 insert into atlas_private.bonus_external_payments(run_id,reference,paid_date,amount,actor_id,reason) values(p_run_id,reference,paid_date,amount,auth.uid(),p_payload->>'reason');
 update atlas_private.bonus_workflow_heads set status='paid',revision=revision+1,updated_at=now() where run_id=p_run_id;
 elsif p_action='void' then
 if h.status not in ('draft','review','approved') or period.status<>'open' then raise exception 'Retained calculations cannot be voided or reopened';end if;
 update public.atlas_bonus_calculation_runs set status='voided' where bonus_calculation_run_id=p_run_id;
 update atlas_private.bonus_workflow_heads set status='voided',revision=revision+1,updated_at=now() where run_id=p_run_id;delete from atlas_private.bonus_workflow_subjects where run_id=p_run_id;
 else
 if h.status in ('locked','paid','voided') or period.status<>'open' then raise exception 'Retained calculations cannot be recalculated, changed or reopened';end if;
 if p_action='submit' and h.status<>'draft' or p_action='approve' and h.status<>'review' or p_action='lock' and h.status<>'approved' then raise exception 'Invalid Bonus workflow transition from % to %',h.status,p_action;end if;
 if p_action='approve' and r.calculated_by=auth.uid() then raise exception 'A different authorized reviewer must approve this calculation';end if;
 calculation:=atlas_private.bonus_calculate(h.assignment_id,h.plan_id,h.period_key);hash:=encode(sha256(convert_to(calculation::text,'UTF8')),'hex');
 if p_action<>'recalculate' and hash is distinct from r.calculation_hash then raise exception 'Canonical eligibility, plan or financial sources changed; recalculate and review before approval';end if;
 if p_action='recalculate' then
 delete from public.atlas_bonus_calculation_lines where bonus_calculation_run_id=p_run_id;
 update public.atlas_bonus_calculation_runs set status='draft',inputs=calculation,calculation_hash=hash,total_payout=(calculation->>'totalPayout')::numeric,calculated_by=auth.uid(),calculated_at=now(),approved_by=null,approved_at=null,exceptions='[]' where bonus_calculation_run_id=p_run_id;
 else
 update public.atlas_bonus_calculation_runs set status=case p_action when 'submit' then 'review' when 'approve' then 'approved' else 'locked' end,approved_by=case when p_action='approve' then auth.uid() else approved_by end,approved_at=case when p_action='approve' then now() else approved_at end where bonus_calculation_run_id=p_run_id;
 end if;
 update atlas_private.bonus_workflow_heads set status=case p_action when 'recalculate' then 'draft' when 'submit' then 'review' when 'approve' then 'approved' else 'locked' end,revision=revision+1,updated_at=now() where run_id=p_run_id;
 end if;end if;
 if p_action in ('draft','recalculate') then
 line:=calculation->'lines'->0;
 insert into public.atlas_bonus_calculation_lines(bonus_calculation_run_id,employee_id,assignment_id,incentive_plan_id,metric_key,metric_source_table,payout_amount,line_payload) values(p_run_id,(line->>'employee_id')::uuid,(line->>'assignment_id')::uuid,(line->>'incentive_plan_id')::uuid,'total','atlas_command_financial_summaries',(line->>'payout_amount')::numeric,line);
 end if;
 select revision into p_expected_revision from atlas_private.bonus_workflow_heads where run_id=p_run_id;
 event_detail:=jsonb_build_object('reason',p_payload->>'reason','calculationHash',coalesce(hash,r.calculation_hash));
 if p_action in ('draft','recalculate') then event_detail:=event_detail||jsonb_build_object('calculation',calculation);end if;
 if p_action='record_external_payment' then event_detail:=event_detail||jsonb_build_object('externalReference',reference,'paidDate',paid_date,'amount',amount);end if;
 insert into atlas_private.bonus_workflow_events(run_id,entity_id,action,revision,actor_id,detail) values(p_run_id,p_run_id,p_action,p_expected_revision,auth.uid(),event_detail);
 result:=atlas_private.bonus_run_result(p_run_id);return atlas_private.bonus_finish(p_request_id,body,result);
end;$$;

create function public.atlas_bonus_workspace(p_community_ids uuid[] default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare communities jsonb;roles jsonb;plans jsonb;employees jsonb;runs jsonb:='[]';h record;row jsonb;current_calculation jsonb;profile_role text;allowed uuid[];
begin
 if not atlas_private.bonus_access(null) then raise exception 'Bonus workspace access denied';end if;
 select role into profile_role from public.atlas_user_profiles where user_id=auth.uid();
 if cardinality(p_community_ids)>100 or exists(select 1 from unnest(p_community_ids)c where not atlas_private.bonus_access(c)) then raise exception 'Bonus community scope denied';end if;
 select array_agg(c.community_id),coalesce(jsonb_agg(jsonb_build_object('id',c.community_id,'name',coalesce(to_jsonb(c)->>'display_name',to_jsonb(c)->>'canonical_name',to_jsonb(c)->>'community_name',to_jsonb(c)->>'name',c.community_id::text)) order by c.community_id),'[]') into allowed,communities from public.atlas_communities c where c.deleted_at is null and atlas_private.bonus_access(c.community_id) and (p_community_ids is null or c.community_id=any(p_community_ids));
 select coalesce(jsonb_agg(jsonb_build_object('id',role_id,'title',title) order by title),'[]') into roles from public.atlas_roles where active;
 select coalesce(jsonb_agg(p.workflow_config||jsonb_build_object('id',p.incentive_plan_id,'version',p.version) order by p.plan_name),'[]') into plans from public.atlas_incentive_plans p where p.deleted_at is null and p.workflow_config is not null and exists(select 1 from jsonb_array_elements_text(p.eligibility_rules->'communityIds')c where c::uuid=any(allowed));
 select coalesce(jsonb_agg(jsonb_build_object('employeeId',e.employee_id,'name',e.full_name,'employeeVersion',e.version,'bonusEligible',e.bonus_eligible,'bonusEffectiveDate',e.bonus_effective_date,'assignmentId',a.assignment_id,'assignmentVersion',a.version,'communityId',a.community_id,'roleId',a.role_id,'effectiveStart',a.effective_start,'effectiveEnd',a.effective_end,'status',a.employment_status,'eligibilityEditable',profile_role in ('admin','centra','people') and atlas_private.bonus_access(a.community_id,'edit_bonus_plans') and not exists(select 1 from public.atlas_employee_assignments other where other.employee_id=e.employee_id and other.deleted_at is null and not atlas_private.bonus_access(other.community_id,'edit_bonus_plans'))) order by e.full_name,a.assignment_id),'[]') into employees from public.atlas_employee_assignments a join public.atlas_employees e using(employee_id) where a.deleted_at is null and e.deleted_at is null and a.community_id=any(allowed);
 for h in select bh.*,r.calculation_hash from atlas_private.bonus_workflow_heads bh join public.atlas_bonus_calculation_runs r on r.bonus_calculation_run_id=bh.run_id where bh.community_id=any(allowed) order by bh.updated_at desc limit 250 loop
 row:=atlas_private.bonus_run_result(h.run_id);
 if h.status in ('draft','review','approved') then
 begin
 current_calculation:=atlas_private.bonus_calculate(h.assignment_id,h.plan_id,h.period_key);
 row:=row||jsonb_build_object('stale',h.calculation_hash<>encode(sha256(convert_to(current_calculation::text,'UTF8')),'hex'),'reason',case when h.calculation_hash<>encode(sha256(convert_to(current_calculation::text,'UTF8')),'hex') then 'Canonical inputs changed; recalculate before proceeding' end);
 exception when others then row:=row||jsonb_build_object('stale',true,'reason',sqlerrm);end;
 end if;runs:=runs||jsonb_build_array(row);end loop;
 return jsonb_build_object('permissions',jsonb_build_object('read',true,'editPlans',atlas_private.bonus_access(null,'edit_bonus_plans'),'editEligibility',profile_role in ('admin','centra','people') and atlas_private.bonus_access(null,'edit_bonus_plans'),'calculate',atlas_private.bonus_access(null,'run_calculations'),'approve',atlas_private.bonus_access(null,'approve_bonuses'),'lock',atlas_private.bonus_access(null,'finalize_period'),'recordPayment',atlas_private.bonus_access(null,'finalize_period')),'communities',communities,'roles',roles,'plans',plans,'employees',employees,'runs',runs,'limitations',jsonb_build_array('Financial weighted scorecards with fixed quarterly targets and full-quarter eligibility only.','Missing, zero-baseline, unsupported and partial-quarter calculations remain unavailable.','Payment recording stores evidence of an external payment; ATLAS does not transfer funds.','Locked and paid calculations cannot be reopened; corrections require a separately authorized adjustment workflow.'));
end;$$;

-- Close legacy status injection and direct-write paths. Existing reads/history remain available.
revoke all on public.atlas_incentive_plans,public.atlas_bonus_periods,public.atlas_bonus_calculation_runs,public.atlas_bonus_calculation_lines from public,authenticated,anon;
do $$declare name text;columns text;begin
 foreach name in array array['atlas_incentive_plans','atlas_bonus_periods','atlas_bonus_calculation_runs','atlas_bonus_calculation_lines'] loop
 select string_agg(format('%I',attname),',') into columns from pg_attribute where attrelid=('public.'||name)::regclass and attnum>0 and not attisdropped;
 execute format('revoke select (%s), insert (%s), update (%s), references (%s) on public.%I from public,anon,authenticated',columns,columns,columns,columns,name);
 end loop;end;$$;
create or replace function public.atlas_record_bonus_calculation(p_period_key text,p_year integer,p_quarter text,p_start_date date,p_end_date date,p_payload jsonb,p_status text default 'draft') returns uuid language plpgsql security definer set search_path='' as $$
begin raise exception 'Use the governed Bonus workflow to calculate canonical sources; legacy caller-supplied payouts and statuses are disabled';end;$$;

-- Attach the immutable per-run external payment receipt without marking unrelated communities paid.
create function atlas_private.bonus_managed_receipt_valid(id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare h atlas_private.bonus_workflow_heads;r public.atlas_bonus_calculation_runs;l public.atlas_bonus_calculation_lines;input jsonb;period public.atlas_bonus_periods;
begin
 select * into h from atlas_private.bonus_workflow_heads where run_id=id;select * into r from public.atlas_bonus_calculation_runs where bonus_calculation_run_id=id and deleted_at is null;
 if h.run_id is null or r.bonus_calculation_run_id is null or h.status not in ('approved','locked','paid') or r.status is distinct from (case when h.status='approved' then 'approved' else 'locked' end) or r.approved_by is null or r.approved_at is null or jsonb_typeof(r.inputs->'lines') is distinct from 'array' or jsonb_array_length(r.inputs->'lines')<>1 or r.calculation_hash is distinct from encode(sha256(convert_to(r.inputs::text,'UTF8')),'hex') then return false;end if;
 select * into period from public.atlas_bonus_periods where bonus_period_id=r.bonus_period_id;
 if r.community_id is distinct from h.community_id or r.inputs->>'communityId' is distinct from h.community_id::text or period.period_key is distinct from h.period_key or r.inputs->'period'->>'periodKey' is distinct from period.period_key or r.inputs->'period'->>'start' is distinct from period.start_date::text or r.inputs->'period'->>'end' is distinct from period.end_date::text then return false;end if;
 if (select count(*) from public.atlas_bonus_calculation_lines where bonus_calculation_run_id=id and deleted_at is null)<>1 then return false;end if;
 select * into l from public.atlas_bonus_calculation_lines where bonus_calculation_run_id=id and deleted_at is null;input:=r.inputs->'lines'->0;
 if input->'retainedRow'->'period' is distinct from r.inputs->'period' or input->'retainedRow'->'employee'->>'communityId' is distinct from h.community_id::text or input->'retainedRow'->'employee'->>'employeeId' is distinct from l.employee_id::text or input->'retainedRow'->'employee'->>'assignmentId' is distinct from l.assignment_id::text or input->'retainedRow'->'plan'->>'id' is distinct from l.incentive_plan_id::text then return false;end if;
 if l.line_payload is distinct from input or l.assignment_id is distinct from h.assignment_id or l.incentive_plan_id is distinct from h.plan_id or l.employee_id::text is distinct from input->>'employee_id' or l.assignment_id::text is distinct from input->>'assignment_id' or l.incentive_plan_id::text is distinct from input->>'incentive_plan_id' or l.metric_key is distinct from input->>'metric_key' or l.metric_source_table is distinct from input->>'metric_source_table' or l.metric_source_id is not null or jsonb_typeof(input->'payout_amount') is distinct from 'number' or l.payout_amount is distinct from (input->>'payout_amount')::numeric or r.total_payout is distinct from l.payout_amount or l.payout_amount is distinct from (input->'retainedRow'->>'finalPayout')::numeric or r.total_payout is distinct from (r.inputs->>'totalPayout')::numeric then return false;end if;
 if not exists(select 1 from atlas_private.bonus_workflow_events e where e.run_id=id and action='approve' and actor_id=r.approved_by and detail->>'calculationHash'=r.calculation_hash) then return false;end if;
 if h.status in ('locked','paid') and not exists(select 1 from atlas_private.bonus_workflow_events e where e.run_id=id and action='lock' and detail->>'calculationHash'=r.calculation_hash) then return false;end if;
 if h.status='paid' and not exists(select 1 from atlas_private.bonus_external_payments p where p.run_id=id and p.amount=r.total_payout) then return false;end if;
 return true;
exception when others then return false;end;$$;
alter function public.atlas_read_bonus_receipts(text) rename to atlas_read_bonus_receipts_before_workflow;
alter function public.atlas_read_bonus_receipts_before_workflow(text) set schema atlas_private;
revoke all on function atlas_private.atlas_read_bonus_receipts_before_workflow(text) from public,anon,authenticated;
create function public.atlas_read_bonus_receipts(p_period_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare receipts jsonb;receipt jsonb;result jsonb:='[]';payment jsonb;profile_role text;receipt_run_id uuid;lines jsonb;
begin
 if not atlas_private.bonus_access(null) then raise exception 'Bonus receipt access denied';end if;
 select role into profile_role from public.atlas_user_profiles where user_id=auth.uid();
 if profile_role='people' then
 select coalesce(jsonb_agg(jsonb_build_object('period',to_jsonb(p),'run',to_jsonb(r)-'inputs'-'source_snapshot_id','lines',(select jsonb_agg(to_jsonb(l)) from public.atlas_bonus_calculation_lines l where l.bonus_calculation_run_id=r.bonus_calculation_run_id),'verified',h.status in ('locked','paid') or (atlas_private.reforecast_bonus_eligibility_current(jsonb_build_object('employee_id',r.inputs->'lines'->0->>'employee_id','assignment_id',h.assignment_id,'incentive_plan_id',h.plan_id,'line_payload',r.inputs->'lines'->0),to_jsonb(p)) and atlas_private.reforecast_bonus_finance_current(r.inputs->'lines'->0,h.community_id,to_jsonb(p))))),'[]') into receipts from atlas_private.bonus_workflow_heads h join public.atlas_bonus_calculation_runs r on r.bonus_calculation_run_id=h.run_id join public.atlas_bonus_periods p using(bonus_period_id) where h.period_key=p_period_key and h.status in ('approved','locked','paid') and atlas_private.bonus_access(h.community_id);
 else receipts:=atlas_private.atlas_read_bonus_receipts_before_workflow(p_period_key);end if;
 for receipt in select value from jsonb_array_elements(receipts) loop
 receipt_run_id:=(receipt->'run'->>'bonus_calculation_run_id')::uuid;
 if exists(select 1 from atlas_private.bonus_workflow_heads h where h.run_id=receipt_run_id) and not atlas_private.bonus_managed_receipt_valid(receipt_run_id) then receipt:=receipt||jsonb_build_object('verified',false,'reason','Managed Bonus receipt failed exact calculation and approval-event verification');end if;
 select coalesce(jsonb_agg(l||jsonb_build_object('line_payload',((l->'line_payload')-'secureCalculationDetail') #- '{retainedRow,employee,salary}' #- '{line_payload,secureCalculationDetail}' #- '{line_payload,retainedRow,employee,salary}')),'[]') into lines from jsonb_array_elements(coalesce(receipt->'lines','[]'))l;receipt:=jsonb_set(receipt,'{lines}',lines);
 select jsonb_build_object('externalReference',reference,'paidDate',paid_date,'amount',amount,'recordedBy',actor_id,'recordedAt',recorded_at) into payment from atlas_private.bonus_external_payments p where p.run_id=receipt_run_id;
 if payment is not null then receipt:=jsonb_set(receipt,'{period,status}','"paid"')||jsonb_build_object('externalPayment',payment);end if;
 result:=result||jsonb_build_array(receipt);end loop;return result;
end;$$;

revoke all on function atlas_private.bonus_access(uuid,text),atlas_private.bonus_request(uuid,jsonb),atlas_private.bonus_finish(uuid,jsonb,jsonb),atlas_private.bonus_reason(jsonb),atlas_private.bonus_number(jsonb,text,numeric,numeric),atlas_private.bonus_validate_plan(jsonb),atlas_private.bonus_calculate(uuid,uuid,text),atlas_private.bonus_eligibility_guard(),atlas_private.bonus_run_result(uuid),atlas_private.bonus_source_lock(),atlas_private.bonus_managed_receipt_valid(uuid) from public,anon,authenticated;
revoke all on function public.atlas_bonus_workspace(uuid[]),public.atlas_bonus_plan_save(uuid,integer,jsonb,uuid),public.atlas_bonus_eligibility_save(uuid,integer,jsonb,uuid),public.atlas_bonus_workflow(uuid,text,integer,jsonb,uuid),public.atlas_read_bonus_receipts(text),public.atlas_record_bonus_calculation(text,integer,text,date,date,jsonb,text) from public,anon;
grant execute on function public.atlas_bonus_workspace(uuid[]),public.atlas_bonus_plan_save(uuid,integer,jsonb,uuid),public.atlas_bonus_eligibility_save(uuid,integer,jsonb,uuid),public.atlas_bonus_workflow(uuid,text,integer,jsonb,uuid),public.atlas_read_bonus_receipts(text) to authenticated;
commit;
