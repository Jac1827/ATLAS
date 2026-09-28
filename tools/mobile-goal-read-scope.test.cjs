const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const names=['withAtlasSynchronousReadScope','atlasSynchronousReadValue','communityCommandGoalKey','communityCommandGoalScope','communityCommandSharedGoalScope','getCommunityCommandApprovedGoal'];
const context={};vm.createContext(context);
vm.runInContext(`
let atlasSynchronousReadScope=null,configured=true,allowed=true,statusReads=0,keyReads=0,accessReads=0;
const getAtlasCentralStatus=()=>{statusReads++;return {configured};};
const getAtlasCommunityAccessRecord=()=>{accessReads++;return {atlasCommunityId:'canonical'};};
const syncCommunityCommandGoalContext=()=>({current:()=>allowed});
const matchPropertyName=name=>{keyReads++;return name==='alias'?'Synthetic':name;};
const buildPeriodKey=(m,y)=>String(y)+'-'+String(m+1).padStart(2,'0');
const getAtlasTodayISODate=()=> '2026-09-15';
const communityCommandState={approvedGoals:[{propName:'Synthetic',monthIdx:8,year:2026,status:'Approved',approvedAt:'2026-08-01',version:1,requiredMoveIns:0}]};
const normalizeCommunityCommandState=value=>value;
const atlasCommunityGoalStore={scopes:new Map([['canonical|2026-09',{approvedHistory:[
 {status:'Approved',approvedAt:'2026-08-01',effectiveDate:'2026-09-01',version:1,requiredMoveIns:null},
 {status:'Approved',approvedAt:'2026-09-02',effectiveDate:'2026-09-02',version:2,requiredMoveIns:0},
 {status:'Approved',approvedAt:'2026-09-14',effectiveDate:'2026-09-16',version:3,requiredMoveIns:99},
 {status:'Draft',approvedAt:'2026-09-14',version:4,requiredMoveIns:100}
]}]])};
`,context);
for(const name of names)vm.runInContext(source.match(new RegExp('^function '+name+'\\([^]*?^\\}','m'))[0],context);
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));
const before=run('JSON.stringify([...atlasCommunityGoalStore.scopes])');
const goals=plain(run('withAtlasSynchronousReadScope(()=>Array.from({length:12},()=>getCommunityCommandApprovedGoal("alias",8,2026)))'));
assert.ok(goals.every(goal=>goal.version===2&&goal.requiredMoveIns===0));
assert.equal(run('keyReads'),0,'Canonical shared goals do not compute unused legacy name keys');
assert.equal(run('statusReads'),1,'Configured status is read once in one synchronous calculation');
assert.equal(run('accessReads'),12,'Canonical community scope checks remain present for each lookup');
assert.equal(run('JSON.stringify([...atlasCommunityGoalStore.scopes])'),before,'Shared goal histories stay immutable');
run('allowed=false');assert.equal(run('withAtlasSynchronousReadScope(()=>getCommunityCommandApprovedGoal("alias",8,2026))'),null,'Changed access cannot reuse an old shared goal');
run('allowed=true;atlasCommunityGoalStore.scopes.get("canonical|2026-09").approvedHistory[1].requiredMoveIns=7');
assert.equal(run('withAtlasSynchronousReadScope(()=>getCommunityCommandApprovedGoal("alias",8,2026)).requiredMoveIns'),7,'An in-place source edit is visible in the next synchronous scope');
run('configured=false');assert.equal(run('withAtlasSynchronousReadScope(()=>getCommunityCommandApprovedGoal("alias",8,2026)).requiredMoveIns'),0,'Offline legacy aliases and explicit zero still work');
assert.ok(run('keyReads')>0,'Legacy mode retains the exact name-key matching path');
run('configured=true');assert.equal(run('withAtlasSynchronousReadScope(()=>getCommunityCommandApprovedGoal("alias",8,2026)).requiredMoveIns'),7,'A changed backend mode is re-read in the next scope');
assert.equal(run('atlasSynchronousReadScope'),null);
assert.throws(()=>run('withAtlasSynchronousReadScope(()=>{throw Error("synthetic failure")})'),/synthetic failure/);
assert.equal(run('atlasSynchronousReadScope'),null,'Failed scopes never retain cached access state');
console.log('PASS configured canonical goal parity, effective dates, null/zero, offline aliases, source/access refresh, synchronous scope lifetime and no unused legacy keys.');
