create or replace function atlas_upsert_marketing_metrics(
  p_metrics jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_metric jsonb;
  v_community_id uuid;
  v_result jsonb := jsonb_build_object('metrics', 0, 'exceptions', 0, 'dryRun', p_dry_run);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to promote Marketing metrics.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','marketing') then
    raise exception 'Atlas Marketing metric promotion denied for role %', v_role using errcode = '42501';
  end if;

  if jsonb_typeof(p_metrics) <> 'array' then
    raise exception 'Marketing metrics payload must be an array.' using errcode = '22023';
  end if;

  for v_metric in select * from jsonb_array_elements(p_metrics) loop
    v_community_id := atlas_lookup_or_create_community(coalesce(v_metric ->> 'communityName', v_metric ->> 'propertyName'), 'marketing', false);
    if v_community_id is null or nullif(v_metric ->> 'sourceIdentifier', '') is null or nullif(v_metric ->> 'metricKey', '') is null or nullif(v_metric ->> 'periodKey', '') is null then
      insert into atlas_mapping_log(source_module, source_entity, source_identifier, source_name, decision, reason, source_payload)
      values ('marketing', 'marketing_metric', coalesce(v_metric ->> 'sourceIdentifier', 'missing'), coalesce(v_metric ->> 'communityName', v_metric ->> 'propertyName'), 'manual_review', 'Missing community, source identifier, metric key, or period key', v_metric);
      v_result := jsonb_set(v_result, '{exceptions}', to_jsonb((v_result ->> 'exceptions')::integer + 1));
      continue;
    end if;

    if not p_dry_run then
      insert into atlas_marketing_metrics(community_id, period_key, metric_key, metric_value, grain, approved, approved_by, approved_at, source_module, source_table, source_identifier, source_hash)
      values (
        v_community_id,
        v_metric ->> 'periodKey',
        v_metric ->> 'metricKey',
        coalesce(nullif(v_metric ->> 'metricValue', '')::numeric, 0),
        coalesce(nullif(v_metric ->> 'grain', ''), 'month'),
        coalesce(nullif(v_metric ->> 'approved', '')::boolean, false),
        case when coalesce(nullif(v_metric ->> 'approved', '')::boolean, false) then auth.uid() else null end,
        case when coalesce(nullif(v_metric ->> 'approved', '')::boolean, false) then now() else null end,
        'marketing',
        v_metric ->> 'sourceTable',
        v_metric ->> 'sourceIdentifier',
        atlas_hash_payload(v_metric)
      )
      on conflict (community_id, period_key, metric_key, grain, source_identifier) do update
        set metric_value = excluded.metric_value,
            approved = excluded.approved,
            approved_by = excluded.approved_by,
            approved_at = excluded.approved_at,
            source_hash = excluded.source_hash,
            version = atlas_marketing_metrics.version + 1,
            updated_at = now();
    end if;

    v_result := jsonb_set(v_result, '{metrics}', to_jsonb((v_result ->> 'metrics')::integer + 1));
  end loop;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (auth.uid(), case when p_dry_run then 'marketing_metrics_dry_run' else 'marketing_metrics_apply' end, 'atlas_marketing_metrics', 'batch', 'marketing', null, p_metrics, v_result);

  return v_result;
end;
$$;

create or replace function atlas_upsert_maintenance_inspections(
  p_records jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_record jsonb;
  v_community_id uuid;
  v_sync_run_id uuid;
  v_inspection_id uuid;
  v_result jsonb := jsonb_build_object('inspections', 0, 'exceptions', 0, 'dryRun', p_dry_run);
  v_type text;
  v_source_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to promote Maintenance inspections.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','maintenance') then
    raise exception 'Atlas Maintenance inspection promotion denied for role %', v_role using errcode = '42501';
  end if;

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Maintenance inspection payload must be an array.' using errcode = '22023';
  end if;

  if not p_dry_run then
    insert into atlas_moonrise_sync_runs(source_method, status, started_by, completed_at, reporting_periods, notes)
    values ('secure_export', 'synced', auth.uid(), now(), '{}', 'Atlas controlled Moonrise MSOE/SOE import.')
    returning moonrise_sync_run_id into v_sync_run_id;
  end if;

  for v_record in select * from jsonb_array_elements(p_records) loop
    v_type := upper(coalesce(v_record ->> 'inspectionType', v_record ->> 'inspection_type', ''));
    v_source_key := nullif(coalesce(v_record ->> 'sourceKey', v_record ->> 'source_key', v_record ->> 'sourceRecordId'), '');
    v_community_id := atlas_lookup_or_create_community(coalesce(v_record ->> 'property', v_record ->> 'communityName', v_record ->> 'sourcePropertyName'), 'maintenance', false);

    if v_community_id is null or v_source_key is null or v_type not in ('MSOE','SOE') or nullif(v_record ->> 'reportingMonth', '') is null then
      insert into atlas_mapping_log(source_module, source_entity, source_identifier, source_name, decision, reason, source_payload)
      values ('maintenance', 'moonrise_inspection', coalesce(v_source_key, 'missing'), coalesce(v_record ->> 'property', v_record ->> 'sourcePropertyName'), 'manual_review', 'Missing matched community, source key, inspection type, or reporting month', v_record);
      v_result := jsonb_set(v_result, '{exceptions}', to_jsonb((v_result ->> 'exceptions')::integer + 1));
      continue;
    end if;

    if not p_dry_run then
      insert into atlas_maintenance_inspections(
        moonrise_sync_run_id,
        community_id,
        source_system,
        source_record_id,
        source_key,
        source_property_name,
        source_property_identifier,
        inspection_type,
        inspection_date,
        reporting_month,
        status,
        findings,
        due_date,
        approval_status,
        signoff_status,
        approved_for_reporting,
        completion_pct,
        created_count,
        approved_count,
        under_review_count,
        in_progress_count,
        not_started_count,
        past_due_count,
        source_payload,
        source_hash
      )
      values (
        v_sync_run_id,
        v_community_id,
        'moonrise',
        v_record ->> 'sourceRecordId',
        v_source_key,
        v_record ->> 'sourcePropertyName',
        v_record ->> 'sourcePropertyId',
        v_type,
        nullif(v_record ->> 'inspectionDate', '')::date,
        nullif(v_record ->> 'reportingMonth', '')::date,
        v_record ->> 'status',
        v_record ->> 'findings',
        nullif(v_record ->> 'dueDate', '')::date,
        v_record ->> 'approvalStatus',
        v_record ->> 'signOffStatus',
        coalesce(nullif(v_record ->> 'approvedForReporting', '')::boolean, false),
        nullif(v_record ->> 'completionPct', '')::numeric,
        nullif(v_record ->> 'createdCount', '')::integer,
        nullif(v_record ->> 'approvedCount', '')::integer,
        nullif(v_record ->> 'reviewCount', '')::integer,
        nullif(v_record ->> 'progressCount', '')::integer,
        nullif(v_record ->> 'notStartedCount', '')::integer,
        nullif(v_record ->> 'pastDueCount', '')::integer,
        v_record,
        atlas_hash_payload(v_record)
      )
      on conflict (source_system, source_key) do update
        set community_id = excluded.community_id,
            source_record_id = excluded.source_record_id,
            source_property_name = excluded.source_property_name,
            source_property_identifier = excluded.source_property_identifier,
            inspection_type = excluded.inspection_type,
            inspection_date = excluded.inspection_date,
            reporting_month = excluded.reporting_month,
            status = excluded.status,
            findings = excluded.findings,
            due_date = excluded.due_date,
            approval_status = excluded.approval_status,
            signoff_status = excluded.signoff_status,
            approved_for_reporting = excluded.approved_for_reporting,
            completion_pct = excluded.completion_pct,
            created_count = excluded.created_count,
            approved_count = excluded.approved_count,
            under_review_count = excluded.under_review_count,
            in_progress_count = excluded.in_progress_count,
            not_started_count = excluded.not_started_count,
            past_due_count = excluded.past_due_count,
            source_payload = excluded.source_payload,
            source_hash = excluded.source_hash,
            last_synced_at = now(),
            version = atlas_maintenance_inspections.version + 1
      returning maintenance_inspection_id into v_inspection_id;

      if jsonb_typeof(v_record -> 'exceptions') = 'array' and jsonb_array_length(v_record -> 'exceptions') > 0 then
        insert into atlas_maintenance_inspection_exceptions(moonrise_sync_run_id, maintenance_inspection_id, exception_code, exception_message, source_payload)
        select v_sync_run_id, v_inspection_id, coalesce(e ->> 'code', 'review'), coalesce(e ->> 'message', 'Moonrise record requires review.'), e
        from jsonb_array_elements(v_record -> 'exceptions') e;
      end if;
    end if;

    v_result := jsonb_set(v_result, '{inspections}', to_jsonb((v_result ->> 'inspections')::integer + 1));
  end loop;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (auth.uid(), case when p_dry_run then 'maintenance_inspections_dry_run' else 'maintenance_inspections_apply' end, 'atlas_maintenance_inspections', coalesce(v_sync_run_id::text, 'dry_run'), 'maintenance', null, p_records, v_result);

  return v_result;
end;
$$;

create or replace function atlas_record_bonus_calculation(
  p_period_key text,
  p_year integer,
  p_quarter text,
  p_start_date date,
  p_end_date date,
  p_payload jsonb,
  p_status text default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_period_id uuid;
  v_run_id uuid;
  v_line jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to record Bonus calculations.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','bonus','finance') then
    raise exception 'Atlas Bonus calculation write denied for role %', v_role using errcode = '42501';
  end if;

  insert into atlas_bonus_periods(period_key, year, quarter, start_date, end_date, status)
  values (p_period_key, p_year, p_quarter, p_start_date, p_end_date, 'open')
  on conflict (period_key) do update
    set year = excluded.year,
        quarter = excluded.quarter,
        start_date = excluded.start_date,
        end_date = excluded.end_date
  returning bonus_period_id into v_period_id;

  insert into atlas_bonus_calculation_runs(bonus_period_id, status, calculation_hash, source_snapshot_id, calculated_by, total_payout, inputs, exceptions)
  values (
    v_period_id,
    coalesce(nullif(p_status, ''), 'draft'),
    atlas_hash_payload(p_payload),
    nullif(p_payload ->> 'sourceSnapshotId', '')::uuid,
    auth.uid(),
    coalesce(nullif(p_payload ->> 'totalPayout', '')::numeric, 0),
    p_payload,
    coalesce(p_payload -> 'exceptions', '[]'::jsonb)
  )
  returning bonus_calculation_run_id into v_run_id;

  if jsonb_typeof(p_payload -> 'lines') = 'array' then
    for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
      insert into atlas_bonus_calculation_lines(bonus_calculation_run_id, employee_id, assignment_id, incentive_plan_id, metric_key, metric_source_table, metric_source_id, payout_amount, line_payload)
      values (
        v_run_id,
        nullif(v_line ->> 'employee_id', '')::uuid,
        nullif(v_line ->> 'assignment_id', '')::uuid,
        nullif(v_line ->> 'incentive_plan_id', '')::uuid,
        v_line ->> 'metric_key',
        v_line ->> 'metric_source_table',
        nullif(v_line ->> 'metric_source_id', '')::uuid,
        coalesce(nullif(v_line ->> 'payout_amount', '')::numeric, 0),
        v_line
      );
    end loop;
  end if;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (auth.uid(), 'bonus_calculation_recorded', 'atlas_bonus_calculation_runs', v_run_id::text, 'bonus', null, p_payload, jsonb_build_object('period_key', p_period_key));

  return v_run_id;
end;
$$;
