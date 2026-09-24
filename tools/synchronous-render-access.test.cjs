const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const extract = name => source.match(new RegExp('^function '+name+'\\([^]*?^\\}', 'm'))[0];
const context = vm.createContext({console});
vm.runInContext(`
let atlasSynchronousReadScope = null;
let actor='a', allowed=true, validations=0;
const atlasCommunityGoalStore={scopes:new Map([['one|2026-09',{value:0}],['two|2026-09',{value:null}]])};
function syncCommunityCommandGoalContext(){validations++;const captured=actor;return {current:()=>allowed&&captured===actor};}
function communityCommandGoalScope(name){return {key:name+'|2026-09'};}
${['withAtlasSynchronousReadScope','atlasSynchronousReadValue','communityCommandSharedGoalScope'].map(extract).join('\n')}
`, context);
const run = code => vm.runInContext(code, context);
(async () => {
  assert.equal(run(`withAtlasSynchronousReadScope(()=>{
    const zero=communityCommandSharedGoalScope('one',8,2026).value;
    const missing=communityCommandSharedGoalScope('two',8,2026).value;
    withAtlasSynchronousReadScope(()=>communityCommandSharedGoalScope('one',8,2026));
    return zero===0 && missing===null;
  })`), true);
  assert.equal(run('validations'), 1, 'One read-only synchronous render validates goal access once');
  run(`actor='b';allowed=false`);
  assert.equal(run(`withAtlasSynchronousReadScope(()=>communityCommandSharedGoalScope('one',8,2026))`), undefined, 'Next actor/access scope cannot reuse prior approved values');
  assert.equal(run('validations'), 2);
  run('allowed=true');
  assert.throws(() => run(`withAtlasSynchronousReadScope(()=>{communityCommandSharedGoalScope('one',8,2026);throw Error('render failure')})`), /render failure/);
  assert.equal(run('atlasSynchronousReadScope'), null, 'A failed render releases its cache');
  const task=run(`withAtlasSynchronousReadScope(async()=>{
    communityCommandSharedGoalScope('one',8,2026);
    await Promise.resolve();
    return communityCommandSharedGoalScope('one',8,2026);
  })`);
  run('allowed=false');
  assert.equal(await task, undefined, 'Async continuation revalidates after access loss');
  assert.equal(run('atlasSynchronousReadScope'), null);
  assert.equal(run('validations'), 5);
  run('allowed=true');
  const before=run('validations');
  run(`communityCommandSharedGoalScope('one',8,2026);communityCommandSharedGoalScope('one',8,2026)`);
  assert.equal(run('validations')-before,2,'Reads outside a synchronous render always validate');
  assert.match(source,/getWorkspaceScopedDetails\(getSelectedDashboardMonthIndex\(\), \{includeRecommendations:false,includeSummary:false\}\)/);
  console.log('PASS synchronous goal-access validation preserves null/zero, nested calls, next-render actor/access changes, exceptions and async cancellation boundaries');
})().catch(error=>{console.error(error);process.exitCode=1;});
