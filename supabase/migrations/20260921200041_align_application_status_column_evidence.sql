create or replace function atlas_private.canonical_application(r jsonb,meta jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare effective timestamptz; started timestamptz; completed timestamptz; signed timestamptz; approved timestamptz; denied timestamptz; cancelled timestamptz; decided timestamptz; status text; observed text; reason text; events integer;
begin
 effective:=atlas_private.application_timestamp(meta->>'sourceAsOf');
 started:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationStartedOn}',''),nullif(r->>'applicationStartedOn',''),r->>'applicationStartedAt'));
 completed:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationCompletedOn}',''),nullif(r->>'applicationCompletedOn',''),r->>'applicationCompletedAt'));
 approved:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationApprovedOn}',''),r->>'applicationApprovedOn'));
 denied:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationDeniedOn}',''),r->>'applicationDeniedOn'));
 cancelled:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationCancelledOn}',''),nullif(r->>'applicationCancelledOn',''),nullif(r#>>'{sourceTimestamps,applicationCompletedCancelledOn}',''),nullif(r#>>'{sourceTimestamps,applicationApprovedCancelledOn}',''),nullif(r->>'applicationCompletedCancelledOn',''),r->>'applicationApprovedCancelledOn'));
 signed:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,leaseSignedOn}',''),nullif(r->>'leaseSignedOn',''),nullif(r#>>'{sourceTimestamps,leaseExecutedOn}',''),r->>'leaseExecutedOn'));
 if approved>effective or effective is null then approved:=null; end if;
 if denied>effective or effective is null then denied:=null; end if;
 if cancelled>effective or effective is null then cancelled:=null; end if;
 observed:=lower(trim(regexp_replace(coalesce(r->>'applicationStatus',''),'^Application:\s*','','i')));
 status:='unavailable'; reason:='non_application_status';
 if coalesce(r->>'applicationStatus','') ~* '^Application:' or (r#>>'{sourceColumns,applicationStatus}'='Application Status' and coalesce(r->>'applicationStatus','') !~* '^(lease|renewal offer|resident):') then
  reason:=null;
  if observed in ('approved','denied','cancelled','canceled','completed (cancelled)','approved (cancelled)') then
   status:=case when observed like '%cancel%' then 'cancelled' else observed end;
   decided:=case status when 'approved' then approved when 'denied' then denied when 'cancelled' then cancelled end;
  elsif greatest(approved,denied,cancelled) is not null then
   decided:=greatest(approved,denied,cancelled);
   events:=case when approved=decided then 1 else 0 end+case when denied=decided then 1 else 0 end+case when cancelled=decided then 1 else 0 end;
   if events>1 then reason:='conflicting_terminal_events'; decided:=null; else status:=case decided when approved then 'approved' when denied then 'denied' else 'cancelled' end; end if;
  elsif completed<=effective then status:='pending';
  elsif observed in ('started','partially completed','incomplete') then status:='incomplete';reason:='started_or_incomplete';
  else reason:='completion_or_effective_timestamp_missing';end if;
 end if;
 if nullif(r->>'applicationId','') is null or nullif(r->>'leaseId','') is null or nullif(r->>'communityId','') is null or signed>effective or effective is null then signed:=null;end if;
 return r||jsonb_build_object('applicationStartedAt',started,'applicationCompletedAt',completed,'decisionStatus',status,'decisionAt',decided,'sourceEffectiveAt',effective,'periodKey',meta->>'reportPeriodKey','exclusionReason',reason,'leaseSignedAt',signed,'leaseJoinVerified',signed is not null,'decisionEvidence',case when decided is not null then 'dated_event' when status in ('approved','denied','cancelled') then 'snapshot_status' when status='pending' then 'completed_without_terminal' else 'unavailable' end);
end $$;

