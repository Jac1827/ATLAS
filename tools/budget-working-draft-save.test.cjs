const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=__dirname+'/../docs/portfolio-operations-dashboard/';
const html=fs.readFileSync(root+'RISE-Budget-Builder.html','utf8');
function fixture(records=new Map()){
 const nodes=new Map([['savestat',{innerHTML:''}],['browser-draft-save-status',{textContent:''}]]),timers=new Map();let tick=0,failure=null;
 const context={console,Date,URL,URLSearchParams,structuredClone,setTimeout:fn=>{timers.set(++tick,fn);return tick;},clearTimeout:id=>timers.delete(id),setInterval:()=>0,
  location:{search:'',hash:'#workspace'},document:{addEventListener(){},querySelectorAll(){return [];},getElementById:id=>nodes.get(id)||null},addEventListener(){},navigator:{},
  localStorage:{getItem:key=>records.get(key)||null,setItem(key,value){if(failure&&key==='rise.budget.autosave')throw failure;records.set(key,value);},removeItem:key=>records.delete(key)}};
 context.window=context;context.parent=context;vm.createContext(context);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim()&&!m[1].includes('RBB.app.boot()'))vm.runInContext(m[1],context);
 vm.runInContext(fs.readFileSync(root+'budget-navigation.js','utf8'),context);
 const R=context.RBB,A=R.app;A.render=()=>A.renderSaveStatus();A.toast=()=>{};A.boot();
 return {R,A,records,nodes,fail:error=>{failure=error;}};
}
const first=fixture(),{R,A,records,nodes}=first,P=R.persist;
const line=A.state.lines.find(row=>row.gl==='5120'),base=JSON.stringify(A.state.lines),actuals=JSON.stringify(A.state.actuals);
const value=(id,year=2026)=>R.engine.computeProperty(A.state,'DORO',id,year).results[line.id].monthly[0];
const original=value('SC-APPROVED'),other=value('SC-SLOW'),nextYear=value('SC-WORK',2027);
A.setScenario('SC-WORK');A.setOverride(line.id,0,'499,999.25');
assert.equal(value('SC-WORK'),499999.25);assert.equal(value('SC-APPROVED'),original);assert.equal(value('SC-SLOW'),other);
const beforeBlank=JSON.stringify(A.state);for(const empty of ['', '   ', '$ , ']){A.setOverride(line.id,0,empty);assert.equal(JSON.stringify(A.state),beforeBlank,'Blank amounts must not silently become zero');}
assert.equal(value('SC-WORK',2027),nextYear);assert.equal(JSON.stringify(A.state.lines),base);assert.equal(JSON.stringify(A.state.actuals),actuals);
assert(P.dirty);assert.equal(nodes.get('browser-draft-save-status').textContent,'Unsaved changes');
assert(P.autosave());assert(!P.dirty);assert.match(nodes.get('savestat').innerHTML,/Saved/);assert.equal(nodes.get('browser-draft-save-status').textContent,'Saved in this browser');
const reopened=fixture(records);assert.equal(reopened.A.state.activeScenario,'SC-WORK');assert.equal(reopened.A.cp().results[line.id].monthly[0],499999.25);
assert.equal(JSON.stringify(reopened.A.state.lines),base);assert.equal(JSON.stringify(reopened.A.state.actuals),actuals);
// Save immediately, before the debounce: the next boot must use the new value.
A.setOverride(line.id,0,0);assert.equal(A.quickSave(),true);assert.equal(fixture(records).A.cp().results[line.id].monthly[0],0);
A.setYear(2027);A.setOverride(line.id,0,-123.45);A.quickSave();
assert.equal(value('SC-WORK',2027),-123.45);assert.equal(value('SC-WORK',2026),0);
A.clearOverrides(line.id);assert.equal(value('SC-WORK',2027),nextYear);assert.equal(value('SC-WORK',2026),0);
// Old saved overrides can also be cleared without mutating shared base lines.
line.overrides={0:456};A.clearOverrides(line.id);assert.equal(value('SC-WORK',2027),nextYear);assert.equal(value('SC-APPROVED',2027),456);delete line.overrides;
A.scenario().lineOverrides[line.id].overrides={0:789};assert.equal(value('SC-WORK',2027),nextYear);assert.equal(value('SC-WORK',2026),0);delete A.scenario().lineOverrides[line.id].overrides;
A.setScenario('SC-APPROVED');const beforeLocked=JSON.stringify(A.state);A.setOverride(line.id,0,1);A.clearOverrides(line.id);assert.equal(JSON.stringify(A.state),beforeLocked);
// An imported source array cannot silently defeat an explicit working edit.
A.setScenario('SC-WORK');A.setYear(2026);line.importedMonthly=Array(12).fill(50);line.overrides={0:60};A.setOverride(line.id,0,75);assert.equal(value('SC-WORK'),75);assert.equal(value('SC-APPROVED'),50,'New edits must not resurrect legacy overrides hidden by approved imported values');
const checkpoint=records.get(P.AUTOSAVE_KEY);first.fail(Object.assign(Error('Synthetic full storage'),{name:'QuotaExceededError'}));
assert.equal(P.autosave(),false);assert(P.dirty);assert.equal(records.get(P.AUTOSAVE_KEY),checkpoint);assert.match(nodes.get('savestat').innerHTML,/Storage full/);assert.match(nodes.get('browser-draft-save-status').textContent,/failed/);
first.fail(Error('Synthetic write failure'));assert.equal(P.autosave(),false);assert(P.dirty);assert.match(nodes.get('savestat').innerHTML,/Save failed/);
first.fail(null);assert(P.autosave());assert.equal(nodes.get('browser-draft-save-status').textContent,'Saved in this browser');
console.log('PASS browser draft save: scenario/year isolation, approved/actual preservation, autosave restore, immediate Save checkpoint, zero/negative values, per-year clear, locked edit rejection, imported precedence, and visible storage-failure retention.');
