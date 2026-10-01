// The retained saveDocument already enforces access identity, but its release
// omitted the helper it calls. Add only that dependency, preserving the guards.
export function patchCentralSaveAccessContext(retained, current) {
  const helper = /^  function getAccessContextKey\(\) \{[\s\S]*?^  \}/gm;
  const anchor = '  function getSession() {';
  const graphAnchor = '  async function saveSharedPropertyGraph(payload = {}, options = {}) {';
  const graphGuard = '\n    if (!Number.isInteger(options.expectedVersion) || options.expectedVersion < 0) throw new Error("Shared property changes remain in this browser; a verified Central version is required before saving.");';
  const matches = [...current.matchAll(helper)];
  if (matches.length !== 1 || /function getAccessContextKey\(/.test(retained)
      || retained.split(anchor).length !== 2 || retained.split(graphAnchor).length !== 2
      || !retained.includes('accessAtStart = getAccessContextKey()')) {
    throw Error('The retained Central save access-context boundary changed.');
  }
  return retained.replace(anchor, matches[0][0] + '\n\n' + anchor).replace(graphAnchor, graphAnchor + graphGuard);
}
