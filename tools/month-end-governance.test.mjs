import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {monthEndReviewHtml,readEligibleMonthEndQueue,REOPENED_PERIOD_WARNING} from '../docs/portfolio-operations-dashboard/features/month-end-governance.mjs';
import {parseComparisonSheet,reconcileComparison} from '../docs/portfolio-operations-dashboard/features/financial-package.mjs';
const row=(a,b)=>[a,b,a-b,b?(a-b)/b:null,a,b,a-b,b?(a-b)/b:null,b];
const matrix=[['Budget Comparison - Income Statement'],['Synthetic Student Community'],['Aug 2026'],['Accrual Basis'],[],[null,null,'Aug 2026',null,null,null,'YTD ( Aug 2026 - Aug 2026 )'],['Account','Account Name','Actual','Budget','$ Variance','% Variance','Actual','Budget','$ Variance','% Variance','Annual Budget'],['Income'],['5120','Gross Potential Rent',...row(1000,900)],['','Net Rental Income',...row(1000,900)],['','Total Income',...row(1000,900)],['Expenses'],['6100','Maintenance',...row(100,100)],['6200','GAS',null,null,null,null,null,null,null,null,null],['','Total Expenses',...row(100,100)],['','Net Operating Income',...row(900,800)]];
const cells={C9:{v:1000},C10:{v:1000,f:'C9'},C11:{v:1000,f:'C9'},C13:{v:100},C15:{v:100,f:'SUM(C13:C14)'},C16:{v:900,f:'C11-C15'}};
const parsed=parseComparisonSheet(matrix,'BCR',{cells});const blank=parsed.inventory.find(r=>r.glCode==='6200');assert.equal(blank.disposition,'supporting');assert.equal(blank.actual.value,null);assert(!parsed.rows.some(r=>r.glCode==='6200'));const c=reconcileComparison([parsed]);assert.equal(c.technicalReconciled,true,JSON.stringify(c.exceptions));assert.equal(c.metadata.ytdStart,'2026-08');
const missing=structuredClone(matrix);missing[13][3]=50;const b=reconcileComparison([parseComparisonSheet(missing,'BCR')]);assert(b.exceptions.some(x=>x.code==='missing_amount'),'Nonblank budget with missing actual cannot be converted to zero');
const html=monthEndReviewHtml({periods:['2026-08'],period:'2026-08',calendar:{classification:'Student Housing'},blockers:[],rows:[{glCode:'6100',actual:1000,budget:0,percentageVariance:null,unbudgetedExpense:true,systemNote:'See Accounting for verification. Explanation not required for approval.'}],expenseActual:1000,expenseBudget:0,reforecastRecommended:false});assert(html.includes('Percentage unavailable'));assert(html.includes('Unbudgeted expenses of $500 or more'));assert(html.includes('both tests are exceeded'));assert(html.includes('Category savings do not clear an unbudgeted concern'));assert(html.includes('reclassification review remains advisory'));assert(html.includes('System note:'));assert(!html.includes('Infinity'));assert(REOPENED_PERIOD_WARNING.includes('re-approved and locked'));
// Execute the actual Central array-preserving transport and scalar RPC helper.
// A mock rpc() returning an array concealed the original empty/multiple-row bug.
const centralSource=await fs.readFile(new URL('../docs/portfolio-operations-dashboard/centralization/atlas-central-client.js',import.meta.url),'utf8');
const extract=name=>{const start=centralSource.indexOf('  async function '+name+'('),end=centralSource.indexOf('\n  }',start);assert(start>=0&&end>start);return centralSource.slice(start,end+4);};
const q=[{communityId:'a',recordType:'month_end_actuals',state:'ready_for_review'},{communityId:'b',recordType:'month_end_actuals',state:'ready_for_review'}];
function fixture(rows){
 const state={actor:'reviewer',profile:{user_id:'reviewer',role:'executive',status:'active',allowed_community_ids:['a','b']},config:{supabaseUrl:'https://synthetic.invalid',enabled:true},requests:[],refreshes:0};
 const refreshSession=async()=>{state.refreshes++;await state.onRefresh?.();};
 const context={window:{},DOMException,getSignedInUser:()=>state.actor?{id:state.actor}:null,refreshSession,restUrl:path=>path,request:async(path,options)=>{state.requests.push({path,options});await state.onRead?.();return structuredClone(rows);}};
 vm.createContext(context);vm.runInContext(extract('fetchJson')+'\n'+extract('rpc'),context);
 const central={getSession:()=>state.actor?{user:{id:state.actor}}:null,getStoredProfile:()=>state.profile,getConfig:()=>state.config,refreshSession,fetchJson:context.fetchJson,rpc:context.rpc};
 return {state,central};
}
for(const rows of [[],q.slice(0,1),q]){
 const f=fixture(rows),got=await readEligibleMonthEndQueue(f.central,{communityIds:['a','b'],year:2026});
 assert.deepEqual(got,rows);assert.equal(f.state.refreshes,1);
 assert.equal(f.state.requests[0].path,'/rpc/atlas_month_end_queue');
 assert.equal(f.state.requests[0].options.method,'POST');assert.equal(f.state.requests[0].options.timeoutMs,20000);
 assert.deepEqual(JSON.parse(f.state.requests[0].options.body),{p_community_ids:['a','b'],p_year:2026});
 const scalar=await fixture(rows).central.rpc('atlas_month_end_queue',{});
 assert.deepEqual(scalar,rows[0],'Actual rpc() unwraps a JSON array and must not be used for queue reads');
}
for(const rows of [undefined,null,{},q[0],[null],[{...q[0],communityId:'other'}],[{...q[0],recordType:'budget'}],[{...q[0],state:'approved'}]]){
 await assert.rejects(()=>readEligibleMonthEndQueue(fixture(rows).central,{communityIds:['a','b']}),/scope mismatch/);
}
for(const stage of ['onRefresh','onRead'])for(const change of [f=>f.state.actor=null,f=>f.state.actor='another-user',f=>f.state.profile.role='viewer',f=>f.state.profile.allowed_community_ids=['b'],f=>f.state.config.supabaseUrl='https://another.invalid']){
 const f=fixture(q);f.state[stage]=()=>change(f);
 await assert.rejects(()=>readEligibleMonthEndQueue(f.central,{communityIds:['a','b']}),/Session or financial access changed/);
 assert.equal(f.state.requests.length,stage==='onRefresh'?0:1,'Changed context is rejected before transport or before returning rows');
}
const signedOut=fixture([]);signedOut.state.actor=null;
await assert.rejects(()=>readEligibleMonthEndQueue(signedOut.central,{communityIds:['a']}),/Sign in/);assert.equal(signedOut.state.requests.length,0);
const failedRefresh=fixture([]);failedRefresh.state.onRefresh=()=>{throw Error('Session refresh failed');};
await assert.rejects(()=>readEligibleMonthEndQueue(failedRefresh.central,{communityIds:['a']}),/Session refresh failed/);assert.equal(failedRefresh.state.requests.length,0);
const mutableScope=['a'],scopeChanged=fixture(q);scopeChanged.state.onRead=()=>mutableScope.push('b');
await assert.rejects(()=>readEligibleMonthEndQueue(scopeChanged.central,{communityIds:mutableScope}),/scope mismatch/);
console.log('PASS blank/missing GL semantics, Student August YTD, system notes, real Central empty/single/multiple queue transport, strict record scope/state, immutable requested scope, and refresh/read actor, access and backend isolation.');
