// Credential-free packaging acceptance; every write is inside a temporary clone
// and its local bare retention remote. No production fetch, push or deploy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {prepareClientRollback,verifyRollbackArtifact,validateClientRollbackSelection,CLIENT_ROLLBACK_REF,CLIENT_ROLLBACK_RELEASE} from './build-atlas-client-rollback.mjs';
import {buildSite} from './build-atlas-site.mjs';

const original=path.resolve(import.meta.dirname,'..');
const retentionRef='09f271122e2436bc642deddabe1dfc7f8cecf93e';
const candidateRelease='75f860f6da674427159a5ba8c5c2ecb0d7e208c49a35d168dcd16877dcf6a370';
const workflow=await fs.readFile(path.join(original,'.github/workflows/deploy-cloudflare.yml'),'utf8');
const condition=workflow.match(/^  production:\n    if: (.+)$/m)?.[1];
assert(condition,'Real production gate is present');
const allowed=(event,ref,target,rollback,ready,release='')=>Function('github','inputs','vars',`return ${condition}`)({event_name:event,ref},{target,client_rollback_ref:rollback,client_rollback_release:release},{ATLAS_SCOPED_WORKSPACE_READY:ready});
assert.equal(allowed('push','refs/heads/main','','',''),false,'Unset readiness blocks main activation');
assert.equal(allowed('workflow_dispatch','refs/heads/main','production','',''),false,'Unset readiness blocks current manual activation');
assert.equal(allowed('workflow_dispatch','refs/heads/main','production',CLIENT_ROLLBACK_REF,'',CLIENT_ROLLBACK_RELEASE),true,'Explicit reviewed pair enters recovery validation');
assert.equal(allowed('workflow_dispatch','refs/heads/main','production',CLIENT_ROLLBACK_REF,''),false,'Missing independent hash cannot bypass readiness');
assert.equal(allowed('workflow_dispatch','refs/heads/main','production','3d80173',''),false);
assert.equal(allowed('workflow_dispatch','refs/heads/main','production','main',''),false);
assert.equal(allowed('workflow_dispatch','refs/heads/main','preview',CLIENT_ROLLBACK_REF,''),false);
assert.equal(allowed('push','refs/heads/feature','','','true'),false);
assert.equal(allowed('push','refs/heads/main','','','true'),true);
assert.equal(allowed('workflow_dispatch','refs/heads/main','production','','true'),true);
assert.deepEqual(validateClientRollbackSelection(),{mode:'current'});
assert.throws(()=>validateClientRollbackSelection({clientRef:CLIENT_ROLLBACK_REF}),/64-character/);
assert.throws(()=>validateClientRollbackSelection({expectedReleaseId:CLIENT_ROLLBACK_RELEASE}),/40-character/);
assert.throws(()=>validateClientRollbackSelection({clientRef:'main',expectedReleaseId:CLIENT_ROLLBACK_RELEASE}),/40-character/);
assert.throws(()=>validateClientRollbackSelection({clientRef:CLIENT_ROLLBACK_REF,expectedReleaseId:'wrong'}),/64-character/);
for(const [clientRef,expectedReleaseId] of [[CLIENT_ROLLBACK_REF,''],['',CLIENT_ROLLBACK_RELEASE],['main',CLIENT_ROLLBACK_RELEASE]]) {
  assert.equal(allowed('workflow_dispatch','refs/heads/main','production',clientRef,'true',expectedReleaseId),true,'Readiness opens the job, not malformed selection');
  assert.throws(()=>validateClientRollbackSelection({clientRef,expectedReleaseId}),/requires/,'Early real selection validation rejects partial/malformed pairs even when ready');
}
assert.match(workflow,/Validate explicit current or reviewed-client selection\n        run: node tools\/build-atlas-client-rollback.mjs --validate/);
assert.match(workflow,/group: atlas-production-publisher\n      cancel-in-progress: false/);
assert.match(workflow,/fetch-depth: 0/);
assert.match(workflow,/name: Run complete discovered test suite\n        run: node tools\/test-all.mjs/g,'Recovery retains full current-checkout CI');
assert.match(workflow,/name: Verify scoped workspace database reader is deployed\n        run:/);
assert.match(workflow,/--config output\/atlas-rollback-wrangler.json/);
assert.match(workflow,/path: output\/atlas-site/,'Pages receives the Worker artifact');

const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-client-rollback-test-'));
try {
  const repo=path.join(tmp,'repo'),remote=path.join(tmp,'retention.git');
  const git=(args,cwd=original)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['clone','--shared','--no-checkout',original,repo]);
  git(['checkout','--detach','HEAD'],repo);
  git(['init','--bare',remote]);
  // The committed release tree is part of the incident evidence. A complete
  // checkout fetches it explicitly in CI without changing the release branch.
  try {git(['cat-file','-e',retentionRef+'^{commit}']);}
  catch {throw Error('Required retained incident commit is absent; fetch atlas-asset-releases before this acceptance test');}
  git(['fetch',original,retentionRef+':refs/heads/atlas-asset-releases'],remote);
  git(['remote','set-url','origin',remote],repo);
  const before=git(['ls-remote','--heads','origin','atlas-asset-releases'],repo);
  const sourceStatus=git(['status','--porcelain'],repo);
  const sourceConfig=JSON.parse(await fs.readFile(path.join(repo,'wrangler.jsonc'),'utf8'));
  const pair={repo,clientRef:CLIENT_ROLLBACK_REF,expectedReleaseId:CLIENT_ROLLBACK_RELEASE};
  await assert.rejects(prepareClientRollback({...pair,clientRef:'main'}),/40-character/);
  await assert.rejects(prepareClientRollback({...pair,clientRef:CLIENT_ROLLBACK_REF.slice(0,7)}),/40-character/);
  await assert.rejects(prepareClientRollback({...pair,expectedReleaseId:'0'.repeat(64),mode:'publish'}),/independently reviewed expected release hash/);
  assert.equal(git(['ls-remote','--heads','origin','atlas-asset-releases'],repo),before,'Hash mismatch fails before retention publication');
  const receipt=await prepareClientRollback(pair);
  assert.equal(receipt.mode,'preview','Local recovery verification never publishes by default');
  assert.equal(receipt.releaseId,CLIENT_ROLLBACK_RELEASE);
  assert.deepEqual(receipt.retainedReleaseIds,[candidateRelease,CLIENT_ROLLBACK_RELEASE]);
  assert.equal(git(['ls-remote','--heads','origin','atlas-asset-releases'],repo),before);
  const config=JSON.parse(await fs.readFile(receipt.configPath,'utf8'));
  const expected={...sourceConfig,main:path.resolve(repo,sourceConfig.main),assets:{...sourceConfig.assets,directory:receipt.out},$schema:path.resolve(repo,sourceConfig.$schema)};
  delete expected.build;
  assert.deepEqual(config,expected,'Only build and local paths change; current Worker, bindings and migrations remain');
  const manifest=JSON.parse(await fs.readFile(receipt.manifestPath,'utf8'));
  assert.equal(manifest.sourceFiles.length,JSON.parse(git(['show',retentionRef+':_atlas-assets/'+CLIENT_ROLLBACK_RELEASE+'/.atlas-release.json'])).files.length);
  assert.equal(git(['status','--porcelain'],repo),sourceStatus,'Source checkout and index stay unchanged');
  await verifyRollbackArtifact(pair);
  const file=path.join(receipt.out,'portfolio-operations-dashboard/index.html');
  const bytes=await fs.readFile(file);
  await fs.writeFile(file,Buffer.concat([bytes,Buffer.from('tamper')]));
  await assert.rejects(verifyRollbackArtifact(pair),/Canonical rollback file changed/);
  await fs.writeFile(file,bytes);
  const published=await prepareClientRollback({...pair,mode:'publish'});
  assert.equal(git(['ls-remote','--heads','origin','atlas-asset-releases'],repo),before,'Recovery reuses exact existing releases without pruning or rewriting retention');
  assert.equal(published.releaseId,receipt.releaseId);
  const normal=await buildSite({repo,out:'output/normal-site',mode:'preview'});
  assert.notEqual(normal.releaseId,CLIENT_ROLLBACK_RELEASE,'Next normal build uses current docs; no sticky rollback setting');
  assert(normal.releaseCount>=2);
  const otherReviewed=await prepareClientRollback({repo,clientRef:git(['rev-parse','HEAD'],repo),expectedReleaseId:normal.releaseId});
  assert.equal(otherReviewed.releaseId,normal.releaseId,'Another exact independently reviewed stable pair can be deliberately selected');
  console.log('PASS exact prior client hash, complete two-release retention, local-only publication idempotence, unchanged current Worker/bindings/backend sources, tamper detection, one-artifact config, normal-build reset and closed-by-default production gate.');
} finally {await fs.rm(tmp,{recursive:true,force:true});}
