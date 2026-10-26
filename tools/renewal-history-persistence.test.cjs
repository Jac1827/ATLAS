// Isolated native IndexedDB and localStorage. No browser, account or resident data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(__dirname + '/../docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const extract = name => {
  const found = source.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{[^\\n]*\\}$', 'm'))
    || source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^\\}', 'm'));
  assert(found, name); return found[0];
};
const clone = value => JSON.parse(JSON.stringify(value));
const JOURNAL = 'atlas_renewal_history_repair_v1', MARKER = 'atlas_renewal_history_repair_pending_v1', CS = 'atlas_central_services_phase1_v2';
const functions = ['atlasRenewalRepairGeneration', 'atlasRenewalRepairPending', 'atlasRenewalRepairDigest', 'atlasRenewalRepairCheck',
  'persistReviewedRenewalHistory', 'finishAtlasRenewalHistoryRepair', 'resumeAtlasRenewalHistoryRepair',
  'atlasStateSetValue', 'atlasOpsGlobalChangedOnlyPeopleSyncTime'];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture() {
  const factory = new IDBFactory();
  const db = await new Promise((resolve, reject) => {
    const request = factory.open('synthetic-renewal-repair', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const rawIO = (mode, action, controls = {}) => new Promise((resolve, reject) => {
    const tx = db.transaction('state', mode), store = tx.objectStore('state'); let request;
    const wrapped = { transaction: tx, get: key => store.get(key), put: row => {
      controls.beforePut?.(row); return store.put(row);
    } };
    try { request = action(wrapped); } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || request?.error || Error('Native transaction aborted'));
  });
  const read = async key => (await rawIO('readonly', s => s.get(key)))?.value;
  const write = (key, value) => rawIO('readwrite', s => s.put({ key, value: clone(value), updatedAt: 'other-tab' }));
  const priorEvent = { at: '2026-09-19T12:00:00Z', label: 'Imported from Prior.xlsx' };
  const currentEvent = { at: '2026-10-26T16:00:00Z', label: 'Imported from Latest.xlsx' };
  const row = { id: 'agreement', propertyName: 'Example', residentName: 'Synthetic', unit: '101', expirationDate: '2026-11-30', periodKey: '2026-11',
    status: 'Signed - Awaiting Execution', notes: 'Latest source note', sourceFileName: 'Latest.xlsx', activity: [currentEvent] };
  const communities = { Example: { renewalDetailRowsByPeriod: { '2026-11': [clone(row)] }, renewalDetailRowsByMonth: Array.from({ length: 12 }, (_, i) => i === 10 ? [clone(row)] : []) }, Other: { intent: 'original' } };
  const prior = clone(communities); prior.Example.renewalDetailRowsByPeriod['2026-11'][0].activity = [priorEvent];
  const snapshot = { app: 'atlas-rise-ops-dashboard', snapshotType: 'atlas_central_migration_read_only_snapshot_v1', readOnly: true, generatedAt: '2026-10-26T15:00:00Z', indexedDb: { communityData: prior } };
  const storage = new Map([[CS, JSON.stringify({ renewals: [row], tasks: [{ id: 'task', status: 'Open' }] })]]);
  await write('communities', communities); await write('atlas_workspace_source_v2', { dirty: false, version: 6 });
  const api = await import('../docs/portfolio-operations-dashboard/features/renewal-workflow-repair.mjs');
  const createTab = async () => {
    const controls = {}, counts = { writes: 0, reads: 0, loads: 0 };
    const c = vm.createContext({ console, Date, JSON, crypto: webcrypto, TextEncoder, Map, Set, window: {},
      ATLAS_RENEWAL_REPAIR_KEY: JOURNAL, ATLAS_RENEWAL_REPAIR_MARKER: MARKER, ATLAS_RENEWAL_CS_KEY: CS,
      ATLAS_STATE_COMMUNITY_KEY: 'communities', OPS_GLOBAL_STORAGE_KEY: 'ops', ATLAS_STATE_DB_NAME: db.name,
      actor: 'synthetic-admin', contextValid: true, atlasWorkspaceAccess: { validated: true },
      savedData: clone(await read('communities')), atlasStateWritePromise: Promise.resolve(),
      getAtlasCentralStatus: () => ({ signedIn: true }), isCommunitySettingsAdmin: () => true,
      saveAtlasCentralAppState: Object.assign(() => {}, { inFlight: false }), getProp: () => ({ name: 'Example' }) });
    c.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => {
      controls.beforeLocalSet?.(key, value); storage.set(key, String(value));
    }, removeItem: key => storage.delete(key) };
    c.atlasWorkspaceActorKey = () => c.actor;
    c.captureAtlasAuxiliaryContext = () => { const actor = c.actor; return { current: () => c.contextValid && c.actor === actor }; };
    c.buildSerializedSavedDataPayload = () => clone(c.savedData);
    c.getCurrentCommunityRecord = () => ({ ...clone(c.savedData.Example), ...c.draftChanges });
    c.captureAtlasSaveContext = () => { const view = c.view; return () => c.view === view; };
    c.loadPropertyData = () => { counts.loads++; controls.beforeLoad?.(); };
    c.withAtlasStateStore = async (mode, action) => {
      const count = mode === 'readwrite' ? ++counts.writes : ++counts.reads;
      await controls.beforeIO?.(mode, count);
      const result = await rawIO(mode, action, controls);
      await controls.afterIO?.(mode, count);
      return result;
    };
    c.atlasStateGetValue = async key => (await c.withAtlasStateStore('readonly', s => s.get(key)))?.value ?? null;
    for (const name of functions) vm.runInContext(extract(name), c);
    const review = await api.reviewRenewalWorkflowRepair(snapshot, { communityData: c.savedData, centralServicesRaw: storage.get(CS), sourceHash: 'a'.repeat(64), digest: c.atlasRenewalRepairDigest });
    return { c, controls, counts, review, apply: () => c.persistReviewedRenewalHistory(review, api) };
  };
  const f = { db, read, write, storage, communities, createTab, api, close: () => db.close() };
  return Object.assign(f, await createTab());
}

test('actual persistence verifies both stores, retains source values and records a dirty completion receipt', async () => {
  const f = await fixture(); try {
    const receipt = await f.apply(), data = await f.read('communities'), cs = JSON.parse(f.storage.get(CS));
    assert.equal(receipt.status, 'complete'); assert.equal((await f.read(JOURNAL)).status, 'complete');
    assert.equal(data.Example.renewalDetailRowsByPeriod['2026-11'][0].activity.length, 2);
    assert.deepEqual(cs.renewals[0].activity, data.Example.renewalDetailRowsByPeriod['2026-11'][0].activity);
    assert.equal(cs.renewals[0].notes, 'Latest source note'); assert.equal(cs.renewals[0].status, 'Signed - Awaiting Execution');
    assert.equal((await f.read('atlas_workspace_source_v2')).dirty, true); assert.equal(f.storage.has(MARKER), false);
    assert.deepEqual(clone(f.c.savedData), data);
  } finally { f.close(); }
});

test('an intervening native edit at journal creation survives the atomic baseline check', async () => {
  const f = await fixture(); try {
    const newer = clone(f.communities); newer.Other.intent = 'newer';
    f.controls.beforeIO = async (mode, count) => { if (mode === 'readwrite' && count === 1) await f.write('communities', newer); };
    await assert.rejects(f.apply(), /changed/); assert.deepEqual(await f.read('communities'), newer);
    assert.equal(await f.read(JOURNAL), undefined); assert.equal(f.storage.has(MARKER), false);
  } finally { f.close(); }
});

test('native abort and Central Services quota failure retain exact resumable evidence without rollback', async () => {
  for (const failAt of ['native', 'central']) {
    const f = await fixture(); try {
      const originalCs = f.storage.get(CS);
      if (failAt === 'native') f.controls.beforePut = row => { if (row.key === 'communities') throw Error('Synthetic native failure'); };
      else f.controls.beforeLocalSet = key => { if (key === CS) throw Error('Synthetic quota failure'); };
      await assert.rejects(f.apply(), /Synthetic/);
      assert.equal((await f.read(JOURNAL)).status, 'pending'); assert.equal(f.storage.get(CS), originalCs);
      assert.equal(f.storage.has(MARKER), true); assert.equal(f.c.window.AtlasRenewalRepairRecovery, true);
      assert.deepEqual(clone(f.c.savedData), f.communities, 'Failed completion does not replace live edits');
      const fresh = await f.createTab(); const receipt = await fresh.c.resumeAtlasRenewalHistoryRepair();
      assert.equal(receipt.status, 'complete'); assert.equal(f.storage.has(MARKER), false);
      assert.equal((await f.read('communities')).Example.renewalDetailRowsByPeriod['2026-11'][0].activity.length, 2);
    } finally { f.close(); }
  }
});

test('a newer Central Services change after native commit is preserved and holds resume', async () => {
  const f = await fixture(); try {
    const newer = JSON.parse(f.storage.get(CS)); newer.tasks[0].status = 'New user action';
    f.controls.afterIO = (mode, count) => { if (mode === 'readwrite' && count === 2) f.storage.set(CS, JSON.stringify(newer)); };
    await assert.rejects(f.apply(), /Central Services has newer/);
    assert.equal(f.storage.get(CS), JSON.stringify(newer)); assert.equal((await f.read(JOURNAL)).status, 'pending');
    const fresh = await f.createTab(); await assert.rejects(fresh.c.resumeAtlasRenewalHistoryRepair(), /Central Services has newer/);
    assert.equal(f.storage.get(CS), JSON.stringify(newer));
  } finally { f.close(); }
});

test('unsaved same-tab edits while the native operation waits are preserved', async () => {
  const f = await fixture(); try {
    f.controls.beforeIO = (mode, count) => { if (mode === 'readwrite' && count === 2) f.c.savedData.Other.intent = 'unsaved current choice'; };
    await assert.rejects(f.apply(), /changed|edits|newer/i);
    assert.equal(f.c.savedData.Other.intent, 'unsaved current choice');
    assert.equal((await f.read(JOURNAL)).status, 'pending');
  } finally { f.close(); }
});

test('a durable pending journal blocks ordinary community writes even if its local marker is unavailable', async () => {
  const f = await fixture(); try {
    f.controls.beforePut = row => { if (row.key === 'communities') throw Error('Synthetic native failure'); };
    await assert.rejects(f.apply()); f.storage.delete(MARKER);
    const fresh = await f.createTab(), newer = clone(f.communities); newer.Other.intent = 'ordinary write';
    await assert.rejects(fresh.c.atlasStateSetValue('communities', newer), /repair|recover/i);
    assert.deepEqual(await f.read('communities'), f.communities);
  } finally { f.close(); }
});

test('a direct write delayed across the complete repair cannot erase the restored history', async () => {
  const f = await fixture(), waiting = gate(), entered = gate();
  try {
    f.controls.beforeIO = async (mode, count) => { if (mode === 'readwrite' && count === 1) { entered.resolve(); await waiting.promise; } };
    const late = f.c.atlasStateSetValue('communities', clone(f.communities)); await entered.promise;
    const repair = await f.createTab(); await repair.apply();
    waiting.resolve(); await assert.rejects(late, /repair|recover|changed|reload/i);
    assert.equal((await f.read('communities')).Example.renewalDetailRowsByPeriod['2026-11'][0].activity.length, 2);
  } finally { waiting.resolve(); f.close(); }
});

test('competing journal creation cannot remove the active repair hold', async () => {
  const f = await fixture(); try {
    const second = await f.createTab(), waitingDigest = gate(), digestEntered = gate(), activeCommit = gate(), activeEntered = gate();
    const digest = second.c.atlasRenewalRepairDigest; let firstDigest = true;
    second.c.atlasRenewalRepairDigest = async value => { if (firstDigest) { firstDigest = false; digestEntered.resolve(); await waitingDigest.promise; } return digest(value); };
    f.controls.beforeIO = async (mode, count) => { if (mode === 'readwrite' && count === 2) { activeEntered.resolve(); await activeCommit.promise; } };
    const losing = second.apply(); await digestEntered.promise;
    const active = f.apply(); await activeEntered.promise; const activeId = (await f.read(JOURNAL)).id;
    waitingDigest.resolve(); await assert.rejects(losing, /pending|repair/i);
    assert.equal(JSON.parse(f.storage.get(MARKER) || '{}').id, activeId, 'The active journal still owns a durable hold');
    activeCommit.resolve(); await active;
  } finally { f.close(); }
});

test('crash after completed receipt resumes by exact hashes; wrong actor or altered journal is rejected', async () => {
  const f = await fixture(); try {
    f.controls.beforeLoad = () => { throw Error('Synthetic postcommit UI failure'); };
    await assert.rejects(f.apply(), /Synthetic postcommit/); assert.equal((await f.read(JOURNAL)).status, 'complete');
    const fresh = await f.createTab(); fresh.c.actor = 'other-account';
    await assert.rejects(fresh.c.resumeAtlasRenewalHistoryRepair(), /another workspace/);
    fresh.c.actor = 'synthetic-admin'; const receipt = await fresh.c.resumeAtlasRenewalHistoryRepair();
    assert.equal(receipt.status, 'complete'); assert.equal(f.storage.has(MARKER), false);
  } finally { f.close(); }
  const f2 = await fixture(); try {
    f2.controls.beforePut = row => { if (row.key === 'communities') throw Error('Synthetic native failure'); };
    await assert.rejects(f2.apply()); const journal = await f2.read(JOURNAL); journal.prepared.Other.intent = 'tampered'; await f2.write(JOURNAL, journal);
    const fresh = await f2.createTab(); await assert.rejects(fresh.c.resumeAtlasRenewalHistoryRepair(), /retained renewal repair changed/);
    assert.deepEqual(await f2.read('communities'), f2.communities);
  } finally { f2.close(); }
});
