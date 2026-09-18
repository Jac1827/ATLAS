const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const peoplePath = path.join(root, 'docs/portfolio-operations-dashboard/RISE-Performance-Platform.html');
const shellPath = path.join(root, 'docs/portfolio-operations-dashboard/index.html');
const clientPath = path.join(root, 'docs/portfolio-operations-dashboard/centralization/atlas-central-client.js');
const sqlPath = path.join(root, 'docs/portfolio-operations-dashboard/centralization/employee-notifications.sql');
const mountsPath = path.join(root, 'docs/portfolio-operations-dashboard/atlas-mounts.js');

const people = fs.readFileSync(peoplePath, 'utf8');
const shell = fs.readFileSync(shellPath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const sql = fs.readFileSync(sqlPath, 'utf8');
const mounts = fs.readFileSync(mountsPath, 'utf8');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
}

test('edited browser scripts parse', () => {
  for (const [file, html] of [[peoplePath, people], [shellPath, shell]]) {
    inlineScripts(html).forEach((source, index) => {
      assert.doesNotThrow(() => new vm.Script(source, { filename: `${file}#${index}` }));
    });
  }
  assert.doesNotThrow(() => new vm.Script(client, { filename: clientPath }));
});

test('roster and employee access are one expandable workspace', () => {
  assert.match(people, /class="page people-roster-page"/);
  assert.match(people, /class="employee-roster-row \$\{isSelected/);
  assert.match(people, /renderUnifiedEmployeeEditor\(employee, isAdmin\)/);
  assert.match(people, /employee-editor-row/);
  assert.match(people, /Unsaved changes/);
  assert.match(people, /Save Employee Record/);
  assert.match(people, /Save Confirmed/);
  assert.match(people, /Bonus and incentive profile/);
  assert.match(people, /Property scope/);
  assert.match(people, /Locked-page permissions/);
  assert.match(people, /Assignment and access-change history/);
  assert.match(people, /employee-record-salary/);
});

test('search and combined filters cover identity, assignment, status, and access', () => {
  assert.match(people, /Search employee, email, ID, role, manager, community, status, or access/);
  for (const id of ['roster-filter-role', 'roster-filter-manager', 'roster-filter-regional-manager', 'roster-filter-region', 'roster-filter-community', 'roster-filter-status', 'roster-filter-access', 'roster-filter-invitation', 'roster-filter-email-review']) {
    assert.match(people, new RegExp(id));
  }
  assert.match(people, /downloadFilteredRosterExport/);
});

test('record save uses backend confirmation and employee-id mismatch protection', () => {
  const start = people.indexOf('async function saveUnifiedEmployeeRecord');
  const end = people.indexOf('async function requestUnifiedEmployeePasswordReset', start);
  const saveSource = people.slice(start, end);
  assert.match(saveSource, /await window\.parent\.saveAtlasUnifiedEmployeeAccess/);
  assert.match(saveSource, /status:'success'/);
  assert.doesNotMatch(saveSource, /alert\(/);
  assert.match(shell, /existingEmployeeId !== employeeId/);
  assert.match(shell, /await window\.ATLAS_CENTRAL\.adminUpsertUserAccess/);
  assert.match(shell, /atlasEmployeeAccessHistory =/);
});

test('role model keeps access management admin-only while retaining scoped roles', () => {
  assert.match(shell, /Only an authorized ATLAS administrator can save employee access/);
  assert.match(shell, /people: \["0","1","8","9","13","14"\]/);
  assert.match(shell, /regional: \["0","1","2","3","4","5","6","8","9","10","11","12","13","14","15"\]/);
  assert.match(shell, /community_manager:/);
  assert.match(shell, /viewer:/);
  assert.match(sql, /atlas_has_role\(array\['admin'\]\)/);
});

test('employee ticker supports secure lifecycle and relevant upload triggers', () => {
  assert.match(shell, /atlas-employee-notices/);
  assert.match(shell, /behavior === "until_viewed"/);
  assert.match(shell, /behavior === "until_dismissed"/);
  assert.match(shell, /requires_acknowledgement/);
  assert.match(shell, /publishAtlasApprovedDataNotices/);
  assert.match(client, /atlas_employee_notification_action/);
  assert.match(client, /atlas_admin_publish_employee_notification/);
});

test('notification storage is recipient-scoped, deduplicated, and excludes sensitive payloads', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /recipient_user_id = auth\.uid\(\)/);
  assert.match(sql, /event_key text not null unique/);
  assert.match(sql, /interval '12 hours'/);
  assert.match(sql, /until_viewed/);
  assert.match(sql, /until_dismissed/);
  assert.match(sql, /on conflict \(event_key\) do nothing/);
  const triggerBody = sql.slice(sql.indexOf('create or replace function atlas_publish_access_change_notification'));
  assert.doesNotMatch(triggerBody, /new\.access_notes|new\.salary|new\.payroll|new\.target_bonus/i);
});

test('People iframe cache key changes with the unified release', () => {
  assert.match(mounts, /20260918-unified-employee-access/);
});
