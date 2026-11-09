// RISE company budget against PGlite: visibility, VP build → executive approval, the
// approver ≠ preparer rule, VP edits after approval, monthly actuals and the ledger.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{fixture}=require('./reforecast-fixture.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 const {db,signIn}=await fixture();
 await db.exec('reset role');
 await db.exec(`alter table auth.users add column if not exists email text;
  create table if not exists atlas_private.budget_vp_designations(user_id uuid primary key,assigned_by uuid,assigned_at timestamptz default now(),reason text);
  create or replace function atlas_private.is_budget_vp(person uuid) returns boolean language sql stable security definer set search_path='' as $$
   select exists(select 1 from public.atlas_user_profiles p where p.user_id=person and p.status='active' and (p.role in ('executive','vp','vice_president') or exists(select 1 from atlas_private.budget_vp_designations d where d.user_id=p.user_id)));$$;
  grant execute on function atlas_private.is_budget_vp(uuid) to authenticated;`);
 await db.exec("insert into auth.users values('00000000-0000-0000-0000-000000000006','ceo@example.com'),('00000000-0000-0000-0000-000000000007','vp2@example.com')");
 await db.exec("update auth.users set email='vp@example.com' where id='00000000-0000-0000-0000-000000000005';update auth.users set email='admin@example.com' where id='00000000-0000-0000-0000-000000000001'");
 await db.exec("insert into atlas_user_profiles values('00000000-0000-0000-0000-000000000006','executive','active','{}','{}','{}'),('00000000-0000-0000-0000-000000000007','vp','active','{}','{}','{}')");
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261106182859_rise_company_budget.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261109205119_company_budget_review_evidence.sql'),'utf8'));
 const VP=5,CEO=6,VP2=7,CM=4,ADMIN=1;
 const call=async(name,args)=>(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result;
 const id=randomUUID(),payload={model:{kind:'company',fiscalYear:2027,lines:[]}},meta={fiscalYear:2027,planType:'budget',name:'RISE Residential FY2027 Budget'};

 // Only the VP builds; others are refused and see nothing.
 await signIn(CM);
 await assert.rejects(()=>call('atlas_company_budget_save',[id,0,randomUUID(),meta,payload,null]),/Only the VP/);
 assert.equal(await call('atlas_company_budget_my_role',[]),null);
 await signIn(VP);
 assert.equal(await call('atlas_company_budget_my_role',[]),'builder');
 let b=await call('atlas_company_budget_save',[id,0,randomUUID(),meta,payload,null]);assert.equal(b.status,'draft');
 const rq=randomUUID();b=await call('atlas_company_budget_save',[id,1,rq,meta,payload,null]);assert.equal(b.revision,2);
 assert.equal((await call('atlas_company_budget_save',[id,2,rq,meta,payload,null])).revision,2,'a replayed save is idempotent');
 await assert.rejects(()=>call('atlas_company_budget_save',[id,1,randomUUID(),meta,payload,null]),/changed in another session/);
 await signIn(CM);assert.equal((await db.query('select count(*)::int n from atlas_company_budgets')).rows[0].n,0,'site staff cannot read the company budget');
 await signIn(ADMIN);assert.equal((await db.query('select count(*)::int n from atlas_company_budgets')).rows[0].n,0,'an admin without a company-budget role cannot read it');

 // Approver designation: by the VP or an admin, never oneself.
 await signIn(VP);
 await assert.rejects(()=>call('atlas_company_budget_set_approver',['vp@example.com',true]),/cannot designate yourself/);
 await assert.rejects(()=>call('atlas_company_budget_set_approver',['nobody@example.com',true]),/No ATLAS account/);
 await call('atlas_company_budget_set_approver',['ceo@example.com',true]);
 await signIn(CEO);assert.equal(await call('atlas_company_budget_my_role',[]),'approver');
 assert.equal((await db.query('select count(*)::int n from atlas_company_budgets')).rows[0].n,1,'the approver can read it');
 await assert.rejects(()=>call('atlas_company_budget_save',[id,2,randomUUID(),meta,payload,null]),/Only the VP/,'the approver does not edit');
 await assert.rejects(()=>call('atlas_company_budget_transition',[id,2,randomUUID(),'approve',null,{summary:{}}]),/Nothing to approve/);

 // VP submits; approver returns with a reason, VP resubmits, approver approves and locks.
 await signIn(VP);b=await call('atlas_company_budget_transition',[id,2,randomUUID(),'submit',null,{}]);assert.equal(b.status,'executive_review');
 await assert.rejects(()=>call('atlas_company_budget_save',[id,3,randomUUID(),meta,payload,null]),/cannot be edited/);
 await assert.rejects(()=>call('atlas_company_budget_transition',[id,3,randomUUID(),'approve',null,{summary:{}}]),/Only the executive approver/);
 await signIn(CEO);
 await assert.rejects(()=>call('atlas_company_budget_transition',[id,3,randomUUID(),'return','',{}]),/reason is required/);
 b=await call('atlas_company_budget_transition',[id,3,randomUUID(),'return','Split software by vendor',{}]);assert.equal(b.status,'draft');
 await signIn(VP);b=await call('atlas_company_budget_save',[id,4,randomUUID(),meta,payload,'Software split']);b=await call('atlas_company_budget_transition',[id,5,randomUUID(),'submit',null,{}]);
 await signIn(CEO);
 await assert.rejects(()=>call('atlas_company_budget_transition',[id,6,randomUUID(),'approve',null,{}]),/summary is required/);
 b=await call('atlas_company_budget_transition',[id,6,randomUUID(),'approve',null,{summary:{totals:{noi:-1}}}]);
 assert.equal(b.status,'approved_locked');assert.equal(b.approved_by,'00000000-0000-0000-0000-000000000006');assert.deepEqual(b.locked_summary,{totals:{noi:-1}});

 // The VP edits the locked budget with a reason; the approver re-approves the revision.
 await signIn(VP);
 await assert.rejects(()=>call('atlas_company_budget_save',[id,7,randomUUID(),meta,payload,null]),/reason is required/);
 b=await call('atlas_company_budget_save',[id,7,randomUUID(),meta,payload,'Insurance renewal received']);assert.equal(b.revised_after_approval,true);assert.equal(b.status,'approved_locked');
 await signIn(CEO);b=await call('atlas_company_budget_transition',[id,8,randomUUID(),'approve',null,{summary:{totals:{noi:-2}}}]);assert.equal(b.revised_after_approval,false);
 await assert.rejects(()=>call('atlas_company_budget_transition',[id,9,randomUUID(),'approve',null,{summary:{}}]),/Nothing to approve/);

 // An approver who also prepared a revision cannot approve it.
 await signIn(VP);await call('atlas_company_budget_set_approver',['vp2@example.com',true]);
 const id2=randomUUID();
 await signIn(VP2);assert.equal(await call('atlas_company_budget_my_role',[]),'approver','an approver designation takes precedence over VP');
 await signIn(VP);await call('atlas_company_budget_save',[id2,0,randomUUID(),{...meta,planType:'reforecast'},payload,null]);await call('atlas_company_budget_transition',[id2,1,randomUUID(),'submit',null,{}]);
 await db.exec('reset role');await db.query("update atlas_company_budgets set submitted_by='00000000-0000-0000-0000-000000000007' where budget_id=$1",[id2]);
 await signIn(VP2);await assert.rejects(()=>call('atlas_company_budget_transition',[id2,2,randomUUID(),'approve',null,{summary:{}}]),/different person/);

 // Monthly actuals: saved, re-saved with comments, reviewed; only the VP writes.
 await signIn(VP);
 const month={fiscalYear:2026,period:'2026-08',ytdFrom:'2026-01',ytdTo:'2026-08',monthsYtd:8,actuals:{'6237':4000},entrataBudget:{'6237':2000},ytdActual:{'6237':18000},ytdBudget:{'6237':16000},comments:{'6237':'Annual invoice'}};
 let m=await call('atlas_company_budget_month_save',['2026-08',0,randomUUID(),'save',month,{file:'aug.xlsx'},null]);assert.equal(m.status,'uploaded');assert.equal(m.fiscal_year,2026);
 m=await call('atlas_company_budget_month_save',['2026-08',1,randomUUID(),'review',month,{},'Month reviewed']);assert.equal(m.status,'reviewed');assert.equal(m.source.file,'aug.xlsx','source kept when not replaced');
 await assert.rejects(()=>call('atlas_company_budget_month_save',['2026-08',1,randomUUID(),'save',month,{},null]),/changed in another session/);
 await assert.rejects(()=>call('atlas_company_budget_month_save',['2026-08',2,randomUUID(),'save',{fiscalYear:2026},{},null]),/actuals are required/);
 await signIn(CEO);await assert.rejects(()=>call('atlas_company_budget_month_save',['2026-09',0,randomUUID(),'save',month,{},null]),/Only the VP/);
 assert.equal((await db.query('select count(*)::int n from atlas_company_budget_months')).rows[0].n,1,'the approver reads tracking');

 // Review is enforced transactionally, including direct RPC callers without the UI.
 await signIn(VP);
 const report=(period,a,b,ya=a,yb=b,comments={})=>({period,actuals:{'6237':a},entrataBudget:{'6237':b},ytdActual:{'6237':ya},ytdBudget:{'6237':yb},ytdFrom:period.slice(0,4)+'-01',ytdTo:period,monthsYtd:Number(period.slice(5)),comments});
 const review=(period,payload,revision=0)=>call('atlas_company_budget_month_save',[period,revision,randomUUID(),'review',payload,{},'Reviewed']);
 await assert.rejects(()=>review('2029-01',report('2029-01',4000,2000)),/variance comment/);
 assert.equal((await db.query("select count(*)::int n from atlas_company_budget_months where period='2029-01'")).rows[0].n,0,'failed review creates no month');
 const uploaded=await call('atlas_company_budget_month_save',['2029-01',0,randomUUID(),'save',report('2029-01',4000,2000),{},null]);
 await assert.rejects(()=>review('2029-01',report('2029-01',4000,2000,4000,2000,{'6237':' \t\n'}),uploaded.revision),/variance comment/);
 assert.equal((await db.query("select status,revision from atlas_company_budget_months where period='2029-01'")).rows[0].status,'uploaded');
 assert.equal((await db.query("select count(*)::int n from atlas_company_budget_events where period='2029-01'")).rows[0].n,1,'rejected review leaves no ledger event');
 const reviewed=await review('2029-01',report('2029-01',4000,2000,4000,2000,{'6237':'Annual invoice'}),uploaded.revision);assert.equal(reviewed.status,'reviewed');
 await assert.rejects(()=>review('2029-02',report('2029-02',2000,2000)),/variance comment/,'YTD-only variance requires a comment using stored prior month actuals');
 await assert.rejects(()=>review('2030-03',report('2030-03',2000,2000,10000,6000)),/variance comment/,'full report YTD fills missing uploads and enforces its variance');
 await assert.rejects(()=>review('2030-03',{...report('2030-03',2000,2000,6000,6000),ytdFrom:'2030-02',monthsYtd:2}),/Complete month and year-to-date evidence/,'partial YTD is not a full fiscal YTD');
 await assert.rejects(()=>review('2030-03',report('2030-03',null,2000,6000,6000)),/Complete month and year-to-date evidence/,'blank current actual is never zero');
 await assert.rejects(()=>review('2030-03',{...report('2030-03',0,2000,6000,6000),actuals:{}}),/Complete month and year-to-date evidence/,'absent GL cannot bypass review');
 assert.equal((await review('2031-01',report('2031-01',0,0))).status,'reviewed','explicit zeros are complete evidence');
 assert.equal((await review('2032-01',report('2032-01',3000,2000))).status,'reviewed','dollar threshold is strictly greater than 1000');
 assert.equal((await review('2033-01',report('2033-01',22000,20000))).status,'reviewed','percentage threshold is strictly greater than ten percent');
 await assert.rejects(()=>review('2034-01',report('2034-01',2000,0)),/variance comment/,'a zero budget still needs a comment for material activity');
 const nullSaved=await call('atlas_company_budget_month_save',['2035-01',0,randomUUID(),'save',report('2035-01',null,0,null,0),{},null]);
 assert.equal(nullSaved.payload.actuals['6237'],null);assert.equal(nullSaved.payload.entrataBudget['6237'],0);
 assert.equal((await db.query("select payload from atlas_company_budget_months where period='2035-01'")).rows[0].payload.actuals['6237'],null,'reload preserves null evidence');
 await assert.rejects(()=>db.query("select atlas_private.company_budget_validate_month_review('2031-01','{}')"),/permission denied/,'private validation helpers are not executable by API roles');

 // Approved company amounts take precedence over a contradictory uploaded Entrata budget.
 await db.exec('reset role');
 const approvedId=randomUUID(),approvedPeriods=Array.from({length:12},(_,i)=>`2036-${String(i+1).padStart(2,'0')}`);
 await db.query("insert into atlas_company_budgets(budget_id,fiscal_year,plan_type,name,status,payload,locked_summary,approved_at,created_by,updated_by) values($1,2036,'budget','Approved fixture','approved_locked','{}',$2,now(),'00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005')",[approvedId,{periods:approvedPeriods,budgetByGl:{'6237':Array(12).fill(2000)}}]);
 await signIn(VP);
 await assert.rejects(()=>review('2036-01',report('2036-01',4000,4000)),/variance comment/,'server uses approved budget, not the client report baseline');
 assert.equal((await review('2036-01',report('2036-01',4000,4000,4000,4000,{'6237':'Approved budget variance explained'}))).status,'reviewed');
 await assert.rejects(()=>review('2036-02',report('2036-02',2000,2000,2000,2000)),/variance comment/,'approved YTD budget compared with the stored complete YTD actuals');

 // The ledger is complete and immutable.
 await db.exec('reset role');
 const actions=(await db.query('select action from atlas_company_budget_events where budget_id=$1 order by created_at',[id])).rows.map(r=>r.action);
 assert.deepEqual(actions,['create','save','submit','return','save','submit','approve','vp_edit','approve']);
 await assert.rejects(()=>db.query('delete from atlas_company_budget_events'),/immutable/);
 console.log('PASS RISE company budget: VP-only build, approver designation, executive approval with a different approver, VP edits after approval, monthly actuals and immutable ledger');
})().catch(e=>{console.error(e);process.exit(1);});
