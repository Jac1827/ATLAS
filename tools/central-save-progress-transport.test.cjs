const test = require('node:test');
const assert = require('node:assert/strict');
const archiveApi = require('../docs/portfolio-operations-dashboard/migration-archive.js');
const Zip = require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');

const chunkSize = 128;
function binary(length) {
  let state = 917263;
  return Uint8Array.from({ length }, () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state & 255;
  });
}
async function fixture(inlineLimit = 0) {
  const bundle = { keys: { synthetic: 'retained' } };
  const archive = await archiveApi.pack(bundle, [{ key: 'source', value: { blob: new Blob([binary(1500)]) } }], Zip, { inlineLimit });
  return { archive, bundle, total: Math.ceil((Math.ceil(archive.bytes / 3) * 4) / chunkSize) };
}
function clientFixture() {
  const docs = new Map(), calls = [];
  let reads = 0, verifiedReads = 0, writes = 0;
  return {
    docs, calls,
    get reads() { return reads; },
    get verifiedReads() { return verifiedReads; },
    get writes() { return writes; },
    client: {
      async readDocument(key) {
        reads++;
        const row = docs.get(key);
        if (row) verifiedReads++;
        calls.push({ type: 'read', key, present: Boolean(row) });
        return row;
      },
      async saveDocument(value) {
        writes++;
        calls.push({ type: 'write', key: value.documentKey });
        docs.set(value.documentKey, { payload: structuredClone(value.payload) });
      },
    },
  };
}

test('part progress advances only after exact readback for new and reused Blob or inline parts', async () => {
  for (const inlineLimit of [0, 100000]) {
    const { archive, bundle, total } = await fixture(inlineLimit), remote = clientFixture(), events = [];
    assert(total > 2);
    const manifest = await archiveApi.publish(archive, remote.client, chunkSize, {
      onProgress(event) {
        assert.equal(event.phase, 'publishing_parts');
        assert.equal(event.total, total);
        assert.equal(event.completed, remote.verifiedReads, 'A saved but unread part is not verified');
        events.push({ ...event });
      },
    });
    assert.deepEqual(events.filter(e => e.completed > 0).map(e => e.completed), Array.from({ length: total }, (_, i) => i + 1));
    assert.equal(remote.writes, total);
    assert.equal(manifest.dataDocuments.length, total);
    const writes = remote.writes, reads = remote.verifiedReads, reused = [];
    const again = await archiveApi.publish(archive, remote.client, chunkSize, {
      onProgress(event) {
        assert.equal(event.completed, remote.verifiedReads - reads);
        reused.push({ ...event });
      },
    });
    assert.equal(remote.writes, writes, 'Verified immutable parts are reused');
    assert.equal(reused.at(-1).completed, total);
    assert.deepEqual(again, manifest);
    const hydrated = await archiveApi.hydrate(manifest, remote.client);
    assert.deepEqual((await archiveApi.unpack(hydrated, Zip)).bundle, bundle);
  }
});

test('a missing or corrupt readback cannot be reported as a verified part', async () => {
  for (const mode of ['missing', 'corrupt']) {
    const { archive } = await fixture(), remote = clientFixture(), events = [];
    const client = {
      ...remote.client,
      async readDocument(key) {
        const value = await remote.client.readDocument(key);
        if (value && remote.writes === 2) return mode === 'missing' ? null : { payload: { ...value.payload, data: 'wrong' } };
        return value;
      },
    };
    await assert.rejects(archiveApi.publish(archive, client, chunkSize, { onProgress: event => events.push({ ...event }) }), /readback mismatch/);
    assert.deepEqual(events.filter(e => e.completed > 0).map(e => e.completed), [1]);
    assert.equal(remote.writes, 2);
  }
});

test('abort or context cancellation during a part readback never reports that part verified', async () => {
  for (const mode of ['signal', 'context']) {
    const { archive } = await fixture(), remote = clientFixture(), events = [], controller = new AbortController();
    let current = true;
    const client = {
      ...remote.client,
      async readDocument(key) {
        const value = await remote.client.readDocument(key);
        if (value) {
          if (mode === 'signal') controller.abort();
          else current = false;
        }
        return value;
      },
    };
    await assert.rejects(archiveApi.publish(archive, client, chunkSize, {
      signal: controller.signal, isCurrent: () => current, onProgress: event => events.push({ ...event }),
    }), error => error.name === 'AbortError');
    assert.equal(events.filter(e => e.completed > 0).length, 0);
    assert.equal(remote.writes, 1, 'An immutable part may exist, but no success receipt is returned');
  }
});

test('cancellation after one verified progress event keeps the existing write fence', async () => {
  const { archive } = await fixture(), remote = clientFixture(), events = [];
  let current = true;
  await assert.rejects(archiveApi.publish(archive, remote.client, chunkSize, {
    isCurrent: () => current,
    onProgress(event) {
      events.push({ ...event });
      if (event.completed === 1) current = false;
    },
  }), error => error.name === 'AbortError');
  assert.deepEqual(events.filter(e => e.completed > 0).map(e => e.completed), [1]);
  assert.equal(remote.writes, 1);
});

test('throwing or mutating progress observers cannot change archive transport or successful metadata', async () => {
  const { archive } = await fixture(), pristine = clientFixture();
  const expected = await archiveApi.publish(archive, pristine.client, chunkSize);
  const originalText = await archive.dataBlob.text();
  for (const onProgress of [
    () => { throw new Error('Synthetic observer failure'); },
    event => { event.phase = 'wrong'; event.completed = -1; event.total = Infinity; event.dataDocuments = []; },
  ]) {
    const remote = clientFixture(), result = await archiveApi.publish(archive, remote.client, chunkSize, { onProgress });
    assert.deepEqual(result, expected);
    assert.equal(await archive.dataBlob.text(), originalText);
    assert.equal(result.dataBlob, undefined);
    assert.equal(result.data, undefined);
  }
});

test('an archive retained inline reports no verified remote parts', async () => {
  const archive = await archiveApi.pack({}, [], Zip), remote = clientFixture(), events = [];
  const result = await archiveApi.publish(archive, remote.client, 1048576, { onProgress: event => events.push({ ...event }) });
  assert.strictEqual(result, archive);
  assert.equal(remote.reads, 0);
  assert.equal(remote.writes, 0);
  assert.equal(events.filter(e => e.completed > 0).length, 0);
});
