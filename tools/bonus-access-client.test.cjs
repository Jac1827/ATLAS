const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const base = __dirname + '/../docs/portfolio-operations-dashboard/';
const client = fs.readFileSync(base + 'centralization/atlas-central-client.js', 'utf8');
const html = fs.readFileSync(base + 'index.html', 'utf8');
const clientSave = client.match(/^  async function adminUpsertUserAccess\([^]*?^  \}/m)?.[0];
const indexSave = html.match(/^async function saveAtlasUnifiedEmployeeAccess\([^]*?^\}/m)?.[0];
assert(clientSave && indexSave, 'Both ends of the Admin access save must exist');

(async () => {
  const calls = [];
  let failure = null, allowed = true, refreshes = 0;
  const context = {
    rpc: async (name, payload) => { calls.push({ name, payload: structuredClone(payload) }); if (failure) throw new Error(failure); return [{ email: payload.p_email, role: payload.p_role }]; },
    normalizeAtlasAccessFormDraft: value => value,
    atlasEmployeeRecordSaveState: { busy: false }, atlasEmployeeAccessHistory: [],
    atlasProfileCanManageSettings: () => allowed, getAtlasAccessProfile: () => ({}),
    atlasEmployeeEmailIsInternal: () => true, findAtlasUnifiedAccessRow: () => null,
    isAtlasUuid: value => /^[\da-f-]{36}$/.test(value), getAtlasAccessTab: id => ({ key: 'page-' + id }),
    loadAtlasAccessAdminData: async () => { refreshes++; }, atlasCurrentUserDisplayName: () => 'Synthetic Admin',
    getAtlasUnifiedEmployeeAccessSnapshot: () => ({ verified: true })
  };
  vm.createContext(context); vm.runInContext(clientSave, context);
  context.window = { ATLAS_CENTRAL: { adminUpsertUserAccess: context.adminUpsertUserAccess } };
  vm.runInContext(indexSave, context);
  const employee = { employeeId: '10000000-0000-4000-8000-000000000001', email: 'synthetic@acceptance.invalid', name: 'Synthetic' };
  const access = { email: employee.email, role: 'regional', status: 'active', allowedCommunityIds: ['10000000-0000-4000-8000-000000000002'], allowedMarketValues: [], allowedRegionValues: [], lockedTabIds: ['9'], bonusPermissions: ['run_calculations', 'view_salary'], accessNotes: 'Explicit reviewed access' };
  let result = await context.saveAtlasUnifiedEmployeeAccess(employee, access);
  assert.equal(result.ok, true); assert.equal(refreshes, 1); assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'atlas_admin_upsert_user_access');
  assert.deepEqual(calls[0].payload.p_bonus_permissions, access.bonusPermissions);
  assert.deepEqual(calls[0].payload.p_allowed_community_ids, access.allowedCommunityIds);
  assert.deepEqual(calls[0].payload.p_locked_page_keys, ['page-9']);
  assert.equal(calls[0].payload.p_employee_id, employee.employeeId);
  assert.equal(context.atlasEmployeeAccessHistory.length, 1);

  // Explicitly removing all access is different from silently dropping a requested field.
  await context.adminUpsertUserAccess({ ...access, bonusPermissions: [] });
  assert.deepEqual(calls.at(-1).payload.p_bonus_permissions, []);
  for (const message of ['function atlas_admin_upsert_user_access not found in schema cache', 'p_bonus_permissions is invalid', 'bonus_permissions constraint failed', 'Only an active Atlas Admin can manage user access']) {
    failure = message; const count = calls.length, history = context.atlasEmployeeAccessHistory.length;
    result = await context.saveAtlasUnifiedEmployeeAccess(employee, access);
    assert.equal(result.ok, false); assert.equal(result.message, message);
    assert.equal(calls.length, count + 1, 'No permission-free compatibility retry is allowed');
    assert.deepEqual(calls.at(-1).payload.p_bonus_permissions, access.bonusPermissions);
    assert.equal(context.atlasEmployeeAccessHistory.length, history);
    assert.equal(context.atlasEmployeeRecordSaveState.status, 'error');
  }
  allowed = false; failure = null; const before = calls.length;
  result = await context.saveAtlasUnifiedEmployeeAccess(employee, access);
  assert.equal(result.ok, false); assert.equal(calls.length, before);
  assert.match(result.message, /Only an authorized ATLAS administrator/);
  console.log('PASS Admin employee access forwards exact Bonus permissions and scope, supports explicit empty permission lists, and never retries or reports success after silently dropping requested permissions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
