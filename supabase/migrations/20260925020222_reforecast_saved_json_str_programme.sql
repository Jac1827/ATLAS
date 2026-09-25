-- Saved JSON programmes retain their exact monthly GL output independently of
-- the existing physical-unit/rate STR calculator. No source amounts are inferred.
begin;
-- STR additions are immutable registry versions selected only by the derived
-- scenario. They never advance the community's operating registry head.
create function atlas_private.reforecast_str_registry_extension(cid uuid,parent_id uuid,registry_id uuid,mappings jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare parent public.atlas_reforecast_publications;parent_config jsonb;original public.atlas_reforecast_registries;candidate public.atlas_reforecast_registries;added jsonb;
begin
 select * into parent from public.atlas_reforecast_publications where publication_id=parent_id and community_id=cid;
 select payload into parent_config from public.atlas_reforecast_revisions where revision_id=parent.revision_id;
 if parent.publication_id is null or not atlas_private.reforecast_publication_valid(parent) or parent_config->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(parent_config->'strStreams','[]'))v where v->>'id'='rise_str') then raise exception 'Exact approved Conventional registry parent required';end if;
 select * into original from public.atlas_reforecast_registries where version_id::text=parent_config->>'registryVersionId' and community_id=cid;
 select * into candidate from public.atlas_reforecast_registries where version_id=registry_id and community_id=cid;
 if original.version_id is null or candidate.version_id is null then raise exception 'Both immutable registry versions are required';end if;
 if (original.payload-array['accounts','reason','effectiveDate','strExtensionParent']) is distinct from (candidate.payload-array['accounts','reason','effectiveDate','strExtensionParent']) or exists(select 1 from jsonb_array_elements(original.payload->'accounts')a where (select count(*) from jsonb_array_elements(candidate.payload->'accounts')b where b=a)<>1) then raise exception 'STR registry extension must preserve all parent accounts and inherited registry relationships unchanged';end if;
 select coalesce(jsonb_agg(a->>'accountCode' order by a->>'accountCode'),'[]') into added from jsonb_array_elements(candidate.payload->'accounts')a where not exists(select 1 from jsonb_array_elements(original.payload->'accounts')b where b->>'accountCode'=a->>'accountCode');
 if candidate.version_id<>original.version_id and (candidate.previous_version_id is distinct from original.version_id or candidate.payload->'strExtensionParent'->>'publicationId' is distinct from parent_id::text or candidate.payload->'strExtensionParent'->>'registryVersion' is distinct from original.version_id::text or jsonb_array_length(added)=0) then raise exception 'STR extension must derive from the exact parent registry and add explicitly reviewed accounts';end if;
 if mappings is not null and exists(select 1 from jsonb_array_elements_text(added)code where not exists(select 1 from jsonb_array_elements(mappings)m where m->>'accountCode'=code and m->>'confirmed'='true' and m->>'parentDisposition'='no_parent_publication_row')) then raise exception 'Every added STR account requires a reviewed source mapping and explicit absent-parent disposition';end if;
 return jsonb_build_object('kind',case when candidate.version_id=original.version_id then 'unchanged' else 'preserve_parent_accounts' end,'parentRegistryVersion',original.version_id,'parentRegistryHash',original.content_hash,'registryVersion',candidate.version_id,'registryHash',candidate.content_hash,'addedAccountCodes',added);
end;$$;

create function atlas_private.save_reforecast_str_registry_extension(p_community_id uuid,p_parent_publication_id uuid,p_expected_version_id uuid,p_request_id uuid,p_payload jsonb)
returns public.atlas_reforecast_registries language plpgsql security definer set search_path='' as $$
declare parent public.atlas_reforecast_publications;config jsonb;original public.atlas_reforecast_registries;r public.atlas_reforecast_registries;account jsonb;codes text[]:='{}';hash text;head uuid;role_name text;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'publish') then raise exception 'Authorized Admin or executive required to approve an isolated STR registry extension';end if;
 select * into parent from public.atlas_reforecast_publications where publication_id=p_parent_publication_id and community_id=p_community_id;
 select payload into config from public.atlas_reforecast_revisions where revision_id=parent.revision_id;
 if parent.publication_id is null or not atlas_private.reforecast_publication_valid(parent) or config->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))v where v->>'id'='rise_str') then raise exception 'Exact approved Conventional parent required';end if;
 select * into original from public.atlas_reforecast_registries where version_id::text=config->>'registryVersionId' and community_id=p_community_id;
 if p_request_id is null or jsonb_typeof(p_payload->'accounts') is distinct from 'array' or jsonb_array_length(p_payload->'accounts')>3000 or length(trim(coalesce(p_payload->>'reason','')))<3 or coalesce(p_payload->>'effectiveDate','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$' or p_payload->'strExtensionParent'->>'publicationId' is distinct from p_parent_publication_id::text or p_payload->'strExtensionParent'->>'registryVersion' is distinct from original.version_id::text or coalesce(p_payload->'strExtensionParent'->>'sourceHash','')!~'^[a-f0-9]{64}$' or coalesce(p_payload->'strExtensionParent'->>'programmeId','')='' then raise exception 'Reviewed STR registry lineage, reason, source and effective date required';end if;
 hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('reforecast-registry:'||p_community_id,0));
 select * into r from public.atlas_reforecast_registries where request_id=p_request_id;
 if found then if r.community_id<>p_community_id or r.created_by<>auth.uid() or r.content_hash<>hash or r.previous_version_id is distinct from original.version_id then raise exception 'STR registry request ID reused';end if;return r;end if;
 select version_id into head from public.atlas_reforecast_registry_heads where community_id=p_community_id;if head is distinct from p_expected_version_id then raise exception 'GL registry changed in another session; reload before saving';end if;
 if (original.payload-array['accounts','reason','effectiveDate','strExtensionParent']) is distinct from (p_payload-array['accounts','reason','effectiveDate','strExtensionParent']) or exists(select 1 from jsonb_array_elements(original.payload->'accounts')a where (select count(*) from jsonb_array_elements(p_payload->'accounts')b where b=a)<>1) then raise exception 'STR registry extension must preserve all parent accounts and inherited registry relationships unchanged';end if;
 for account in select value from jsonb_array_elements(p_payload->'accounts') loop
  if coalesce(account->>'accountCode','')='' or length(account->>'accountCode')>80 or account->>'accountCode'=any(codes) or coalesce(account->>'category','')='' or coalesce(account->>'nature','') not in ('income','contra_income','expense','capital','debt','below_noi') or coalesce(account->>'placement','') not in ('above_noi','below_noi') or coalesce(account->>'effectiveFrom','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Every unique GL needs a category, nature, statement placement and effective month';end if;
  if account->>'nature' in ('capital','debt','below_noi') and account->>'placement'<>'below_noi' then raise exception 'Capital, debt and below-NOI GLs must remain below the line';end if;
  codes:=array_append(codes,account->>'accountCode');
  if exists(select 1 from jsonb_array_elements(original.payload->'accounts')a where a=account) then continue;end if;
  if coalesce(account->>'name','')='' or account->>'retiredAfter' is not null or account->'sourceEvidence'->>'sourceHash' is distinct from p_payload->'strExtensionParent'->>'sourceHash' or coalesce(account->'sourceEvidence'->>'sourceLineId','')='' or coalesce(account->'sourceEvidence'->>'sourceGL','')='' or account->'sourceEvidence'->>'reviewedBy' is distinct from auth.uid()::text or length(trim(coalesce(account->'sourceEvidence'->>'reason','')))<3 then raise exception 'Every new STR account requires explicit name, classification and reviewed source evidence';end if;
 end loop;
 if jsonb_array_length(p_payload->'accounts')<=jsonb_array_length(original.payload->'accounts') then raise exception 'An STR extension requires explicitly reviewed new accounts';end if;
 select role into role_name from public.atlas_user_profiles where user_id=auth.uid();
 insert into public.atlas_reforecast_registries(community_id,previous_version_id,request_id,effective_date,payload,content_hash,created_by,created_role) values(p_community_id,original.version_id,p_request_id,(p_payload->>'effectiveDate')::date,p_payload,hash,auth.uid(),role_name) returning * into r;
 return r;
end;$$;

create function atlas_private.read_reforecast_str_mapping_context(p_community_id uuid,p_parent_publication_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare parent public.atlas_reforecast_publications;config jsonb;registry public.atlas_reforecast_registries;head uuid;accounts jsonb;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'read') then raise exception 'STR mapping context access denied';end if;
 select * into parent from public.atlas_reforecast_publications where publication_id=p_parent_publication_id and community_id=p_community_id;
 select payload into config from public.atlas_reforecast_revisions where revision_id=parent.revision_id;
 if parent.publication_id is null or not atlas_private.reforecast_publication_valid(parent) or config->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))v where v->>'id'='rise_str') then raise exception 'Exact approved Conventional parent required';end if;
 select * into registry from public.atlas_reforecast_registries where version_id::text=config->>'registryVersionId' and community_id=p_community_id;
 select version_id into head from public.atlas_reforecast_registry_heads where community_id=p_community_id;
 select coalesce(jsonb_agg(v order by v->>'sourceGL',v->>'sheet',v->>'address'),'[]') into accounts from (select distinct jsonb_build_object('sourceGL',l->'accountCode','name',coalesce(l->'accountName',l->'name'),'sheet',l->'sheet','address',l->'accountAddress','uploadId',u.upload_id,'sourceHash',u.source_hash) v from public.atlas_reforecast_uploads u cross join lateral jsonb_array_elements(u.payload->'lines')l where u.community_id=p_community_id and (u.upload_id::text=config->>'uploadId' or exists(select 1 from jsonb_array_elements(coalesce(config->'importHistory','[]'))h where h->>'uploadId'=u.upload_id::text)))q;
 return jsonb_build_object('parentRegistry',registry.payload||jsonb_build_object('version',registry.version_id,'contentHash',registry.content_hash),'currentRegistryVersionId',head,'workbookAccountEvidence',accounts);
end;$$;
create function public.atlas_save_reforecast_str_registry_extension(p_community_id uuid,p_parent_publication_id uuid,p_expected_version_id uuid,p_request_id uuid,p_payload jsonb) returns public.atlas_reforecast_registries language sql security invoker set search_path='' as $$select atlas_private.save_reforecast_str_registry_extension(p_community_id,p_parent_publication_id,p_expected_version_id,p_request_id,p_payload)$$;
create function public.atlas_read_reforecast_str_mapping_context(p_community_id uuid,p_parent_publication_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select atlas_private.read_reforecast_str_mapping_context(p_community_id,p_parent_publication_id)$$;
revoke all on function atlas_private.reforecast_str_registry_extension(uuid,uuid,uuid,jsonb),atlas_private.save_reforecast_str_registry_extension(uuid,uuid,uuid,uuid,jsonb),atlas_private.read_reforecast_str_mapping_context(uuid,uuid),public.atlas_save_reforecast_str_registry_extension(uuid,uuid,uuid,uuid,jsonb),public.atlas_read_reforecast_str_mapping_context(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas_private.save_reforecast_str_registry_extension(uuid,uuid,uuid,uuid,jsonb),atlas_private.read_reforecast_str_mapping_context(uuid,uuid),public.atlas_save_reforecast_str_registry_extension(uuid,uuid,uuid,uuid,jsonb),public.atlas_read_reforecast_str_mapping_context(uuid,uuid) to authenticated;

create table public.atlas_reforecast_str_json_sources (
 source_receipt_id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.atlas_communities(community_id),
 request_id uuid not null unique,
 request_hash text not null,
 source_hash text not null,
 source_fingerprint text not null,
 content_hash text not null,
 parent_publication_id uuid not null references public.atlas_reforecast_publications(publication_id),
 mapping_version uuid not null,
 evidence jsonb not null,
 review jsonb not null,
 registry_extension jsonb not null,
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(mapping_version,community_id) references public.atlas_reforecast_registries(version_id,community_id)
);
alter table public.atlas_reforecast_str_json_sources enable row level security;
revoke all on public.atlas_reforecast_str_json_sources from public,anon,authenticated;
grant select on public.atlas_reforecast_str_json_sources to authenticated;
create policy reforecast_str_json_source_read on public.atlas_reforecast_str_json_sources for select to authenticated using(atlas_private.reforecast_access(community_id,'read'));
create trigger reforecast_str_json_source_immutable before update or delete on public.atlas_reforecast_str_json_sources for each row execute function atlas_private.finance_immutable();

create function atlas_private.reforecast_saved_str_source(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare bytes bytea;document jsonb;state jsonb;property jsonb;programme jsonb;cfg jsonb;pick jsonb;group_row jsonb;line jsonb;cell jsonb;result jsonb;groups jsonb:='[]';ramp jsonb:='[]';lines jsonb:='[]';cells jsonb:='[]';differences jsonb:='[]';saved jsonb;computed jsonb;value jsonb;
 periods jsonb;property_id text;programme_id text;p text;y text;metric text;programme_index integer;line_index integer;pick_index integer;month_index integer;n integer;units numeric;allocated numeric:=0;amount numeric;income numeric;contra numeric;expense numeric;capital numeric;
begin
 if input->>'schemaVersion' is distinct from 'atlas.saved-str-monthly-programme.v1' or input->'originalFile'->>'encoding' is distinct from 'base64' then raise exception 'Complete original saved STR JSON evidence required';end if;
 bytes:=decode(input->'originalFile'->>'data','base64');
 if octet_length(bytes) not between 1 and 1048576 or encode(sha256(bytes),'hex') is distinct from input->>'sourceHash' or octet_length(bytes) is distinct from (input->>'byteLength')::integer then raise exception 'Saved STR original byte hash or size mismatch';end if;
 document:=convert_from(bytes,'UTF8')::jsonb;state:=document->'state';periods:=input->'periods';property_id:=input->>'sourcePropertyId';programme_id:=input->>'programmeId';
 if document->>'formatVersion' is distinct from '1' or jsonb_typeof(state->'properties') is distinct from 'array' or jsonb_typeof(state->'strPrograms') is distinct from 'array' or jsonb_typeof(state->'lines') is distinct from 'array' or jsonb_typeof(periods) is distinct from 'array' or jsonb_array_length(periods) not between 1 and 24 or exists(select 1 from jsonb_array_elements_text(periods)v where v!~'^20[0-9]{2}-(0[1-9]|1[0-2])$') or (select count(distinct v) from jsonb_array_elements_text(periods)v)<>jsonb_array_length(periods) then raise exception 'Supported source format and distinct complete forecast months required';end if;
 select count(*),jsonb_agg(v)->0 into n,property from jsonb_array_elements(state->'properties')v where v->>'id'=property_id;if n<>1 then raise exception 'One exact source property required';end if;
 select count(*),jsonb_agg(v)->0,min(ord)::integer-1 into n,programme,programme_index from jsonb_array_elements(state->'strPrograms')with ordinality q(v,ord) where v->>'id'=programme_id and v->>'propertyId'=property_id;
 if n<>1 or coalesce(programme->>'operatorId','') not in ('rise_internal','rise_str') then raise exception 'One exact RISE source programme required';end if;
 cfg:=programme->'config';
 if cfg->>'propertyId' is distinct from property_id or cfg->>'programmeId' is distinct from programme_id or jsonb_typeof(cfg->'unitPicks') is distinct from 'array' or jsonb_array_length(cfg->'unitPicks')=0 or exists(select 1 from jsonb_array_elements(cfg->'unitPicks')v group by v->>'groupId' having count(*)>1) then raise exception 'Saved group allocations must identify this exact property and programme';end if;
 for pick,pick_index in select v,ord::integer-1 from jsonb_array_elements(cfg->'unitPicks')with ordinality q(v,ord) loop
  select count(*),jsonb_agg(v)->0 into n,group_row from jsonb_array_elements(property->'units')v where v->>'id'=pick->>'groupId';units:=(pick->>'units')::numeric;
  if n<>1 or jsonb_typeof(pick->'units') is distinct from 'number' or units<0 or units<>trunc(units) then raise exception 'Unique retained group and nonnegative integer allocation required';end if;
  allocated:=allocated+units;groups:=groups||jsonb_build_array(jsonb_build_object('sourceGroupId',pick->'groupId','units',pick->'units','sourceGroup',group_row,'sourcePath','/state/strPrograms/'||programme_index||'/config/unitPicks/'||pick_index));
 end loop;
 for p in select jsonb_array_elements_text(periods) loop
  y:=left(p,4);month_index:=right(p,2)::integer-1;value:=cfg->'unitRamp'->y;
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)<>12 or jsonb_typeof(value->month_index) is distinct from 'number' then raise exception 'Every source month needs an exact retained unit ramp';end if;units:=(value->>month_index)::numeric;
  if units<0 or units<>trunc(units) or units>allocated then raise exception 'Saved ramp exceeds reviewed group allocation';end if;
  ramp:=ramp||jsonb_build_array(jsonb_build_object('period',p,'units',units,'sourcePath','/state/strPrograms/'||programme_index||'/config/unitRamp/'||y||'/'||month_index));
 end loop;
 for line,line_index in select v,ord::integer-1 from jsonb_array_elements(state->'lines')with ordinality q(v,ord) where v->>'propertyId'=property_id and v->>'strProgramId'=programme_id loop
  if coalesce(line->>'id','')='' or coalesce(line->>'gl','')='' or coalesce(line->>'nature','') not in ('income','contra_income','expense','capital','debt','below_noi') or exists(select 1 from jsonb_array_elements(lines)v where v->'line'->>'id'=line->>'id') then raise exception 'Saved contribution line identity and classification must be unambiguous';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('sourceLineIndex',line_index,'line',line));
  for p in select jsonb_array_elements_text(periods) loop
   y:=left(p,4);month_index:=right(p,2)::integer-1;value:=line->'yearData'->y;
   if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)<>12 or jsonb_typeof(value->month_index) is distinct from 'number' then raise exception 'Every source GL/month needs an exact numeric value; blank is not zero';end if;
   if exists(select 1 from jsonb_array_elements(cells)c where c->>'sourceGL'=line->>'gl' and c->>'period'=p) then raise exception 'Duplicate saved GL/month requires explicit aggregation';end if;
   cells:=cells||jsonb_build_array(jsonb_build_object('sourceLineId',line->'id','sourceLineIndex',line_index,'sourceGL',line->'gl','sourceName',coalesce(line->>'name',''),'nature',line->'nature','department',line->'department','period',p,'sourceAmount',value->month_index,'sourcePath','/state/lines/'||line_index||'/yearData/'||y||'/'||month_index,'sourceKind','saved_json_monthly_programme'));
  end loop;
 end loop;
 if jsonb_array_length(lines)=0 then raise exception 'Saved programme has no retained GL output';end if;
 for y in select distinct left(v,4) from jsonb_array_elements_text(periods)v order by 1 loop
  saved:=programme->'byYear'->y;if saved is null then continue;end if;
  select sum((a.v)::text::numeric) filter(where l->'line'->>'nature'='income'),sum((a.v)::text::numeric) filter(where l->'line'->>'nature'='contra_income'),sum((a.v)::text::numeric) filter(where l->'line'->>'nature'='expense'),sum((a.v)::text::numeric) filter(where l->'line'->>'nature'='capital') into income,contra,expense,capital from jsonb_array_elements(lines)l cross join lateral jsonb_array_elements(l->'line'->'yearData'->y)a(v);
  computed:=jsonb_build_object('totalRevenue',coalesce(income,0),'expense',coalesce(expense,0),'furnishCapex',coalesce(capital,0),'uplift',coalesce(income,0)+coalesce(contra,0)-coalesce(expense,0));
  foreach metric in array array['totalRevenue','expense','furnishCapex','uplift'] loop
   if jsonb_typeof(saved->metric)='number' and saved->metric is distinct from computed->metric then differences:=differences||jsonb_build_array(jsonb_build_object('year',y,'metric',metric,'savedProgrammeTotal',saved->metric,'savedMonthlyGLTotal',computed->metric,'difference',(computed->>metric)::numeric-(saved->>metric)::numeric,'authority','saved_monthly_gl_cells'));end if;
  end loop;
 end loop;
 result:=jsonb_build_object('schemaVersion','atlas.saved-str-monthly-programme.v1','fileName',input->'fileName','sourceHash',input->'sourceHash','byteLength',octet_length(bytes),'originalFile',input->'originalFile','savedAt',document->'savedAt','sourcePropertyId',property_id,'programmeId',programme_id,'periods',(select jsonb_agg(v order by v) from jsonb_array_elements_text(periods)v),'property',property,'programme',programme,'groupAllocations',groups,'allocatedUnits',allocated,'unitRamp',ramp,'lineEvidence',lines,'cells',cells,'sourceRollups',coalesce(programme->'byYear','{}'),'sourceRollupDifferences',differences,'referenceDisposition','Other operators and reference datasets remain retained in the original JSON and are not applied as RISE contributions.','blockers','[]'::jsonb);
 result:=result||jsonb_build_object('fingerprint',encode(sha256(convert_to(atlas_private.workbook_canonical_json(result),'UTF8')),'hex'));
 if result is distinct from input then raise exception 'Saved STR evidence does not exactly reproduce the retained original JSON';end if;
 return result;
end;$$;
revoke all on function atlas_private.reforecast_saved_str_source(jsonb) from public,anon,authenticated;

create function atlas_private.read_reforecast_str_json_source_receipt(p_community_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_reforecast_str_json_sources;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'read') then raise exception 'Saved STR source access denied';end if;
 select * into r from public.atlas_reforecast_str_json_sources where community_id=p_community_id and request_id=p_request_id;if not found then return null;end if;
 if r.content_hash is distinct from encode(sha256(convert_to(atlas_private.workbook_canonical_json(jsonb_build_object('review',r.review,'registryExtension',r.registry_extension)),'UTF8')),'hex') then raise exception 'Saved STR receipt content hash mismatch';end if;
 return jsonb_build_object('source_receipt_id',r.source_receipt_id,'request_id',r.request_id,'community_id',r.community_id,'source_hash',r.source_hash,'source_fingerprint',r.source_fingerprint,'content_hash',r.content_hash,'status','approved','review',r.review,'registry_extension',r.registry_extension,'source_rollup_differences',r.evidence->'sourceRollupDifferences','created_at',r.created_at,'actor_id',r.actor_id);
end;$$;

create function atlas_private.save_reforecast_str_json_source(p_community_id uuid,p_request_id uuid,p_source jsonb,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.atlas_reforecast_str_json_sources;parent public.atlas_reforecast_publications;parent_config jsonb;source jsonb;review jsonb;mapping jsonb;account jsonb;cell jsonb;base jsonb;cells jsonb:='[]';ramp jsonb;request_hash text;parent_identity jsonb;registry jsonb;extension jsonb;combined numeric;n integer;absent boolean;reason text:=trim(coalesce(p_review->>'reason',''));
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'publish') then raise exception 'Authorized Admin or executive required to approve saved STR source';end if;
 if p_request_id is null or jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_review) is distinct from 'object' or octet_length(p_source::text)+octet_length(p_review::text)>8388608 then raise exception 'Valid bounded saved STR source and review required';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_source,p_review)::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended('saved-str-source:'||p_request_id,0));
 select * into prior from public.atlas_reforecast_str_json_sources where request_id=p_request_id;
 if found then if prior.community_id<>p_community_id or prior.actor_id<>auth.uid() or prior.request_hash<>request_hash then raise exception 'Saved STR request ID reused with different evidence';end if;return atlas_private.read_reforecast_str_json_source_receipt(p_community_id,p_request_id);end if;
 source:=atlas_private.reforecast_saved_str_source(p_source);
 select * into parent from public.atlas_reforecast_publications where publication_id::text=p_review->'parentPublication'->>'publicationId' and community_id=p_community_id;
 select payload into parent_config from public.atlas_reforecast_revisions where revision_id=parent.revision_id;
 if parent.publication_id is null or not atlas_private.reforecast_publication_valid(parent) or parent_config->>'scenarioPurpose'='str_overlay' or exists(select 1 from jsonb_array_elements(coalesce(parent_config->'strStreams','[]'))v where v->>'id'='rise_str') then raise exception 'Exact approved and locked Conventional parent required';end if;
 parent_identity:=jsonb_build_object('publicationId',parent.publication_id,'revisionId',parent.revision_id,'contentHash',parent.snapshot->>'fingerprint','communityId',p_community_id,'periods',to_jsonb(parent.periods),'originalBudgetVersionIds',parent_config->'baselineVersionIds');
 if p_review->'parentPublication' is distinct from parent_identity or p_review->>'actorId' is distinct from auth.uid()::text or length(reason)<3 or coalesce(p_review->>'reviewedAt','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' or p_review->>'application' is distinct from 'add' then raise exception 'Review actor, additive method, exact parent and mapping ancestry required';end if;
 select payload into registry from public.atlas_reforecast_registries where version_id::text=p_review->>'mappingVersion' and community_id=p_community_id;
 if registry is null then raise exception 'Parent registry is unavailable';end if;
 extension:=atlas_private.reforecast_str_registry_extension(p_community_id,parent.publication_id,(p_review->>'mappingVersion')::uuid,p_review->'mappings');
 if extension->>'kind'='preserve_parent_accounts' and (registry->'strExtensionParent'->>'sourceHash' is distinct from source->>'sourceHash' or registry->'strExtensionParent'->>'programmeId' is distinct from source->>'programmeId') then raise exception 'STR registry extension must bind the exact retained programme source';end if;
 if exists(select 1 from jsonb_array_elements_text(source->'periods')p where not(p=any(parent.periods)) or atlas_private.reforecast_month_locked(p_community_id,p) or p<=(select max(h.period_key) from public.atlas_financial_close_heads h join public.atlas_financial_close_versions v using(version_id) where h.community_id=p_community_id and h.accounting_basis='accrual' and atlas_private.reforecast_close_eligible(p_community_id,h.period_key,v.source_hash))) then raise exception 'Saved STR contributions require eligible open parent months';end if;
 if jsonb_array_length(source->'sourceRollupDifferences')>0 and not coalesce(p_review->'rollupReview'->>'confirmed'='true' and p_review->'rollupReview'->>'sourceHash'=source->>'sourceHash' and p_review->'rollupReview'->>'authority'='saved_monthly_gl_cells' and length(trim(coalesce(p_review->'rollupReview'->>'reason','')))>=3,false) then raise exception 'Review saved monthly GL versus programme summary differences; never alter source cents';end if;
 if jsonb_typeof(p_review->'mappings') is distinct from 'array' then raise exception 'Explicit source-to-canonical GL mappings required';end if;
 for cell in select value from jsonb_array_elements(source->'cells') loop
  select count(*),jsonb_agg(v)->0 into n,mapping from jsonb_array_elements(p_review->'mappings')v where v->>'sourceLineId'=cell->>'sourceLineId' and v->>'sourceGL'=cell->>'sourceGL';
  if n<>1 or length(trim(coalesce(mapping->>'reason','')))<3 or mapping->>'confirmed' is distinct from 'true' or mapping ? 'signMultiplier' and mapping->>'signMultiplier' is distinct from '1' then raise exception 'Exactly one confirmed mapping must preserve each saved signed contribution';end if;
  select count(*),jsonb_agg(v)->0 into n,account from jsonb_array_elements(registry->'accounts')v where v->>'accountCode'=mapping->>'accountCode';
  if n<>1 or (cell->>'nature'='contra_income' and account->>'nature' not in ('income','contra_income')) or (cell->>'nature'<>'contra_income' and cell->>'nature' is distinct from account->>'nature') or account->>'effectiveFrom'>cell->>'period' or account->>'retiredAfter'<cell->>'period' then raise exception 'Preserve source financial classification and effective canonical GL mapping';end if;
  if extension->'addedAccountCodes' ? (account->>'accountCode') and (account->'sourceEvidence'->>'sourceHash' is distinct from source->>'sourceHash' or account->'sourceEvidence'->>'sourceLineId' is distinct from cell->>'sourceLineId' or account->'sourceEvidence'->>'sourceGL' is distinct from cell->>'sourceGL' or account->'sourceEvidence'->>'sourceName' is distinct from cell->>'sourceName' or account->'sourceEvidence'->>'sourcePath' is distinct from '/state/lines/'||(cell->>'sourceLineIndex')) then raise exception 'Added canonical account must bind its exact original source GL, label and path';end if;
  if account->>'accountCode'='5144' and p_review->>'allowHelloLandingGl5144' is distinct from 'true' then raise exception 'Explicit approved authority required for RISE contribution to protected GL 5144';end if;
  select count(*),jsonb_agg(v)->0 into n,base from jsonb_array_elements(parent.snapshot->'lines')v where v->>'period'=cell->>'period' and v->>'accountCode'=account->>'accountCode';absent:=n=0;
  if n>1 or n=1 and jsonb_typeof(base->'forecast') is distinct from 'number' then raise exception 'Parent GL/month is ambiguous or blank; blank is not zero';end if;
  if absent and mapping->>'parentDisposition' is distinct from 'no_parent_publication_row' then raise exception 'Explicit review required for absent parent publication row';end if;
  if absent and exists(select 1 from jsonb_array_elements(coalesce(parent.source->'baseline'->'originalBudgetLines',parent.source->'baseline'->'lines','[]'))v where v->>'period'=cell->>'period' and v->>'accountCode'=account->>'accountCode') then raise exception 'A present original budget row cannot be omitted from the parent';end if;
  if exists(select 1 from jsonb_array_elements(cells)v where v->>'accountCode'=account->>'accountCode' and v->>'period'=cell->>'period') then raise exception 'Duplicate saved contribution target requires explicit aggregation';end if;
  combined:=case when absent then (cell->>'sourceAmount')::numeric else (base->>'forecast')::numeric+(cell->>'sourceAmount')::numeric end;
  cells:=cells||jsonb_build_array(cell||jsonb_build_object('accountCode',account->'accountCode','mappingVersion',p_review->'mappingVersion','amount',cell->'sourceAmount','application','add','parentAmount',base->'forecast','parentDisposition',case when absent then 'no_parent_publication_row' else 'existing_parent_cell' end,'combinedForecast',combined,'actorId',auth.uid(),'reviewedAt',p_review->'reviewedAt','reason',reason));
 end loop;
 review:=jsonb_build_object('schemaVersion','atlas.saved-str-monthly-programme.v1','sourceKind','saved_json_monthly_programme','sourceHash',source->'sourceHash','sourceFingerprint',source->'fingerprint','sourcePropertyId',source->'sourcePropertyId','programmeId',source->'programmeId','parentPublication',parent_identity,'mappingVersion',p_review->'mappingVersion','periods',source->'periods','application','add','groupAllocations',source->'groupAllocations','unitRamp',source->'unitRamp','cells',cells,'mappings',p_review->'mappings','allowHelloLandingGl5144',coalesce(p_review->'allowHelloLandingGl5144','false'),'rollupReview',p_review->'rollupReview','actorId',auth.uid(),'reviewedAt',p_review->'reviewedAt','reason',reason,'blockers','[]'::jsonb,'ready',true);
 review:=review||jsonb_build_object('fingerprint',encode(sha256(convert_to(atlas_private.workbook_canonical_json(review),'UTF8')),'hex'));
 if review is distinct from p_review then raise exception 'Saved STR contribution review differs from independently reconstructed source and parent values';end if;
 insert into public.atlas_reforecast_str_json_sources(community_id,request_id,request_hash,source_hash,source_fingerprint,content_hash,parent_publication_id,mapping_version,evidence,review,registry_extension,actor_id) values(p_community_id,p_request_id,request_hash,source->>'sourceHash',source->>'fingerprint',encode(sha256(convert_to(atlas_private.workbook_canonical_json(jsonb_build_object('review',review,'registryExtension',extension)),'UTF8')),'hex'),parent.publication_id,(p_review->>'mappingVersion')::uuid,source,review,extension,auth.uid());
 return atlas_private.read_reforecast_str_json_source_receipt(p_community_id,p_request_id);
end;$$;

create function public.atlas_save_reforecast_str_json_source(p_community_id uuid,p_request_id uuid,p_source jsonb,p_review jsonb) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.save_reforecast_str_json_source(p_community_id,p_request_id,p_source,p_review)$$;
create function public.atlas_read_reforecast_str_json_source_receipt(p_community_id uuid,p_request_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select atlas_private.read_reforecast_str_json_source_receipt(p_community_id,p_request_id)$$;
revoke all on function atlas_private.save_reforecast_str_json_source(uuid,uuid,jsonb,jsonb),atlas_private.read_reforecast_str_json_source_receipt(uuid,uuid),public.atlas_save_reforecast_str_json_source(uuid,uuid,jsonb,jsonb),public.atlas_read_reforecast_str_json_source_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas_private.save_reforecast_str_json_source(uuid,uuid,jsonb,jsonb),atlas_private.read_reforecast_str_json_source_receipt(uuid,uuid),public.atlas_save_reforecast_str_json_source(uuid,uuid,jsonb,jsonb),public.atlas_read_reforecast_str_json_source_receipt(uuid,uuid) to authenticated;

-- Bind immutable approved source receipts into the source version used by saves,
-- publishing and second-session reads. Original bytes remain in the receipt table.
alter function atlas_private.reforecast_source_for_config(uuid,jsonb) rename to reforecast_source_for_config_before_saved_str;
revoke all on function atlas_private.reforecast_source_for_config_before_saved_str(uuid,jsonb) from public,anon,authenticated;
create function atlas_private.reforecast_source_for_config(cid uuid,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;receipts jsonb;
begin
 result:=atlas_private.reforecast_source_for_config_before_saved_str(cid,config);
 if not exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))s where s->>'type'='saved_json_monthly_programme') then return result;end if;
 select coalesce(jsonb_agg(atlas_private.read_reforecast_str_json_source_receipt(cid,r.request_id) order by r.source_receipt_id),'[]') into receipts from public.atlas_reforecast_str_json_sources r where r.community_id=cid and exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))s where s->>'type'='saved_json_monthly_programme' and s->>'sourceReceiptId'=r.source_receipt_id::text);
 result:=(result-'sourceVersion')||jsonb_build_object('savedStrSourceReceipts',receipts);
 return result||jsonb_build_object('sourceVersion',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_source_for_config(uuid,jsonb) from public,anon,authenticated;

create function atlas_private.reforecast_saved_str_receipt(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare stream jsonb:=config->'strStreams'->0;r public.atlas_reforecast_str_json_sources;parent public.atlas_reforecast_publications;
begin
 if config->>'scenarioPurpose' is distinct from 'str_overlay' or jsonb_array_length(coalesce(config->'strStreams','[]'))<>1 or stream->>'id' is distinct from 'rise_str' or stream->>'type' is distinct from 'saved_json_monthly_programme' or stream->>'reviewed' is distinct from 'true' or stream->>'application' is distinct from 'add' then raise exception 'Saved programme requires one separate reviewed additive RISE overlay';end if;
 select * into r from public.atlas_reforecast_str_json_sources where source_receipt_id::text=stream->>'sourceReceiptId' and community_id::text=source->>'communityId';
 if not found or stream->>'sourceHash' is distinct from r.source_hash or stream->>'sourceFingerprint' is distinct from r.source_fingerprint or stream->>'contentHash' is distinct from r.content_hash or stream->>'mappingVersion' is distinct from r.mapping_version::text or stream->>'reviewedBy' is distinct from r.actor_id::text or stream->>'reviewedAt' is distinct from r.review->>'reviewedAt' or stream->>'assumptionReason' is distinct from r.review->>'reason' then raise exception 'Saved programme must match its exact approved immutable source receipt';end if;
 if stream is distinct from jsonb_build_object('id','rise_str','type','saved_json_monthly_programme','sourceReceiptId',r.source_receipt_id,'sourceHash',r.source_hash,'sourceFingerprint',r.source_fingerprint,'contentHash',r.content_hash,'mappingVersion',r.mapping_version,'application','add','reviewed',true,'reviewedBy',r.actor_id,'reviewedAt',r.review->'reviewedAt','assumptionReason',r.review->'reason') then raise exception 'Saved programme stream must contain exactly its approved receipt binding, without alternate rates or units';end if;
 select * into parent from public.atlas_reforecast_publications where publication_id=r.parent_publication_id;
 if not atlas_private.reforecast_publication_valid(parent) or config->'parentPublication' is distinct from r.review->'parentPublication' or config->>'baselineType' is distinct from 'approved_reforecast' or config->'baselinePublicationIds' is distinct from jsonb_build_array(r.parent_publication_id) or config->'baselineVersionIds' is distinct from r.review->'parentPublication'->'originalBudgetVersionIds' or config->>'registryVersionId' is distinct from r.mapping_version::text or source->'registry'->>'version' is distinct from r.mapping_version::text or (select jsonb_agg(v order by v) from jsonb_array_elements_text(config->'periods')v) is distinct from to_jsonb(parent.periods) then raise exception 'Saved STR overlay must preserve its exact approved Conventional ancestry';end if;
 if config->'strRegistryExtension' is distinct from r.registry_extension then raise exception 'Saved programme must retain its exact immutable registry extension receipt';end if;
 if jsonb_array_length(coalesce(config->'drivers','[]'))<>0 or config->>'uploadId' is not null or jsonb_array_length(coalesce(config->'importHistory','[]'))<>0 then raise exception 'Saved STR overlay cannot contain unrelated drivers or workbook imports';end if;
 if exists(select 1 from jsonb_array_elements(r.review->'cells')c where source->'lockedPeriods' ? (c->>'period') or c->>'period'<=greatest(source->'actuals'->>'cutoffPeriod',source->'actuals'->>'latestFullClosePeriod') or atlas_private.reforecast_month_locked((source->>'communityId')::uuid,c->>'period')) then raise exception 'Saved STR contributions cannot change governed actual or locked months';end if;
 return atlas_private.read_reforecast_str_json_source_receipt(r.community_id,r.request_id);
end;$$;
revoke all on function atlas_private.reforecast_saved_str_receipt(jsonb,jsonb) from public,anon,authenticated;

alter function atlas_private.reforecast_rise_issues(jsonb,jsonb) rename to reforecast_rise_issues_before_saved_str;
create function atlas_private.reforecast_rise_issues(p_source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))s where s->>'type'='saved_json_monthly_programme') then perform atlas_private.reforecast_saved_str_receipt(p_source,config);return '[]';end if;
 return atlas_private.reforecast_rise_issues_before_saved_str(p_source,config);
end;$$;
revoke all on function atlas_private.reforecast_rise_issues_before_saved_str(jsonb,jsonb),atlas_private.reforecast_rise_issues(jsonb,jsonb) from public,anon,authenticated;

alter function atlas_private.reforecast_str_validation(jsonb,jsonb) rename to reforecast_str_validation_before_saved_str;
create function atlas_private.reforecast_str_validation(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare receipt jsonb;cell jsonb;over jsonb;month jsonb;schedules jsonb:='[]';n integer;
begin
 if not exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))s where s->>'type'='saved_json_monthly_programme') then return atlas_private.reforecast_str_validation_before_saved_str(source,config);end if;
 receipt:=atlas_private.reforecast_saved_str_receipt(source,config);
 if jsonb_array_length(coalesce(config->'overrides','[]'))<>jsonb_array_length(receipt->'review'->'cells') then raise exception 'Apply each saved STR GL/month exactly once';end if;
 for cell in select value from jsonb_array_elements(receipt->'review'->'cells') loop
  select count(*),jsonb_agg(v)->0 into n,over from jsonb_array_elements(coalesce(config->'overrides','[]'))v where v->>'period'=cell->>'period' and v->>'accountCode'=cell->>'accountCode';
  if n<>1 or over->'amount' is distinct from cell->'combinedForecast' or over->'before' is distinct from cell->'parentAmount' or over->'after' is distinct from cell->'combinedForecast' or over->'source'->>'kind' is distinct from 'str_schedule' or over->'source'->>'sourceKind' is distinct from 'saved_json_monthly_programme' or over->'source'->>'sourceReceiptId' is distinct from receipt->>'source_receipt_id' or over->'source'->>'sourceHash' is distinct from receipt->>'source_hash' or over->'source'->>'sourceLineId' is distinct from cell->>'sourceLineId' or over->'source'->>'sourcePath' is distinct from cell->>'sourcePath' or over->'source'->'sourceAmount' is distinct from cell->'amount' or over->'source'->>'application' is distinct from 'add' then raise exception 'Saved STR override differs from exact source receipt and parent addition';end if;
 end loop;
 for month in select value from jsonb_array_elements(receipt->'review'->'unitRamp') loop
  schedules:=schedules||jsonb_build_array(jsonb_build_object('streamId','rise_str','period',month->'period','availableUnits',month->'units','sourceKind','saved_json_monthly_programme','sourceReceiptId',receipt->'source_receipt_id','sourceHash',receipt->'source_hash','incomeBasis','saved_monthly_gl_cells','application','add','grossIncome',(select sum((c->>'amount')::numeric) from jsonb_array_elements(receipt->'review'->'cells')c where c->>'period'=month->>'period' and c->>'nature'='income'),'netIncome',(select sum(case when c->>'nature'='expense' then -(c->>'amount')::numeric else (c->>'amount')::numeric end) from jsonb_array_elements(receipt->'review'->'cells')c where c->>'period'=month->>'period' and c->>'nature' in ('income','contra_income','expense')),'capital',(select sum((c->>'amount')::numeric) from jsonb_array_elements(receipt->'review'->'cells')c where c->>'period'=month->>'period' and c->>'nature'='capital'),'status','approved_source'));
 end loop;
 return jsonb_build_object('issues','[]'::jsonb,'schedules',schedules);
end;$$;
revoke all on function atlas_private.reforecast_str_validation_before_saved_str(jsonb,jsonb),atlas_private.reforecast_str_validation(jsonb,jsonb) from public,anon,authenticated;

-- Preserve exact combined precision without treating the saved JSON as an Excel
-- import. The temporary calculator-only sourceLineId never changes the payload.
alter function atlas_private.calculate_reforecast(jsonb,jsonb) rename to calculate_reforecast_before_saved_str;
create function atlas_private.calculate_reforecast(source jsonb,config jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare receipt jsonb;calculation jsonb:=config;
begin
 if exists(select 1 from jsonb_array_elements(coalesce(config->'strStreams','[]'))s where s->>'type'='saved_json_monthly_programme') then
  receipt:=atlas_private.reforecast_saved_str_receipt(source,config);
  calculation:=jsonb_set(calculation,'{overrides}',(select coalesce(jsonb_agg(v||jsonb_build_object('sourceLineId',v->'source'->'sourceLineId')),'[]') from jsonb_array_elements(coalesce(config->'overrides','[]'))v));
 end if;
 return atlas_private.calculate_reforecast_before_saved_str(source,calculation);
end;$$;
revoke all on function atlas_private.calculate_reforecast_before_saved_str(jsonb,jsonb),atlas_private.calculate_reforecast(jsonb,jsonb) from public,anon,authenticated;

alter function atlas_private.reforecast_original_absence_disposition(jsonb,jsonb,text,text) rename to reforecast_original_absence_before_saved_str;
create function atlas_private.reforecast_original_absence_disposition(source jsonb,config jsonb,p text,code text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;receipt jsonb;cell jsonb;
begin
 result:=atlas_private.reforecast_original_absence_before_saved_str(source,config,p,code);if result is not null then return result;end if;
 if exists(select 1 from jsonb_array_elements(coalesce(source->'baseline'->'originalBudgetLines',source->'baseline'->'lines','[]'))l where l->>'period'=p and l->>'accountCode'=code) then return null;end if;
 if config->'strStreams'->0->>'type'='saved_json_monthly_programme' then
  receipt:=atlas_private.reforecast_saved_str_receipt(source,config);
  select value into cell from jsonb_array_elements(receipt->'review'->'cells')c where c->>'period'=p and c->>'accountCode'=code and c->>'parentDisposition'='no_parent_publication_row';
  if cell is not null then return jsonb_build_object('kind','no_original_budget_row','confirmed',true,'reviewedBy',receipt->'actor_id','reviewedAt',cell->'reviewedAt','reason',cell->'reason','originalBudgetVersionIds',config->'baselineVersionIds','parentDisposition','no_parent_publication_row','sourceReceiptId',receipt->'source_receipt_id');end if;
 end if;
 return null;
end;$$;
revoke all on function atlas_private.reforecast_original_absence_before_saved_str(jsonb,jsonb,text,text),atlas_private.reforecast_original_absence_disposition(jsonb,jsonb,text,text) from public,anon,authenticated;
create or replace function atlas_private.reforecast_overlay_snapshot_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare saved boolean:=coalesce(new.payload->'strStreams'->0->>'type'='saved_json_monthly_programme',false);receipt jsonb;contribution jsonb;parent public.atlas_reforecast_publications;bridge jsonb;line jsonb;original jsonb;issues jsonb;blockers integer;
begin
 issues:=atlas_private.reforecast_rise_issues(new.source,new.payload);if saved then receipt:=atlas_private.reforecast_saved_str_receipt(new.source,new.payload);end if;
 new.snapshot:=jsonb_set(new.snapshot,'{identity,sourceHashes}',(select coalesce(jsonb_agg(v),'[]') from (select jsonb_build_object('kind','workbook','uploadId',u.upload_id,'sourceHash',u.source_hash) v from public.atlas_reforecast_uploads u where u.community_id=new.community_id and u.upload_id::text=new.payload->>'uploadId' union select jsonb_build_object('kind','reviewed_source','uploadId',r->'uploadId','sourceHash',r->'sourceHash','reviewId',r->'reviewId') from jsonb_array_elements(coalesce(new.source->'sourceReceipts','[]'))r union select jsonb_build_object('kind','baseline','period',r->'period','sourceHash',r->'sourceHash','contentHash',r->'contentHash','versionId',r->'versionId') from jsonb_array_elements(coalesce(new.source->'baseline'->'periodVersions','[]'))r) q));
 if new.payload->>'scenarioPurpose'='str_overlay' then
 select * into parent from public.atlas_reforecast_publications where publication_id::text=new.payload->'parentPublication'->>'publicationId' and community_id=new.community_id;
 if parent.publication_id is not null then
 new.snapshot:=jsonb_set(new.snapshot,'{identity,sourceHashes}',coalesce(parent.snapshot->'identity'->'sourceHashes','[]')||coalesce(new.snapshot->'identity'->'sourceHashes','[]'));
 for line in select value from jsonb_array_elements(new.snapshot->'lines') loop
 select value into original from jsonb_array_elements(parent.snapshot->'lines')v where v->>'period'=line->>'period' and v->>'accountCode'=line->>'accountCode';
 if original is null and not(saved and line->'originalBudget'='null'::jsonb and line->'actual'='null'::jsonb and exists(select 1 from jsonb_array_elements(receipt->'review'->'cells')c where c->>'period'=line->>'period' and c->>'accountCode'=line->>'accountCode' and c->>'parentDisposition'='no_parent_publication_row' and c->'combinedForecast'=line->'forecast')) or original is not null and (line->'originalBudget' is distinct from original->'originalBudget' or line->'actual' is distinct from original->'actual' or line->'closeVersionId' is distinct from original->'closeVersionId'
 or (line->'forecast' is distinct from original->'forecast' and not exists(select 1 from jsonb_array_elements(coalesce(new.payload->'overrides','[]'))o where o->>'period'=line->>'period' and o->>'accountCode'=line->>'accountCode' and o->'source'->>'kind'='str_schedule'))) then
 issues:=issues||jsonb_build_array(jsonb_build_object('code','str_ancestor_changed','severity','blocking','message','The overlay must preserve every Conventional GL, original budget and actual outside its STR contribution.'));end if;
 end loop;
 if jsonb_array_length(new.snapshot->'lines')<>jsonb_array_length(parent.snapshot->'lines')+(case when saved then (select count(*) from jsonb_array_elements(receipt->'review'->'cells')c where c->>'parentDisposition'='no_parent_publication_row') else 0 end) or exists(select 1 from jsonb_array_elements(new.snapshot->'lines')v group by v->>'period',v->>'accountCode' having count(*)<>1) then issues:=issues||jsonb_build_array(jsonb_build_object('code','str_lineage_coverage','severity','blocking','message','Overlay GL coverage must equal its Conventional ancestor.'));end if;
 select coalesce(jsonb_agg(jsonb_build_object('period',v->>'period','accountCode',v->>'accountCode','conventional',b->'forecast','strContribution',case when b is null and saved then (v->>'forecast')::numeric else (v->>'forecast')::numeric-(b->>'forecast')::numeric end,'parentDisposition',case when b is null then 'no_parent_publication_row' else 'existing_parent_cell' end,'withStr',v->'forecast') order by v->>'period',v->>'accountCode'),'[]') into bridge from jsonb_array_elements(new.snapshot->'lines')v left join jsonb_array_elements(parent.snapshot->'lines')b on b->>'period'=v->>'period' and b->>'accountCode'=v->>'accountCode';
 new.snapshot:=new.snapshot||jsonb_build_object('strBridge',bridge);if saved then new.snapshot:=new.snapshot||jsonb_build_object('savedStrProgramme',jsonb_build_object('sourceReceiptId',receipt->'source_receipt_id','sourceHash',receipt->'source_hash','sourceFingerprint',receipt->'source_fingerprint','contentHash',receipt->'content_hash','registryExtension',receipt->'registry_extension','programmeId',receipt->'review'->'programmeId','groupAllocations',receipt->'review'->'groupAllocations','unitRamp',receipt->'review'->'unitRamp','cells',receipt->'review'->'cells','rollupReview',receipt->'review'->'rollupReview','sourceRollupDifferences',receipt->'source_rollup_differences'));new.snapshot:=jsonb_set(new.snapshot,'{identity,sourceHashes}',coalesce(new.snapshot->'identity'->'sourceHashes','[]')||jsonb_build_array(jsonb_build_object('kind','saved_json_monthly_programme','sourceReceiptId',receipt->'source_receipt_id','sourceHash',receipt->'source_hash','contentHash',receipt->'content_hash')));end if;
 end if;
 new.snapshot:=jsonb_set(new.snapshot,'{identity}',(new.snapshot->'identity')||jsonb_build_object('scenarioPurpose','str_overlay','parentPublication',jsonb_build_object('publicationId',parent.publication_id,'revisionId',parent.revision_id,'contentHash',parent.snapshot->>'fingerprint','communityId',parent.community_id,'periods',parent.periods,'originalBudgetVersionIds',new.payload->'baselineVersionIds')));
 end if;
 new.snapshot:=jsonb_set(new.snapshot,'{diagnostics}',coalesce(new.snapshot->'diagnostics','[]')||issues);
 select count(*) into blockers from jsonb_array_elements(new.snapshot->'diagnostics')d where d->>'severity' in ('error','blocking');
 new.snapshot:=jsonb_set(new.snapshot,'{completeness,blockerCount}',to_jsonb(blockers));
 if blockers>0 and new.action in ('ready','submit','approve','lock') then raise exception 'Resolve RISE overlay ancestry, reviewed source, roster, rates, signed fees and protected GL blockers before approval';end if;
 if blockers>0 then new.snapshot:=jsonb_set(new.snapshot,'{status}','"action_required"');if new.action='reconcile' then new.status:='working_draft';end if;end if;
 new.snapshot:=new.snapshot||jsonb_build_object('fingerprint',encode(sha256(convert_to((new.snapshot-'fingerprint')::text,'UTF8')),'hex'));return new;
end;$$;

revoke all on function atlas_private.reforecast_overlay_snapshot_guard() from public,anon,authenticated;

alter function atlas_private.reforecast_report_snapshot(jsonb) rename to reforecast_report_snapshot_before_saved_str;
create function atlas_private.reforecast_report_snapshot(input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;programme jsonb;monthly jsonb;
begin
 result:=atlas_private.reforecast_report_snapshot_before_saved_str(input);programme:=input->'savedStrProgramme';
 if programme is null then return result;end if;
 result:=(result-'fingerprint')||jsonb_build_object('savedStrProgramme',atlas_private.reforecast_report_fields(programme,array['sourceReceiptId','sourceHash','sourceFingerprint','contentHash','programmeId'])||jsonb_build_object('registryExtension',atlas_private.reforecast_report_fields(programme->'registryExtension',array['kind','parentRegistryVersion','parentRegistryHash','registryVersion','registryHash','addedAccountCodes']))||jsonb_build_object('sourceRollupDifferences',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(d,array['year','metric','savedProgrammeTotal','savedMonthlyGLTotal','difference','authority'])),'[]') from jsonb_array_elements(coalesce(programme->'sourceRollupDifferences','[]'))d),'rollupReview',atlas_private.reforecast_report_fields(programme->'rollupReview',array['confirmed','sourceHash','authority','reason']),'unitRamp',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','units'])),'[]') from jsonb_array_elements(coalesce(programme->'unitRamp','[]'))v),'groupAllocationCount',jsonb_array_length(coalesce(programme->'groupAllocations','[]')),'allocatedUnits',(select sum((v->>'units')::numeric) from jsonb_array_elements(coalesce(programme->'groupAllocations','[]'))v)));
 result:=result||jsonb_build_object('strBridge',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['period','accountCode','conventional','strContribution','withStr','parentDisposition']) order by v->>'period',v->>'accountCode'),'[]') from jsonb_array_elements(coalesce(input->'strBridge','[]'))v),'strSchedules',(select coalesce(jsonb_agg(atlas_private.reforecast_report_fields(v,array['streamId','period','availableUnits','sourceKind','sourceReceiptId','sourceHash','incomeBasis','application','grossIncome','netIncome','capital','status']) order by v->>'period'),'[]') from jsonb_array_elements(coalesce(input->'strSchedules','[]'))v));
 result:=jsonb_set(result,'{lines}',(select jsonb_agg(case when original->'baselineDisposition' is not null then line||jsonb_build_object('baselineDisposition',line->'baselineDisposition'||atlas_private.reforecast_report_fields(original->'baselineDisposition',array['parentDisposition','sourceReceiptId'])) else line end order by ordinal) from jsonb_array_elements(result->'lines') with ordinality q(line,ordinal) join lateral (select value original from jsonb_array_elements(input->'lines') where value->>'period'=line->>'period' and value->>'accountCode'=line->>'accountCode') v on true));
 return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end;$$;
revoke all on function atlas_private.reforecast_report_snapshot_before_saved_str(jsonb),atlas_private.reforecast_report_snapshot(jsonb) from public,anon,authenticated;
commit;
