const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/performance/diagnostics.js','utf8');
function boot(hostname,search){
  const root={location:{hostname,search},performance,navigator:{userAgent:'test'},addEventListener(){}};
  vm.runInNewContext(source,{window:root,URLSearchParams});return root.AtlasPerformance;
}
(async()=>{
  const production=boot('jac1827.github.io','');
  assert.equal(production.enabled,false);assert.equal(production.report,undefined);
  assert.equal(boot('jac1827.github.io','?atlasPerf=1').enabled,true);
  const dev=boot('localhost','?atlasPerf=1');
  for(let i=0;i<1000;i++)dev.record('render',i,{scope:'7',payload:{secret:true}});
  assert.equal(dev.report().events.length,600);assert.equal(dev.report().counters.render,1000);
  assert(!JSON.stringify(dev.report()).includes('secret'));
  const error=new Error('same');await assert.rejects(dev.wrap(async()=>{throw error},'failure')(),e=>e===error);
  const value={identity:true};assert.equal(await dev.wrap(async()=>value,'read')(),value);
  dev.reset();assert.equal(dev.report().events.length,0);
  console.log('PASS diagnostics: development gate, bounded retention, no payload capture, preserved results/errors');
})().catch(e=>{console.error(e);process.exitCode=1});
