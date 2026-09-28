const {PGlite}=require(process.env.ATLAS_PGLITE||'@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const wire=value=>JSON.parse(JSON.stringify(value));
(async()=>{
const db=new PGlite();
const ids=['10000000-0000-0000-0000-000000000043','20000000-0000-0000-0000-000000000097'];
const actors=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
create table atlas_user_profiles(user_id uuid,role text,status text,allowed_community_ids uuid[],locked_tab_ids text[],locked_page_keys text[]);
create table atlas_communities(community_id uuid primary key,display_name text,canonical_name text,status text,deleted_at timestamptz);
create table atlas_community_aliases(community_id uuid,alias text,active boolean);
create function atlas_can_access_community(id uuid) returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from atlas_user_profiles where user_id=auth.uid() and status='active' and id=any(allowed_community_ids)) $$;
create table finance_fixture(community_id uuid,period_key text,summary jsonb,primary key(community_id,period_key));`);
for(const [i,cid]of ids.entries())await db.query("insert into atlas_communities values($1,$2,$2,'active',null)",[cid,['Arbitrary Meadow','Example Harbor'][i]]);
for(const [i,actor]of actors.entries()){
 await db.query('insert into auth.users values($1)',[actor]);
 await db.query("insert into atlas_user_profiles values($1,'community_manager','active',$2,'{}','{}')",[actor,i<2?ids:[]]);
}
await db.exec(fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/centralization/community-command.sql'),'utf8'));
await db.exec(`create function public.atlas_read_finance(p_community_ids uuid[],p_periods text[]) returns table(community_id uuid,period_key text,fiscal_year integer,publication_id uuid,summary jsonb) language sql stable security definer set search_path='' as $$ select f.community_id,f.period_key,left(f.period_key,4)::int,null::uuid,f.summary from public.finance_fixture f where f.community_id=any(p_community_ids) and f.period_key=any(p_periods) and atlas_private.command_access(f.community_id) $$;
create function public.atlas_read_active_reforecast(uuid[],text[]) returns jsonb language sql as $$ select '[]'::jsonb $$;
create function atlas_private.community_goal_for_period(uuid,text) returns jsonb language sql as $$ select null::jsonb $$;`);
await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260928213956_community_plan_governed_economic_occupancy.sql'),'utf8'));
const signIn=async(index=0,role=true)=>db.exec(`reset role;set request.jwt.claim.sub='${actors[index]}';${role?'set role authenticated;':''}`);
const close=(cid,period,nri=750,gpr=1000)=>({communityId:cid,period,actualCloseVersion:'version-'+period,periodState:'locked',close:{community_id:cid,period_key:period,version_id:'version-'+period,status:'closed',coverage:'full_month',metrics:{netRentalIncome:nri,grossPotentialRent:gpr},source_file:'governed-'+period+'.xlsx',source_hash:'h-'+period,approved_by:actors[0],approved_at:period+'-28T12:00:00Z'}});
const fixture=async(cid,period,envelope)=>{await db.exec('reset role');await db.query('insert into finance_fixture values($1,$2,$3::jsonb) on conflict(community_id,period_key) do update set summary=excluded.summary',[cid,period,JSON.stringify(envelope)]);};
const clear=()=>db.exec('reset role;delete from finance_fixture');
const resolve=async(cid,period,current='2026-09')=>{await signIn(0,false);return(await db.query('select atlas_private.community_closed_economic_occupancy($1,$2,$3) value',[cid,period,current])).rows[0].value;};
for(const cid of ids){
 await clear();await fixture(cid,'2026-08',close(cid,'2026-08'));await fixture(cid,'2026-09',close(cid,'2026-09',990));
 for(const selected of ['2026-09','2027-03']){const actual=await resolve(cid,selected);assert.equal(actual.displayedClosePeriod,'2026-08');assert.equal(actual.closedPct,75);assert.equal(actual.state,'open_month_latest_close');assert.equal(actual.closeVersionId,'version-2026-08');}
 assert.equal((await resolve(cid,'2026-08')).state,'closed_exact');
 await clear();await fixture(cid,'2026-07',close(cid,'2026-07'));
 assert.equal((await resolve(cid,'2026-08')).state,'missing_historical_close','historical August never uses July');
 await clear();await fixture(cid,'2025-12',close(cid,'2025-12'));let actual=await resolve(cid,'2026-01','2026-01');assert.equal(actual.displayedClosePeriod,'2025-12');assert.equal(actual.closedPct,75);
 await clear();assert.equal((await resolve(cid,'2026-09')).state,'open_month_no_prior_close');
 await fixture(cid,'2025-08',close(cid,'2025-08'));assert.equal((await resolve(cid,'2026-09')).closedPct,null,'prior window is bounded to 12 months');
 for(const [label,mutate]of [
  ['MTD',v=>v.close.coverage='month_to_date'],['unapproved',v=>v.close.approved_by=null],['no approval time',v=>v.close.approved_at=''],['no source',v=>v.close.source_file=' '],
  ['reopened',v=>v.periodState='reopened'],['superseded',v=>v.periodState='superseded'],['superseded version',v=>v.actualCloseVersion='different-version'],['wrong envelope period',v=>v.period='2026-07'],['wrong close period',v=>v.close.period_key='2026-07'],['wrong community',v=>v.close.community_id='other'],['zero GPR',v=>v.close.metrics.grossPotentialRent=0],['missing NRI',v=>v.close.metrics.netRentalIncome=null],['boolean NRI',v=>v.close.metrics.netRentalIncome=false],['blank NRI',v=>v.close.metrics.netRentalIncome=' '],['infinite NRI',v=>v.close.metrics.netRentalIncome='Infinity']]){
  await clear();const v=close(cid,'2026-08');mutate(v);await fixture(cid,'2026-08',v);actual=await resolve(cid,'2026-08');assert.equal(actual.closedPct,null,label);if(['reopened','superseded','superseded version'].includes(label))assert.equal(actual.state,'reopened_or_superseded',label);
 }
 await clear();await fixture(cid,'2026-08',close(cid,'2026-08',1,3));assert.equal((await resolve(cid,'2026-08')).closedPct,1/3*100,'raw exported percentage matches the browser formula before display rounding');
 for(const nri of [0,-125,'-125']){await clear();await fixture(cid,'2026-08',close(cid,'2026-08',nri));actual=await resolve(cid,'2026-08');assert.equal(actual.closedPct,Number(nri)/10);assert.equal(actual.state,'closed_exact');}
}
const {reportHtml,closedEconomicOccupancyRows}=await import('../docs/portfolio-operations-dashboard/features/community-plan-report.mjs');
const current=(await db.query("select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM') period")).rows[0].period;
const prior=(await db.query("select to_char(($1||'-01')::date-interval '1 month','YYYY-MM') period",[current])).rows[0].period;
await clear();const reports=[];
for(const [i,cid]of ids.entries()){
 await fixture(cid,prior,close(cid,prior,i?-125:750));await signIn();
 const plan=(await db.query('select * from atlas_save_community_plan($1,$2,0,$3::jsonb)',[cid,current,JSON.stringify({tasks:[],stage:'Active'})])).rows[0];
 const occupancy={communityId:cid,period:current,occupiedUnits:80,rentableUnits:100,source:'operating counts',sourceTimestamp:'2026-09-01',revisionKey:'r1',closedPct:99,closedEconomicOccupancy:{closedPct:99},mtdOperatingProxy:99};
 const generate=async()=>wire((await db.query('select * from atlas_generate_community_plan_report($1,1,$2,$3::jsonb)',[plan.plan_id,'Retained source',JSON.stringify(occupancy)])).rows[0]);
 const report=await generate();reports.push(report);assert.equal(report.snapshot.reportSchemaVersion,6);assert.equal(report.snapshot.closedEconomicOccupancy.closedPct,i?-12.5:75);assert.equal(report.snapshot.occupancy.closedPct,undefined,'client cannot supply economic occupancy');assert.equal(report.snapshot.closedEconomicOccupancy.mtdOperatingProxy,undefined);
 await signIn(1);assert.equal((await generate()).report_id,report.report_id,'second authorized session deduplicates same immutable source');
 const reread=wire((await db.query('select * from atlas_community_plan_reports where report_id=$1',[report.report_id])).rows[0]);assert.deepEqual(reread.snapshot,report.snapshot);assert.equal(reportHtml(reread),reportHtml(report),'screen, saved HTML and print/PDF consume same retained report');
 const html=reportHtml(report);assert(html.includes((i?-12.5:75).toFixed(1)+'%'));for(const text of [prior,current,'version-'+prior,'governed-'+prior+'.xlsx'])assert(html.includes(text));
 const rows=closedEconomicOccupancyRows(reread),workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Closed economic occupancy');const loaded=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));const reloaded=XLSX.utils.sheet_to_json(loaded.Sheets['Closed economic occupancy'],{defval:null});assert.deepEqual(reloaded,rows,'actual XLSX serialization retains same close version, period, percentage and approval evidence');
 const replacement=close(cid,prior,500);replacement.actualCloseVersion='replacement';replacement.close.version_id='replacement';await fixture(cid,prior,replacement);await signIn(1);
 assert.equal((await db.query('select snapshot from atlas_community_plan_reports where report_id=$1',[report.report_id])).rows[0].snapshot.closedEconomicOccupancy.closedPct,i?-12.5:75,'existing report remains immutable after canonical close changes');
 const newer=await generate();assert.notEqual(newer.report_id,report.report_id);assert.equal(newer.snapshot.closedEconomicOccupancy.closeVersionId,'replacement');assert.equal(newer.snapshot.closedEconomicOccupancy.closedPct,50);
 await assert.rejects(()=>db.query("update atlas_community_plan_reports set snapshot='{}'"),/permission denied/);
 await assert.rejects(()=>db.query('select atlas_private.community_closed_economic_occupancy($1,$2)',[cid,current]),/permission denied/);
 await assert.rejects(()=>db.query('select * from atlas_generate_community_plan_report($1,0)',[plan.plan_id]),/another session/);
 await signIn(2);assert.equal((await db.query('select * from atlas_community_plan_reports')).rows.length,0);await assert.rejects(()=>generate(),/access denied/);
}
assert.deepEqual(reports.map(r=>closedEconomicOccupancyRows(r)[0].Closed_economic_occupancy_pct),[75,-12.5],'mixed-community outputs preserve each community value');
await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select * from atlas_generate_community_plan_report($1,1)',[reports[0].plan_id]),/permission denied/);
await db.close();console.log('PASS governed report resolver, arbitrary communities, year rollover, unavailable/reopened rejection, signed/zero NRI, canonical server-only snapshot, RLS, reload/second-session immutable reuse and XLSX roundtrip parity');
})().catch(e=>{console.error(e);process.exitCode=1;});
