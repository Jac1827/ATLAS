const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/performance/feature-loader.js','utf8');
(async()=>{
  const appended=[];const timers=new Map();let id=0;
  const root={}; const document={currentScript:{src:'https://example.test/dashboard/performance/feature-loader.js'},querySelector:()=>null,
    createElement:tag=>({tag,dataset:{},remove(){this.removed=true}}),head:{appendChild:el=>appended.push(el)}};
  vm.runInNewContext(source,{window:root,document,URL,Map,Promise,Error,setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:i=>timers.delete(i)});
  assert.equal(appended.length,0,'No feature loads during startup');
  const a=root.AtlasFeatures.load('pdf'),b=root.AtlasFeatures.load('pdf');
  assert.equal(appended.length,1);root.pdfjsLib={};appended[0].onload();await Promise.all([a,b]);assert.equal(timers.size,0);
  await root.AtlasFeatures.load('pdf');assert.equal(appended.length,1);
  const failure=root.AtlasFeatures.load('zip');appended.at(-1).onerror();await assert.rejects(failure,/could not load/);
  const retry=root.AtlasFeatures.load('zip');root.JSZip={};appended.at(-1).onload();await retry;
  const timeout=root.AtlasFeatures.load('pptx');timers.values().next().value();await assert.rejects(timeout,/20 seconds/);assert.equal(timers.size,0);
  console.log('PASS lazy dependencies: no startup requests, deduplicated loads, cache, isolated failure/retry, timeout cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
