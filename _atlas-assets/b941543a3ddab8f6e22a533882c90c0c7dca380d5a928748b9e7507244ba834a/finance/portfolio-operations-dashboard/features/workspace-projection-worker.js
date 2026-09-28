/* Decode only the workspace and import provenance; archived blobs stay in the parent archive. */
importScripts('../vendor/jszip.min.js?v=acc7e41455a80765');
const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
self.onmessage = async ({data:{archive,source}}) => {
  try {
    const {projectCurrentHistory} = await import('./import-history-store.mjs?v=1b4de46ef620566c');
    const bytes = Uint8Array.from(atob(archive.data),c=>c.charCodeAt(0));
    if (bytes.length !== archive.bytes || await sha(bytes) !== source.archiveHash) throw new Error('Central archive fingerprint mismatch.');
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    if (manifest.format !== archive.bundleType || manifest.entries.length !== archive.recordCount+1) throw new Error('Central archive manifest is incomplete.');
    let bundle = null, history = null;
    for (const entry of manifest.entries) {
      const file = zip.file(entry.name); if (!file) throw new Error('Missing archived record.');
      const payload = await file.async('uint8array');
      // The parent fingerprint authenticates every compressed member. Selected entries are also checked individually.
      const prefix = new TextDecoder().decode(payload.subarray(0,1024));
      if (entry.name !== 'bundle.json' && !/^\s*\{\s*"key"\s*:\s*"atlas_data_import_2_state_v1"/.test(prefix)) continue;
      if (payload.length !== entry.bytes || await sha(payload) !== entry.sha256) throw new Error('Workspace entry fingerprint mismatch.');
      const value = JSON.parse(new TextDecoder().decode(payload));
      if (entry.name === 'bundle.json') bundle = value;
      else history = value.value;
    }
    if (!bundle?.indexedDb?.communityData || !history) throw new Error('Archive is missing the canonical workspace or import evidence.');
    const raw = bundle.keys?.rise_ops_global_v1;
    const importState = projectCurrentHistory(history);
    importState.historyStorage = {...importState.historyStorage,view:'remote',archiveHash:source.archiveHash,parentDocument:source.documentKey,version:source.version};
    self.postMessage({ok:true,value:{format:1,source,communityData:bundle.indexedDb.communityData,opsGlobalData:typeof raw==='string'?JSON.parse(raw):raw||{},importState}});
  } catch(error) {self.postMessage({ok:false,error:error.message});}
};
