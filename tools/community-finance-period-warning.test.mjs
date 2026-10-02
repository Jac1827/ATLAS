import assert from 'node:assert/strict';
globalThis.window=globalThis;
globalThis.AtlasCommunityCommandContract=(await import('../docs/portfolio-operations-dashboard/community-command-contract.js')).default;
class Node{
 constructor(tag='span'){this.tagName=tag.toUpperCase();this.dataset={};this.style={};this.children=[];this.attributes={};this._text='';}
 set textContent(value){this._text=String(value);this.children=[];} get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 append(node){node.parent=this;this.children.push(node);}replaceChildren(){this._text='';this.children=[];}
 setAttribute(key,value){this.attributes[key]=value;}
 remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}
}
const cells={'occupancy-budget':new Node('td'),'occupancy-variance':new Node('td'),units:new Node('td'),gpr:new Node('td'),expenses:new Node('td')},plan=new Node('td'),count=new Node(),row=new Node('tr');
row.querySelector=selector=>selector==='[data-shared-plan]'?plan:cells[selector.match(/data-metric="([^"]+)"/)[1]];
row.querySelectorAll=selector=>selector==='[data-financial-period-warning]'?Object.values(cells).flatMap(c=>c.children).filter(c=>c.dataset.financialPeriodWarning):Object.values(cells);
globalThis.document={querySelector:selector=>selector.startsWith('[data-roster-budget-count=')?null:selector==='[data-shared-plan-count]'?count:row,createElement:tag=>new Node(tag)};
const {hydrate,cancel}=await import('../docs/portfolio-operations-dashboard/features/community-finance.mjs');
const {REOPENED_PERIOD_WARNING}=await import('../docs/portfolio-operations-dashboard/features/month-end-governance.mjs');
const cid='10000000-0000-0000-0000-000000000001',period='2026-09',entry={key:'one',communityId:cid,period,year:2026};
cells['occupancy-variance'].dataset.physicalPct='17.4';
let hasBudget=true,budgetPct=47.612064;
let actor='actor-one',version=1,reopened=true,delayPlan=null;
const central={getSession:()=>({user:{id:actor}}),getStoredProfile:()=>({user_id:actor,version,status:'active',role:'executive'}),async fetchJson(path){
 if(path.startsWith('/atlas_approved_budget_versions?'))return hasBudget?[{community_id:cid,calendar_year:2026,status:'locked',version_id:'locked-2026',content_hash:'a'.repeat(64),covered_months:[8],payload:{occupancyPct:Array(12).fill(budgetPct)}}]:[];
 if(path==='/rpc/atlas_read_finance')return [{community_id:cid,period_key:period,summary:{registryVersion:'atlas-finance-v1',communityId:cid,period,periodState:reopened?'reopened':'locked',periodWarning:reopened?REOPENED_PERIOD_WARNING:null,effectiveBaseline:{status:'unavailable'},expenses:{actual:100,budget:null,status:'missing',label:'Missing budget'}}}];
 if(path.includes('plan_summaries')&&delayPlan)return delayPlan();return [];
}};
await hydrate([entry],central);
assert.equal(row.querySelectorAll('[data-financial-period-warning]').length,1);
assert.equal(cells.expenses.children.at(-1).textContent,REOPENED_PERIOD_WARNING);
assert.equal(cells.expenses.children.at(-1).attributes.role,'alert');
assert.equal(cells['occupancy-budget'].textContent,'47.6%');assert.equal(cells['occupancy-variance'].textContent,'-30.2 pp');
budgetPct=0;await hydrate([entry],central);assert.equal(cells['occupancy-budget'].textContent,'0.0%');assert.equal(cells['occupancy-variance'].textContent,'+17.4 pp');
hasBudget=false;await hydrate([entry],central);assert.equal(cells['occupancy-budget'].textContent,'Missing budget');assert.equal(cells['occupancy-variance'].textContent,'Missing budget');
reopened=false;await hydrate([entry],central);assert.equal(row.querySelectorAll('[data-financial-period-warning]').length,0,'Re-approved periods clear the previous warning');
for(const change of [()=>{actor='actor-two';},()=>{version++;}]){
 let release,started;const begun=new Promise(resolve=>started=resolve);delayPlan=()=>new Promise(resolve=>{release=resolve;started();});
 const pending=hydrate([entry],central);await begun;change();cells.expenses.textContent='Current authorized scope';globalThis.AtlasCommandPlanSummaries={current:true};
 release([{community_id:cid,period_key:period,stage:'Old response',task_count:2,verified_count:1}]);await pending;
 assert.equal(cells.expenses.textContent,'Current authorized scope');assert.deepEqual(globalThis.AtlasCommandPlanSummaries,{current:true});
}
cancel();console.log('PASS server-sourced reopened warning, removal after relock, and delayed actor/access-change isolation.');
