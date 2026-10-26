/* Explicitly reviewed People contacts. This projection never supplies workforce,
   authenticated-user, payroll, recipient, or regional-appointment records. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  root.AtlasPeopleContacts = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const TYPE = 'atlas.people-contact.v1';
  const PEOPLE_KEY = 'rise_performance_platform_github_v1';
  const text = value => String(value ?? '').trim();
  const norm = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const active = row => row && /^active$/i.test(text(row.status)) && !row.archived && !row.terminationDate;
  const gm = role => /^(general manager|community manager|gm)$/i.test(text(role));
  const email = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
  function normalize(value) {
    if (!value || value.schema !== TYPE || !text(value.peopleId) || !text(value.assignmentId) || !text(value.community)
      || !text(value.name) || !email(value.email) || !gm(value.title) || !/^[a-f0-9]{64}$/.test(value.sourceHash || '')
      || !Number.isFinite(Date.parse(value.sourceDate)) || !date(value.asOf)) return null;
    const result = Object.fromEntries(['schema', 'peopleId', 'assignmentId', 'community', 'name', 'email', 'title', 'sourceHash', 'sourceDate', 'asOf', 'reviewedAt', 'reviewedBy'].map(key => [key, text(value[key])]));
    const supervisor = value.supervisor;
    if (supervisor?.kind === 'employee-reference' && text(supervisor.peopleId) && text(supervisor.name) && text(supervisor.title) && email(supervisor.email)) {
      result.supervisor = {kind: 'employee-reference', peopleId: text(supervisor.peopleId), name: text(supervisor.name), title: text(supervisor.title), email: text(supervisor.email)};
    } else if (supervisor?.kind === 'recorded-name' && text(supervisor.name)) {
      result.supervisor = {kind: 'recorded-name', name: text(supervisor.name)};
    }
    return result;
  }
  function contact(record, community) {
    const value = normalize(record?.peopleContactAuthority);
    return value && value.community === community ? value : null;
  }
  function baseline(record = {}) {
    return JSON.stringify({authority: record.peopleContactAuthority || null,
      fields: Object.fromEntries(['generalManagerName', 'generalManagerEmail', 'generalManagerEmployeeId', 'generalManagerUserId'].map(key => [key, text(record[key])]))});
  }
  function apply(record, candidate) {
    const binding = normalize(candidate);
    if (!binding) throw Error('The reviewed People contact is invalid. Review the source again.');
    return {...record, peopleContactAuthority: binding, generalManagerName: binding.name, generalManagerEmail: binding.email};
  }
  async function review(snapshot, {communities, records, aliases = {}, asOf = new Date().toISOString().slice(0, 10), digest}) {
    if (snapshot?.snapshotType !== 'atlas_central_migration_read_only_snapshot_v1' || snapshot.readOnly !== true || !date(asOf)) throw Error('Choose an ATLAS read-only snapshot exported from the saved People workspace.');
    const entry = snapshot.storageEntries?.[PEOPLE_KEY];
    if (typeof entry?.value !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) throw Error('The snapshot has no verified People source.');
    if (await digest(entry.value) !== entry.sha256) throw Error('The People source fingerprint does not match the snapshot.');
    const people = JSON.parse(entry.value);
    if (JSON.stringify(people) !== JSON.stringify(entry.parsed)) throw Error('The two retained People records disagree.');
    if (!Array.isArray(people.employees) || !Array.isArray(people.employeeAssignments)) throw Error('The snapshot is missing People assignments.');
    const byId = new Map();
    for (const employee of people.employees) {
      if (!text(employee.id) || byId.has(employee.id)) throw Error('The People source contains missing or duplicate employee identities.');
      byId.set(employee.id, employee);
    }
    const allowed = new Map(communities.map(name => [norm(name), name]));
    const resolve = value => allowed.get(norm(value)) || allowed.get(norm(aliases[text(value).toLowerCase()])) || '';
    const candidates = new Map(), issues = [];
    for (const employee of people.employees) {
      if (!active(employee) || !gm(employee.role)) continue;
      const community = resolve(employee.community);
      if (!community) continue;
      const current = people.employeeAssignments.filter(row => row.employeeId === employee.id
        && /^(active|current)$/i.test(text(row.recordStatus)) && active(row)
        && date(row.effectiveStart) && row.effectiveStart <= asOf && (!row.effectiveEnd || date(row.effectiveEnd) && row.effectiveEnd >= asOf));
      const identity = row => JSON.stringify([resolve(row.community), text(row.role), text(row.managerId), text(row.managerName), text(row.regionalManagerId), text(row.regionalManagerName)]);
      if (!current.length || new Set(current.map(identity)).size !== 1 || identity(employee) !== identity(current[0]) || current.some(row => !text(row.id))) {
        issues.push({community, reason: 'Current People assignments are missing or disagree.'}); continue;
      }
      if (!email(employee.email)) {issues.push({community, reason: 'Review the General Manager work email in People.'}); continue;}
      current.sort((a, b) => text(b.effectiveStart).localeCompare(text(a.effectiveStart)) || text(b.createdAt).localeCompare(text(a.createdAt)) || text(a.id).localeCompare(text(b.id)));
      const managerId = text(employee.managerId), manager = managerId.startsWith('emp:') ? byId.get(managerId.slice(4)) : null;
      const supervisor = manager && active(manager) && email(manager.email)
        ? {kind: 'employee-reference', peopleId: manager.id, name: manager.name, title: manager.role, email: manager.email}
        : !managerId && text(employee.managerName) ? {kind: 'recorded-name', name: employee.managerName} : null;
      const value = normalize({schema: TYPE, peopleId: employee.id, assignmentId: current[0].id, community,
        name: employee.name, email: employee.email, title: employee.role, sourceHash: entry.sha256,
        sourceDate: snapshot.generatedAt, asOf, supervisor});
      if (!value) {issues.push({community, reason: 'The People contact evidence is incomplete.'}); continue;}
      const list = candidates.get(community) || []; list.push(value); candidates.set(community, list);
    }
    const rows = [];
    for (const community of communities) {
      const matches = candidates.get(community) || [];
      if (matches.length !== 1) {issues.push({community, reason: matches.length ? 'More than one current General Manager requires review.' : 'No confirmed current General Manager in this People source.'}); continue;}
      const candidate = matches[0], record = records[community] || {}, prior = contact(record, community);
      const sameIdentity = prior && ['peopleId', 'assignmentId', 'name', 'email', 'title'].every(key => prior[key] === candidate[key]);
      const sameSupervisor = JSON.stringify(prior?.supervisor || null) === JSON.stringify(candidate.supervisor || null);
      const unchanged = sameIdentity && sameSupervisor;
      rows.push({community, candidate, baseline: baseline(record), currentName: text(record.generalManagerName), currentEmail: text(record.generalManagerEmail), currentSupervisor: prior?.supervisor || null,
        disposition: unchanged ? 'unchanged' : sameIdentity && !sameSupervisor ? 'update supervisor' : record.generalManagerName === candidate.name && record.generalManagerEmail === candidate.email ? 'confirm identity' : 'correct contact'});
    }
    return {sourceDate: snapshot.generatedAt, sourceHash: entry.sha256, employeeCount: people.employees.length, rows, issues};
  }
  return {TYPE, normalize, contact, baseline, apply, review};
});
