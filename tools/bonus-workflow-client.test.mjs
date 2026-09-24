import assert from 'node:assert/strict';
import { createBonusWorkflowClient } from '../docs/portfolio-operations-dashboard/features/bonus-workflow-client.mjs';

let actor = 'actor-a', fail = true, next = 0;
const calls = [];
const runId = '11111111-1111-4111-8111-111111111111';
const central = {
  getSession: () => actor ? { user: { id: actor } } : null,
  async fetchJson(path, options) {
    const body = JSON.parse(options.body); calls.push({ path, body });
    if (fail) { fail = false; throw new Error('Connection interrupted after send'); }
    return { runId, revision: body.p_expected_revision + 1, status: body.p_action === 'lock' ? 'locked' : 'approved', calculationHash: 'a'.repeat(64), totalPayout: 0 };
  }
};
const client = createBonusWorkflowClient(central, { requestId: () => 'request-' + (++next) });
await assert.rejects(() => client.transition(runId, 'approve', 1, { reason: 'Reviewed' }), /interrupted/);
await client.transition(runId, 'approve', 1, { reason: 'Reviewed' });
assert.equal(calls[0].body.p_request_id, calls[1].body.p_request_id, 'An uncertain retry must not duplicate an approval.');
await client.transition(runId, 'lock', 2, { reason: 'Reviewed' });
assert.notEqual(calls[1].body.p_request_id, calls[2].body.p_request_id);
assert.equal(calls[2].body.p_expected_revision, 2);
actor = null;
const count = calls.length;
await assert.rejects(() => client.read([]), /Sign in/);
assert.equal(calls.length, count);
actor = 'actor-a';
central.fetchJson = async () => { actor = 'actor-b'; return { verified: true }; };
await assert.rejects(() => client.read(['community']), /account changed/);
actor = 'actor-a';
let finish;
central.fetchJson = () => new Promise(resolve => { finish = resolve; });
const pending = client.read(['community']);
client.clear(); finish({ plans: [] });
await assert.rejects(() => pending, /account changed/);
console.log('PASS Bonus workflow client: uncertain writes retry the same request, revisions remain explicit, unauthenticated writes are blocked, and stale account responses are discarded.');

actor = 'actor-a';
const invalidCalls = [];
central.fetchJson = async (_path, options) => { invalidCalls.push(JSON.parse(options.body)); return { verified: true, revision: 3 }; };
await assert.rejects(() => client.transition(runId, 'approve', 2, { reason: 'Reviewed' }), /could not be verified/);
await assert.rejects(() => client.transition(runId, 'approve', 2, { reason: 'Reviewed' }), /could not be verified/);
assert.equal(invalidCalls[0].p_request_id, invalidCalls[1].p_request_id);
console.log('PASS malformed success is never reported as approval and retains its retry identity.');
