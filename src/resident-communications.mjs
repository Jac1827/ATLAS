// Chatwoot is the only message store. Never log request/upstream payloads in this module.
const ROLES = new Set([
  "admin",
  "centra",
  "executive",
  "regional",
  "community_manager",
  "people",
  "marketing",
  "maintenance",
  "finance",
  "bonus",
  "viewer",
]);
const EVENTS = new Set([
  "message_created",
  "message_updated",
  "conversation_created",
  "conversation_updated",
  "conversation_status_changed",
]);
const STATUS = new Set(["open", "pending", "resolved", "snoozed"]);
const enc = new TextEncoder();
const eq = (value) => encodeURIComponent(String(value));
const positive = (value) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0;
function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}
export async function boundedJson(response, limit = 1048576) {
  const reader = response.body?.getReader();
  if (!reader) fail("invalid_json");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) fail("payload_too_large", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}
async function readBody(request) {
  try {
    return JSON.parse(
      new TextDecoder().decode(await boundedJson(request, 32768)),
    );
  } catch (error) {
    if (error.code) throw error;
    fail("invalid_json");
  }
}
export async function fingerprint(value) {
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyWebhook(request, secret, now = Date.now()) {
  if (!secret) fail("webhook_not_configured", 503);
  const stamp = request.headers.get("X-Chatwoot-Timestamp") || "";
  if (!/^\d{10}$/.test(stamp) || Math.abs(now / 1000 - Number(stamp)) > 300)
    fail("stale_webhook", 401);
  const signature = request.headers.get("X-Chatwoot-Signature") || "";
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) fail("invalid_signature", 401);
  const raw = await boundedJson(request);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const prefix = enc.encode(`${stamp}.`),
    signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  const bytes = Uint8Array.from(signature.slice(7).match(/../g), (x) =>
    parseInt(x, 16),
  );
  if (!(await crypto.subtle.verify("HMAC", key, bytes, signed)))
    fail("invalid_signature", 401);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    fail("invalid_json");
  }
  const delivery = request.headers.get("X-Chatwoot-Delivery");
  if (delivery && !/^[a-zA-Z0-9_-]{1,150}$/.test(delivery))
    fail("invalid_delivery");
  // Raw digest fallback excludes the signing timestamp so transport retries deduplicate.
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const rawHash = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return {
    payload,
    eventKey: delivery ? await fingerprint(`delivery:${delivery}`) : rawHash,
  };
}
export function smsBlockReason(route, consent, identity, now = new Date()) {
  if (!route?.active || !route.verified_at || !route.sms_pilot_approved)
    return "sms_route_unapproved";
  if (!route.timezone || !route.time_zone_verified_at)
    return "timezone_unverified";
  if (
    !route.morning_resume ||
    !/^\d{2}:\d{2}(:\d{2})?$/.test(route.morning_resume)
  )
    return "morning_resume_missing";
  const [h, m] = route.morning_resume.split(":").map(Number),
    resume = h * 60 + m;
  if (h > 18 || m > 59 || resume >= 1140) return "morning_resume_invalid";
  if (
    !identity?.phone_verified ||
    !/^\+[1-9]\d{7,14}$/.test(identity.phone_e164 || "")
  )
    return "phone_unverified";
  if (identity?.sms_opted_out) return "sms_opted_out";
  if (consent?.revoked_at || consent?.status === "revoked")
    return "sms_opted_out";
  if (
    consent?.status !== "granted" ||
    !consent.captured_at ||
    !consent.evidence_reference ||
    consent.scope !== "resident_service"
  )
    return "sms_consent_required";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: route.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const minute =
      Number(parts.find((p) => p.type === "hour").value) * 60 +
      Number(parts.find((p) => p.type === "minute").value);
    if (minute >= 1140 || minute < resume) return "sms_quiet_hours";
  } catch {
    return "timezone_invalid";
  }
  return null;
}
export function pickMessage(m) {
  return {
    id: m.id,
    content: typeof m.content === "string" ? m.content : "",
    private: m.private === true,
    message_type: m.message_type,
    status: ["sending", "sent", "delivered", "read", "failed"].includes(
      m.status,
    )
      ? m.status
      : null,
    created_at: m.created_at,
    has_attachments: Array.isArray(m.attachments) && m.attachments.length > 0,
  };
}
export function pickConversation(c) {
  return {
    id: c.conversation_id,
    link_id: c.link_id,
    community_id: c.community_id,
    resident_id: c.resident_id,
    lease_id: c.lease_id,
    channel: c.channel,
    status: c.status,
    assignee_id: c.assignee_id,
    unread_count: c.unread_count,
    urgent: c.urgent,
    last_incoming_at: c.last_incoming_at,
    last_response_at: c.last_response_at,
    follow_up_at: c.follow_up_at,
    delivery_failed: c.delivery_failed,
  };
}
export function createCommunicationService(env, deps) {
  const config = deps.config(env);
  const db = (path, options = {}) =>
    deps.db(config, `/rest/v1/${path}`, options);
  const service = (path, options = {}) =>
    db(path, { ...options, service: true });
  const rpc = (name, body, token) =>
    db(`rpc/${name}`, {
      method: "POST",
      body,
      ...(token ? { token } : { service: true }),
    });
  async function access(request) {
    const token = (request.headers.get("Authorization") || "").match(
      /^Bearer (.+)$/i,
    )?.[1];
    if (!token) fail("authentication_required", 401);
    let user;
    try {
      user = await deps.db(config, "/auth/v1/user", { token });
    } catch {
      fail("session_expired", 401);
    }
    if (!user?.id) fail("authentication_required", 401);
    const p = (
      await service(
        `atlas_user_profiles?user_id=eq.${eq(user.id)}&select=*&limit=1`,
      )
    )?.[0];
    if (
      !p ||
      p.status !== "active" ||
      p.account_status !== "active" ||
      !ROLES.has(p.role)
    )
      fail("profile_inactive", 403);
    if (
      p.locked_tab_ids?.includes("15") ||
      p.locked_page_keys?.some((k) =>
        ["central_services", "resident_communications"].includes(k),
      )
    )
      fail("workspace_restricted", 403);
    return { token, user, p };
  }
  async function scope(a, cid) {
    if (
      !(await rpc(
        "atlas_communication_access",
        { p_community_id: cid },
        a.token,
      ))
    )
      fail("community_access_denied", 403);
  }
  function enabled() {
    if (env.ATLAS_COMMUNICATIONS_ENABLED !== "true")
      fail("communications_not_enabled", 503);
  }
  function upstreamConfigured() {
    let url;
    try {
      url = new URL(env.CHATWOOT_BASE_URL);
    } catch {
      fail("chatwoot_not_configured", 503);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !positive(env.CHATWOOT_ACCOUNT_ID) ||
      !env.CHATWOOT_API_TOKEN ||
      !env.CHATWOOT_ORIGIN_TOKEN ||
      !env.CHATWOOT_WEBHOOK_SECRET ||
      env.CHATWOOT_DEPLOYMENT_VALIDATED !== "true"
    )
      fail("chatwoot_not_validated", 503);
    return url.origin;
  }
  async function cw(path, method = "GET", body) {
    const origin = upstreamConfigured();
    let response;
    try {
      response = await (deps.fetch || fetch)(
        `${origin}/api/v1/accounts/${env.CHATWOOT_ACCOUNT_ID}/${path}`,
        {
          method,
          headers: {
            "X-Atlas-Origin-Token": env.CHATWOOT_ORIGIN_TOKEN,
            api_access_token: env.CHATWOOT_API_TOKEN,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      fail("chatwoot_unavailable", 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail("chatwoot_request_failed", 502);
    }
    try {
      return JSON.parse(
        new TextDecoder().decode(await boundedJson(response, 2097152)),
      );
    } catch (error) {
      if (error.code) throw error;
      fail("chatwoot_invalid_response", 502);
    }
  }
  async function route(l) {
    const r = (
      await service(
        `atlas_chatwoot_inbox_routes?community_id=eq.${eq(l.community_id)}&channel=eq.${eq(l.channel)}&limit=1`,
      )
    )?.[0];
    if (
      !r?.active ||
      !r.verified_at ||
      Number(r.account_id) !== Number(env.CHATWOOT_ACCOUNT_ID) ||
      Number(r.inbox_id) !== Number(l.inbox_id)
    )
      fail("route_unverified", 409);
    return r;
  }
  async function identity(l) {
    const rows = await service(
      `atlas_resident_communication_identity?community_id=eq.${eq(l.community_id)}&resident_id=eq.${eq(l.resident_id)}&current_lease=eq.true`,
    );
    if (
      rows?.length !== 1 ||
      !rows[0].lease_id ||
      rows[0].lease_id !== l.lease_id
    )
      fail("canonical_identity_unresolved", 409);
    const contact = (
      await service(
        `atlas_chatwoot_contact_links?link_id=eq.${eq(l.contact_link_id || "00000000-0000-0000-0000-000000000000")}&limit=1`,
      )
    )?.[0];
    return { ...rows[0], sms_opted_out: contact?.sms_opted_out === true };
  }
  async function audit(a, l, action, outcome, rule = null) {
    await service("atlas_resident_communication_audit", {
      method: "POST",
      body: {
        community_id: l.community_id,
        conversation_link_id: l.link_id || null,
        actor_user_id: a?.user.id || null,
        action,
        outcome,
        rule,
      },
    });
  }
  async function link(a, id) {
    if (!positive(id)) fail("invalid_conversation");
    const rows = await db(
      `atlas_chatwoot_conversation_links?conversation_id=eq.${id}&account_id=eq.${eq(env.CHATWOOT_ACCOUNT_ID)}&state=eq.linked&limit=1`,
      { token: a.token },
    );
    if (!rows?.[0]) fail("conversation_not_found", 404);
    await scope(a, rows[0].community_id);
    return rows[0];
  }
  async function verifiedConversation(l) {
    const c = await cw(`conversations/${l.conversation_id}`);
    const contact = (
      await service(
        `atlas_chatwoot_contact_links?link_id=eq.${l.contact_link_id}&state=eq.linked&limit=1`,
      )
    )?.[0];
    if (
      Number(c.inbox_id) !== Number(l.inbox_id) ||
      Number(c.meta?.sender?.id ?? c.contact?.id) !==
        Number(contact?.contact_id) ||
      !contact
    )
      fail("conversation_identity_conflict", 409);
    const identityContact = await cw(`contacts/${contact.contact_id}`);
    const source = identityContact.payload || identityContact;
    if (
      source.identifier !== contact.identity_key ||
      source.custom_attributes?.atlas_community_id !== l.community_id ||
      source.custom_attributes?.atlas_resident_id !== l.resident_id
    )
      fail("conversation_identity_conflict", 409);
    if (
      c.custom_attributes?.atlas_community_id &&
      c.custom_attributes.atlas_community_id !== l.community_id
    )
      fail("conversation_identity_conflict", 409);
    if (
      c.custom_attributes?.atlas_resident_id &&
      c.custom_attributes.atlas_resident_id !== l.resident_id
    )
      fail("conversation_identity_conflict", 409);
    if (
      c.custom_attributes?.atlas_lease_id &&
      c.custom_attributes.atlas_lease_id !== l.lease_id
    )
      fail("conversation_identity_conflict", 409);
    return c;
  }
  async function consentFor(l, i) {
    return (
      await service(
        `atlas_resident_message_consent?community_id=eq.${eq(l.community_id)}&resident_id=eq.${eq(l.resident_id)}&endpoint_fingerprint=eq.${await fingerprint(i.phone_e164 || "")}&limit=1`,
      )
    )?.[0];
  }
  async function sendReason(l, r, i) {
    if (!r.timezone || !r.time_zone_verified_at) return "timezone_unverified";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: r.timezone }).format(
        new Date(),
      );
    } catch {
      return "timezone_invalid";
    }
    if (!r.first_response_minutes || !r.follow_up_minutes)
      return "reminder_configuration_missing";
    if (
      env.ATLAS_COMMUNICATIONS_OUTBOUND_ENABLED !== "true" ||
      env.ATLAS_COMMUNICATIONS_COMPLIANCE_APPROVED !== "true"
    )
      return "outbound_activation_pending";
    if (l.channel === "sms")
      return smsBlockReason(r, await consentFor(l, i), i);
    if (!r.email_pilot_approved) return "email_route_unapproved";
    if (!i.email_verified || !i.email) return "email_unverified";
    return null;
  }
  async function operation(a, l, action, key) {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key || ""))
      fail("idempotency_key_required");
    const k = await fingerprint(
      `${a.user.id}:${l.community_id}:${l.link_id || l.resident_id + ":" + l.lease_id}:${action}:${key}`,
    );
    if (
      !(await rpc("atlas_communication_claim_operation", {
        p_key: k,
        p_community_id: l.community_id,
        p_actor: a.user.id,
        p_action: action,
      }))
    ) {
      const old = (
        await service(`atlas_chatwoot_operations?operation_key=eq.${k}&limit=1`)
      )?.[0];
      if (old?.state === "accepted") return { key: k, result: old.result_id };
      fail("operation_requires_review", 409);
    }
    return { key: k };
  }
  async function complete(op, id) {
    if (!positive(id)) fail("operation_requires_review", 409);
    await service(`atlas_chatwoot_operations?operation_key=eq.${op.key}`, {
      method: "PATCH",
      body: { state: "accepted", result_id: Number(id) },
    });
  }
  async function listAlerts(a) {
    return rpc("atlas_communication_alert_summary", {}, a.token);
  }
  async function webhook(request) {
    enabled();
    upstreamConfigured();
    const { payload: p, eventKey } = await verifyWebhook(
      request,
      env.CHATWOOT_WEBHOOK_SECRET,
    );
    if (!EVENTS.has(p.event)) fail("unsupported_event", 422);
    const account = p.account?.id ?? p.conversation?.account_id ?? p.account_id;
    const id =
      p.conversation?.id ??
      (p.event.startsWith("conversation_") ? p.id : p.conversation_id);
    const inbox = p.inbox?.id ?? p.conversation?.inbox_id ?? p.inbox_id;
    if (
      Number(account) !== Number(env.CHATWOOT_ACCOUNT_ID) ||
      !positive(id) ||
      !positive(inbox)
    )
      fail("unknown_account_or_inbox", 422);
    if (
      !(
        await service(
          `atlas_chatwoot_inbox_routes?account_id=eq.${eq(account)}&inbox_id=eq.${eq(inbox)}&active=eq.true&verified_at=not.is.null&limit=1`,
        )
      )?.length
    )
      fail("unknown_account_or_inbox", 422);
    if (
      (
        await service(
          `atlas_chatwoot_webhook_receipts?fingerprint=eq.${eventKey}&select=fingerprint&limit=1`,
        )
      )?.length
    )
      fail("webhook_replayed", 409);
    let l = (
      await service(
        `atlas_chatwoot_conversation_links?account_id=eq.${eq(account)}&conversation_id=eq.${id}&state=eq.linked&limit=1`,
      )
    )?.[0];
    if (!l) {
      const c = await cw(`conversations/${id}`);
      if (Number(c.inbox_id) !== Number(inbox))
        fail("unknown_account_or_inbox", 422);
      const contactId = c.meta?.sender?.id ?? c.contact?.id;
      const contact = (
        await service(
          `atlas_chatwoot_contact_links?contact_id=eq.${eq(contactId)}&account_id=eq.${eq(account)}&state=eq.linked&limit=1`,
        )
      )?.[0];
      if (!contact) fail("unknown_canonical_contact", 422);
      const routes = await service(
        `atlas_chatwoot_inbox_routes?community_id=eq.${contact.community_id}&inbox_id=eq.${inbox}&account_id=eq.${account}&active=eq.true`,
      );
      if (routes?.length !== 1) fail("ambiguous_inbox_route", 422);
      const identities = await service(
        `atlas_resident_communication_identity?community_id=eq.${contact.community_id}&resident_id=eq.${eq(contact.resident_id)}&current_lease=eq.true`,
      );
      if (identities?.length !== 1 || !identities[0].lease_id)
        fail("canonical_identity_unresolved", 422);
      const existing = await service(
        `atlas_chatwoot_conversation_links?community_id=eq.${contact.community_id}&resident_id=eq.${eq(contact.resident_id)}&lease_id=eq.${eq(identities[0].lease_id)}&inbox_id=eq.${inbox}`,
      );
      if (existing?.length) fail("conversation_identity_conflict", 422);
      l = (
        await service("atlas_chatwoot_conversation_links", {
          method: "POST",
          body: {
            community_id: contact.community_id,
            resident_id: contact.resident_id,
            lease_id: identities[0].lease_id,
            contact_link_id: contact.link_id,
            account_id: Number(account),
            conversation_id: Number(id),
            inbox_id: Number(inbox),
            channel: routes[0].channel,
            state: "linked",
          },
          prefer: "return=representation",
        })
      )[0];
    }
    if (Number(l.inbox_id) !== Number(inbox)) fail("unknown_conversation", 422);
    await route(l);
    const earlyStop =
      l.channel === "sms" &&
      p.event === "message_created" &&
      !p.private &&
      [0, "incoming"].includes(p.message_type) &&
      (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(
        String(p.content || "").trim(),
      ) ||
        p.content_attributes?.opted_out === true);
    if (earlyStop)
      await rpc("atlas_communication_record_opt_out", { p_link_id: l.link_id });
    const c = await verifiedConversation(l);
    const created =
      p.event === "message_created"
        ? p.created_at
        : (p.updated_at ??
          p.conversation?.updated_at ??
          p.timestamp ??
          Number(request.headers.get("X-Chatwoot-Timestamp")));
    const time =
      typeof created === "number"
        ? new Date(created * 1000)
        : new Date(created);
    if (
      !Number.isFinite(time.getTime()) ||
      time.getTime() > Date.now() + 300000
    )
      fail("invalid_event_time", 422);
    const incoming =
      p.event === "message_created" &&
      !p.private &&
      [0, "incoming"].includes(p.message_type);
    const outgoing =
      p.event === "message_created" &&
      !p.private &&
      [1, "outgoing"].includes(p.message_type) &&
      p.status !== "failed";
    // STOP equivalents only from verified incoming SMS. Content is inspected transiently.
    const stop =
      l.channel === "sms" &&
      incoming &&
      (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/i.test(
        String(p.content || "").trim(),
      ) ||
        p.content_attributes?.opted_out === true);
    const accepted = await rpc("atlas_communication_apply_event", {
      p_fingerprint: eventKey,
      p_event_type: p.event,
      p_link_id: l.link_id,
      p_event_at: time.toISOString(),
      p_status: STATUS.has(c.status) ? c.status : "pending",
      p_assignee_id: c.meta?.assignee?.id || null,
      p_unread: Number.isInteger(c.unread_count) ? c.unread_count : 0,
      p_urgent:
        c.priority === "urgent" || c.labels?.includes("escalated") === true,
      p_delivery_failed:
        p.status === "failed"
          ? true
          : p.event === "message_updated" &&
              ["sent", "delivered", "read"].includes(p.status)
            ? false
            : l.delivery_failed,
      p_incoming: incoming,
      p_outgoing: outgoing,
      p_opt_out: stop,
      p_message_id:
        p.event.startsWith("message_") && positive(p.id) ? Number(p.id) : null,
      p_delivery_status:
        p.event.startsWith("message_") &&
        [1, "outgoing"].includes(p.message_type) &&
        ["sending", "sent", "delivered", "read", "failed"].includes(p.status)
          ? p.status
          : null,
    });
    if (!accepted) fail("webhook_replayed", 409);
    return { accepted: true };
  }
  async function handle(request) {
    const url = new URL(request.url),
      path = url.pathname.replace("/api/atlas/chatwoot", "");
    if (path === "/webhooks" && request.method === "POST")
      return webhook(request);
    const a = await access(request);
    enabled();
    if (
      request.method !== "GET" &&
      path !== "/exports" &&
      env.ATLAS_COMMUNICATIONS_WRITE_ENABLED !== "true"
    )
      fail("communications_read_only", 409);
    if (path === "/communities" && request.method === "GET")
      return {
        communities: await rpc("atlas_communication_communities", {}, a.token),
      };
    if (path === "/agents" && request.method === "GET") {
      const cid = url.searchParams.get("community");
      await scope(a, cid);
      const candidates = await service(
        "atlas_user_profiles?status=eq.active&account_status=eq.active&select=user_id,display_name,role,status,account_status,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys&limit=200",
      );
      const mapped = await service(
        `atlas_chatwoot_agent_links?account_id=eq.${eq(env.CHATWOOT_ACCOUNT_ID)}&select=user_id`,
      );
      const allowed = [];
      for (const p of candidates) {
        if (
          mapped.some((m) => m.user_id === p.user_id) &&
          (await profileScope(p, cid))
        )
          allowed.push({ user_id: p.user_id, display_name: p.display_name });
      }
      return { agents: allowed };
    }
    if (path === "/policies" && ["GET", "PATCH"].includes(request.method)) {
      const body =
        request.method === "PATCH"
          ? await readBody(request)
          : Object.fromEntries(url.searchParams);
      await scope(a, body.community_id);
      if (!["sms", "email"].includes(body.channel)) fail("invalid_channel");
      const r = (
        await service(
          `atlas_chatwoot_inbox_routes?community_id=eq.${eq(body.community_id)}&channel=eq.${body.channel}&limit=1`,
        )
      )?.[0];
      if (!r) fail("route_unverified", 409);
      if (request.method === "PATCH") {
        if (
          Object.keys(body).some(
            (k) =>
              ![
                "community_id",
                "channel",
                "first_response_minutes",
                "follow_up_minutes",
              ].includes(k),
          )
        )
          fail("unsupported_policy_fields");
        for (const key of ["first_response_minutes", "follow_up_minutes"])
          if (
            !Number.isInteger(body[key]) ||
            body[key] < 1 ||
            body[key] > 10080
          )
            fail("invalid_reminder_threshold");
        await audit(
          a,
          { community_id: body.community_id },
          "reminder_policy",
          "allowed",
        );
        await service(`atlas_chatwoot_inbox_routes?route_id=eq.${r.route_id}`, {
          method: "PATCH",
          body: {
            first_response_minutes: body.first_response_minutes,
            follow_up_minutes: body.follow_up_minutes,
          },
        });
        await rpc("atlas_communication_refresh_alerts", {});
      }
      return {
        policy: {
          timezone: r.timezone,
          morning_resume: r.morning_resume,
          quiet_hours_start: "19:00",
          first_response_minutes:
            body.first_response_minutes || r.first_response_minutes,
          follow_up_minutes: body.follow_up_minutes || r.follow_up_minutes,
        },
      };
    }
    if (path === "/readiness" && request.method === "GET") {
      let ready = true;
      try {
        upstreamConfigured();
      } catch {
        ready = false;
      }
      return {
        ready,
        write_enabled: env.ATLAS_COMMUNICATIONS_WRITE_ENABLED === "true",
        outbound_enabled:
          ready &&
          env.ATLAS_COMMUNICATIONS_OUTBOUND_ENABLED === "true" &&
          env.ATLAS_COMMUNICATIONS_COMPLIANCE_APPROVED === "true",
      };
    }
    if (path === "/alerts" && request.method === "GET")
      return await listAlerts(a);
    if (path === "/events" && request.method === "GET") {
      // Authenticated fetch stream, never JWT query parameters. Revalidate profile/JWT each tick.
      let stopped = false;
      const stream = new ReadableStream({
        start(controller) {
          request.signal.addEventListener(
            "abort",
            () => {
              stopped = true;
            },
            { once: true },
          );
          const run = async () => {
            let prior = "";
            try {
              for (let n = 0; n < 15 && !stopped; n++) {
                const fresh = await access(request);
                const alerts = await listAlerts(fresh),
                  json = JSON.stringify(alerts);
                if (json !== prior) {
                  controller.enqueue(enc.encode(`data: ${json}\n\n`));
                  prior = json;
                }
                await new Promise((resolve) => setTimeout(resolve, 2000));
              }
            } catch {
              if (!stopped)
                controller.enqueue(enc.encode("event: expired\ndata: {}\n\n"));
            } finally {
              try {
                controller.close();
              } catch {}
            }
          };
          return run();
        },
        cancel() {
          stopped = true;
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
        },
      });
    }
    const linkMatch = path.match(/^\/conversation-links\/([0-9a-f-]{36})$/i);
    if (linkMatch && request.method === "GET") {
      const found = (
        await db(
          `atlas_chatwoot_conversation_links?link_id=eq.${eq(linkMatch[1])}&state=eq.linked&limit=1`,
          { token: a.token },
        )
      )?.[0];
      if (!found) fail("conversation_not_found", 404);
      await scope(a, found.community_id);
      return { conversation: pickConversation(found) };
    }
    if (path === "/conversations" && request.method === "GET") {
      let query =
        "atlas_chatwoot_conversation_links?state=eq.linked&order=updated_at.desc&limit=100";
      for (const [key, column] of [
        ["community", "community_id"],
        ["channel", "channel"],
        ["status", "status"],
        ["assignee", "assignee_id"],
        ["resident", "resident_id"],
      ])
        if (url.searchParams.get(key))
          query += `&${column}=eq.${eq(url.searchParams.get(key))}`;
      const attention = url.searchParams.get("attention");
      if (attention === "unread") query += "&unread_count=gt.0";
      if (attention === "urgent") query += "&urgent=eq.true";
      if (attention === "failed") query += "&delivery_failed=eq.true";
      if (attention === "alerts")
        query +=
          "&select=*,atlas_resident_communication_alerts!inner(kind)&atlas_resident_communication_alerts.active=eq.true";
      const rows = await db(query, { token: a.token });
      return { conversations: rows.map(pickConversation) };
    }
    if (path === "/exports" && request.method === "POST") {
      const body = await readBody(request);
      await scope(a, body.community_id);
      const rows = await db(
        `atlas_chatwoot_conversation_links?community_id=eq.${eq(body.community_id)}&state=eq.linked&limit=1000`,
        { token: a.token },
      );
      await audit(a, { community_id: body.community_id }, "export", "allowed");
      return {
        conversations: rows.map(pickConversation),
        format: "metadata_only",
        truncated: rows.length === 1000,
      };
    }
    if (path === "/contacts/sync" && request.method === "POST") {
      upstreamConfigured();
      const body = await readBody(request);
      if (!body.resident_id || !body.lease_id)
        fail("canonical_identity_required");
      await scope(a, body.community_id);
      const l = {
        community_id: body.community_id,
        resident_id: body.resident_id,
        lease_id: body.lease_id,
      };
      const i = await identity(l);
      const key = `atlas:${l.community_id}:${l.resident_id}`;
      const existing = (
        await service(
          `atlas_chatwoot_contact_links?identity_key=eq.${eq(key)}&limit=1`,
        )
      )?.[0];
      if (existing?.state === "linked")
        return { contact_link_id: existing.link_id };
      if (existing) fail("identity_requires_review", 409);
      const op = await operation(a, l, "contact", await fingerprint(key));
      await service("atlas_chatwoot_contact_links", {
        method: "POST",
        body: {
          community_id: l.community_id,
          resident_id: l.resident_id,
          account_id: Number(env.CHATWOOT_ACCOUNT_ID),
          identity_key: key,
        },
        prefer: "return=minimal",
      });
      // Identifier lookup, never lookup by name/email/phone. Duplicate or conflicting identifier fails closed.
      const found = await cw("contacts/filter", "POST", {
        payload: [
          {
            attribute_key: "identifier",
            filter_operator: "equal_to",
            values: [key],
            query_operator: null,
          },
        ],
      });
      if ((found.payload || []).length) fail("identity_requires_review", 409);
      const c = await cw("contacts", "POST", {
        identifier: key,
        name: i.display_name,
        email: i.email_verified ? i.email : undefined,
        phone_number: i.phone_verified ? i.phone_e164 : undefined,
        custom_attributes: {
          atlas_community_id: l.community_id,
          atlas_resident_id: l.resident_id,
        },
      });
      const id = c.payload?.contact?.id ?? c.payload?.id ?? c.id;
      await complete(op, id);
      const rows = await service(
        `atlas_chatwoot_contact_links?identity_key=eq.${eq(key)}`,
        {
          method: "PATCH",
          body: { contact_id: id, state: "linked" },
          prefer: "return=representation",
        },
      );
      await audit(a, l, "contact_sync", "accepted");
      return { contact_link_id: rows[0].link_id };
    }
    if (path === "/conversations" && request.method === "POST") {
      const body = await readBody(request);
      await scope(a, body.community_id);
      if (!["email", "sms"].includes(body.channel)) fail("invalid_channel");
      const i = await identity(body),
        contact = (
          await service(
            `atlas_chatwoot_contact_links?community_id=eq.${eq(body.community_id)}&resident_id=eq.${eq(body.resident_id)}&state=eq.linked&account_id=eq.${eq(env.CHATWOOT_ACCOUNT_ID)}&limit=1`,
          )
        )?.[0];
      if (!contact) fail("contact_sync_required", 409);
      const r = (
        await service(
          `atlas_chatwoot_inbox_routes?community_id=eq.${eq(body.community_id)}&channel=eq.${body.channel}&limit=1`,
        )
      )?.[0];
      if (!r) fail("route_unverified", 409);
      const l = {
        community_id: body.community_id,
        resident_id: body.resident_id,
        lease_id: i.lease_id,
        channel: body.channel,
        inbox_id: r.inbox_id,
        account_id: Number(env.CHATWOOT_ACCOUNT_ID),
        contact_link_id: contact.link_id,
      };
      await route(l);
      const reason = await sendReason(l, r, i);
      if (reason) {
        await audit(a, l, "conversation_create", "blocked", reason);
        fail(reason, 409);
      }
      const prior = (
        await service(
          `atlas_chatwoot_conversation_links?community_id=eq.${eq(l.community_id)}&resident_id=eq.${eq(l.resident_id)}&lease_id=eq.${eq(l.lease_id)}&inbox_id=eq.${l.inbox_id}&limit=1`,
        )
      )?.[0];
      if (prior?.state === "linked")
        return { conversation: pickConversation(prior) };
      if (prior) fail("operation_requires_review", 409);
      const op = await operation(
        a,
        l,
        "conversation",
        await fingerprint(`${contact.link_id}:${i.lease_id}:${r.inbox_id}`),
      );
      const reserved = (
        await service("atlas_chatwoot_conversation_links", {
          method: "POST",
          body: l,
          prefer: "return=representation",
        })
      )[0];
      const ci = await cw(
        `contacts/${contact.contact_id}/contact_inboxes`,
        "POST",
        { inbox_id: r.inbox_id },
      );
      const source = ci.source_id ?? ci.payload?.source_id;
      if (!source) fail("contact_inbox_unresolved", 409);
      const c = await cw("conversations", "POST", {
        source_id: source,
        inbox_id: r.inbox_id,
        contact_id: contact.contact_id,
        custom_attributes: {
          atlas_community_id: l.community_id,
          atlas_resident_id: l.resident_id,
          atlas_lease_id: l.lease_id,
        },
      });
      await complete(op, c.id);
      const saved = (
        await service(
          `atlas_chatwoot_conversation_links?link_id=eq.${reserved.link_id}`,
          {
            method: "PATCH",
            body: { conversation_id: c.id, state: "linked" },
            prefer: "return=representation",
          },
        )
      )[0];
      await audit(a, saved, "conversation_create", "accepted");
      return { conversation: pickConversation(saved) };
    }
    const match = path.match(
      /^\/conversations\/(\d+)(?:\/(messages|private-notes|assignment|status|read))?$/,
    );
    if (!match) fail("route_not_found", 404);
    const l = await link(a, match[1]);
    let r;
    try {
      r = await route(l);
      await verifiedConversation(l);
    } catch (error) {
      if (
        request.method === "POST" &&
        ["messages", "private-notes"].includes(match[2])
      )
        await audit(
          a,
          l,
          "send",
          "blocked",
          error.code || "verification_failed",
        );
      throw error;
    }
    if (!match[2] && request.method === "GET") {
      let i,
        reason = "canonical_identity_unresolved";
      try {
        i = await identity(l);
        reason = await sendReason(l, r, i);
      } catch (error) {
        if (error.code !== "canonical_identity_unresolved") throw error;
      }
      await audit(a, l, "conversation_read", "allowed");
      return {
        write_block_reason:
          env.ATLAS_COMMUNICATIONS_WRITE_ENABLED === "true"
            ? null
            : "communications_read_only",
        conversation: pickConversation(l),
        resident: i
          ? {
              resident_id: i.resident_id,
              display_name: i.display_name,
              lease_id: i.lease_id,
              lease_context: i.lease_context,
            }
          : null,
        consent:
          i && l.channel === "sms"
            ? (await consentFor(l, i))?.status || "absent"
            : null,
        send_block_reason: reason,
      };
    }
    if (match[2] === "messages" && request.method === "GET") {
      const before = url.searchParams.get("before");
      if (before && !positive(before)) fail("invalid_cursor");
      const result = await cw(
        `conversations/${l.conversation_id}/messages${before ? `?before=${before}` : ""}`,
      );
      await audit(a, l, "messages_read", "allowed");
      return { messages: (result.payload || []).map(pickMessage) };
    }
    if (
      ["messages", "private-notes"].includes(match[2]) &&
      request.method === "POST"
    ) {
      const body = await readBody(request);
      const note = match[2] === "private-notes";
      if (
        typeof body.content !== "string" ||
        !body.content.trim() ||
        enc.encode(body.content).length > 16000
      )
        fail("invalid_message");
      // Recipient/inbox/actor/HTML/attachments are never accepted from the browser.
      if (Object.keys(body).some((k) => k !== "content"))
        fail("unsupported_message_fields");
      let i;
      try {
        i = await identity(l);
      } catch (error) {
        await audit(
          a,
          l,
          note ? "private_note" : "send",
          "blocked",
          error.code || "canonical_identity_unresolved",
        );
        throw error;
      }
      const reason = note ? null : await sendReason(l, r, i);
      if (reason) {
        await audit(a, l, "send", "blocked", reason);
        fail(reason, 409);
      }
      // Confirm Chatwoot's current recipient agrees with canonical endpoints before delivery.
      const c = await verifiedConversation(l),
        sender = c.meta?.sender || c.contact;
      if (
        !note &&
        ((l.channel === "sms" && sender?.phone_number !== i.phone_e164) ||
          (l.channel === "email" &&
            String(sender?.email || "").toLowerCase() !==
              i.email.toLowerCase()))
      ) {
        await audit(a, l, "send", "blocked", "recipient_identity_conflict");
        fail("recipient_identity_conflict", 409);
      }
      const op = await operation(
        a,
        l,
        note ? "note" : "message",
        request.headers.get("Idempotency-Key"),
      );
      if (op.result) return { message: { id: op.result }, replayed: true };
      await audit(a, l, note ? "private_note" : "send", "allowed");
      const m = await cw(
        `conversations/${l.conversation_id}/messages`,
        "POST",
        {
          content: body.content,
          message_type: "outgoing",
          private: note,
          content_type: "text",
        },
      );
      await complete(op, m.id);
      await audit(a, l, note ? "private_note" : "send", "accepted");
      return { message: pickMessage(m) };
    }
    if (match[2] === "read" && request.method === "POST") {
      await cw(
        `conversations/${l.conversation_id}/update_last_seen`,
        "POST",
        {},
      );
      await service(
        `atlas_chatwoot_conversation_links?link_id=eq.${l.link_id}`,
        {
          method: "PATCH",
          body: { unread_count: 0, updated_at: new Date().toISOString() },
        },
      );
      await rpc("atlas_communication_refresh_alerts", {
        p_link_id: l.link_id,
        p_touch: true,
      });
      await audit(a, l, "mark_read", "allowed");
      return { updated: true };
    }
    if (match[2] === "assignment" && request.method === "PATCH") {
      const body = await readBody(request);
      let agent = null;
      if (body.user_id) {
        const target = (
          await service(
            `atlas_user_profiles?user_id=eq.${eq(body.user_id)}&select=*&limit=1`,
          )
        )?.[0];
        if (!target || !(await profileScope(target, l.community_id)))
          fail("assignee_unauthorized", 403);
        const mapped = (
          await service(
            `atlas_chatwoot_agent_links?user_id=eq.${eq(body.user_id)}&account_id=eq.${eq(env.CHATWOOT_ACCOUNT_ID)}&limit=1`,
          )
        )?.[0];
        if (!mapped) fail("assignee_unmapped", 409);
        agent = mapped.agent_id;
      }
      await audit(a, l, "assignment", "allowed");
      await cw(`conversations/${l.conversation_id}/assignments`, "POST", {
        assignee_id: agent,
      });
      await service(
        `atlas_chatwoot_conversation_links?link_id=eq.${l.link_id}`,
        {
          method: "PATCH",
          body: { assignee_id: agent, updated_at: new Date().toISOString() },
        },
      );
      await rpc("atlas_communication_refresh_alerts", {
        p_link_id: l.link_id,
        p_touch: true,
      });
      return { updated: true };
    }
    if (match[2] === "status" && request.method === "PATCH") {
      const body = await readBody(request);
      if (!["open", "pending", "resolved"].includes(body.status))
        fail("invalid_status");
      await audit(a, l, "status", "allowed");
      await cw(`conversations/${l.conversation_id}/toggle_status`, "POST", {
        status: body.status,
      });
      await service(
        `atlas_chatwoot_conversation_links?link_id=eq.${l.link_id}`,
        {
          method: "PATCH",
          body: {
            status: body.status,
            ...(body.status === "resolved"
              ? { waiting_since: null, follow_up_at: null }
              : {}),
            updated_at: new Date().toISOString(),
          },
        },
      );
      await rpc("atlas_communication_refresh_alerts", {
        p_link_id: l.link_id,
        p_touch: true,
      });
      return { updated: true };
    }
    fail("method_not_allowed", 405);
  }
  async function profileScope(p, cid) {
    if (
      p.status !== "active" ||
      p.account_status !== "active" ||
      !ROLES.has(p.role) ||
      p.locked_tab_ids?.includes("15") ||
      p.locked_page_keys?.some((k) =>
        ["central_services", "resident_communications"].includes(k),
      )
    )
      return false;
    const c = (
      await service(
        `atlas_communities?community_id=eq.${eq(cid)}&deleted_at=is.null&limit=1`,
      )
    )?.[0];
    if (!c || c.status !== "active") return false;
    return (
      (["admin", "centra", "executive"].includes(p.role) ||
        p.allowed_community_ids?.includes(cid)) &&
      (!p.allowed_community_ids?.length ||
        p.allowed_community_ids.includes(cid)) &&
      (!p.allowed_market_values?.length ||
        p.allowed_market_values.some(
          (v) => v.toLowerCase() === c.market?.toLowerCase(),
        )) &&
      (!p.allowed_region_values?.length ||
        p.allowed_region_values.some(
          (v) => v.toLowerCase() === c.regional_grouping?.toLowerCase(),
        ))
    );
  }
  return {
    handle,
    refreshReminders: () =>
      env.ATLAS_COMMUNICATIONS_ENABLED === "true"
        ? rpc("atlas_communication_refresh_alerts", {})
        : Promise.resolve(),
  };
}
export async function handleResidentCommunications(request, env, deps) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization,Content-Type,Idempotency-Key",
  };
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  try {
    const result = await createCommunicationService(env, deps).handle(request);
    if (result instanceof Response) {
      for (const [k, v] of Object.entries(headers)) result.headers.set(k, v);
      return result;
    }
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) {
    return Response.json(
      { ok: false, error: error.code || "communication_request_failed" },
      { status: error.status && error.code ? error.status : 503, headers },
    );
  }
}
