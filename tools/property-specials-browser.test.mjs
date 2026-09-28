// Browser transport regression and authenticated local integration. Chromium loads
// the production client, Community Settings handlers, and Comp Calculator renderer
// from one origin, and calls the actual Worker + SQLite Durable Object at another.
// Only the surrounding dashboard shell, auth/database service, and public website
// responses are fixtures. No production account, website or storage is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.ATLAS_PLAYWRIGHT || 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const browserSource = process.env.ATLAS_PROPERTY_SPECIALS_BROWSER_SOURCE || path.join(root, 'docs/portfolio-operations-dashboard');
const scriptNames = [
  'centralization/atlas-central-client.js',
  'property-intelligence.js',
  'property-organization.js',
  'concession-insights.js'
];
const scripts = new Map(await Promise.all(scriptNames.map(async name => [
  '/' + name, await fs.readFile(path.join(browserSource, name), 'utf8')
])));
const communities = [
  {community_id:'11111111-1111-4111-8111-111111111111', display_name:'Bartram Park', canonical_name:'Bartram Park'},
  {community_id:'22222222-2222-4222-8222-222222222222', display_name:'Cedar Creek', canonical_name:'Cedar Creek'},
  {community_id:'33333333-3333-4333-8333-333333333333', display_name:'Outside Scope', canonical_name:'Outside Scope'}
];
const [bartram, cedar, outside] = communities;
const urls = {
  bartram:['https://bartram.example/', 'https://bartram.example/floorplans'],
  cedar:['https://cedar.example/', 'https://cedar.example/rates']
};
let communityData = {
  [bartram.display_name]:{communityId:bartram.community_id, communityWebsiteUrl:'', floorPlanRatesPageUrl:''},
  // Simulates previously saved community URLs whose configure request was blocked.
  [cedar.display_name]:{communityId:cedar.community_id, communityWebsiteUrl:urls.cedar[0], floorPlanRatesPageUrl:urls.cedar[1], websiteSettingsUpdatedAt:'2026-01-01T00:00:00.000Z'}
};
const sessions = new Map();
const pageResponses = new Map();
const outboundRequests = [];
const transport = [];
const pageErrors = [];
let rejectPreflight = false;
let dropConfigure = false;
let projectionAvailable = true;
let sessionSequence = 0;
let apiOrigin;
let uiOrigin;
let browser;
let mf;

function profileFor(user) {
  return {
    user_id:user.id, email:user.email, role:'community_manager', status:'active', account_status:'active',
    allowed_community_ids:user.email.startsWith('restricted@') ? [bartram.community_id] : [bartram.community_id, cedar.community_id]
  };
}
function authenticated(headers) {
  return sessions.get(String(headers.get('authorization') || '').replace(/^Bearer /, ''));
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json'}});
}
async function databaseFixture(request) {
  const url = new URL(request.url);
  const user = authenticated(request.headers);
  if (url.pathname === '/auth/v1/user') return user ? jsonResponse(user) : jsonResponse({message:'Invalid session'}, 401);
  if (url.pathname === '/rest/v1/atlas_user_profiles') {
    const id = url.searchParams.get('user_id')?.replace(/^eq\./, '');
    const found = [...sessions.values()].find(item => item.id === id);
    return jsonResponse(found ? [profileFor(found)] : []);
  }
  if (url.pathname === '/rest/v1/atlas_communities') {
    const filters = ['community_id', 'display_name', 'canonical_name', 'source_identifier'];
    const filter = filters.find(key => url.searchParams.has(key));
    const value = filter && url.searchParams.get(filter).replace(/^eq\./, '');
    return jsonResponse(filter ? communities.filter(item => item[filter] === value) : communities.filter(item => user && profileFor(user).allowed_community_ids.includes(item.community_id)));
  }
  if (url.pathname === '/rest/v1/rpc/atlas_read_workspace_projection') {
    assert(user, 'Reconciliation must read the authenticated user projection');
    if (!projectionAvailable) return jsonResponse({code:'PGRST202',message:'Could not find the function public.atlas_read_workspace_projection in the schema cache'},404);
    const allowed = profileFor(user).allowed_community_ids;
    const scoped = Object.fromEntries(Object.entries(communityData).filter(([,record]) => allowed.includes(record.communityId)));
    return jsonResponse({status:'available', projection:{communityData:scoped}});
  }
  throw new Error('Unexpected synthetic database request: ' + url.pathname);
}
function htmlPage(offer) {
  return `<html><body><h1>Our apartment community</h1><p>Welcome to our beautiful community. Find the perfect home, explore amenities, floor plans and the neighborhood, or contact our leasing team to arrange a visit.</p><div>${offer}</div></body></html>`;
}
function websiteResponse(address, offer, status = 200) {
  pageResponses.set(address, {status, body:htmlPage(offer)});
}
function setOffers(addresses, offer) {
  for (const address of addresses) websiteResponse(address, offer);
}
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
async function sendResponse(response, res) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
}
function close(server) {
  return new Promise(resolve => server.close(resolve));
}

// The fixture shell deliberately delegates website save/read/collect and all
// concessions HTML to production functions. Local community persistence is an
// adapter here; the authoritative server projection persists across browser contexts.
function fixtureHtml() {
  return `<!doctype html><meta charset="utf-8"><title>ATLAS website integration fixture</title>
  <form id="login"><label>Email<input name="email" value="manager@risere.com"></label><label>Password<input name="password" type="password" value="local-fixture-password"></label><button>Sign in</button></form>
  <nav><button id="settings">Community Settings</button><button id="insights">Comp Calculator</button></nav><main id="app"></main>
  <script>
    window.ATLAS_CENTRAL_CONFIG = ${JSON.stringify({accessApiBaseUrl:apiOrigin, supabaseUrl:uiOrigin, supabaseAnonKey:'synthetic-public-key', allowedEmailDomains:['risere.com']})};
    window.savedData = ${JSON.stringify(communityData)};
    window.fixture = {view:'settings', name:'Bartram Park', pushes:[], graphWrite:Promise.resolve()};
    window.communityWebsiteUrl = savedData[fixture.name].communityWebsiteUrl;
    window.floorPlanRatesPageUrl = savedData[fixture.name].floorPlanRatesPageUrl;
    window.ATLAS_STATE_COMMUNITY_KEY = 'fixture_community_data';
    window.atlasStateWritePromise = Promise.resolve();
    window.dataImport2State = {canonicalRecords:[]};
    window.getProp = () => ({name:fixture.name});
    window.getCurrentCommunityRecord = () => ({...savedData[fixture.name],communityWebsiteUrl,floorPlanRatesPageUrl});
    window.normalizeSavedCommunityRecord = (name,record) => ({...record});
    window.persistSaved = () => {localStorage.setItem(ATLAS_STATE_COMMUNITY_KEY,JSON.stringify(savedData));atlasStateWritePromise=Promise.resolve();};
    window.atlasStateGetValue = async key => localStorage.getItem(key);
    window.queueAtlasCentralDocumentPush = reason => {
      fixture.pushes.push(reason);
      const snapshot = JSON.stringify(savedData);
      fixture.graphWrite = fixture.graphWrite.then(()=>fetch('/fixture/community-data',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+ATLAS_CENTRAL.getSession().access_token},body:snapshot}));
      return fixture.graphWrite;
    };
    window.getSelectedDashboardPeriodKey = () => new Date().toISOString().slice(0,7);
    window.getWorkspaceScopedDetails = () => Object.entries(savedData).filter(([,record])=>ATLAS_CENTRAL.getStoredProfile()?.allowed_community_ids.includes(record.communityId)).map(([name,record])=>({name,record}));
    window.getCompCalculatorScopeMeta = () => ({marketArea:'Fixture market'});
    window.renderTab = () => {
      const app=document.getElementById('app');
      if(fixture.view==='insights'){app.innerHTML=AtlasConcessionInsights.render();return;}
      app.innerHTML='<h1>Community Settings</h1><label>Community website URL<input id="website" value="'+communityWebsiteUrl+'"></label><label>Floor plan / rates page URL<input id="floorplan" value="'+floorPlanRatesPageUrl+'"></label>'+atlasWebsiteSaveStatus();
      document.getElementById('website').onchange=e=>atlasSaveWebsiteField('communityWebsiteUrl',e.target.value);
      document.getElementById('floorplan').onchange=e=>atlasSaveWebsiteField('floorPlanRatesPageUrl',e.target.value);
    };
  </script>
  ${scriptNames.map(name => `<script src="/${name}"></script>`).join('\n')}
  <script>
    document.getElementById('login').onsubmit=async e=>{e.preventDefault();const form=new FormData(e.target);await ATLAS_CENTRAL.signInWithPassword(form.get('email'),form.get('password'));e.target.hidden=true;renderTab();};
    document.getElementById('settings').onclick=()=>{fixture.view='settings';renderTab();};
    document.getElementById('insights').onclick=()=>{fixture.view='insights';renderTab();};
  </script>`;
}

const uiServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, uiOrigin || 'http://localhost');
    if (url.pathname === '/') {
      res.setHeader('content-type', 'text/html'); res.end(fixtureHtml()); return;
    }
    if (scripts.has(url.pathname)) {
      res.setHeader('content-type', 'text/javascript'); res.end(scripts.get(url.pathname)); return;
    }
    const body = await readBody(req);
    if (url.pathname === '/auth/v1/token') {
      const input = JSON.parse(body);
      assert.equal(input.password, 'local-fixture-password');
      const id = input.email.startsWith('restricted@') ? 'restricted-user' : 'fixture-manager';
      const user = {id, email:input.email};
      const token = 'fixture-session-' + (++sessionSequence);
      sessions.set(token, user);
      await sendResponse(jsonResponse({access_token:token,refresh_token:'refresh-'+token,expires_in:3600,token_type:'bearer',user}), res); return;
    }
    const request = new Request(url, {method:req.method, headers:req.headers, ...(body ? {body} : {})});
    if (url.pathname === '/fixture/community-data') {
      const user = authenticated(request.headers);
      assert(user, 'Community URL persistence requires authentication');
      const rows = JSON.parse(body);
      const allowed = profileFor(user).allowed_community_ids;
      for (const [name,record] of Object.entries(rows)) {
        assert(allowed.includes(record.communityId));
        communityData[name] = record;
      }
      await sendResponse(jsonResponse({ok:true}),res); return;
    }
    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/rest/')) {
      await sendResponse(await databaseFixture(request), res); return;
    }
    res.writeHead(404); res.end();
  } catch (error) { res.writeHead(500); res.end(error.stack); }
});
const apiServer = createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const entry = {
      method:req.method, path:req.url, origin:req.headers.origin,
      requestedMethod:req.headers['access-control-request-method'],
      requestedHeaders:req.headers['access-control-request-headers'],
      hasAuthorization:Boolean(req.headers.authorization), body:body ? JSON.parse(body) : null
    };
    transport.push(entry);
    if (dropConfigure && entry.body?.action === 'configure') {
      entry.status = 0;
      res.destroy();
      return;
    }
    // Sensitivity control: reproduces the original route's 405 response before
    // enabling the real route, proving a browser blocks POST at this boundary.
    const response = rejectPreflight && req.method === 'OPTIONS'
      ? new Response('Use POST.', {status:405, headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type, authorization, apikey'}})
      : await mf.dispatchFetch(apiOrigin + req.url, {method:req.method,headers:req.headers,...(body ? {body} : {})});
    entry.status = response.status;
    entry.responseHeaders = Object.fromEntries(response.headers);
    await sendResponse(response, res);
  } catch (error) { res.writeHead(500); res.end(error.stack); }
});

const apiCall = (page, action, community = bartram, extra = {}) => page.evaluate(async ({action,community,extra}) => {
  try {
    return await ATLAS_CENTRAL.propertySpecials(action, {communityName:community.display_name,communityId:community.community_id,...extra});
  } catch(error) {
    return {error:error.message,stage:error.stage,status:error.status,code:error.code};
  }
}, {action,community,extra});

async function login(context, email = 'manager@risere.com') {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(uiOrigin);
  assert.equal(await page.evaluate(() => ATLAS_CENTRAL.getSession()), null, 'Fresh browser context starts without an authenticated session');
  await page.getByLabel('Email', {exact:true}).fill(email);
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
  await page.getByRole('heading', {name:'Community Settings',exact:true}).waitFor();
  assert.equal(await page.evaluate(() => ATLAS_CENTRAL.getStoredProfile().status), 'active');
  return page;
}
async function saveField(page, label, value) {
  await page.getByLabel(label, {exact:true}).fill(value);
  await page.getByLabel(label, {exact:true}).press('Tab');
  await page.waitForFunction(() => {
    const status = document.querySelector('[role=status]')?.textContent || '';
    return !/Connecting|automatically/.test(status);
  });
  await page.evaluate(() => fixture.graphWrite);
}
async function showInsights(page) {
  await page.getByRole('button', {name:'Comp Calculator',exact:true}).click();
  await page.getByRole('heading', {name:'Concessions & competition',exact:true}).waitFor();
  await page.waitForFunction(() => [...AtlasPropertyService.cache.values()].length === 2 && !document.body.textContent.includes('Loading website history'));
}
const card = (page, community = bartram) => page.locator('article.ci-card').filter({has:page.getByRole('checkbox',{name:'Compare '+community.display_name,exact:true})});
async function collectFromCard(page, community = bartram) {
  const before = await page.evaluate(name => AtlasPropertyService.cache.get(name)?.observations?.length || 0, community.display_name);
  await card(page, community).getByRole('button', {name:'Check website now',exact:true}).click();
  await page.waitForFunction(({name,before}) => (AtlasPropertyService.cache.get(name)?.observations?.length || 0) > before, {name:community.display_name,before});
  return page.evaluate(name => AtlasPropertyService.cache.get(name), community.display_name);
}

try {
  const bundle = await build({
    stdin:{contents:`import worker from './src/worker.mjs';import {PropertySpecialsState} from './src/property-specials-store.mjs';
      export class BrowserTestSpecials extends PropertySpecialsState {async testAlarm(clear=false){if(clear)await this.ctx.storage.deleteAlarm();return this.ctx.storage.getAlarm();}}
      export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/__fixture/alarm')return Response.json({alarm:await env.PROPERTY_SPECIALS.getByName(url.searchParams.get('id')).testAlarm(url.searchParams.has('clear'))});return worker.fetch(request,env,ctx);}};`,resolveDir:root},
    bundle:true,write:false,format:'esm',external:['cloudflare:workers']
  });
  mf = new Miniflare({
    modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-01',
    durableObjects:{PROPERTY_SPECIALS:{className:'BrowserTestSpecials',useSQLite:true}},
    bindings:{SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'fixture-public-key',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key'},
    outboundService:async request => {
      const url = new URL(request.url);
      outboundRequests.push({url:url.href,method:request.method,authorization:request.headers.get('authorization')});
      if (url.origin === 'https://auth.example') return databaseFixture(request);
      const response = pageResponses.get(url.href);
      assert(response, 'Unconfigured outbound website request: ' + url.href);
      return new Response(response.body, {status:response.status,headers:{'content-type':'text/html'}});
    }
  });
  await mf.ready;
  apiOrigin = await listen(apiServer);
  uiOrigin = await listen(uiServer);
  assert.notEqual(apiOrigin, uiOrigin, 'Fixture must exercise a genuinely cross-origin fetch');
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext();
  const page = await login(context);

  rejectPreflight = true;
  await saveField(page, 'Community website URL', urls.bartram[0]);
  assert.equal(communityData[bartram.display_name].communityWebsiteUrl, urls.bartram[0]);
  assert.equal(transport.filter(row => row.method === 'POST').length, 0, 'Rejected browser preflight prevents the actual POST');
  assert(transport.some(row => row.method === 'OPTIONS' && row.status === 405));
  assert.match(await page.getByRole('status').innerText(), /configuration.*transport|transport.*configuration/i, 'Saved URLs expose a configuration transport diagnostic');
  console.log('PASS browser sensitivity: rejected OPTIONS saves community URL but suppresses POST and reports the configuration transport stage.');

  rejectPreflight = false;
  transport.length = 0;
  await saveField(page, 'Floor plan / rates page URL', urls.bartram[1]);
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('saved centrally'));
  const preflight = transport.find(row => row.method === 'OPTIONS');
  assert.equal(preflight?.status, 204);
  assert.equal(preflight.origin, uiOrigin);
  assert.equal(preflight.requestedMethod, 'POST');
  for (const header of ['authorization','content-type']) {
    assert(preflight.requestedHeaders.toLowerCase().includes(header));
    assert(preflight.responseHeaders['access-control-allow-headers'].toLowerCase().includes(header));
  }
  assert(['*',uiOrigin].includes(preflight.responseHeaders['access-control-allow-origin']));
  assert(preflight.responseHeaders['access-control-allow-methods'].split(',').includes('POST'));
  assert(transport.findIndex(row => row.method === 'POST') > transport.indexOf(preflight), 'Browser sends the real authenticated POST after preflight');
  assert(transport.find(row => row.method === 'POST').hasAuthorization);

  let state = await apiCall(page, 'read');
  assert.equal(state.communityId, bartram.community_id);
  assert.equal(state.settings.communityId, bartram.community_id);
  assert.equal(state.settings.website, urls.bartram[0]);
  assert.equal(state.settings.floorplan, urls.bartram[1]);
  const alarm = async community => (await (await mf.dispatchFetch('http://fixture/__fixture/alarm?id='+community.community_id)).json()).alarm;
  assert((await alarm(bartram)) > Date.now(), 'Configure schedules collection');
  const beforeConfigure = await alarm(bartram);
  await apiCall(page, 'configure', bartram, {communityWebsiteUrl:urls.bartram[0],floorPlanRatesPageUrl:urls.bartram[1]});
  assert((await alarm(bartram)) >= beforeConfigure, 'Idempotent configure refreshes the scheduled collection alarm');
  console.log('PASS actual Worker OPTIONS 204/CORS headers, authenticated POST, canonical mapping, both saved URLs, read and configure alarm.');

  projectionAvailable = false;
  const projectionStart = outboundRequests.length;
  await showInsights(page);
  const cedarState = await apiCall(page, 'read', cedar);
  assert.equal(cedarState.settings.communityId, cedar.community_id);
  assert.equal(cedarState.settings.website, urls.cedar[0]);
  assert.equal(cedarState.settings.floorplan, urls.cedar[1]);
  assert((await alarm(cedar)) > Date.now(), 'Reading an authorized community repairs its missing website alarm');
  assert.equal(cedarState.offers.length, 0, 'Settings backfill must not invent offers');
  assert.equal(outboundRequests.slice(projectionStart).filter(row => row.url.includes('/rpc/atlas_read_workspace_projection')).length, 0, 'Persisted authorized browser settings recover without requiring an undeployed workspace projection');
  projectionAvailable = true;

  setOffers(urls.bartram, 'One month free rent');
  const fetchStart = outboundRequests.length;
  state = await collectFromCard(page);
  assert.equal(state.current.status, 'found');
  assert.equal(state.observations.at(-1).status, 'found');
  assert.equal(state.observations.at(-1).pages.length, 2);
  assert.deepEqual(outboundRequests.slice(fetchStart).filter(row => row.url.startsWith('https://bartram.example/')).map(row => row.url).sort(), [...urls.bartram].sort(), 'Both configured URLs reach the server-side fetcher');
  assert.match(await card(page).innerText(), /One month free rent/);
  assert.match(await card(page).innerText(), /Website verified/);
  assert.doesNotMatch(await page.locator('body').innerText(), /Failed to fetch/);
  const firstOffer = state.current.offerId;
  const firstVerified = state.current.lastVerifiedAt;
  const firstOfferRecord = structuredClone(state.offers.find(item => item.id === firstOffer));
  state = await collectFromCard(page);
  assert.equal(state.current.offerId, firstOffer);
  assert.equal(state.offers.length, 1, 'Repeated unchanged collections do not duplicate offers');
  const lastVerifiedBeforeFailure = state.current.lastVerifiedAt;

  websiteResponse(urls.bartram[0], '', 503);
  state = await collectFromCard(page);
  assert.equal(state.current.status, 'failed');
  assert.equal(state.current.offerId, firstOffer, 'A failed collection retains the previous verified offer');
  assert.equal(state.current.lastVerifiedAt, lastVerifiedBeforeFailure, 'Collection failure must not advance the verified date');
  assert.equal(state.offers.length, 1);
  assert.equal(state.observations.at(-1).pages.length, 2);
  assert.match(await card(page).innerText(), /previous offer retained/i);
  assert.equal(state.observations.at(-1).pages.find(item => item.url === urls.bartram[0]).stage, 'website_retrieval');

  for (const [text,stage,label] of [
    ['Enable JavaScript to continue', 'blocked_dynamic_website', /requires browser rendering/i],
    ['Limited time leasing special; contact our team for details', 'extraction', /Offer extraction failure/i]
  ]) {
    websiteResponse(urls.bartram[0], text);
    state = await collectFromCard(page);
    assert.equal(state.current.status, 'failed');
    assert.equal(state.current.offerId, firstOffer);
    assert.equal(state.current.lastVerifiedAt, lastVerifiedBeforeFailure);
    assert.equal(state.offers.length, 1);
    const evidence = state.observations.at(-1).pages.find(item => item.url === urls.bartram[0]);
    assert.equal(evidence.stage, stage);
    assert(evidence.evidence.includes(text), 'Failed extraction retains per-page evidence');
    assert.match(await card(page).innerText(), label);
  }

  websiteResponse(urls.bartram[0], 'One month free rent');
  websiteResponse(urls.bartram[1], 'Two months free rent');
  state = await collectFromCard(page);
  assert.equal(state.current.status, 'conflict');
  assert.equal(state.current.offerId, firstOffer);
  assert.equal(state.offers.length, 1);
  assert.match(await card(page).innerText(), /Conflicting website offers/i);

  setOffers(urls.bartram, 'Two months free rent');
  state = await collectFromCard(page);
  assert.equal(state.current.status, 'found');
  assert.notEqual(state.current.offerId, firstOffer);
  assert.equal(state.offers.length, 2, 'A changed offer creates exactly one new history entry');
  assert(state.offers.find(item => item.id === firstOffer).closedAt);
  assert.equal(state.offers.find(item => item.id === firstOffer).firstObservedAt, firstOfferRecord.firstObservedAt);
  const secondOffer = state.current.offerId;
  state = await collectFromCard(page);
  assert.equal(state.current.offerId, secondOffer);
  assert.equal(state.offers.length, 2);
  assert(state.current.lastVerifiedAt >= firstVerified);

  setOffers(urls.cedar, 'No current specials');
  const cedarCollected = await collectFromCard(page, cedar);
  assert.equal(cedarCollected.current.status, 'none');
  assert.equal(cedarCollected.offers.length, 1);
  assert.equal(cedarCollected.offers[0].text, 'No special listed');
  assert.match(await card(page, cedar).innerText(), /No special listed/);
  assert.doesNotMatch(await card(page, cedar).innerText(), /Two months free rent|bartram\.example/);
  assert.equal((await apiCall(page,'read')).offers.length, 2, 'Second community collection cannot alter Bartram history');
  console.log('PASS Community Settings → configure/read → both server fetches → SQLite observations → Comp Calculator; found/none/conflict/failed, prior-offer retention and exactly-once offer changes.');

  const stable = await apiCall(page, 'read');
  await mf.dispatchFetch('http://fixture/__fixture/alarm?id='+bartram.community_id+'&clear');
  assert.equal(await alarm(bartram), null);
  const refreshed = await apiCall(page, 'reconcile');
  assert((await alarm(bartram)) > Date.now(), 'Reconciliation repairs a missing alarm for existing verified history');
  assert.deepEqual(refreshed.offers, stable.offers, 'Backfill leaves verified offer history untouched');
  assert.deepEqual(refreshed.observations, stable.observations);

  // A later failed configure must be recoverable too: the last successful
  // settings cannot silently replace a newer, durably saved community URL pair.
  await page.getByRole('button', {name:'Community Settings',exact:true}).click();
  dropConfigure = true;
  const repairedUrl = 'https://bartram.example/current-rates';
  await saveField(page, 'Floor plan / rates page URL', repairedUrl);
  await page.getByRole('button', {name:'Retry website settings',exact:true}).waitFor();
  assert.equal(communityData[bartram.display_name].floorPlanRatesPageUrl, repairedUrl);
  assert.equal((await apiCall(page, 'read')).settings.floorplan, urls.bartram[1], 'A failed configure has not changed central settings');
  dropConfigure = false;
  await page.getByRole('button', {name:'Retry website settings',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('saved centrally'));
  const retried = await apiCall(page, 'read');
  assert.equal(retried.settings.website, urls.bartram[0]);
  assert.equal(retried.settings.floorplan, repairedUrl);
  assert.equal(retried.settings.sourceUpdatedAt, communityData[bartram.display_name].websiteSettingsUpdatedAt);
  assert.deepEqual(retried.offers, stable.offers, 'Retrying the saved URLs does not duplicate or overwrite verified history');
  assert.deepEqual(retried.observations, stable.observations);

  // Legacy browser graph identifiers are namespaced local keys, not canonical
  // server IDs. The production service must omit them and resolve by unique name.
  const legacyStart = transport.length;
  const legacyResult = await page.evaluate(async () => {
    AtlasPropertyService.cache.delete('Cedar Creek');
    return AtlasPropertyService.load({name:'Cedar Creek',record:{...savedData['Cedar Creek'],communityId:'community:cedar-creek'}},true);
  });
  assert.equal(legacyResult.communityId, cedar.community_id);
  const legacyRead = transport.slice(legacyStart).find(row => row.body?.action === 'read' && row.body.communityName === cedar.display_name);
  assert(legacyRead);
  assert.equal(legacyRead.body.communityId, undefined, 'Legacy local community IDs are not sent as authoritative canonical IDs');
  console.log('PASS retry of a newer saved URL after a later transport failure preserves history; legacy browser identity resolves to the canonical community ID.');

  const denied = await apiCall(page, 'read', outside);
  assert.equal(denied.status, 403);
  assert.equal(denied.stage, 'authorization');
  const mismatch = await apiCall(page, 'read', {...bartram, community_id:cedar.community_id});
  assert(mismatch.error, 'A different canonical ID and community name must not silently cross community boundaries');
  assert.equal(mismatch.stage, 'community_mapping');
  const missing = await apiCall(page, 'read', {...bartram, community_id:'44444444-4444-4444-8444-444444444444'});
  assert.equal(missing.stage, 'community_mapping', 'An unknown canonical ID must not fall back to a valid name');

  await context.close();
  const secondContext = await browser.newContext();
  const freshPage = await login(secondContext);
  await showInsights(freshPage);
  assert.match(await card(freshPage).innerText(), /Two months free rent/);
  assert.match(await card(freshPage, cedar).innerText(), /No special listed/);
  const afterLogin = await apiCall(freshPage, 'read');
  assert.equal(afterLogin.current.offerId, secondOffer);
  assert.deepEqual(afterLogin.offers, stable.offers);
  assert.deepEqual(afterLogin.observations, stable.observations);
  assert.equal(sessionSequence, 2, 'The second browser context obtains a fresh authenticated session');
  await secondContext.close();

  const restrictedContext = await browser.newContext();
  const restrictedPage = await login(restrictedContext, 'restricted@risere.com');
  assert.equal((await apiCall(restrictedPage, 'read')).communityId, bartram.community_id);
  const excluded = await apiCall(restrictedPage, 'read', cedar);
  assert.equal(excluded.status, 403);
  assert.equal(excluded.stage, 'authorization');
  assert.equal(excluded.settings, undefined);
  assert.equal(excluded.offers, undefined);
  await restrictedContext.close();
  assert.deepEqual(pageErrors, []);
  console.log('PASS idempotent authorized backfill/alarm, strict community mapping, restricted-account isolation and a fresh login in a second browser session.');
  console.log('PASS local synthetic integration only: production Bartram records, live website responses and authenticated report schedules remain separate deployment validation.');
} finally {
  await browser?.close();
  await Promise.all([close(uiServer),close(apiServer)]);
  await mf?.dispose();
}
