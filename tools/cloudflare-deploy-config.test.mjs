import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
assert.match(config.account_id,/^[a-f0-9]{32}$/);
assert.equal(createHash('sha256').update(config.account_id).digest('hex'),'76eb07fdfb431c9ddd4fcf92b0b7b2a43dde4bbb6b0b8bfd390b7491a0d4a489','Deploy only to the verified ATLAS Worker account');
assert.equal(config.name,'rise-performance-platform-site');
const workflow=fs.readFileSync('.github/workflows/deploy-cloudflare.yml','utf8');
assert.equal((workflow.match(/apiToken: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/g)||[]).length,2,'Preview and production continue using the existing credential');
assert(workflow.includes('command: versions upload'));
assert(workflow.includes('command: deploy --keep-vars'));

// Exercise the installed, pinned CLI account selector without a network call or credential.
// An explicit account must avoid the /memberships discovery path used in the failed CI run.
const cli=fs.readFileSync('node_modules/wrangler/wrangler-dist/cli.js','utf8');
const start=cli.indexOf('async function getAccountId(config) {'),end=cli.indexOf('\nasync function requireAuth(',start);
assert(start>=0&&end>start,'Pinned Wrangler account selector is available');
const forbidden=()=>{throw Error('Explicit account unexpectedly requested account discovery');};
const context=vm.createContext({getAccountFromCache:forbidden,getAccountChoices:forbidden,getCloudflareAccountIdFromEnv:forbidden});
vm.runInContext(cli.slice(start,end),context);
assert.equal(await context.getAccountId(config),config.account_id);
console.log('PASS explicit verified Cloudflare account bypasses memberships discovery; existing preview/production credentials and deploy commands preserved');
