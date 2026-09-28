// A derived read model. The immutable parent archive remains the source of truth.
import {stableJson,digest} from './workspace-canonical.mjs?v=dbb5eb39e5af90c5';
export {stableJson,digest};
export async function digestWorkspaceBody(body,{signal}={}) {
  if(signal?.aborted)throw signal.reason || new DOMException('Cancelled','AbortError');
  if(typeof Worker!=='function')return digest(body);
  const worker=new Worker(new URL('./workspace-integrity-worker.js?v=54078411af51e7cd',import.meta.url));
  let abort;
  try {
    return await new Promise((resolve,reject)=>{
      abort=()=>reject(signal.reason || new DOMException('Cancelled','AbortError'));
      signal?.addEventListener('abort',abort,{once:true});
      worker.onmessage=({data})=>data?.ok && /^[a-f0-9]{64}$/.test(data.contentHash||'') ? resolve(data.contentHash) : reject(new Error(data?.error || 'Workspace integrity worker returned an invalid receipt.'));
      worker.onerror=()=>reject(new Error('Workspace integrity verification did not finish.'));
      worker.postMessage(body);
    });
  } finally {signal?.removeEventListener('abort',abort);worker.terminate();}
}
export function sourceIdentity(document) {
  const archive = document?.payload?.bundle;
  if (archive?.bundleType !== 'atlas_migration_archive_v1' || !/^[a-f0-9]{64}$/.test(archive.sha256 || '') || !Number.isSafeInteger(document.version)) throw new Error('The central workspace has no verified archive manifest.');
  return {documentKey:document.document_key,version:document.version,archiveHash:archive.sha256,effectiveAt:document.updated_at};
}
export const projectionKey = source => `atlas_workspace_projection_v1:${source.archiveHash}:${source.version}`;
export async function verifyProjection(value, source, {signal,worker=false} = {}) {
  if (!value || value.format !== 1 || stableJson(value.source) !== stableJson(source) || !value.communityData || !value.importState) throw new Error('Workspace projection does not match the current central archive.');
  const {contentHash,...body} = value;
  if (contentHash !== await (worker ? digestWorkspaceBody(body,{signal}) : digest(body))) throw new Error('Workspace projection fingerprint mismatch.');
  return value;
}
export async function readProjection(central, document, {signal} = {}) {
  const source = sourceIdentity(document);
  const row = await central.readDocument(projectionKey(source), {signal});
  if (!row?.payload) return null;
  return verifyProjection(row.payload, source);
}
// The server resolves the current source and authorization scope in one snapshot.
// Never fall back to the unfiltered archive when a scoped read is unavailable.
export async function readWorkspace(central, {signal} = {}) {
  const result = await central.fetchJson('/rpc/atlas_read_workspace_projection', {method:'POST',body:'{}',signal});
  if (signal?.aborted) throw signal.reason || new DOMException('Cancelled','AbortError');
  if (result?.status !== 'available') throw new Error('The verified central workspace is temporarily unavailable. Retry after its source projection is ready.');
  const {source,projection,scopeFingerprint,projectionVersion,projectionContentHash,projectionHashFormat,fullProjection} = result;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (source?.documentKey !== 'atlas_dashboard_state_v1' || !Number.isSafeInteger(source.version) || !hash(source.archiveHash) || !Number.isFinite(Date.parse(source.effectiveAt)) || !hash(scopeFingerprint) || !Number.isSafeInteger(projectionVersion) || !hash(projectionContentHash) || projectionHashFormat !== 'postgres-jsonb-sha256' || typeof fullProjection !== 'boolean') throw new Error('Invalid workspace source or authorization receipt.');
  if (projection?.format !== 1 || stableJson(projection.source) !== stableJson(source) || !projection.communityData || !projection.opsGlobalData || !projection.importState) throw new Error('Workspace projection does not match its source receipt.');
  if (fullProjection) await verifyProjection(projection,source,{signal,worker:true});
  // A filtered response has its own integrity digest. It is not the full archive's digest.
  const {contentHash:ignored,...body} = projection;
  const contentHash = fullProjection ? projection.contentHash : await digestWorkspaceBody(body,{signal});
  if (signal?.aborted) throw signal.reason || new DOMException('Cancelled','AbortError');
  return {source,projection:{...body,contentHash},binding:{scopeFingerprint,projectionVersion,projectionContentHash,projectionHashFormat,fullProjection}};
}
export async function buildProjection(central, document, {signal,archive:inlineArchive} = {}) {
  const source = sourceIdentity(document);
  await Promise.all([window.AtlasFeatures.load('zip'),window.AtlasFeatures.load('migrationArchive')]);
  if (inlineArchive && (inlineArchive.sha256 !== source.archiveHash || inlineArchive.bytes !== document.payload.bundle.bytes || typeof inlineArchive.data !== 'string')) throw new Error('Prepared archive does not match the saved central source.');
  const archive = inlineArchive || await window.AtlasMigrationArchive.hydrate(document.payload.bundle, central, {signal});
  if (signal?.aborted) throw signal.reason;
  const worker = new Worker(new URL('./workspace-projection-worker.js?v=e228063be4020b0b', import.meta.url));
  try {
    const body = await new Promise((resolve,reject) => {
      const abort = () => {worker.terminate(); reject(signal.reason || new DOMException('Cancelled','AbortError'));};
      signal?.addEventListener('abort', abort, {once:true});
      worker.onmessage = ({data}) => {signal?.removeEventListener('abort',abort); data.ok ? resolve(data.value) : reject(new Error(data.error));};
      worker.onerror = () => {signal?.removeEventListener('abort',abort); reject(new Error('Workspace projection worker failed.'));};
      worker.postMessage({archive,source});
    });
    return {...body,contentHash:await digest(body)};
  } finally {worker.terminate();}
}
// Used by the deployment materializer or an explicit admin repair, never by startup.
export async function publishProjection(central, document, options = {}) {
  const source = sourceIdentity(document);
  const current = async () => {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('Cancelled','AbortError');
    const latest = await central.readDocument(source.documentKey,options);
    if (stableJson(sourceIdentity(latest)) !== stableJson(source)) throw new Error('Central source changed while preparing its projection. Refresh before retrying.');
  };
  await current();
  const existing = await central.readDocument(projectionKey(source),options);
  if (existing) {
    if (existing.module_key !== 'dashboard' || existing.source_module !== 'workspace_projection') throw new Error('The retained startup document is not a canonical projection.');
    const value = await verifyProjection(existing.payload,source);
    await current();
    return value;
  }
  const value = await buildProjection(central,document,options);
  await current();
  // This bounded admin RPC checks and locks the exact parent source, keeps
  // immutable version/audit writes atomic, and has its own publication budget.
  await central.rpc('atlas_publish_workspace_projection',{p_projection:value});
  const readback = await central.readDocument(projectionKey(source),options);
  if (readback?.module_key !== 'dashboard' || readback?.source_module !== 'workspace_projection') throw new Error('The saved startup projection receipt is unavailable.');
  const verified = await verifyProjection(readback.payload,source);
  await current();
  return verified;
}

export async function accessNamespace(central, profile) {
  const actor = central.getSession()?.user?.id, backend = central.getConfig().supabaseUrl;
  if (!actor || profile?.user_id !== actor || profile.status !== 'active' || (profile.account_status ?? 'active') !== 'active' || profile.access_backend !== backend || !profile.access_verified_at) throw new Error('A current access check is required to open this workspace.');
  const scope = {actor,backend,role:profile.role,status:profile.status,accountStatus:profile.account_status ?? null,employee:profile.employee_id,communities:profile.allowed_community_ids,markets:profile.allowed_market_values,regions:profile.allowed_region_values,tabs:profile.locked_tab_ids,pages:profile.locked_page_keys,bonus:profile.bonus_permissions,roster:profile.community_access_records};
  return 'atlas_rise_scoped_v2:' + await digest(scope);
}
