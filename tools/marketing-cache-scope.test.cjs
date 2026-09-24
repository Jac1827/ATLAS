const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/RISE-Marketing-Command-Center.html', 'utf8');
const functionSource = name => {
  const match = html.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  assert(match, name); return match[0];
};
const clone = x => JSON.parse(JSON.stringify(x));
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve }; };
function fixture() {
  const storage = new Map(), listeners = new Map(), elements = new Map(), writes = [];
  const h = { actor: 'a', configured: true, signedIn: true, verified: true, backend: 'https://a.invalid', api: '', role: 'admin', allowed: ['A'], fresh: 0 };
  for (const id of ['property-tbody', 'team-cards-grid', 'approvers-tbody', 'm-people-select', 'ap-people-select']) elements.set(id, { text: 'old actor data', replaceChildren() { this.text = ''; } });
  const central = {
    getStatus: () => ({ configured: h.configured, signedIn: h.signedIn }),
    getSignedInUser: () => h.signedIn ? { id: h.actor } : null,
    getConfig: () => ({ supabaseUrl: h.backend, apiBaseUrl: h.api }),
    getStoredProfile: () => h.signedIn ? { user_id: h.actor, status: 'active', account_status: 'active', role: h.role, access_verified_at: h.verified ? '2026-09-24T00:00:00Z' : undefined, access_backend: h.verified ? h.backend : undefined } : null,
    getAccessContextKey: () => JSON.stringify([h.actor, h.role, h.allowed, h.backend]),
    fetchProfile: async options => { assert.equal(options.claim, false); h.fresh++; if (h.profileGate) await h.profileGate.promise; h.verified = true; if (h.emitProfile) h.emit('atlas-central-auth-change'); return central.getStoredProfile(); },
    readSharedPropertyGraph: async () => { const row = clone(h.remote || { payload: { properties: {}, people: {} } }); if (h.readGate) await h.readGate.promise; return row; },
    saveSharedPropertyGraph: payload => { writes.push(clone(payload)); return h.writeGate?.promise || Promise.resolve({ saved: true }); }
  };
  const c = { console, Date, Map, Set, DOMException, window: { ATLAS_CENTRAL: central, addEventListener: (name, fn) => { const values = listeners.get(name) || []; values.push(fn); listeners.set(name, values); } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { getElementById: id => elements.get(id) || null },
    propertiesData: [], teamData: [], approversData: [], editingMemberId: null, editingPropertyId: null, editingApproverId: null,
    syncPropertyDropdown() {}, rfmComm() {}, COMM_LIST: ['Old property'], showToast() {},
    applySharedPropertiesToMarketingState() {}, refreshMarketingSharedViews() { h.refreshes = (h.refreshes || 0) + 1; },
    marketingUpsertSharedPerson(graph, person) { graph.people[person.userId] = person; return { changed: true }; },
    marketingUpsertSharedProperty(graph, prop) { graph.properties[prop.communityId] = prop; return { changed: true }; }
  };
  vm.createContext(c);
  vm.runInContext(html.slice(html.indexOf('const PEOPLE_DIRECTORY_STORAGE_KEY'), html.indexOf('function marketingPropertySignatureSet')), c);
  for (const name of ['readOpsPropertyCatalogForMarketing', 'loadMarketingPeopleLinks', 'saveMarketingPeopleLinks', 'splitPeopleDirectoryName', 'getPeopleDirectoryCommunity', 'isPeopleDirectoryEmployeeActive', 'marketingPeopleIdentityKey', 'getPeopleDirectoryEmployees']) vm.runInContext(functionSource(name), c);
  const storageListener = html.match(/window\.addEventListener\("storage", \(event\) => \{[^]*?^\}\);/m); assert(storageListener); vm.runInContext(storageListener[0], c);
  h.emit = name => { for (const fn of listeners.get(name) || []) fn({}); };
  h.storageEvent = event => { for (const fn of listeners.get('storage') || []) fn(event); };
  Object.assign(h, { c, storage, elements, writes }); return h;
}
(async () => {
  for (const [, source] of html.matchAll(/<script(?:\s[^>]*)?>([^]*?)<\/script>/gi)) if (!source.includes("import { createClient }")) new vm.Script(source);
  const h = fixture(), c = h.c;
  const rawKeys = ['atlas_shared_property_graph_v1', 'rise_ops_property_catalog_v1', 'atlas_marketing_people_links_v1', 'rise_performance_platform_github_v1'];
  const raw = [JSON.stringify({ properties: { private: { displayName: 'Other actor property' } } }), JSON.stringify({ properties: [{ name: 'Other actor property' }] }), JSON.stringify({ employee: { peopleEmployeeName: 'Other actor' } }), JSON.stringify({ employees: [{ id: 'old', name: 'Other actor' }] })];
  rawKeys.forEach((key, i) => h.storage.set(key, raw[i]));
  assert.equal(Object.keys(c.readMarketingSharedPropertyGraph().properties).length, 0);
  assert.equal(c.readOpsPropertyCatalogForMarketing().length, 0);
  assert.equal(Object.keys(c.loadMarketingPeopleLinks()).length, 0);
  assert.equal(c.getPeopleDirectoryEmployees().length, 0, 'Unverified configured cache never paints legacy People');
  c.writeMarketingSharedPropertyGraph({ properties: { private: { displayName: 'Must not publish' } } });
  assert.equal(h.writes.length, 0, 'No preverification publication');
  await c.ensureMarketingSharedAccess(); assert.equal(h.fresh, 1);
  assert.equal(c.getPeopleDirectoryEmployees().length, 0, 'Verification does not claim raw legacy ownership');
  const firstKey = c.marketingScopedLocalKey(rawKeys[0]); assert(firstKey && firstKey !== rawKeys[0]);
  c.writeMarketingSharedPropertyGraph({ properties: { a: { displayName: 'Actor A property' } } });
  c.saveMarketingPeopleLinks({ a: { peopleEmployeeId: 'employee-a' } });
  assert.equal(Object.keys(c.readMarketingSharedPropertyGraph().properties).length, 1); assert.equal(h.writes.length, 1);
  for (const change of ['actor', 'role', 'scope', 'backend', 'api']) {
    c.propertiesData = [{ name: 'Prior actor' }]; c.teamData = [{ name: 'Prior person' }]; c.approversData = [{ name: 'Prior approver' }];
    const priorKey = c.marketingScopedLocalKey(rawKeys[0]);
    if (change === 'actor') h.actor = 'b'; else if (change === 'role') h.role = 'regional'; else if (change === 'scope') h.allowed = ['B']; else if (change === 'backend') h.backend = 'https://b.invalid'; else h.api = 'https://api.invalid';
    h.emit('atlas-central-auth-change');
    assert.equal(c.propertiesData.length + c.teamData.length + c.approversData.length, 0, change + ' clears graph-derived live values');
    assert.equal(c.marketingScopedLocalKey(rawKeys[0]), null, change + ' needs fresh verification');
    assert.equal(c.readOpsPropertyCatalogForMarketing().length, 0); assert.equal(Object.keys(c.loadMarketingPeopleLinks()).length, 0);
    await c.ensureMarketingSharedAccess(); assert.notEqual(c.marketingScopedLocalKey(rawKeys[0]), priorKey);
    assert.equal(Object.keys(c.readMarketingSharedPropertyGraph().properties).length, 0);
  }
  rawKeys.forEach((key, i) => assert.equal(h.storage.get(key), raw[i], 'Legacy evidence is preserved byte-for-byte'));
  h.storageEvent({ key: rawKeys[0], newValue: 'new legacy', oldValue: '' }); assert.equal(h.refreshes || 0, 0, 'Unowned storage events never refresh current data');
  h.storageEvent({ key: c.marketingScopedLocalKey(rawKeys[0]), newValue: 'new scoped', oldValue: '' }); assert.equal(h.refreshes, 1);
  h.remote = { payload: { properties: { a: { communityId: 'a', displayName: 'Old remote' } }, people: {} } }; h.readGate = deferred();
  const pull = c.pullMarketingSharedPropertyGraphFromCentral({ silent: true }); await tick(); h.actor = 'c'; h.emit('atlas-central-auth-change'); h.readGate.resolve();
  assert.equal(await pull, null, 'Late graph read cannot enter the next actor cache');
  await c.ensureMarketingSharedAccess(); assert.equal(Object.keys(c.readMarketingSharedPropertyGraph().properties).length, 0);
  h.readGate = null; await c.pullMarketingSharedPropertyGraphFromCentral({ silent: true });
  assert.equal(Object.keys(c.readMarketingSharedPropertyGraph().properties).length, 1, 'Authorized current-scope pull still installs its exact graph');
  h.signedIn = false; h.emit('atlas-central-auth-change'); assert.equal(Object.keys(c.readMarketingSharedPropertyGraph().properties).length, 0); assert.equal(c.marketingScopedLocalKey(rawKeys[0]), null);
  const stale = fixture(); stale.profileGate = deferred(); const validation = stale.c.ensureMarketingSharedAccess(); stale.actor = 'other'; stale.emit('atlas-central-auth-change'); stale.profileGate.resolve(); await assert.rejects(validation, { name: 'AbortError' });
  const cold = fixture(); cold.verified = false; cold.emitProfile = true;
  assert.equal(cold.c.marketingScopedLocalKey(rawKeys[0]), null);
  await cold.c.ensureMarketingSharedAccess(); assert(cold.c.marketingScopedLocalKey(rawKeys[0]), 'Expected freshly verified profile event unlocks only its same-actor scope');
  const switchedBack = fixture(); switchedBack.profileGate = deferred(); const returning = switchedBack.c.ensureMarketingSharedAccess();
  switchedBack.actor = 'other'; switchedBack.emit('atlas-central-auth-change'); switchedBack.actor = 'a'; switchedBack.emit('atlas-central-auth-change'); switchedBack.profileGate.resolve();
  await assert.rejects(returning, { name: 'AbortError' });
  const database = fixture(), d = database.c;
  d.currentUser = { id: 'native-a' };
  for (const name of ['mapTeamMember', 'mapProperty', 'mapApprover', 'mapLeadSource', 'mapRating']) d[name] = clone;
  d.syncMarketingSharedGraphFromLoadedData = () => {};
  database.nativeGate = deferred();
  d.sb = { from: table => {
    const query = { select() { return query; }, order() { return query; }, limit() { return query; },
      then(resolve, reject) { return (database.nativeGate?.promise || Promise.resolve()).then(() => resolve({ data: table === 'properties' ? [{ name: 'Authorized server property' }] : [] }), reject); } };
    return query;
  } };
  const dbStart = html.indexOf('const DB = {'), dbEnd = html.indexOf('\n};', dbStart) + 3;
  vm.runInContext(html.slice(dbStart, dbEnd) + '\nglobalThis.TEST_DB = DB;', d);
  const loading = d.TEST_DB.loadAll(); await tick(); database.actor = 'next'; database.emit('atlas-central-auth-change'); database.nativeGate.resolve();
  await assert.rejects(loading, { name: 'AbortError' }); assert.equal(d.propertiesData.length, 0, 'Old DB result cannot refill cleared graph-derived state');
  database.nativeGate = null; await d.TEST_DB.loadAll(); assert.equal(d.propertiesData[0].name, 'Authorized server property', 'Current authorized DB load still works');
  assert.match(html, /sourceUserId !== currentUser\?\.id \|\| !marketingSharedContextCurrent\(sharedContext\)/);
  assert.match(html, /if \(!marketingSharedContextCurrent\(context\)\) return;\s+grid\.innerHTML/);
  console.log('PASS Marketing graph/catalog/People cache scopes: fresh verification, no legacy fallback, actor/role/community/backend changes, cleared rendered state, preserved evidence, current storage events and stale async denial.');
})().catch(error => { console.error(error); process.exitCode = 1; });
