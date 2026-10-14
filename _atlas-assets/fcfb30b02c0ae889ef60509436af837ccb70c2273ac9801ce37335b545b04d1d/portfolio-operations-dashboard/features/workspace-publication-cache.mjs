// A publication acknowledgement changes only the cache receipt, never user data.
// Compare exact persisted records in the same transaction as the acknowledgement.
export async function capturePublicationCache(withStore, keys, isCurrent) {
  const captured = {};
  await withStore('readonly', store => {
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => { captured[key] = JSON.stringify(request.result ?? null); };
    }
  });
  if (!isCurrent()) return null;
  return captured;
}
export async function acknowledgePublicationCache(withStore, captured, workspace, expectedSource, isCurrent, stableJson) {
  if (!captured || !isCurrent() || stableJson(workspace.source) !== stableJson(expectedSource)) return false;
  // A scoped response must not relabel an unrelated local portfolio.
  if (!workspace.binding.fullProjection) return false;
  let acknowledged = false;
  await withStore('readwrite', store => {
    const keys = Object.keys(captured); let remaining = keys.length, matches = !!remaining;
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        matches = matches && JSON.stringify(request.result ?? null) === captured[key];
        if (--remaining || !matches || !isCurrent()) return;
        const verifiedAt = new Date().toISOString();
        store.put({key:'atlas_workspace_source_v2',value:{identity:workspace.source,binding:workspace.binding,contentHash:workspace.projection.contentHash,verifiedAt,dirty:false},updatedAt:verifiedAt});
        store.put({key:'atlas_startup_import_projection_v2',value:workspace.projection.importState,updatedAt:verifiedAt});
        acknowledged = true;
      };
    }
  });
  return acknowledged && isCurrent();
}
