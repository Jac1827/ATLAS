import {readDashboardSource} from './dashboard-source.cjs';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {createBonusReceiptCache} from '../docs/portfolio-operations-dashboard/features/reforecast-bonus.mjs';
const source=readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const fn=name=>{const match=source.match(new RegExp('^function '+name+'\\([^]*?^\\}','m'));assert(match,name);return match[0];};
const period={periodKey:'2026-Q3',start:'2026-07-01',end:'2026-09-30'},employees=Array.from({length:12},(_,i)=>({employeeId:'synthetic-'+i,assignmentId:'assignment-'+i,communityName:'Synthetic'}));
async function scenario(stale=false){
 let reads=0,renders=0,rows=0,resolve,context='actor-a:scope-a:2026-Q3';const timers=[];
 const central={getSession:()=>({user:{id:'actor-a'}}),fetchJson:()=>{reads++;return new Promise(yes=>resolve=yes);}};
 const c={window:{ATLAS_CENTRAL:central},WeakMap,Map,Promise,Date,simpleHash:x=>x,atlasBonusState:()=>({}),atlasBonusGetCommunityOperatingType:()=> 'conventional',getAtlasRenderContextKey:()=>context,atlasAccessDecision:()=>({ok:true}),activeTab:9,atlasDashboardInitializationComplete:true,setTimeout:fn=>(timers.push(fn),timers.length),renderTab:()=>{renders++;for(const employee of employees){rows++;c.atlasBonusRetainedRow(employee,period,{plan:{id:'synthetic-plan'}});}}};
 vm.createContext(c);vm.runInContext('const atlasObservedRefreshes=new WeakMap();let atlasSharedRenderTimer=null,atlasSharedRenderNeedsWorkspace=false;'+['observeAtlasRefresh','scheduleAtlasSharedRender','atlasBonusRetainedRow'].map(fn).join('\n'),c);
 c.atlasBonusRetainedRow.cache=createBonusReceiptCache(central);
 for(const employee of employees){rows++;c.atlasBonusRetainedRow(employee,period,{plan:{id:'synthetic-plan'}});}
 assert.equal(reads,1);assert.equal(renders,0);if(stale)context='actor-b:scope-b:2026-Q4';resolve([]);await new Promise(setImmediate);
 assert.equal(timers.length,stale?0:1,'N employee callbacks schedule at most one current-context paint');
 while(timers.length)timers.shift()();await new Promise(setImmediate);
 assert.equal(renders,stale?0:1);assert.equal(rows,stale?12:24);return {reads,renders,rows};
}
console.log(JSON.stringify({passed:true,current:await scenario(),stale:await scenario(true),baseline:{reads:1,renders:12,rows:156},scope:'Synthetic real receipt cache and retained-row/scheduler functions; no network or operational data'}));
