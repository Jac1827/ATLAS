// Explicit incident recovery: restore only the reviewed client tree. The current
// Worker, database migrations and append-only retained releases stay in place.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSite} from './build-atlas-site.mjs';
import {verifyRelease} from './package-atlas-assets.mjs';

export const CLIENT_ROLLBACK_REF='3d80173de32f227410663662a523932c50ecaa2b';
export const CLIENT_ROLLBACK_RELEASE='92989f640671df582527300a54b79cc80d46f0c4300564528c333d72cdbae540';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function requireExactPair(clientRef,expectedReleaseId) {
  if(typeof clientRef!=='string'||!/^[a-f0-9]{40}$/.test(clientRef))throw Error('Client recovery requires an exact reviewed full 40-character commit');
  if(typeof expectedReleaseId!=='string'||!/^[a-f0-9]{64}$/.test(expectedReleaseId))throw Error('Client recovery requires an independently reviewed full 64-character release hash');
}
export function validateClientRollbackSelection({clientRef='',expectedReleaseId=''}={}) {
  if(clientRef===''&&expectedReleaseId==='')return {mode:'current'};
  requireExactPair(clientRef,expectedReleaseId);
  return {mode:'reviewed_client',clientRef,expectedReleaseId};
}

export async function verifyRollbackArtifact({repo=process.cwd(),clientRef,expectedReleaseId}={}) {
  requireExactPair(clientRef,expectedReleaseId);
  repo=path.resolve(repo);
  const receipt=JSON.parse(await fs.readFile(path.join(repo,'output/atlas-client-rollback.json'),'utf8'));
  if(receipt.clientRef!==clientRef||receipt.releaseId!==expectedReleaseId)throw Error('Unapproved client rollback receipt');
  const out=path.join(repo,'output/atlas-site');
  const manifestBytes=await fs.readFile(path.join(out,'atlas-asset-manifest.json'));
  if(hash(manifestBytes)!==receipt.manifestHash)throw Error('Rollback artifact changed after verification');
  const manifest=JSON.parse(manifestBytes);
  if(manifest.releaseId!==expectedReleaseId||JSON.stringify(manifest.retainedReleaseIds)!==JSON.stringify(receipt.retainedReleaseIds))throw Error('Rollback release identity changed');
  for(const id of receipt.retainedReleaseIds)await verifyRelease(path.join(out,'_atlas-assets',id),id);
  for(const file of manifest.canonicalFiles) {
    // The existing packager deliberately emits the generated empty Pages marker
    // after its canonical inventory; the retained source marker stays exact.
    const expected=file.path==='.nojekyll'?hash(Buffer.alloc(0)):file.sha256;
    if(hash(await fs.readFile(path.join(out,file.path)))!==expected)throw Error('Canonical rollback file changed: '+file.path);
  }
  return receipt;
}

export async function prepareClientRollback({repo=process.cwd(),clientRef,expectedReleaseId,mode='preview',remote='origin'}={}) {
  requireExactPair(clientRef,expectedReleaseId);
  repo=path.resolve(repo);
  const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(git(['rev-parse','--verify',clientRef+'^{commit}'])!==clientRef)throw Error('Rollback commit cannot be verified');
  await fs.mkdir(path.join(repo,'output'),{recursive:true});
  const temp=await fs.mkdtemp(path.join(repo,'output/.atlas-client-rollback-'));
  try {
    const archive=path.join(temp,'client.tar');
    git(['archive','--format=tar','--output='+archive,clientRef,'docs']);
    execFileSync('tar',['-xf',archive,'-C',temp],{cwd:repo,stdio:['ignore','pipe','pipe']});
    const result=await buildSite({repo,source:path.join(temp,'docs'),remote,mode,expectedReleaseId});
    const manifestBytes=await fs.readFile(result.manifestPath),manifest=JSON.parse(manifestBytes);
    // Keep the deployed Worker code and bindings, but prevent Wrangler's custom
    // build hook from replacing this already-verified artifact with current docs.
    const config=JSON.parse(await fs.readFile(path.join(repo,'wrangler.jsonc'),'utf8'));
    delete config.build;
    config.main=path.resolve(repo,config.main);
    config.assets.directory=result.out;
    if(config.$schema)config.$schema=path.resolve(repo,config.$schema);
    const configPath=path.join(repo,'output/atlas-rollback-wrangler.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
    const receipt={...result,clientRef,workerRef:git(['rev-parse','HEAD']),manifestHash:hash(manifestBytes),retainedReleaseIds:manifest.retainedReleaseIds,configPath};
    await fs.writeFile(path.join(repo,'output/atlas-client-rollback.json'),JSON.stringify(receipt,null,2)+'\n');
    await verifyRollbackArtifact({repo,clientRef,expectedReleaseId});
    return receipt;
  } finally {await fs.rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const pair={clientRef:process.env.ATLAS_CLIENT_ROLLBACK_REF,expectedReleaseId:process.env.ATLAS_CLIENT_ROLLBACK_RELEASE};
  const task=process.argv.includes('--validate')?Promise.resolve().then(()=>validateClientRollbackSelection(pair)):process.argv.includes('--verify')?verifyRollbackArtifact(pair):prepareClientRollback({...pair,mode:process.env.ATLAS_ASSET_RELEASE_MODE||'preview'});
  task.then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
