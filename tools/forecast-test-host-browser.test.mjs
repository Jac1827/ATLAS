// Browser wiring acceptance only. All HTTP responses are intercepted; no hosted service is called.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {prepareTestHost, configFromEnvironment} from './prepare-forecast-test-host.mjs';
import {createWorker} from './isolated-forecast-host/worker.mjs';
const require = createRequire(import.meta.url), {chromium} = require(process.env.ATLAS_PLAYWRIGHT || 'playwright');
const origin = 'https://atlas-forecast-test-browser.example.workers.dev', database = 'https://abcdefghijklmnopqrst.supabase.co';
const env = {ATLAS_TEST_WORKER_NAME: 'atlas-forecast-test-browser', ATLAS_TEST_APP_ORIGIN: origin, ATLAS_TEST_API_ORIGIN: origin, ATLAS_TEST_SUPABASE_URL: database, ATLAS_TEST_SUPABASE_PUBLIC_KEY: 'sb_publishable_synthetic_browser_fixture_only'};
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-isolated-browser-'));
const actor = '00000000-0000-0000-0000-000000000001', community = '10000000-0000-0000-0000-000000000001';
const profile = {user_id: actor, email: 'forecast-admin@example.invalid', display_name: 'Synthetic Admin', role: 'admin', status: 'active', account_status: 'active', allowed_community_ids: [community], locked_tab_ids: [], locked_page_keys: []};
const contentTypes = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json'};
let browser;
try {
  const prepared = await prepareTestHost({env, out: path.join(temp, 'host')});
  const worker = createWorker(configFromEnvironment(env)), requests = [], unexpected = [], violations = [], saveGuardLoads = [];
  const manifest = JSON.parse(await fs.readFile(new URL('../docs/portfolio-operations-dashboard/performance/asset-manifest.json', import.meta.url), 'utf8'));
  const bindings = {ASSETS: {async fetch(request) {
    const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const file = path.resolve(prepared.directory, 'assets', relative);
    if (!file.startsWith(path.join(prepared.directory, 'assets') + path.sep)) return new Response(null, {status: 404});
    try { return new Response(await fs.readFile(file), {headers: {'content-type': contentTypes[path.extname(file)] || 'application/octet-stream'}}); }
    catch { return new Response(null, {status: 404}); }
  }}};
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) {
      const response = await worker.fetch(new Request(request.url(), {method: request.method()}), bindings);
      if (url.pathname.endsWith('/market-save-guards.js')) saveGuardLoads.push({status: response.status, version: url.searchParams.get('v')});
      await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
    } else if (url.origin === database) {
      requests.push(url.pathname);
      let data = [];
      if (url.pathname === '/auth/v1/token') data = {access_token: 'synthetic-test-token', refresh_token: 'synthetic-refresh', expires_in: 3600, user: {id: actor, email: profile.email}};
      else if (url.pathname === '/auth/v1/user') data = {id: actor, email: profile.email};
      else if (url.pathname === '/rest/v1/atlas_user_profiles') data = [profile];
      else if (url.pathname === '/rest/v1/atlas_communities') data = [{community_id: community, display_name: 'Synthetic Community', status: 'active'}];
      else if (url.pathname === '/rest/v1/rpc/atlas_read_reforecast_builder_source') data = {communityId: community, syntheticWiringReceipt: true};
      await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': origin}, body: JSON.stringify(data)});
    } else {
      if (!['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'].includes(url.hostname)) unexpected.push(url.origin);
      await route.abort();
    }
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.testCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.testCspViolations.push({blocked: event.blockedURI, directive: event.effectiveDirective}));
    if (!localStorage.getItem('fixture-initialized')) {
      localStorage.setItem('fixture-initialized', 'true');
      localStorage.setItem('atlas_central_runtime_config_v1', JSON.stringify({supabaseUrl: 'https://rmyhmvjcswfwaracgriy.supabase.co'}));
      localStorage.setItem('atlas_central_auth_session_v1', JSON.stringify({access_token: 'old-project-token'}));
    }
  });
  await page.goto(origin + '/portfolio-operations-dashboard/index.html');
  await page.waitForFunction(() => window.ATLAS_CENTRAL && window.XLSX);
  assert.equal(await page.locator('#atlas-isolated-test-banner').count(), 1);
  const readback = await page.evaluate(async () => {
    const central = window.ATLAS_CENTRAL;
    if (central.getSession()?.access_token) throw new Error('Old project session survived startup');
    await central.signInWithPassword('forecast-admin@example.invalid', 'synthetic-only');
    return {config: central.getConfig(), profile: await central.fetchProfile(), communities: await central.readCommunitiesForAccess(), users: await central.readUserProfiles(), source: await central.fetchJson('/rpc/atlas_read_reforecast_builder_source', {method: 'POST', body: JSON.stringify({p_community_id: '10000000-0000-0000-0000-000000000001', p_periods: ['2026-10']})})};
  });
  assert.equal(readback.config.supabaseUrl, database);
  assert.equal(readback.config.accessApiBaseUrl, origin);
  assert.equal(readback.profile.role, 'admin');
  assert.equal(readback.communities[0].community_id, community);
  assert.equal(readback.users[0].user_id, actor);
  assert.equal(readback.source.syntheticWiringReceipt, true);
  await page.reload();
  await page.waitForFunction(() => window.ATLAS_CENTRAL?.getSession()?.access_token === 'synthetic-test-token');
  await page.waitForFunction(() => typeof getAtlasSaveContextKey === 'function' && getAtlasSaveContextKey());
  assert(saveGuardLoads.length >= 2, 'The real classic guard asset must load on startup and reload');
  assert(saveGuardLoads.every(load => load.status === 200 && load.version === manifest['market-save-guards.js'].sha256), 'The browser must receive the content-keyed guard asset successfully');
  const saveGuard = await page.evaluate(() => {
    const key = JSON.parse(getAtlasSaveContextKey()), captured = captureAtlasSaveContext();
    const currentBeforeAuthEvent = captured();
    window.dispatchEvent(new CustomEvent('atlas-central-auth-change'));
    return {actor: key.actor, service: key.service, currentBeforeAuthEvent, oldCurrentAfterAuthEvent: captured(), freshCurrentAfterAuthEvent: captureAtlasSaveContext()()};
  });
  assert.equal(saveGuard.actor, actor, 'The loaded guard reads the actual main-script session actor');
  assert.equal(saveGuard.service, database, 'The loaded guard reads the isolated source configuration');
  assert.equal(saveGuard.currentBeforeAuthEvent, true);
  assert.equal(saveGuard.oldCurrentAfterAuthEvent, false, 'The real inline auth listener invalidates the prior capture');
  assert.equal(saveGuard.freshCurrentAfterAuthEvent, true, 'A valid fresh capture retains same-context saves');
  const libraries = await page.evaluate(async () => {
    const {PDFDocument} = await import('./vendor/pdf-lib-1.17.1.mjs');
    const document = await PDFDocument.create(); document.addPage().drawText('Synthetic statement smoke test');
    const pdf = await document.save();
    const {inspectProviderStatement} = await import('./features/reforecast-provider.mjs');
    const parsed = await inspectProviderStatement(pdf, {filename: 'synthetic.pdf', communityId: '10000000-0000-0000-0000-000000000001'});
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Synthetic', 123]]), 'Test');
    const bytes = XLSX.write(book, {bookType: 'xlsx', type: 'array'});
    const roundtrip = XLSX.read(bytes, {type: 'array'});
    return {pdf: new TextDecoder().decode(pdf.slice(0, 4)), parserHash: parsed.source.sha256, value: roundtrip.Sheets.Test.B1.v};
  });
  assert.equal(libraries.pdf, '%PDF'); assert(libraries.parserHash); assert.equal(libraries.value, 123);
  const blocked = await page.evaluate(async () => {
    const results = [];
    for (const url of ['https://rmyhmvjcswfwaracgriy.supabase.co/rest/v1/atlas_communities', 'https://rise-performance-platform-site.jacquelyn-heflin.workers.dev/api/sync', 'https://abcdefghijklmnopqrst.supabase.co/auth/v1/otp']) {
      try { await fetch(url, {method: 'POST'}); results.push(false); } catch { results.push(true); }
    }
    results.push((await fetch('/api/atlas/access/invite', {method: 'POST'})).status === 503);
    return results;
  });
  assert.deepEqual(blocked, [true, true, true, true]);
  violations.push(...await page.evaluate(() => window.testCspViolations));
  assert(violations.some(item => item.blocked.includes('rmyhmvjcswfwaracgriy') && item.directive === 'connect-src'));
  assert(!requests.includes('/auth/v1/otp'));
  assert.deepEqual(unexpected, [], 'no production/other HTTP request escaped the test CSP');
  console.log('PASS isolated host browser: real client Auth/profile/community/RPC wiring, session reload, local PDF generation/parser worker and XLSX, production/email/API blocking. All database responses were synthetic.');
} finally {
  await browser?.close();
  await fs.rm(temp, {recursive: true, force: true});
}
