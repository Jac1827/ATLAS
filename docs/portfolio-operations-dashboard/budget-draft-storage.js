/* Full browser drafts. This store is separate from ATLAS operational/financial data. */
(function (R) {
  'use strict';
  if (!R?.persist || R.persist.durableDraftInstalled) return;
  const P = R.persist, A = R.app, H = A.h;
  P.durableDraftInstalled = true;
  P.DRAFT_DB_NAME = 'rise-budget-drafts-v1';
  const baseSerialize = P.serialize, baseApply = P.apply, baseBoot = A.boot, baseRender = A.render;
  P.renderReady = false;
  A.render = function () { if (P.renderReady) return baseRender.apply(this, arguments); };
  let db, initializing, initialized = false, booted = false, bound, generation = 0, contextInvalidated = false;
  let revision = 0, queue = Promise.resolve(), checkpoint = null, undoCheckpoint = null;
  let durableMode = false, slotCatalog = [], legacyAllowed = false;
  const OPEN_TIMEOUT = 8000;
  const fail = message => new Error(message);
  const refresh = () => A.renderSaveStatus?.();
  const storage = () => { try { return window.localStorage; } catch { return null; } };
  const context = () => {
    const host = window.parent || window, central = host.ATLAS_CENTRAL || window.ATLAS_CENTRAL;
    const config = central?.getConfig?.() || host.ATLAS_CENTRAL_CONFIG || {};
    const session = central?.getSession?.();
    if (central && (!session?.user?.id || (session.expires_at && Number(session.expires_at) * 1000 <= Date.now())))
      throw fail('Sign in again before saving this browser draft. Your open edits have not been discarded.');
    const profile = central?.getStoredProfile?.();
    const access = central?.getAccessContextKey?.() || JSON.stringify(profile ? {
      user: profile.user_id, role: profile.role, status: profile.status,
      communities: profile.allowed_community_ids, markets: profile.allowed_market_values, regions: profile.allowed_region_values
    } : null);
    return { central, access, enabled: config.enabled, identity: {
      actor: central ? String(session.user.id) : 'standalone',
      backend: String(config.supabaseUrl || ''), api: String(config.apiBaseUrl || ''),
      accessApi: String(config.accessApiBaseUrl || ''),
      workspace: String(config.workspaceId || 'portfolio-operations-dashboard')
    } };
  };
  const scopeOf = value => JSON.stringify(value.identity);
  const guard = () => {
    if (!initialized || !bound) throw fail('Browser recovery is not ready. Reload and retry before saving.');
    let now;
    try { now = context(); } catch (error) { contextInvalidated = true; throw error; }
    if (contextInvalidated || now.central !== bound.central || now.access !== bound.access || now.enabled !== bound.enabled || scopeOf(now) !== scopeOf(bound)) {
      contextInvalidated = true;
      throw fail('Your account or workspace changed. Download your open edits, then reload before saving.');
    }
  };
  const identityMatches = payload => payload.browserDraftIdentity
    ? JSON.stringify(payload.browserDraftIdentity) === scopeOf(bound) : legacyAllowed;
  const nextRevision = () => (revision = Math.max(revision + 1, Date.now() * 1000));
  const revisionOf = payload => Number.isSafeInteger(payload.browserDraftRevision)
    ? payload.browserDraftRevision : (Date.parse(payload.savedAt) || 0) * 1000;
  const digest = async raw => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), byte => byte.toString(16).padStart(2, '0')).join('');
  function open() {
    return new Promise((resolve, reject) => {
      let request, settled = false;
      const finish = (error, result) => { if (settled) { result?.close(); return; } settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => finish(fail('Browser recovery storage did not open. Close other Budget Builder tabs, then retry.')), OPEN_TIMEOUT);
      try {
        request = indexedDB.open(P.DRAFT_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          database.createObjectStore('records', { keyPath: 'key' });
          database.createObjectStore('catalog', { keyPath: 'key' }).createIndex('scope', 'scope');
        };
        request.onerror = () => finish(request.error || fail('Browser recovery storage is unavailable.'));
        request.onblocked = () => finish(fail('Another Budget Builder tab is blocking browser recovery. Close it and retry.'));
        request.onsuccess = () => finish(null, request.result);
      } catch (error) { finish(error); }
    });
  }
  function read(store, key) {
    return new Promise((resolve, reject) => {
      let value;
      try {
        const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).get(key);
        request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () => reject(tx.error || fail('Browser recovery could not be read.'));
      } catch (error) { reject(error); }
    });
  }
  const keyFor = id => scopeOf(bound) + ':' + id;
  async function verified(id) {
    const row = await read('records', keyFor(id));
    if (!row) return null;
    if (row.scope !== scopeOf(bound) || row.id !== id || !Number.isSafeInteger(row.revision)) throw fail('Browser recovery identity is inconsistent. Keep this tab open and download a save file.');
    if (row.deleted === true && row.raw === null) return row;
    if (typeof row.raw !== 'string' || await digest(row.raw) !== row.sha256) throw fail('Browser recovery verification failed. Keep this tab open and download a save file.');
    const payload = P.parse(row.raw);
    if (!identityMatches(payload) || revisionOf(payload) !== row.revision) throw fail('Browser recovery belongs to a different account or revision.');
    return row;
  }
  function localRecord(key, id) {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const payload = P.parse(raw);
    if (!identityMatches(payload)) return null;
    return { id, raw, revision: revisionOf(payload) };
  }
  const newest = (a, b) => !a ? b : !b ? a : a.revision > b.revision ? a : b;
  async function loadCatalog() {
    slotCatalog = await new Promise((resolve, reject) => {
      const tx = db.transaction('catalog', 'readonly'), request = tx.objectStore('catalog').index('scope').getAll(scopeOf(bound));
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result || []);
      tx.onabort = tx.onerror = () => reject(tx.error || fail('Save points could not be read.'));
    });
  }
  // Old browser saves had no actor metadata. Bind that existing collection once;
  // a later account must never silently adopt the first account's legacy saves.
  function bindLegacy() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records'), request = store.get('legacy-owner');
      let owner;
      request.onsuccess = () => {
        owner = request.result?.scope || scopeOf(bound);
        if (!request.result) store.put({ key: 'legacy-owner', scope: owner });
      };
      tx.oncomplete = () => resolve(owner === scopeOf(bound));
      tx.onabort = tx.onerror = () => reject(tx.error || fail('Existing browser saves could not be verified.'));
    });
  }
  P.initialize = function () {
    if (initialized) return Promise.resolve();
    if (initializing) return initializing;
    initializing = (async () => {
      bound = context(); contextInvalidated = false;
      db = await open();
      db.onversionchange = () => { db.close(); P.lastError = 'storage-unavailable'; refresh(); };
      legacyAllowed = await bindLegacy();
      const current = localRecord(P.AUTOSAVE_KEY, 'autosave') || localRecord(P.LEGACY_AUTOSAVE_KEY, 'autosave');
      const durable = await verified('autosave');
      checkpoint = newest(current, durable);
      undoCheckpoint = newest(localRecord(P.UNDO_KEY, 'undo'), await verified('undo'));
      await loadCatalog();
      revision = Math.max(checkpoint?.revision || 0, undoCheckpoint?.revision || 0, ...slotCatalog.map(row => row.revision || 0));
      durableMode = !!durable;
      initialized = true;
      guard();
      P.lastError = null;
    })().catch(error => {
      initialized = false; db?.close(); db = null; initializing = null;
      P.lastError = 'recovery-unavailable'; P.lastErrorMessage = error.message;
      throw error;
    });
    P.ready = initializing;
    return initializing;
  };
  const enqueue = work => {
    const result = queue.catch(() => {}).then(work);
    queue = result.catch(() => {});
    return result;
  };
  function metadata(row) {
    const p = row.raw ? P.parse(row.raw) : null;
    return { key: row.key, scope: row.scope, id: row.id, revision: row.revision, deleted: !!row.deleted,
      label: p?.label, note: p?.note, savedAt: p?.savedAt, savedAtLocal: p?.savedAtLocal,
      bytes: row.raw?.length || 0, summary: p?.summary };
  }
  async function writeRecords(entries) {
    guard();
    const rows = await Promise.all(entries.map(async entry => ({ ...entry, key: keyFor(entry.id), scope: scopeOf(bound), sha256: entry.raw === null ? null : await digest(entry.raw) })));
    guard();
    await new Promise((resolve, reject) => {
      let error;
      const tx = db.transaction(['records', 'catalog'], 'readwrite'), records = tx.objectStore('records'), catalog = tx.objectStore('catalog');
      for (const row of rows) {
        const request = records.get(row.key);
        request.onsuccess = () => {
          try {
            guard();
            if (request.result && request.result.revision >= row.revision && request.result.raw !== row.raw)
              throw fail('A newer browser checkpoint already exists. Download your open edits before reloading.');
            records.put(row); catalog.put(metadata(row));
          } catch (cause) { error = cause; tx.abort(); }
        };
      }
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(error || tx.error || fail('Browser save did not commit.'));
    });
    // Transaction completion alone is not a save receipt. Read in a new transaction.
    for (const row of rows) {
      const actual = await verified(row.id);
      guard();
      if (!actual || actual.revision !== row.revision || actual.raw !== row.raw || actual.sha256 !== row.sha256 || !!actual.deleted !== !!row.deleted)
        throw fail('Browser save readback did not match. Your open changes still need saving.');
    }
    for (const row of rows) {
      slotCatalog = slotCatalog.filter(value => value.id !== row.id).concat(metadata(row));
      if (row.id === 'autosave') { checkpoint = row; durableMode = true; }
      if (row.id === 'undo') undoCheckpoint = row;
    }
    return rows;
  }
  P.storage = storage; // Reading must not require spare localStorage quota.
  P.storageAvailable = () => initialized;
  P.serialize = function (state, meta) {
    const payload = baseSerialize.call(P, state, meta);
    if (bound) payload.browserDraftIdentity = { ...bound.identity };
    return payload;
  };
  function capture(kind, label, note) {
    guard();
    const payload = P.serialize(A.state, { kind, label, note });
    payload.browserDraftRevision = nextRevision();
    return { raw: JSON.stringify(payload), revision: payload.browserDraftRevision, generation };
  }
  const saved = (entry, kind) => {
    guard();
    if (entry.generation === generation) P.markClean();
    P.lastSavedAt = new Date(P.parse(entry.raw).savedAt); P.lastSaveKind = kind;
    P.lastError = null; P.lastErrorMessage = null; refresh();
  };
  function failed(error) {
    P.dirty = true; P.lastError = 'write-failed'; P.lastErrorMessage = error.message; refresh();
    return false;
  }
  P.markDirty = function () {
    generation++; P.dirty = true;
    clearTimeout(P._timer);
    P._timer = setTimeout(() => { P.autosave(); }, P.AUTOSAVE_DEBOUNCE_MS);
    refresh();
  };
  P.autosave = function () {
    if (!A.state) return false;
    let entry;
    try {
      entry = capture('autosave', 'Autosave', '');
      if (!durableMode) {
        const s = storage();
        if (s) {
          try {
            s.setItem(P.AUTOSAVE_KEY, entry.raw);
            if (s.getItem(P.AUTOSAVE_KEY) !== entry.raw) throw fail('Browser checkpoint readback did not match.');
            checkpoint = { ...entry, id: 'autosave' }; saved(entry, 'autosave'); return true;
          } catch { /* Preserve the old checkpoint and use the full-state store. */ }
        }
      }
    } catch (error) { return failed(error); }
    // Pin this page to one backend as soon as asynchronous work begins. A later
    // synchronous localStorage write must not leapfrog an older queued IDB write.
    durableMode = true; P.dirty = true; P.lastError = null; refresh();
    return enqueue(async () => {
      try { await writeRecords([{ ...entry, id: 'autosave' }]); saved(entry, 'autosave'); return true; }
      catch (error) { return failed(error); }
    });
  };
  P.hasAutosave = () => !!checkpoint?.raw && !checkpoint.deleted;
  P.autosaveInfo = () => {
    if (!P.hasAutosave()) return null;
    const p = P.parse(checkpoint.raw);
    return { savedAt: p.savedAt, savedAtLocal: p.savedAtLocal, summary: p.summary, bytes: checkpoint.raw.length, formatVersion: p.formatVersion };
  };
  P.restoreAutosave = () => {
    try { guard(); if (!P.hasAutosave()) throw fail('There is no autosave to restore.'); return P.apply(P.parse(checkpoint.raw)); }
    catch (error) { if (P.restoringAtBoot) P.bootRestoreError = error; throw error; }
  };
  P.apply = function (payload) {
    guard();
    const result = baseApply.call(P, payload);
    if (!P.restoringAtBoot) P.markDirty(); // Restores/imports must also become the reopening checkpoint.
    return result;
  };
  P.discardAutosave = () => enqueue(async () => {
    await writeRecords([{ id: 'autosave', raw: null, revision: nextRevision(), deleted: true }]);
    const s = storage(); s?.removeItem(P.AUTOSAVE_KEY); s?.removeItem(P.LEGACY_AUTOSAVE_KEY);
  });
  P.index = () => {
    let old = [];
    try { if (legacyAllowed) old = JSON.parse(storage()?.getItem(P.SLOT_INDEX_KEY) || '[]'); } catch {}
    const rows = new Map((Array.isArray(old) ? old : []).map(row => [row.id, row]));
    for (const row of slotCatalog.filter(value => value.id.startsWith('S'))) row.deleted ? rows.delete(row.id) : rows.set(row.id, row);
    return [...rows.values()].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  };
  P.saveSlot = function (label, note) {
    const entry = capture('slot', label || P.suggestLabel(), note || '');
    const id = 'S' + entry.revision.toString(36) + '-' + crypto.randomUUID();
    durableMode = true; P.dirty = true; refresh();
    return enqueue(async () => {
      try {
        await loadCatalog(); guard();
        if (P.index().length >= P.MAX_SLOTS) throw fail('You already have ' + P.MAX_SLOTS + ' save points. Download a save file, or explicitly delete a save point you no longer need.');
        await writeRecords([{ ...entry, id }, { ...entry, id: 'autosave' }]);
        saved(entry, 'slot');
        return { id, label: P.parse(entry.raw).label, bytes: entry.raw.length };
      } catch (error) { failed(error); throw error; }
    });
  };
  async function slotRecord(id) {
    guard();
    const row = await verified(id) || (legacyAllowed ? localRecord(P.slotKey(id), id) : null);
    guard();
    if (!row?.raw || row.deleted) throw fail('That save point is no longer available.');
    return row;
  }
  P.loadSlot = async id => {
    const capturedGeneration = generation, row = await slotRecord(id);
    if (capturedGeneration !== generation) throw fail('Your open edits changed while the save point was loading. Save those edits, then retry restoring it.');
    return P.apply(P.parse(row.raw));
  };
  P.renameSlot = (id, label) => enqueue(async () => {
    const row = await slotRecord(id), payload = P.parse(row.raw);
    payload.label = label; payload.browserDraftIdentity = { ...bound.identity }; payload.browserDraftRevision = nextRevision();
    await writeRecords([{ id, raw: JSON.stringify(payload), revision: payload.browserDraftRevision }]);
    return true;
  });
  P.deleteSlot = id => enqueue(async () => { await writeRecords([{ id, raw: null, revision: nextRevision(), deleted: true }]); return true; });
  P.snapshotUndo = function (label) {
    let entry;
    try { entry = capture('undo', label || 'last action', ''); } catch (error) { P.undoError = error.message; return false; }
    P.undoLabel = label || 'last action';
    P._undoMem = entry.raw; undoCheckpoint = { ...entry, id: 'undo' };
    // Capture synchronously before the caller changes state. Never prefer an old
    // localStorage undo over this newer in-memory copy.
    enqueue(async () => {
      try { await writeRecords([{ ...entry, id: 'undo' }]); P.undoError = null; }
      catch (error) { P.undoError = 'Undo is available only while this tab stays open: ' + error.message; }
    });
    return true;
  };
  P.canUndo = () => !!(P._undoMem || (!undoCheckpoint?.deleted && undoCheckpoint?.raw));
  P.undo = function () {
    guard();
    const raw = P._undoMem || (!undoCheckpoint?.deleted && undoCheckpoint?.raw);
    if (!raw) throw fail('There is nothing to undo.');
    const result = P.apply(P.parse(raw));
    P._undoMem = null; undoCheckpoint = null;
    const deletion = { id: 'undo', raw: null, revision: nextRevision(), deleted: true };
    enqueue(() => writeRecords([deletion])).catch(error => { P.undoError = error.message; });
    return result;
  };
  A.quickSave = async function () {
    A.commitFocusedEditor();
    if (await P.autosave()) {
      A.toast(P.dirty ? 'The earlier checkpoint was saved. Your newer edits are still saving.' : 'Working model saved in this browser. It will reopen with these changes.');
      return !P.dirty;
    }
    A.toast('Your changes are not saved in this browser. Keep this tab open and download a save file from Save & restore. ' + H.esc(P.lastErrorMessage || ''), 'r');
    return false;
  };
  const field = (id, fallback) => document.getElementById(id)?.value || fallback;
  A.doSaveSlot = async function (label, note) {
    try {
      A.commitFocusedEditor();
      const result = await P.saveSlot(label || field('slotLabel', P.suggestLabel()), note || field('slotNote', ''));
      A.render(); A.toast('<b>Save point created:</b> ' + H.esc(result.label)); return result;
    } catch (error) { A.toast(H.esc(error.message), 'r'); return null; }
  };
  const action = work => async () => { try { await work(); A.render(); } catch (error) { A.toast(H.esc(error.message), 'r'); } };
  A.doLoadSlot = id => A.confirmAct('Restore this save point? Anything on screen now will be replaced.', action(async () => {
    P.snapshotUndo('restoring a save point'); await P.loadSlot(id); A.toast('Save point restored. Saving the reopening checkpoint…');
  }));
  A.doRenameSlot = id => {
    const label = prompt('New name for this save point:', P.index().find(row => row.id === id)?.label || '');
    if (label) return action(async () => { await P.renameSlot(id, label); A.toast('Renamed.'); })();
  };
  A.doDeleteSlot = id => A.confirmAct('Delete this save point? This cannot be undone.', action(async () => { await P.deleteSlot(id); A.toast('Save point deleted.'); }));
  A.doDiscardAutosave = () => A.confirmAct('Discard the autosave snapshot?', action(async () => { await P.discardAutosave(); A.toast('Autosave snapshot discarded.'); }));
  A.dismissRestore = () => A.confirmAct('Start fresh from the workbook and discard the browser checkpoint?', action(async () => { await P.discardAutosave(); A.restoreDismissed = true; }));
  const saveView = R.views.saveload;
  R.views.saveload = function () {
    const explanation = '<div class="note">Large working drafts and new save points use expanded browser storage. Existing save points are kept. A save is confirmed only after its full contents are read back. Keep downloaded save files as a separate backup.</div>';
    const error = P.lastError ? '<div class="note r" role="alert"><b>Changes need saving.</b> ' + H.esc(P.lastErrorMessage || 'Retry Save or download a save file before closing this tab.') + '</div>' : '';
    return explanation + error + (P.undoError ? '<div class="note r">' + H.esc(P.undoError) + '</div>' : '') + saveView.call(this).replace('browser limit is usually about 5,000 KB', 'legacy storage only; expanded drafts are stored separately');
  };
  A.boot = function () {
    if (booted) return P.ready;
    const main = document.querySelector('.main');
    if (main) main.innerHTML = '<p role="status">Checking your saved browser draft…</p>';
    return P.initialize().then(() => {
      if (booted) return;
      guard(); P.restoringAtBoot = true; P.bootRestoreError = null;
      try {
        R.rebuildLibraries();
        baseBoot.call(A);
        // The legacy boot catches restore errors and builds a default model.
        // That default must never appear as successful recovery of a newer save.
        if (P.bootRestoreError) throw P.bootRestoreError;
        booted = true;
      } finally { P.restoringAtBoot = false; }
    }).catch(error => {
      booted = false; A.state = null; P.renderReady = false;
      P.markClean(); P.lastSavedAt = null; P.lastError = 'recovery-unavailable'; P.lastErrorMessage = error.message;
      initialized = false; initializing = null; db?.close(); db = null;
      if (main) main.innerHTML = '<div class="note r" role="alert"><b>Your saved browser draft could not be verified.</b> ' + H.esc(error.message) + ' An older draft has not been opened.<br><button class="btn" onclick="RBB.app.start()">Retry saved draft check</button></div>';
    });
  };
  function changed() { if (!initialized) return; try { guard(); } catch (error) { clearTimeout(P._timer); failed(error); } }
  window.addEventListener('atlas-central-auth-change', changed);
  if (window.parent !== window) window.parent.addEventListener('atlas-central-auth-change', changed);
  window.addEventListener('storage', changed);
})(window.RBB);
