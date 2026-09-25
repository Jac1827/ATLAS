import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Evidence must distinguish an unavailable comparison from a measured failure,
// and must not hide the first visit's task or promote a heap sample to a peak.
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-replay-summary-'));
const parity={homeHistoryHash:'history',homeValue:0,monthlyNormalizationMatchesBaseline:true,communityProgressHash:'report',communityDocumentHash:'html',operatingDataHash:'data',reportAggregateHash:'aggregate',exportRowsHash:'rows',reportDetailCount:2,exportRowCount:2,period:{year:2026,month:8}};
function group(build){return {build,device:'mobile',parity,errors:[],startup:['cold','warm'].map(cache=>({cache,readyElapsed:500,longestTask:80,blockingTime:30,longTasks:[{start:200,duration:80}],renderCount:1,apiRequests:0,cdpCacheHits:cache==='warm'?3:0,heap:10*1024**2})),navigation:[0,8,7,2,9].flatMap(tab=>['first-loop','repeated'].map(stage=>({tab,stage,cycle:stage==='first-loop'?0:1,ms:100,longestTask:tab===8&&stage==='first-loop'?201:60,renders:1,apiRequests:0,heap:12*1024**2,renderIssue:false}))),heap:{before:{usedSize:10*1024**2},after:{usedSize:11*1024**2},domBefore:{nodes:100},dom:{nodes:100}},externalResponseCount:0};}
async function summarize(results){
 const input={kind:'TEST FIXTURE',browser:'test',date:'2026-09-25',fixture:{},configuration:{},limits:[],results,blocked:[],clientApi:[]};
 const file=path.join(directory,'results.json');await fs.writeFile(file,JSON.stringify(input));
 execFileSync('python3',['tools/performance/workspace-replay-summary.py',file],{stdio:'pipe'});
 return {json:JSON.parse(await fs.readFile(path.join(directory,'summary.json'),'utf8')),markdown:await fs.readFile(path.join(directory,'summary.md'),'utf8')};
}
try {
 const solo=await summarize([group('repaired')]);
 assert.equal(solo.json.comparison.baselineRepairedComplete,false);
 assert(Object.values(solo.json.comparison.baselineRepaired).every(value=>value===null));
 assert.match(solo.markdown,/Baseline\/repaired report and data parity: unavailable/);
 assert.equal(solo.json.groups[0].startup.warm.authenticatedShellMs.allSamplesPass,null);
 assert.equal(solo.json.groups[0].startup.warm.authenticatedShellMs.unavailableCount,1);
 const reports=solo.json.groups[0].navigation.Reports;
 assert.equal(reports.firstLoopLongestTaskMs.allSamplesPass,false);
 assert.equal(reports.firstLoopLongestTaskMs.max,201);
 assert.equal(reports.repeatedLongestTaskMs.allSamplesPass,true);
 const memory=solo.json.groups[0].memory;
 assert.equal(memory.sampledHeapPass,true);assert.equal(memory.transientPeakMeasured,false);
 assert.equal(Object.hasOwn(memory,'peakPass'),false);
 const matched=await summarize([group('baseline'),group('repaired')]);
 assert.equal(matched.json.comparison.baselineRepairedComplete,true);
 assert(Object.values(matched.json.comparison.baselineRepaired).every(value=>value===true));
 const changed=group('repaired');changed.parity={...parity,communityDocumentHash:'changed'};
 const mismatch=await summarize([group('baseline'),changed]);
 assert.equal(mismatch.json.comparison.baselineRepaired.communityDocumentHash,false);
 assert.equal(mismatch.json.comparison.baselineRepaired.exportRowsHash,true);
 const instrumented=group('repaired');for(const row of instrumented.startup)row.authenticatedShellMs=601;
 const shell=await summarize([instrumented]);
 assert.equal(shell.json.groups[0].startup.warm.authenticatedShellMs.allSamplesPass,false);
 assert.equal(shell.json.groups[0].startup.warm.authenticatedShellMs.availableCount,1);
 assert.equal(shell.json.groups[0].startup.warm.authenticatedShellMs.limit,600);
 assert.equal(Object.hasOwn(shell.json.groups[0].startup.cold.authenticatedShellMs,'allSamplesPass'),false);
 console.log('Replay evidence availability, first-visit task budgets, and sampled heap semantics passed.');
} finally {await fs.rm(directory,{recursive:true,force:true});}
