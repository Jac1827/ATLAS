// Prepare one verified site for both hosting targets. Published releases are
// retained in an append-only Git tree before canonical HTML can be deployed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {packageAssets} from './package-atlas-assets.mjs';

export async function buildSite({repo=process.cwd(),source='docs',out='output/atlas-site',remote='origin',branch='atlas-asset-releases',mode='publish',bootstrap=false}={}) {
  if (!['publish','preview'].includes(mode)) throw Error('Invalid asset release mode');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(branch)) throw Error('Invalid retention branch');
  repo=path.resolve(repo);
  const git=(args,env={})=>execFileSync('git',args,{cwd:repo,env:{...process.env,...env},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  // A missing branch is distinct from a failed network/authentication request.
  const remoteHead=git(['ls-remote','--heads',remote,`refs/heads/${branch}`]).split(/\s/)[0];
  if (!remoteHead && !bootstrap) throw Error('The durable asset retention branch is missing. Bootstrap the first release explicitly; deployment stopped.');
  if (remoteHead) git(['fetch','--no-tags',remote,`refs/heads/${branch}`]);
  const parent=remoteHead ? git(['rev-parse','FETCH_HEAD']) : null;
  const parentDir=path.join(repo,'output');
  await fs.mkdir(parentDir,{recursive:true});
  const temp=await fs.mkdtemp(path.join(parentDir,'.atlas-retention-'));
  try {
    const retained=path.join(temp,'tree');
    await fs.mkdir(retained);
    const env={GIT_INDEX_FILE:path.join(temp,'index'),GIT_WORK_TREE:retained};
    git(['read-tree',parent||'--empty'],env);
    if(parent)git(['checkout-index','--all',`--prefix=${retained}${path.sep}`],env);
    const result=await packageAssets({source:path.resolve(repo,source),out:path.resolve(repo,out),retained,allowEmptyRetained:!parent&&bootstrap});
    if(mode==='publish') {
      await fs.cp(path.join(result.out,'_atlas-assets'),path.join(retained,'_atlas-assets'),{recursive:true});
      await fs.writeFile(path.join(retained,'README.md'),'# ATLAS retained asset releases\n\nAppend-only deployment inputs. Each tree is hash-verified before deployment. Do not edit or prune published releases.\n');
      git(['add','-f','--','_atlas-assets','README.md'],env);
      const tree=git(['write-tree'],env);
      if(!parent || tree!==git(['rev-parse',`${parent}^{tree}`])) {
        const commit=git(['-c','user.name=ATLAS release automation','-c','user.email=actions@users.noreply.github.com','commit-tree',tree,...(parent?['-p',parent]:[]),'-m',`Retain ATLAS asset release ${result.releaseId}`],env);
        // Ordinary fast-forward push: a concurrent writer fails rather than
        // replacing another release. Rerunning fetches and keeps both trees.
        git(['push',remote,`${commit}:refs/heads/${branch}`]);
      }
      const published=git(['ls-remote','--heads',remote,`refs/heads/${branch}`]).split(/\s/)[0];
      if(!published)throw Error('Asset retention publication was not confirmed');
      return {...result,retentionBranch:branch,retentionCommit:published,mode};
    }
    return {...result,retentionBranch:branch,retentionCommit:parent,mode};
  } finally {await fs.rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const bootstrap=process.argv.includes('--bootstrap');
  const mode=process.env.ATLAS_ASSET_RELEASE_MODE||'publish';
  buildSite({bootstrap,mode}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
