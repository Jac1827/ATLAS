import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {validateConfig, browserConfig, contentSecurityPolicy} from './isolated-forecast-host/policy.mjs';
import {bootstrap} from './isolated-forecast-host/bootstrap.mjs';
import {createWorker} from './isolated-forecast-host/worker.mjs';
import {configFromEnvironment, prepareHtml, prepareTestHost} from './prepare-forecast-test-host.mjs';

const input = {workerName: 'atlas-forecast-test-fixture', appOrigin: 'https://atlas-forecast-test-fixture.example.workers.dev', apiOrigin: 'https://atlas-forecast-test-fixture.example.workers.dev', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublicKey: 'sb_publishable_synthetic_test_fixture_only'};
const config = validateConfig(input), central = browserConfig(config);
const env = {ATLAS_TEST_WORKER_NAME: input.workerName, ATLAS_TEST_APP_ORIGIN: input.appOrigin, ATLAS_TEST_API_ORIGIN: input.apiOrigin, ATLAS_TEST_SUPABASE_URL: input.supabaseUrl, ATLAS_TEST_SUPABASE_PUBLIC_KEY: input.supabasePublicKey};
const jwt = claims => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
for (const field of Object.keys(input)) assert.throws(() => validateConfig({...input, [field]: ''}), undefined, field);
for (const patch of [
  {workerName: 'rise-performance-platform-site'},
  {appOrigin: 'https://rise-performance-platform-site.jacquelyn-heflin.workers.dev'},
  {appOrigin: 'https://jac1827.github.io'},
  {appOrigin: input.appOrigin + '/portfolio-operations-dashboard/index.html'},
  {apiOrigin: 'https://other.example.workers.dev'},
  {supabaseUrl: 'https://rmyhmvjcswfwaracgriy.supabase.co'},
  {supabaseUrl: 'https://dgkedyzdhneiypqeimhd.supabase.co'},
  {supabaseUrl: 'http://abcdefghijklmnopqrst.supabase.co'},
  {supabaseUrl: 'https://user:password@abcdefghijklmnopqrst.supabase.co'},
  {supabasePublicKey: 'sb_secret_this_must_never_be_written'},
  {supabasePublicKey: jwt({role: 'service_role', ref: config.projectRef})},
  {supabasePublicKey: jwt({role: 'anon', ref: 'rmyhmvjcswfwaracgriy'})}
]) assert.throws(() => validateConfig({...input, ...patch}));
assert.equal(validateConfig({...input, supabasePublicKey: jwt({role: 'anon', ref: config.projectRef})}).projectRef, config.projectRef);
assert.deepEqual(configFromEnvironment({...env, SUPABASE_SERVICE_ROLE_KEY: 'must-not-copy'}), config);
const connect = contentSecurityPolicy(config).split('; ').find(value => value.startsWith('connect-src'));
assert.equal(connect, "connect-src 'self' https://abcdefghijklmnopqrst.supabase.co");
assert(!contentSecurityPolicy(config).includes('https: '));

let forwarded = 0;
const worker = createWorker(config);
const bindings = {ASSETS: {async fetch() { forwarded++; return new Response('<html></html>', {headers: {'content-type': 'text/html'}}); }}};
const get = (pathname, method = 'GET') => worker.fetch(new Request(input.appOrigin + pathname, {method}), bindings);
assert.equal((await get('/')).headers.get('location'), input.appOrigin + '/portfolio-operations-dashboard/index.html');
assert.equal((await get('/api/atlas/access/invite', 'POST')).status, 503);
assert.equal((await get('/api/sync')).status, 503);
assert.equal((await get('/upload', 'POST')).status, 503);
assert.equal(forwarded, 0);
assert.equal((await worker.fetch(new Request('https://other.example.workers.dev/'), bindings)).status, 421);
const response = await get('/portfolio-operations-dashboard/index.html');
assert.equal(response.headers.get('content-security-policy'), contentSecurityPolicy(config));
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.equal(forwarded, 1);
const redirected = await worker.fetch(new Request(input.appOrigin + '/redirect'), {ASSETS: {fetch: async () => Response.redirect('https://jac1827.github.io/ATLAS/')}});
assert.equal(redirected.status, 502);
assert.equal((await (await get('/__atlas_test_health')).json()).serverIntegrations, false);

const state = new Map([['atlas_central_runtime_config_v1', '{"supabaseUrl":"production"}'], ['atlas_central_auth_session_v1', 'old-project-token']]);
function runBootstrap({storageFails = false} = {}) {
  const pending = [], appended = [], page = {fetch: async () => ({ok: true})};
  const localStorage = {getItem: key => state.get(key) ?? null, setItem: (key, value) => {if (storageFails) throw new Error('disabled'); state.set(key, value);}, removeItem: key => state.delete(key)};
  const document = {head: {appendChild: value => appended.push(value)}, createElement: () => ({}), addEventListener: (event, handler) => pending.push({event, handler})};
  const context = vm.createContext({window: page, localStorage, document, location: {origin: input.appOrigin, href: input.appOrigin + '/'}, URL, console});
  try { vm.runInContext(`(${bootstrap.toString()})(${JSON.stringify(config)},${JSON.stringify(central)})`, context); }
  catch (error) { return {error, appended}; }
  return {page, appended};
}
let boot = runBootstrap();
assert.equal(state.has('atlas_central_auth_session_v1'), false, 'old project credentials removed before client startup');
assert.deepEqual(JSON.parse(state.get('atlas_central_runtime_config_v1')), central, 'local override cannot shadow injected test config');
state.set('atlas_central_auth_session_v1', 'current-test-session');
boot = runBootstrap();
assert.equal(state.get('atlas_central_auth_session_v1'), 'current-test-session', 'iframe/reload must preserve test login');
await assert.rejects(boot.page.fetch(config.supabaseUrl + '/auth/v1/otp'), /disabled/);
assert.equal((await boot.page.fetch(config.supabaseUrl + '/auth/v1/token?grant_type=password')).ok, true);
const blocked = runBootstrap({storageFails: true});
assert.match(blocked.error.message, /cannot start safely/);
assert.match(blocked.appended[0].content, /script-src 'none'/, 'later production-default scripts blocked after setup failure');
assert.throws(() => prepareHtml('<script>unsafe()</script>', config), /lacks a head/);
const html = prepareHtml('<html><head><script src="central-client.js"></script></head></html>', config);
assert(html.indexOf('data-atlas-isolated-test') < html.indexOf('src="central-client.js"'));

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-forecast-host-test-'));
try {
  await assert.rejects(prepareTestHost({env: {}, out: path.join(temp, 'missing')}));
  await assert.rejects(prepareTestHost({env, out: path.resolve('output/unsafe-test-host')}), /outside the repository/);
  const source = path.join(temp, 'source'); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'index.html'), '<html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script></head><body></body></html>');
  await fs.writeFile(path.join(source, 'private.sql'), 'not an asset');
  const result = await prepareTestHost({env, out: path.join(temp, 'prepared'), sourceDirectory: source});
  const wrangler = JSON.parse(await fs.readFile(path.join(result.directory, 'wrangler.jsonc'), 'utf8'));
  assert.deepEqual(Object.keys(wrangler).sort(), ['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'assets'].sort());
  assert.equal(wrangler.assets.run_worker_first, true);
  assert.equal(wrangler.name, input.workerName);
  assert.deepEqual(await fs.readdir(path.join(result.directory, 'assets')), ['index.html']);
  const prepared = await fs.readFile(path.join(result.directory, 'assets/index.html'), 'utf8');
  assert(prepared.includes('/portfolio-operations-dashboard/assets/xlsx.full.min.js'));
  assert(!prepared.includes('https://cdnjs.cloudflare.com'));
  await assert.rejects(prepareTestHost({env, out: result.directory, sourceDirectory: source}), /EEXIST/);
  const original = await fs.readFile(path.join(source, 'index.html'), 'utf8');
  assert(!original.includes('data-atlas-isolated-test'), 'source assets are unchanged');
} finally { await fs.rm(temp, {recursive: true, force: true}); }
console.log('PASS isolated Forecast host: explicit config, production/secret rejection, denied server effects, CSP, bootstrap/session isolation, output safety.');
