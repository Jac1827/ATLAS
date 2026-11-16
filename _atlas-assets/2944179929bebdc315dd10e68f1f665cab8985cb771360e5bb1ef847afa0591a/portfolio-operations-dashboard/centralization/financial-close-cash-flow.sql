create or replace function public.atlas_close_financial_review(p_review_id uuid,p_expected_version_id uuid,p_reason text,p_accounting_approved boolean)
returns public.atlas_financial_close_versions language plpgsql security definer set search_path='' as $$
declare review public.atlas_financial_package_reviews; comparison public.atlas_financial_comparison_versions;
 prior public.atlas_financial_close_versions; result public.atlas_financial_close_versions;
 cid uuid; cmpid uuid; net_ord bigint; income_ord bigint; noi_ord bigint; net numeric; gpr numeric; net_control numeric;
 income numeric; noi numeric; cash_ord bigint; cash_value numeric; cash_control numeric; field text; mapping jsonb; source_controls jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin') then raise exception 'Only an active Admin may close financial actuals';end if;
 select * into review from public.atlas_financial_package_reviews where review_id=p_review_id;
 if review.review_id is null or not atlas_private.financial_review_access(review.community_id,true) then raise exception 'Financial close access denied';end if;
 if p_accounting_approved is distinct from true or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Explicit Accounting approval confirmation and close reason required';end if;
 if review.period_key>=to_char(current_date,'YYYY-MM') then raise exception 'Only a completed accounting month can close';end if;
 perform pg_advisory_xact_lock(hashtextextended('close:'||review.community_id::text||review.period_key,0));
 select v.* into prior from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=review.community_id and h.period_key=review.period_key and h.accounting_basis=review.accounting_basis;
 select version_id into cmpid from public.atlas_financial_comparison_heads where community_id=review.community_id and period_key=review.period_key;
 -- This re-runs the existing server-side reconciliation; a certificate's client status is not a close gate.
 select * into comparison from public.atlas_apply_financial_comparison(p_review_id,cmpid,p_reason);
 if prior.content_hash is distinct from comparison.content_hash then
 if prior.version_id is distinct from p_expected_version_id then raise exception 'Closed version changed in another session. Reload before closing';end if;
 if exists(select 1 from public.atlas_financial_close_versions where community_id=review.community_id and period_key=review.period_key and content_hash=comparison.content_hash) then raise exception 'Prior closed content requires explicit correction review, not implicit reactivation';end if;
 end if;
 select min(ord) filter(where value->>'kind'='control' and value->>'accountName'='Net Rental Income'),
 min(ord) filter(where value->>'kind'='control' and value->>'accountName'='Total Income'),
 min(ord) filter(where value->>'kind'='control' and value->>'accountName' ~* '^Net Operating Income( *\(NOI\))?$')
 into net_ord,income_ord,noi_ord from jsonb_array_elements(review.certificate->'rows') with ordinality r(value,ord);
 if net_ord is null or net_ord>=income_ord then raise exception 'Source Net Rental Income control and GL mapping require review';end if;
 select sum((value->'values'->>'actual')::numeric) filter(where ord<net_ord and value->>'kind'='posting'),
 max((value->'values'->>'actual')::numeric) filter(where ord=net_ord),
 max((value->'values'->>'actual')::numeric) filter(where value->>'kind'='posting' and value->>'glCode'='5120'),
 max((value->'values'->>'actual')::numeric) filter(where ord=income_ord),
 max((value->'values'->>'actual')::numeric) filter(where ord=noi_ord)
 into net,net_control,gpr,income,noi from jsonb_array_elements(review.certificate->'rows') with ordinality r(value,ord);
 if net is null or net_control is null or round(net,2)<>round(net_control,2) or gpr is null then raise exception 'Net Rental Income and approved GPR GL 5120 must reconcile';end if;
 -- Reconcile final cash flow when the approved source includes that control.
 select min(ord) into cash_ord from jsonb_array_elements(review.certificate->'rows') with ordinality r(value,ord) where value->>'kind'='control' and value->>'accountName'='Net Cash Flow';
 if cash_ord is not null then
  foreach field in array array['actual','budget','ytdActual','ytdBudget','annualBudget'] loop
   select sum(case when ord<income_ord then (value->'values'->>field)::numeric else -(value->'values'->>field)::numeric end) filter(where value->>'kind'='posting' and ord<cash_ord),max((value->'values'->>field)::numeric) filter(where ord=cash_ord) into cash_value,cash_control from jsonb_array_elements(review.certificate->'rows') with ordinality r(value,ord);
   if cash_value is null or cash_control is null or round(cash_value,2)<>round(cash_control,2) then raise exception 'Cash flow reconciliation failed: %',field;end if;
  end loop;
 end if;
 if prior.content_hash=comparison.content_hash then return prior;end if;
 select jsonb_build_object('definition','source_posting_rows_before_net_rental_income_control','grossPotentialRentGl','5120','netRentalIncomeGls',jsonb_agg(value->>'glCode' order by ord),'sourceControl','Net Rental Income') into mapping from jsonb_array_elements(review.certificate->'rows') with ordinality r(value,ord) where ord<net_ord and value->>'kind'='posting';
 select jsonb_object_agg(value->>'accountName',value->'values') into source_controls from jsonb_array_elements(review.certificate->'rows') value where value->>'kind'='control';
 insert into public.atlas_financial_close_versions(community_id,period_key,accounting_basis,comparison_version_id,review_id,previous_version_id,revision,source_hash,source_file,content_hash,approved_by,reason,row_count,metrics,mapping)
 values(review.community_id,review.period_key,review.accounting_basis,comparison.version_id,review.review_id,prior.version_id,coalesce(prior.revision,0)+1,review.source_hash,review.source_file,comparison.content_hash,auth.uid(),p_reason,comparison.row_count,
 jsonb_build_object('netRentalIncome',net,'grossPotentialRent',gpr,'totalIncome',income,'netOperatingIncome',noi,'operatingExpenses',income-noi,'sourceControls',source_controls),mapping) returning * into result;
 insert into public.atlas_financial_close_rows select result.version_id,community_id,gl_code,account_name,section,actual,ytd_actual,source_location from public.atlas_financial_comparison_rows where version_id=comparison.version_id;
 insert into public.atlas_financial_close_heads values(review.community_id,review.period_key,review.accounting_basis,result.version_id) on conflict(community_id,period_key,accounting_basis) do update set version_id=excluded.version_id;
 insert into public.atlas_financial_close_events(version_id,community_id,event_type,actor,detail) values(result.version_id,review.community_id,case when prior.version_id is null then 'closed' else 'replacement' end,auth.uid(),jsonb_build_object('previousVersion',prior.version_id,'previousTotals',prior.metrics,'replacementTotals',result.metrics,'reason',p_reason,'downstreamStatus','awaiting consumer readback'));
 return result;
end;$$;
