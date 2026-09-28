// Explicit finance activation that preserves the verified operational runtime.
// No workspace projection, database record, or browser storage is migrated.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSite} from './build-atlas-site.mjs';
import {verifyRelease} from './package-atlas-assets.mjs';
import {composeFinanceCompatSource} from './compose-finance-compat-source.mjs';

export const OPERATIONAL_RELEASE='774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateFinanceReleaseSelection({expectedReleaseId='',clientRef='',clientRelease='',mode='preview'}={}) {
  if(!expectedReleaseId)return {mode:'current'};
  if(!/^[a-f0-9]{64}$/.test(expectedReleaseId))throw Error('Finance compatibility release requires an independently reviewed full 64-character asset hash');
  if(clientRef||clientRelease)throw Error('Finance compatibility and client rollback are mutually exclusive');
  if(!['preview','publish'].includes(mode))throw Error('Invalid finance release mode');
  return {mode:'finance_compatibility',expectedReleaseId,operationalRelease:OPERATIONAL_RELEASE};
}

export async function verifyFinanceArtifact({repo=process.cwd(),expectedReleaseId}={}) {
  repo=await fs.realpath(repo);
  validateFinanceReleaseSelection({expectedReleaseId});
  if(!expectedReleaseId)throw Error('An independently reviewed finance release hash is required');
  const receipt=JSON.parse(await fs.readFile(path.join(repo,'output/atlas-finance-release.json'),'utf8'));
  if(receipt.releaseId!==expectedReleaseId||receipt.operationalRelease!==OPERATIONAL_RELEASE)throw Error('Finance release selection changed');
  const out=path.join(repo,'output/atlas-site'),bytes=await fs.readFile(path.join(out,'atlas-asset-manifest.json'));
  if(hash(bytes)!==receipt.manifestHash)throw Error('Finance artifact manifest changed');
  const manifest=JSON.parse(bytes);
  if(manifest.releaseId!==expectedReleaseId||JSON.stringify(manifest.retainedReleaseIds)!==JSON.stringify(receipt.retainedReleaseIds))throw Error('Finance release identity changed');
  for(const id of manifest.retainedReleaseIds)await verifyRelease(path.join(out,'_atlas-assets',id),id);
  for(const file of manifest.canonicalFiles){
    const expected=file.path==='.nojekyll'?hash(Buffer.alloc(0)):file.sha256;
    if(hash(await fs.readFile(path.join(out,file.path)))!==expected)throw Error('Canonical finance asset changed: '+file.path);
  }
  const config=JSON.parse(await fs.readFile(path.join(repo,'wrangler.jsonc'),'utf8'));
  delete config.build;
  config.main=path.resolve(repo,config.main);config.assets.directory=out;
  if(config.$schema)config.$schema=path.resolve(repo,config.$schema);
  if(JSON.stringify(JSON.parse(await fs.readFile(receipt.configPath,'utf8')))!==JSON.stringify(config))throw Error('Current Worker configuration changed');
  return receipt;
}

export async function prepareFinanceRelease({repo=process.cwd(),expectedReleaseId=null,mode='preview',remote='origin',operationalRoot=null}={}) {
  if(!['preview','publish'].includes(mode))throw Error('Invalid finance release mode');
  if(mode==='publish'&&!expectedReleaseId)throw Error('Production requires an independently reviewed finance release hash');
  if(expectedReleaseId)validateFinanceReleaseSelection({expectedReleaseId,mode});
  repo=await fs.realpath(repo);
  const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  await fs.mkdir(path.join(repo,'output'),{recursive:true});
  const temp=await fs.mkdtemp(path.join(repo,'output/.atlas-finance-release-'));
  try{
    if(!operationalRoot){
      git(['fetch','--no-tags',remote,'refs/heads/atlas-asset-releases']);
      const ref=git(['rev-parse','FETCH_HEAD']);
      const archive=path.join(temp,'operational.tar');
      git(['archive','--format=tar','--output='+archive,ref,'_atlas-assets/'+OPERATIONAL_RELEASE]);
      execFileSync('tar',['-xf',archive,'-C',temp],{cwd:repo,stdio:['ignore','pipe','pipe']});
      operationalRoot=path.join(temp,'_atlas-assets',OPERATIONAL_RELEASE);
    }
    await verifyRelease(operationalRoot,OPERATIONAL_RELEASE);
    const source=path.join(temp,'source');
    const composition=await composeFinanceCompatSource({operationalSource:operationalRoot,financeSource:path.join(repo,'docs'),out:source});
    const result=await buildSite({repo,source,remote,mode,expectedReleaseId});
    const manifestBytes=await fs.readFile(result.manifestPath),manifest=JSON.parse(manifestBytes);
    const config=JSON.parse(await fs.readFile(path.join(repo,'wrangler.jsonc'),'utf8'));
    delete config.build;config.main=path.resolve(repo,config.main);config.assets.directory=result.out;
    if(config.$schema)config.$schema=path.resolve(repo,config.$schema);
    const configPath=path.join(repo,'output/atlas-finance-wrangler.json');
    await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
    const receipt={...result,operationalRelease:OPERATIONAL_RELEASE,financeRef:git(['rev-parse','HEAD']),composition,manifestHash:hash(manifestBytes),retainedReleaseIds:manifest.retainedReleaseIds,configPath};
    await fs.writeFile(path.join(repo,'output/atlas-finance-release.json'),JSON.stringify(receipt,null,2)+'\n');
    await verifyFinanceArtifact({repo,expectedReleaseId:result.releaseId});
    return receipt;
  }finally{await fs.rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const expectedReleaseId=process.env.ATLAS_FINANCE_RELEASE_HASH||'',mode=process.env.ATLAS_ASSET_RELEASE_MODE||'preview';
  const task=process.argv.includes('--validate')?Promise.resolve().then(()=>validateFinanceReleaseSelection({expectedReleaseId,clientRef:process.env.ATLAS_CLIENT_ROLLBACK_REF,clientRelease:process.env.ATLAS_CLIENT_ROLLBACK_RELEASE,mode})):process.argv.includes('--verify')?verifyFinanceArtifact({expectedReleaseId}):prepareFinanceRelease({expectedReleaseId:expectedReleaseId||null,mode});
  task.then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
