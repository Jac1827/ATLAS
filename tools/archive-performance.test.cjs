const assert = require('node:assert/strict');
const api = require('../docs/portfolio-operations-dashboard/migration-archive.js');
const Zip = require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
(async () => {
  const archive = await api.pack({ keys: { fixture: 'original' } }, [], Zip);
  const docs = new Map();
  const client = { readDocument: async key => docs.get(key), saveDocument: async o => docs.set(o.documentKey, {payload:o.payload}) };
  const manifest = await api.publish(archive, client, 32);
  let active = 0, peak = 0, reads = 0;
  const remote = { readDocument: async key => {
    reads++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return docs.get(key);
  }};
  const result = await api.hydrate(manifest, remote, {concurrency:3});
  assert.equal(result.data, archive.data, 'Part order must survive concurrent responses');
  assert.equal(peak, 3); assert.equal(active, 0); assert.equal(reads, manifest.dataDocuments.length);
  const controller = new AbortController(); controller.abort();
  const before = reads;
  await assert.rejects(api.hydrate(manifest, remote, {signal:controller.signal}), /abort/i);
  assert.equal(reads, before, 'Cancelled work must not start remote reads');
  const bad = structuredClone(manifest); bad.dataDocuments[0].sha256 = 'corrupt';
  await assert.rejects(api.hydrate(bad, remote), /missing or changed/);
  assert.equal(active, 0, 'All in-flight reads must settle before releasing buffers');
  console.log('PASS bounded archive concurrency, ordering, cancellation, hashing and settled cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
