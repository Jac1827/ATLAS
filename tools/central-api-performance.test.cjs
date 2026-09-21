const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js', 'utf8');
const body = source.slice(source.indexOf('  async function fetchJson('), source.indexOf('  async function signInWithPassword('));
async function run(path, request, diagnostics) {
  const context = { window: { AtlasPerformance: diagnostics }, request, restUrl: p => p };
  vm.createContext(context);
  vm.runInContext(body, context);
  return context.fetchJson(path);
}
(async () => {
  const events = [];
  const diagnostics = { enabled: true, start(name, details) { return end => events.push({name, ...details, ...end}); } };
  const rows = [{resident: 'private'}];
  assert.equal(await run('/atlas_application_imports?community_id=eq.private', async () => rows, diagnostics), rows);
  assert.deepEqual(events, [{name:'central-api',scope:'/atlas_application_imports',failed:false,rows:1}]);
  assert(!JSON.stringify(events).includes('private'));
  const error = new Error('private error');
  await assert.rejects(run('/rpc/atlas_publish_application_import', async () => { throw error; }, diagnostics), e => e === error);
  assert.equal(events[1].failed, true);
  assert.equal(events.length, 2);
  for (const broken of [{enabled:true,start(){throw Error();}}, {enabled:true,start(){return () => {throw Error();};}}, undefined]) {
    assert.equal(await run('/anything', async () => rows, broken), rows);
    await assert.rejects(run('/anything', async () => {throw error;}, broken), e => e === error);
  }
  await run('/user-private-path', async () => ({}), diagnostics);
  assert.equal(events.at(-1).scope, 'central-other');
  await run('/atlas_app_documents', async () => rows, {enabled:false,start(){throw Error('must not run');}});
  console.log('PASS Central API timing: no private query data; results/errors preserved; instrumentation isolated');
})().catch(error => {console.error(error);process.exitCode=1;});
