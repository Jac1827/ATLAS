// Repeat the transport/storage/UI contract with the exact assets that compatibility
// packaging will activate, including the retained authentication client.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {composeFinanceCompatSource,OPERATIONAL_RELEASE} from './compose-finance-compat-source.mjs';

const root = path.resolve(import.meta.dirname, '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-website-compat-browser-'));
try {
  const retained = path.join(temp, 'retained'), composed = path.join(temp, 'composed');
  await fs.mkdir(retained);
  execFileSync('git', ['archive','--format=tar','--output='+path.join(temp,'retained.tar'),'origin/atlas-asset-releases:_atlas-assets/'+OPERATIONAL_RELEASE], {cwd:root});
  execFileSync('tar', ['-xf',path.join(temp,'retained.tar'),'-C',retained]);
  await composeFinanceCompatSource({operationalSource:retained,financeSource:path.join(root,'docs'),out:composed});
  execFileSync(process.execPath, [path.join(root,'tools/property-specials-browser.test.mjs')], {
    cwd:root,stdio:'inherit',timeout:90000,
    env:{...process.env,ATLAS_PROPERTY_SPECIALS_BROWSER_SOURCE:path.join(composed,'portfolio-operations-dashboard')}
  });
  console.log('PASS website transport/integration against the exact composed operational assets and retained authentication client.');
} finally { await fs.rm(temp,{recursive:true,force:true}); }
