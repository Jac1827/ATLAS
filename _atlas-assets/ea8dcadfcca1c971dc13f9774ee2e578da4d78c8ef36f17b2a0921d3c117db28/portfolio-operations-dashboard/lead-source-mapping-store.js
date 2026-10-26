/* Uses ATLAS's existing admin-only, optimistic-concurrency document API. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasLeadMappingStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const documentKey = 'atlas-entrata-lead-source-mappings-v1';
  const stable = value => JSON.stringify(value, (_,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
  function create(client) {
    let revision;
    return {
      async load() {
        const doc = await client.readDocument(documentKey);
        revision = doc?.version ?? null;
        return doc?.payload || {rules:[],history:[]};
      },
      async save(payload) {
        if (revision === undefined) throw new Error('Load shared mappings before saving.');
        const before = await client.readDocument(documentKey);
        if ((before?.version ?? null) !== revision) throw new Error('Mappings changed in another session. Reload and preview again.');
        await client.saveDocument({documentKey,moduleKey:'data_import',expectedVersion:revision,payload,
          sourceModule:'lead_source_mapping_review',metadata:{effect:'future_imports_only'}});
        const stored = await client.readDocument(documentKey);
        if (!stored || stable(stored.payload) !== stable(payload)) throw new Error('Shared mapping save could not be verified. Reload to check its status.');
        revision = stored.version;
        return stored.payload;
      }
    };
  }
  return {documentKey,create};
});
