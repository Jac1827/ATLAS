const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');const {fixture}=require('./reforecast-fixture.cjs');
(async()=>{
 const {db,A,B,signIn}=await fixture();await db.exec('reset role');
 await db.exec(`create table atlas_bonus_periods(bonus_period_id uuid primary key,period_key text,year int,quarter text,start_date date,end_date date,status text);
 create table atlas_bonus_calculation_runs(bonus_calculation_run_id uuid primary key,bonus_period_id uuid,community_id uuid,status text,calculation_hash text,inputs jsonb,exceptions jsonb,calculated_at timestamptz default now(),approved_by uuid,approved_at timestamptz,total_payout numeric,deleted_at timestamptz);
 create table atlas_bonus_calculation_lines(bonus_line_id uuid primary key default gen_random_uuid(),bonus_calculation_run_id uuid,employee_id uuid,assignment_id uuid,incentive_plan_id uuid,metric_key text,metric_source_table text,metric_source_id uuid,payout_amount numeric,line_payload jsonb,deleted_at timestamptz);
 create table atlas_employee_assignments(assignment_id uuid primary key,community_id uuid,employee_id uuid,deleted_at timestamptz);`);
 const period=randomUUID(),run=randomUUID(),draft=randomUUID(),employee=randomUUID(),assignment=randomUUID(),plan=randomUUID();
 await db.query("insert into atlas_bonus_periods values($1,'2026-Q1',2026,'Q1','2026-01-01','2026-03-31','open')",[period]);
 await db.query('insert into atlas_employee_assignments values($1,$2,$3,null)',[assignment,A,employee]);
 const line={employee_id:employee,assignment_id:assignment,incentive_plan_id:plan,metric_key:'total',payout_amount:123,secureCalculationDetail:{salary:987654},retainedRow:{employee:{salary:987654,name:'Synthetic'},employeeId:employee,assignmentId:assignment,incentivePlanId:plan,totalPayout:123,periodKey:'2026-Q1'}};const inputs={lines:[line],totalPayout:123};
 for(const [id,status]of [[run,'locked'],[draft,'draft']]){await db.query("insert into atlas_bonus_calculation_runs(bonus_calculation_run_id,bonus_period_id,community_id,status,calculation_hash,inputs,exceptions,total_payout) values($1,$2,$3,$4,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),$5,'[]',123)",[id,period,A,status,JSON.stringify(inputs)]);await db.query('insert into atlas_bonus_calculation_lines(bonus_calculation_run_id,employee_id,assignment_id,incentive_plan_id,metric_key,payout_amount,line_payload) values($1,$2,$3,$4,\'total\',123,$5)',[id,employee,assignment,plan,JSON.stringify(line)]);}
 await db.exec(fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/centralization/reforecast-builder.sql'),'utf8'));
 // Preserve the existing RPC's atomic run-then-lines creation semantics.
 const newPeriod=randomUUID(),newRun=randomUUID();await db.exec('begin');
 await db.query("insert into atlas_bonus_periods values($1,'2026-Q2',2026,'Q2','2026-04-01','2026-06-30','open')",[newPeriod]);
 await db.query("insert into atlas_bonus_calculation_runs(bonus_calculation_run_id,bonus_period_id,community_id,status,calculation_hash,inputs,exceptions,total_payout) values($1,$2,$3,'locked',encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'),$4,'[]',123)",[newRun,newPeriod,A,JSON.stringify(inputs)]);
 await db.query('insert into atlas_bonus_calculation_lines(bonus_calculation_run_id,employee_id,assignment_id,incentive_plan_id,metric_key,payout_amount,line_payload) values($1,$2,$3,$4,\'total\',123,$5)',[newRun,employee,assignment,plan,JSON.stringify(line)]);await db.exec('commit');
 const receipts=async()=>(await db.query("select atlas_read_bonus_receipts('2026-Q1') result")).rows[0].result;
 await signIn(1);let result=await receipts();assert.equal(result.length,1);assert.equal(result[0].verified,true);assert.equal(result[0].lines[0].payout_amount,123);assert(!JSON.stringify(result).includes('987654'));assert.equal(result[0].run.inputs,undefined);assert.equal(result[0].lines[0].line_payload.secureCalculationDetail,undefined);
 await signIn(2);assert.deepEqual(await receipts(),result);await signIn(4);assert.deepEqual(await receipts(),[]);
 await db.exec('reset role');
 await assert.rejects(()=>db.query('update atlas_bonus_calculation_runs set total_payout=999 where bonus_calculation_run_id=$1',[run]),/immutable/);
 await assert.rejects(()=>db.query('delete from atlas_bonus_calculation_lines where bonus_calculation_run_id=$1',[run]),/immutable/);
 await assert.rejects(()=>db.query('insert into atlas_bonus_calculation_lines(bonus_calculation_run_id,payout_amount) values($1,9)',[run]),/immutable/);
 await assert.rejects(()=>db.query('update atlas_bonus_calculation_lines set bonus_calculation_run_id=$1 where bonus_calculation_run_id=$2',[run,draft]),/retained/);
 await assert.rejects(()=>db.query("update atlas_bonus_periods set start_date='2025-12-01' where bonus_period_id=$1",[period]),/identity and dates/);
 // Hash and exact line mismatches fail closed on mutable approved evidence.
 await db.query("update atlas_bonus_calculation_runs set status='approved' where bonus_calculation_run_id=$1",[draft]);await db.query('update atlas_bonus_calculation_lines set payout_amount=999 where bonus_calculation_run_id=$1',[draft]);await signIn(1);result=await receipts();assert.equal(result.find(r=>r.run.bonus_calculation_run_id===draft).verified,false);
 await db.exec('reset role');await db.query("update atlas_bonus_calculation_runs set exceptions='[{\"code\":\"baseline_stale\"}]' where bonus_calculation_run_id=$1",[draft]);
 await db.query("update atlas_bonus_periods set status='paid' where bonus_period_id=$1",[period]);
 await assert.rejects(()=>db.query("update atlas_bonus_periods set status='open' where bonus_period_id=$1",[period]),/cannot be reopened/);
 await assert.rejects(()=>db.query("update atlas_bonus_calculation_runs set status='draft' where bonus_calculation_run_id=$1",[draft]),/immutable/);
 await assert.rejects(()=>db.query("insert into atlas_bonus_calculation_runs(bonus_calculation_run_id,bonus_period_id,status) values($1,$2,'draft')",[randomUUID(),period]),/immutable/);
 await signIn(1);assert.equal((await receipts()).find(r=>r.run.bonus_calculation_run_id===run).verified,true);
 await signIn(4);const hidden=await receipts();assert.equal(hidden.length,1);assert.equal(hidden[0].period.status,'paid');assert.equal(hidden[0].run,null);assert.equal(hidden[0].reason,'retained_evidence_unavailable');assert.equal(hidden[0].verified,false);
 await db.exec("reset role;update atlas_user_profiles set locked_page_keys='{bonus}' where role='admin'");await signIn(1);await assert.rejects(()=>receipts(),/access denied/);await db.exec('reset role;set role anon');await assert.rejects(()=>receipts(),/permission denied/);
 await db.close();console.log('PASS exact scoped Bonus receipts, paid/locked mutation and insertion guards, period identity retention, stale/mismatched readback, denied role/tab');
})().catch(e=>{console.error(e);process.exitCode=1});
