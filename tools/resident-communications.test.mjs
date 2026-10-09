import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  smsBlockReason,
  verifyWebhook,
  handleResidentCommunications,
  pickMessage,
} from "../src/resident-communications.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const community = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333",
  linkId = "44444444-4444-4444-8444-444444444444";
const identity = {
  community_id: community,
  resident_id: "synthetic-person",
  lease_id: "synthetic-lease",
  email: "synthetic@example.test",
  email_verified: true,
  phone_e164: "+12025550101",
  phone_verified: true,
  current_lease: true,
};
const route = {
  active: true,
  verified_at: "2026-01-01",
  sms_pilot_approved: true,
  email_pilot_approved: true,
  time_zone_verified_at: "2026-01-01",
  timezone: "America/New_York",
  morning_resume: "08:00:00",
  first_response_minutes: 5,
  follow_up_minutes: 30,
  inbox_id: 2,
  account_id: 1,
};
const consent = {
  status: "granted",
  captured_at: "2026-01-01",
  evidence_reference: "synthetic-record",
  scope: "resident_service",
};
const env = {
  ATLAS_COMMUNICATIONS_ENABLED: "true",
  ATLAS_COMMUNICATIONS_WRITE_ENABLED: "true",
  ATLAS_COMMUNICATIONS_OUTBOUND_ENABLED: "true",
  ATLAS_COMMUNICATIONS_COMPLIANCE_APPROVED: "true",
  CHATWOOT_DEPLOYMENT_VALIDATED: "true",
  CHATWOOT_BASE_URL: "https://chatwoot.example.test",
  CHATWOOT_ACCOUNT_ID: "1",
  CHATWOOT_API_TOKEN: "synthetic-api-token",
  CHATWOOT_ORIGIN_TOKEN: "synthetic-origin-token",
  CHATWOOT_WEBHOOK_SECRET: "synthetic-webhook-secret",
};
const link = {
  link_id: linkId,
  community_id: community,
  resident_id: identity.resident_id,
  lease_id: identity.lease_id,
  contact_link_id: "55555555-5555-4555-8555-555555555555",
  inbox_id: 2,
  conversation_id: 4,
  account_id: 1,
  channel: "sms",
  state: "linked",
  status: "open",
  unread_count: 1,
};
function fixture(overrides = {}) {
  const writes = [],
    upstream = [];
  let claimed = false,
    eventApplied = false;
  const profile = {
    user_id: actor,
    role: "viewer",
    status: "active",
    account_status: "active",
    allowed_community_ids: [community],
  };
  const deps = {
    config: () => ({}),
    db: async (config, path, opts = {}) => {
      if (path === "/auth/v1/user") {
        if (overrides.expired) throw Error("expired");
        return { id: actor };
      }
      if (path.includes("atlas_user_profiles"))
        return [{ ...profile, ...overrides.profile }];
      if (opts.method === "POST" || opts.method === "PATCH")
        writes.push({ path, body: opts.body });
      if (path.endsWith("rpc/atlas_communication_alert_summary"))
        return { alerts: [], total: 0, conversation_count: 0 };
      if (path.endsWith("rpc/atlas_communication_access"))
        return opts.body.p_community_id === community;
      if (path.endsWith("rpc/atlas_communication_claim_operation")) {
        if (claimed) return false;
        claimed = true;
        return true;
      }
      if (path.endsWith("rpc/atlas_communication_apply_event")) {
        if (eventApplied) return false;
        eventApplied = true;
        return true;
      }
      if (path.includes("atlas_chatwoot_operations"))
        return [{ state: claimed ? "accepted" : "pending", result_id: 8 }];
      if (path.includes("atlas_chatwoot_webhook_receipts"))
        return eventApplied ? [{ fingerprint: "existing" }] : [];
      if (path.includes("atlas_chatwoot_inbox_routes"))
        return path.includes("inbox_id=eq.999")
          ? []
          : [{ ...route, ...overrides.route }];
      if (path.includes("atlas_chatwoot_conversation_links"))
        return path.includes(`community_id=eq.${other}`) || overrides.hidden
          ? []
          : [{ ...link, ...overrides.link }];
      if (path.includes("atlas_chatwoot_contact_links"))
        return [
          {
            contact_id: 3,
            identity_key: `atlas:${community}:${identity.resident_id}`,
            state: "linked",
            sms_opted_out: overrides.optedOut || false,
          },
        ];
      if (path.includes("atlas_resident_communication_identity"))
        return overrides.missingIdentity ? [] : [identity];
      if (path.includes("atlas_resident_message_consent"))
        return overrides.missingConsent
          ? []
          : [{ ...consent, ...overrides.consent }];
      if (path.includes("atlas_resident_communication_alerts")) return [];
      return [];
    },
    fetch: async (url, options) => {
      upstream.push({ url, options });
      if (url.endsWith("/contacts/3"))
        return Response.json({
          payload: {
            id: 3,
            identifier: `atlas:${community}:${identity.resident_id}`,
            custom_attributes: {
              atlas_community_id: community,
              atlas_resident_id: identity.resident_id,
            },
          },
        });
      if (url.endsWith("/messages"))
        return options.method === "GET"
          ? Response.json({
              payload: [
                {
                  id: 8,
                  content: "synthetic-transient-body",
                  api_access_token: "must-not-return",
                  attachments: [{ data_url: "https://private.test" }],
                },
              ],
            })
          : Response.json({
              id: 8,
              content: "synthetic-transient-body",
              status: "sent",
            });
      return Response.json({
        id: 4,
        inbox_id: 2,
        status: "open",
        unread_count: 2,
        meta: {
          sender: {
            id: 3,
            email: identity.email,
            phone_number: identity.phone_e164,
          },
        },
        custom_attributes: {
          atlas_community_id: community,
          atlas_resident_id: identity.resident_id,
          atlas_lease_id: identity.lease_id,
        },
      });
    },
  };
  const call = (path, method = "GET", body, extra = {}) =>
    handleResidentCommunications(
      new Request(`https://atlas.example.test/api/atlas/chatwoot${path}`, {
        method,
        headers: {
          Authorization: "Bearer synthetic-jwt",
          "Content-Type": "application/json",
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      { ...env, ...overrides.env },
      deps,
    );
  return { deps, writes, upstream, call };
}
function signed(payload, stamp = Math.floor(Date.now() / 1000), signature) {
  const raw = JSON.stringify(payload),
    secret = env.CHATWOOT_WEBHOOK_SECRET;
  return new Request("https://atlas.example.test/api/atlas/chatwoot/webhooks", {
    method: "POST",
    headers: {
      "X-Chatwoot-Timestamp": String(stamp),
      "X-Chatwoot-Signature":
        signature ||
        `sha256=${createHmac("sha256", secret).update(`${stamp}.${raw}`).digest("hex")}`,
      "X-Chatwoot-Delivery": "synthetic-delivery",
    },
    body: raw,
  });
}

test("quiet hours follow each verified local timezone, including DST and exact boundary", () => {
  for (const [zone, before, after] of [
    ["America/New_York", "2026-10-06T22:59:00Z", "2026-10-06T23:00:00Z"],
    ["America/Chicago", "2026-10-06T23:59:00Z", "2026-10-07T00:00:00Z"],
    ["America/Los_Angeles", "2026-10-07T01:59:00Z", "2026-10-07T02:00:00Z"],
    ["America/New_York", "2026-12-01T23:59:00Z", "2026-12-02T00:00:00Z"],
  ]) {
    assert.equal(
      smsBlockReason(
        { ...route, timezone: zone },
        consent,
        identity,
        new Date(before),
      ),
      null,
    );
    assert.equal(
      smsBlockReason(
        { ...route, timezone: zone },
        consent,
        identity,
        new Date(after),
      ),
      "sms_quiet_hours",
    );
  }
  assert.equal(
    smsBlockReason(route, consent, identity, new Date("2026-10-06T11:59:00Z")),
    "sms_quiet_hours",
  );
  assert.equal(
    smsBlockReason(route, consent, identity, new Date("2026-10-06T12:00:00Z")),
    null,
  );
});
test("SMS missing/invalid configuration and revoked/ambiguous consent fail closed", () => {
  const now = new Date("2026-10-06T16:00:00Z");
  for (const r of [
    { morning_resume: null },
    { morning_resume: "19:00" },
    { timezone: null },
    { timezone: "invented/timezone" },
    { time_zone_verified_at: null },
    { active: false },
    { sms_pilot_approved: false },
  ])
    assert.ok(smsBlockReason({ ...route, ...r }, consent, identity, now));
  for (const c of [
    null,
    { status: "revoked" },
    { status: "ambiguous" },
    { ...consent, evidence_reference: null },
    { ...consent, revoked_at: "2026-01-02" },
  ])
    assert.ok(smsBlockReason(route, c, identity, now));
  assert.equal(
    smsBlockReason(route, consent, { ...identity, sms_opted_out: true }, now),
    "sms_opted_out",
  );
  assert.ok(
    smsBlockReason(route, consent, { ...identity, phone_e164: "invalid" }, now),
  );
});
test("HMAC binds timestamp and exact bytes; invalid signatures and stale timestamps rejected", async () => {
  const p = { event: "message_created" };
  assert.equal(
    (await verifyWebhook(signed(p), env.CHATWOOT_WEBHOOK_SECRET)).payload.event,
    p.event,
  );
  await assert.rejects(
    () =>
      verifyWebhook(
        signed(p, Math.floor(Date.now() / 1000) - 301),
        env.CHATWOOT_WEBHOOK_SECRET,
      ),
    /stale_webhook/,
  );
  await assert.rejects(
    () =>
      verifyWebhook(
        signed(p, Math.floor(Date.now() / 1000), `sha256=${"0".repeat(64)}`),
        env.CHATWOOT_WEBHOOK_SECRET,
      ),
    /invalid_signature/,
  );
  const req = signed(p),
    headers = req.headers;
  await assert.rejects(
    () =>
      verifyWebhook(
        new Request(req.url, {
          method: "POST",
          headers,
          body: JSON.stringify(p) + " ",
        }),
        env.CHATWOOT_WEBHOOK_SECRET,
      ),
    /invalid_signature/,
  );
});
test("unauthenticated, expired and inactive profiles never reach Chatwoot", async () => {
  for (const options of [
    { expired: true },
    { profile: { status: "disabled" } },
    { profile: { account_status: "invitation_expired" } },
    { profile: { role: "unknown" } },
    { profile: { locked_page_keys: ["resident_communications"] } },
  ]) {
    const f = fixture(options);
    const response = await f.call("/conversations");
    assert.ok([401, 403].includes(response.status));
    assert.equal(f.upstream.length, 0);
  }
  const f = fixture();
  const response = await handleResidentCommunications(
    new Request("https://atlas.test/api/atlas/chatwoot/conversations"),
    env,
    f.deps,
  );
  assert.equal(response.status, 401);
});
test("cross-community detail and forged create scope/inbox IDs cannot bypass access", async () => {
  const f = fixture({ hidden: true });
  assert.equal((await f.call("/conversations/999/messages")).status, 404);
  assert.equal(f.upstream.length, 0);
  const forged = fixture();
  assert.equal(
    (
      await forged.call("/conversations", "POST", {
        ...identity,
        community_id: other,
        channel: "sms",
        inbox_id: 999,
      })
    ).status,
    403,
  );
  assert.equal(forged.upstream.length, 0);
});
test("reply rejects recipient/inbox/actor/attachment injection and never logs or persists body", async () => {
  const f = fixture({
    env: { ATLAS_COMMUNICATIONS_OUTBOUND_ENABLED: "false" },
  });
  for (const field of [
    "community_id",
    "inbox_id",
    "actor",
    "attachments",
    "recipient",
  ])
    assert.equal(
      (
        await f.call(
          "/conversations/4/messages",
          "POST",
          { content: "synthetic-body", [field]: "forged" },
          { "Idempotency-Key": "synthetic-request-123" },
        )
      ).status,
      400,
    );
  const response = await f.call(
    "/conversations/4/messages",
    "POST",
    { content: "synthetic-body" },
    { "Idempotency-Key": "synthetic-request-123" },
  );
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, "outbound_activation_pending");
  assert.ok(!JSON.stringify(f.writes).includes("synthetic-body"));
  assert.ok(!f.upstream.some((c) => c.options.method === "POST"));
});
test("opt-out and missing canonical identity block delivery", async () => {
  const opted = fixture({ optedOut: true });
  const r = await opted.call(
    "/conversations/4/messages",
    "POST",
    { content: "synthetic-body" },
    { "Idempotency-Key": "synthetic-request-123" },
  );
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "sms_opted_out");
  const missing = fixture({ missingIdentity: true });
  assert.equal(
    (
      await missing.call(
        "/conversations/4/messages",
        "POST",
        { content: "synthetic-body" },
        { "Idempotency-Key": "synthetic-request-123" },
      )
    ).status,
    409,
  );
});
test("private notes and history use Worker; only minimum history fields returned", async () => {
  const f = fixture();
  const history = await (await f.call("/conversations/4/messages")).json();
  assert.equal(history.messages[0].content, "synthetic-transient-body");
  assert.ok(!JSON.stringify(history).includes("must-not-return"));
  assert.ok(!JSON.stringify(history).includes("https://private.test"));
  const first = await f.call(
    "/conversations/4/private-notes",
    "POST",
    { content: "synthetic-body" },
    { "Idempotency-Key": "synthetic-request-123" },
  );
  assert.equal(first.status, 200);
  const second = await f.call(
    "/conversations/4/private-notes",
    "POST",
    { content: "synthetic-body" },
    { "Idempotency-Key": "synthetic-request-123" },
  );
  assert.equal(second.status, 200);
  assert.equal(f.upstream.filter((c) => c.options.method === "POST").length, 1);
  assert.ok(!JSON.stringify(f.writes).includes("synthetic-body"));
});
test("verified webhook deduplicates, projects only metadata, and rejects unapproved inbox", async () => {
  const f = fixture();
  const p = {
    event: "message_created",
    id: 8,
    account: { id: 1 },
    inbox: { id: 2 },
    conversation: { id: 4 },
    created_at: Math.floor(Date.now() / 1000),
    message_type: "incoming",
    content: "STOP",
  };
  assert.equal(
    (await handleResidentCommunications(signed(p), env, f.deps)).status,
    200,
  );
  const write = f.writes.find((w) =>
    w.path.endsWith("rpc/atlas_communication_apply_event"),
  );
  assert.equal(write.body.p_opt_out, true);
  assert.ok(!JSON.stringify(f.writes).includes("STOP"));
  assert.equal(
    (await handleResidentCommunications(signed(p), env, f.deps)).status,
    409,
  );
  assert.equal(
    f.writes.filter((w) =>
      w.path.endsWith("rpc/atlas_communication_apply_event"),
    ).length,
    1,
  );
  const unknown = fixture();
  assert.equal(
    (
      await handleResidentCommunications(
        signed({ ...p, inbox: { id: 999 } }),
        env,
        unknown.deps,
      )
    ).status,
    422,
  );
  assert.equal(unknown.upstream.length, 0);
});
test("browser features contain no upstream credentials, endpoint, iframe or message persistence", () => {
  for (const path of [
    "features/resident-communications.js",
    "features/resident-communication-alerts.js",
  ]) {
    const text = readFileSync(
      new URL(
        `../docs/portfolio-operations-dashboard/${path}`,
        import.meta.url,
      ),
      "utf8",
    );
    for (const forbidden of [
      "CHATWOOT_API_TOKEN",
      "CHATWOOT_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "api_access_token",
      "<iframe",
      "localStorage",
      "sessionStorage",
      "console.log",
    ])
      assert.ok(!text.includes(forbidden), forbidden);
  }
  assert.deepEqual(
    Object.keys(
      pickMessage({ id: 1, api_access_token: "secret", attachments: [] }),
    ),
    [
      "id",
      "content",
      "private",
      "message_type",
      "status",
      "created_at",
      "has_attachments",
    ],
  );
});

test("read-only pilot rejects mutations while allowing scoped metadata reads", async () => {
  const f = fixture({ env: { ATLAS_COMMUNICATIONS_WRITE_ENABLED: "false" } });
  assert.equal((await f.call("/conversations")).status, 200);
  for (const [path, method, body] of [
    ["/conversations/4/status", "PATCH", { status: "resolved" }],
    ["/contacts/sync", "POST", identity],
    ["/conversations/4/private-notes", "POST", { content: "synthetic-note" }],
  ]) {
    const response = await f.call(path, method, body);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "communications_read_only");
  }
  assert.equal(f.upstream.length, 0);
});
test("deterministic existing canonical contact synchronization is idempotent", async () => {
  const f = fixture();
  assert.equal((await f.call("/contacts/sync", "POST", identity)).status, 200);
  assert.equal((await f.call("/contacts/sync", "POST", identity)).status, 200);
  assert.equal(f.upstream.length, 0);
  assert.equal(
    f.writes.length,
    2,
    "Only authorization RPCs, no contact creation writes",
  );
});
test("verified STOP is revoked before upstream outage can delay the consent projection", async () => {
  const f = fixture();
  f.deps.fetch = async () => {
    throw Error("synthetic outage");
  };
  const p = {
    event: "message_created",
    id: 8,
    account: { id: 1 },
    inbox: { id: 2 },
    conversation: { id: 4 },
    created_at: Math.floor(Date.now() / 1000),
    message_type: "incoming",
    content: "STOP",
  };
  const response = await handleResidentCommunications(signed(p), env, f.deps);
  assert.equal(response.status, 502);
  assert.ok(
    f.writes.some((w) =>
      w.path.endsWith("rpc/atlas_communication_record_opt_out"),
    ),
  );
});
test("actual Worker routes reject missing sessions and support authenticated PATCH preflight", async () => {
  const { loadWorker } = await import("./load-worker-for-node-test.mjs");
  const worker = await loadWorker();
  assert.equal(
    (
      await worker.fetch(
        new Request("https://atlas.test/api/atlas/chatwoot/conversations"),
        {},
        {},
      )
    ).status,
    401,
  );
  const preflight = await worker.fetch(
    new Request(
      "https://atlas.test/api/atlas/chatwoot/conversations/4/status",
      { method: "OPTIONS" },
    ),
    {},
    {},
  );
  assert.equal(preflight.status, 204);
  assert.ok(
    preflight.headers.get("Access-Control-Allow-Methods").includes("PATCH"),
  );
});
