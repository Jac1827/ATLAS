const SITE_ROUTES = [
  {
    path: "/",
    title: "RISE Performance Platform",
    description: "Main landing page for the performance platform.",
  },
  {
    path: "/portfolio-operations-dashboard/",
    title: "ATLAS RISE Ops Dashboard",
    description: "Operational dashboard workspace for the portfolio team.",
  },
  {
    path: "/portfolio-operations-dashboard/financial-accountability.html",
    title: "Financial Accountability",
    description: "Companion dashboard for financial performance review and drill-down.",
  },
  {
    path: "/docs/",
    title: "Docs Home (Legacy Alias)",
    description: "Legacy alias that resolves to the performance platform.",
  },
  {
    path: "/docs/portfolio-operations-dashboard/",
    title: "ATLAS RISE Ops Dashboard (Legacy Alias)",
    description: "Legacy alias that resolves to the operations dashboard workspace.",
  },
  {
    path: "/docs/portfolio-operations-dashboard/financial-accountability.html",
    title: "Financial Accountability (Legacy Alias)",
    description: "Legacy alias that resolves to the financial accountability dashboard.",
  },
];

const BUILD_INFO = {
  name: "rise-performance-platform-site",
  compatibilityDate: "2026-05-22",
  assetDirectory: "./docs",
  workerEntrypoint: "./src/worker.mjs",
  runtime: "cloudflare-workers",
};

const SYNC_WRITE_TOKEN = "atlas-rise-shared-sync-2026";
const DEFAULT_SUPABASE_URL = "https://rmyhmvjcswfwaracgriy.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_2DEqeCNZFn6sNeVrSEfW8A_EI6tRb_1";
const DEFAULT_ATLAS_APP_PATH = "/portfolio-operations-dashboard/index.html";
const API_CORS_ALLOW_HEADERS = "content-type, authorization, apikey";
const COMPANY_EMAIL_PATTERN = /^[^@\s]+@(risere|riseresidential)[.]com$/i;
const ATLAS_AUTH_ALIAS_ROUTES = new Map([
  ["/invite", "activate"],
  ["/invite/", "activate"],
  ["/activate", "activate"],
  ["/activate/", "activate"],
  ["/set-password", "forgot"],
  ["/set-password/", "forgot"],
  ["/auth/callback", ""],
  ["/auth/callback/", ""],
  ["/portfolio-operations-dashboard/invite", "activate"],
  ["/portfolio-operations-dashboard/invite/", "activate"],
  ["/portfolio-operations-dashboard/activate", "activate"],
  ["/portfolio-operations-dashboard/activate/", "activate"],
  ["/portfolio-operations-dashboard/set-password", "forgot"],
  ["/portfolio-operations-dashboard/set-password/", "forgot"],
  ["/portfolio-operations-dashboard/auth/callback", ""],
  ["/portfolio-operations-dashboard/auth/callback/", ""],
]);

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(data, null, 2), {
    status: init.status ?? 200,
    headers,
  });
}

function apiResponse(data, init = {}) {
  const response = json(data, init);
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", API_CORS_ALLOW_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function noContent() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": API_CORS_ALLOW_HEADERS,
    },
  });
}

function withCommonHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function buildCandidatePaths(pathname) {
  const candidates = pathname === "/" ? [pathname, "/index.html"] : [pathname];

  const endsWithSlash = pathname.endsWith("/");
  const hasExtension = pathname.split("/").pop().includes(".");

  if (!endsWithSlash && !hasExtension) {
    candidates.push(`${pathname}/index.html`);
    candidates.push(`${pathname}.html`);
    candidates.push(`${pathname}/`);
  }

  if (endsWithSlash) {
    candidates.push(`${pathname}index.html`);
  }

  return [...new Set(candidates)];
}

function normalizeAssetPathname(pathname) {
  if (pathname === "/docs" || pathname === "/docs/") {
    return "/";
  }

  if (pathname.startsWith("/docs/")) {
    const normalized = pathname.slice("/docs".length);
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  return pathname;
}

async function fetchAsset(request, env) {
  const url = new URL(request.url);
  const candidates = buildCandidatePaths(normalizeAssetPathname(url.pathname));

  for (const pathname of candidates) {
    const candidateUrl = new URL(url);
    candidateUrl.pathname = pathname;
    const candidateRequest = new Request(candidateUrl, request);
    const response = await env.ASSETS.fetch(candidateRequest);

    if (response.status !== 404 || pathname === candidates[candidates.length - 1]) {
      return response;
    }
  }

  return null;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isCompanyEmail(value) {
  return COMPANY_EMAIL_PATTERN.test(cleanEmail(value));
}

function isLocalUrl(value) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(String(value || "").trim());
}

function getAtlasSupabaseConfig(env) {
  const supabaseUrl = String(env.SUPABASE_URL || env.ATLAS_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const anonKey = String(env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.ATLAS_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || env.ATLAS_SUPABASE_SECRET_KEY || "").trim();
  return { supabaseUrl, anonKey, serviceKey };
}

function jsonSafeError(error) {
  return String(error?.message || error || "Request failed.").replace(/sb_(secret|service_role)_[A-Za-z0-9_-]+/g, "[redacted]");
}

async function parseResponseBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function supabaseRequest(config, path, { method = "GET", token = "", service = false, body = null } = {}) {
  const key = service ? config.serviceKey : config.anonKey;
  const headers = new Headers({
    accept: "application/json",
    apikey: key,
    authorization: `Bearer ${service ? config.serviceKey : token || config.anonKey}`,
  });
  if (body !== null) headers.set("content-type", "application/json");
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  const payload = await parseResponseBody(response);
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? payload.message || payload.error_description || payload.error || `Supabase request failed with HTTP ${response.status}`
      : payload || `Supabase request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function getBearerToken(request) {
  const header = String(request.headers.get("authorization") || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function requireAtlasAccessAdmin(request, env) {
  const config = getAtlasSupabaseConfig(env);
  if (!config.serviceKey) {
    const error = new Error("ATLAS invitation service is not configured. Add SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY to the worker environment.");
    error.status = 503;
    throw error;
  }
  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("Sign in to ATLAS before managing invitations.");
    error.status = 401;
    throw error;
  }
  const user = await supabaseRequest(config, "/auth/v1/user", { token });
  if (!user?.id) {
    const error = new Error("ATLAS could not verify the signed-in user.");
    error.status = 401;
    throw error;
  }
  const profileRows = await supabaseRequest(
    config,
    `/rest/v1/atlas_user_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,email,role,status&limit=1`,
    { service: true }
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  const role = String(profile?.role || "").toLowerCase();
  const status = String(profile?.status || "").toLowerCase();
  if (!profile || status !== "active" || role !== "admin") {
    const error = new Error("Only an active ATLAS Admin can manage invitations.");
    error.status = 403;
    throw error;
  }
  return { config, token, user, profile };
}

async function callAtlasRpcAsUser(config, token, functionName, args = {}) {
  return supabaseRequest(config, `/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    token,
    body: args,
  });
}

function getInviteExpiryIso(env) {
  const seconds = Math.max(300, Number(env.ATLAS_INVITE_EXPIRATION_SECONDS || 3600) || 3600);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function resolveAtlasAppBaseUrl(request, env, explicitBaseUrl = "") {
  const explicit = String(explicitBaseUrl || "").trim();
  if (explicit && /^https?:\/\//i.test(explicit) && !isLocalUrl(explicit)) return explicit;
  const configured = String(env.ATLAS_APP_BASE_URL || "").trim();
  if (configured && /^https?:\/\//i.test(configured) && !isLocalUrl(configured)) return configured;
  const url = new URL(request.url);
  return new URL(DEFAULT_ATLAS_APP_PATH, url.origin).toString();
}

function buildAtlasAuthEntryUrl(request, env, { mode = "activate", email = "", baseUrl = "" } = {}) {
  const target = new URL(resolveAtlasAppBaseUrl(request, env, baseUrl));
  if (mode) target.searchParams.set("atlas-entry", mode);
  if (email) target.searchParams.set("email", cleanEmail(email));
  target.hash = "";
  if (isLocalUrl(target.toString())) throw new Error("ATLAS invitations must use a hosted production URL, not localhost.");
  return target.toString();
}

function authUserIdFromPayload(payload) {
  return String(payload?.id || payload?.user?.id || payload?.data?.user?.id || "").trim() || null;
}

async function loadProvisioningState(config, token, email) {
  const state = await callAtlasRpcAsUser(config, token, "atlas_admin_user_provisioning_state", {
    p_email: cleanEmail(email),
  });
  return Array.isArray(state) ? state[0] : state;
}

async function recordProvisioningDelivery(config, token, details = {}) {
  return callAtlasRpcAsUser(config, token, "atlas_admin_record_invitation_delivery", {
    p_email: cleanEmail(details.email),
    p_auth_user_id: details.authUserId || null,
    p_account_status: String(details.accountStatus || "invitation_sent"),
    p_invitation_sent_at: details.sentAt || new Date().toISOString(),
    p_invitation_expires_at: details.expiresAt || null,
    p_last_invite_error: details.error || null,
  });
}

async function handleAtlasAccessDiagnoseRequest(request, env) {
  try {
    const { config, token } = await requireAtlasAccessAdmin(request, env);
    const url = new URL(request.url);
    const email = cleanEmail(url.searchParams.get("email"));
    if (!isCompanyEmail(email)) return apiResponse({ ok: false, error: "Enter a valid RISE company email address." }, { status: 400 });
    const state = await loadProvisioningState(config, token, email);
    return apiResponse({ ok: true, state });
  } catch (error) {
    return apiResponse({ ok: false, error: jsonSafeError(error) }, { status: error.status || 500 });
  }
}

async function handleAtlasAccessInviteRequest(request, env) {
  let body = null;
  let email = "";
  let token = "";
  try {
    const access = await requireAtlasAccessAdmin(request, env);
    const { config } = access;
    token = access.token;
    body = await readJsonBody(request);
    if (!body || typeof body !== "object") return apiResponse({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    email = cleanEmail(body.email);
    if (!isCompanyEmail(email)) return apiResponse({ ok: false, error: "Enter a valid RISE company email address." }, { status: 400 });

    const action = String(body.action || "invite").trim().toLowerCase();
    const state = await loadProvisioningState(config, token, email);
    if (!state?.invite_id && !state?.profile_user_id) {
      return apiResponse({ ok: false, error: "Save employee access before sending an invitation." }, { status: 409 });
    }

    const sentAt = new Date().toISOString();
    const expiresAt = getInviteExpiryIso(env);
    const displayName = String(body.displayName || body.display_name || state?.linked_employee_name || email).trim();
    const metadata = {
      display_name: displayName,
      atlas_invite_id: state?.invite_id || null,
      atlas_employee_id: state?.employee_id || null,
    };

    let providerAction = "invite";
    let providerPayload = null;
    let accountStatus = "invitation_sent";
    let redirectTo = buildAtlasAuthEntryUrl(request, env, { mode: "activate", email, baseUrl: body.appBaseUrl });

    if (action === "password_reset" || state?.auth_email_confirmed_at) {
      providerAction = "password_reset";
      accountStatus = "password_reset_required";
      redirectTo = buildAtlasAuthEntryUrl(request, env, { mode: "forgot", email, baseUrl: body.appBaseUrl });
      providerPayload = await supabaseRequest(config, `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        service: true,
        body: { email },
      });
    } else if (state?.auth_user_id) {
      providerAction = "resend_confirmation";
      accountStatus = "activation_pending";
      providerPayload = await supabaseRequest(config, `/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        service: true,
        body: { type: "signup", email },
      });
    } else {
      providerPayload = await supabaseRequest(config, `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        service: true,
        body: { email, data: metadata },
      });
    }

    const authUserId = authUserIdFromPayload(providerPayload) || state?.auth_user_id || null;
    const delivery = await recordProvisioningDelivery(config, token, {
      email,
      authUserId,
      accountStatus,
      sentAt,
      expiresAt: providerAction === "password_reset" ? null : expiresAt,
    });
    const nextState = await loadProvisioningState(config, token, email).catch(() => null);
    return apiResponse({
      ok: true,
      action: providerAction,
      email,
      redirectTo,
      delivery,
      state: nextState,
    });
  } catch (error) {
    try {
      const config = getAtlasSupabaseConfig(env);
      if (token && isCompanyEmail(email)) {
        await recordProvisioningDelivery(config, token, {
          email,
          accountStatus: "authentication_error",
          error: jsonSafeError(error),
        }).catch(() => null);
      }
    } catch {}
    return apiResponse({ ok: false, error: jsonSafeError(error) }, { status: error.status || 500 });
  }
}

function renderAtlasAuthAlias(mode = "") {
  const entry = String(mode || "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening ATLAS</title>
</head>
<body>
  <p>Opening ATLAS...</p>
  <script>
    (function () {
      var target = new URL("${DEFAULT_ATLAS_APP_PATH}", window.location.origin);
      var params = new URLSearchParams(window.location.search);
      params.forEach(function (value, key) { target.searchParams.set(key, value); });
      ${entry ? `target.searchParams.set("atlas-entry", ${JSON.stringify(entry)});` : ""}
      target.hash = window.location.hash || "";
      window.location.replace(target.toString());
    }());
  </script>
</body>
</html>`;
}

function atlasAuthAliasResponse(pathname) {
  const normalized = normalizeAssetPathname(pathname);
  if (!ATLAS_AUTH_ALIAS_ROUTES.has(normalized)) return null;
  return new Response(renderAtlasAuthAlias(ATLAS_AUTH_ALIAS_ROUTES.get(normalized)), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeScope(scope) {
  return String(scope || "").trim() || "atlas_performance_v1";
}

function makeSyncRecord({ scope, payload, source, updatedAt }) {
  return {
    scope: normalizeScope(scope),
    source: String(source || "manual"),
    updatedAt: String(updatedAt || new Date().toISOString()),
    payload: payload && typeof payload === "object" ? payload : { keys: {} },
  };
}

async function handleSyncRequest(request, env) {
  const url = new URL(request.url);
  const scope = normalizeScope(url.searchParams.get("scope"));

  if (!env.SYNC_STATE) {
    return apiResponse({ ok: false, error: "Sync storage is not configured" }, { status: 503 });
  }

  const syncId = env.SYNC_STATE.idFromName(scope);
  const syncObject = env.SYNC_STATE.get(syncId);
  return syncObject.fetch(request);
}

export class PerformanceSyncState {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const scope = normalizeScope(url.searchParams.get("scope"));

    if (request.method === "OPTIONS") {
      return noContent();
    }

    if (request.method === "GET") {
      const record = (await this.state.storage.get("record")) || null;
      return apiResponse({ ok: true, record });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object") {
        return apiResponse({ ok: false, error: "Invalid JSON body" }, { status: 400 });
      }

      if (String(body.writeToken || "") !== SYNC_WRITE_TOKEN) {
        return apiResponse({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      const record = makeSyncRecord({
        scope: body.scope ?? scope,
        payload: body.payload,
        source: body.source,
        updatedAt: body.updatedAt,
      });

      await this.state.storage.put("record", record);
      return apiResponse({ ok: true, record });
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        allow: "GET, POST, OPTIONS",
        "access-control-allow-origin": "*",
      },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__health" || url.pathname === "/api/status") {
      return apiResponse({
        ok: true,
        service: "rise-performance-platform-site",
        time: new Date().toISOString(),
        routes: SITE_ROUTES.length,
      });
    }

    if (url.pathname === "/api/health") {
      return apiResponse({
        ok: true,
        service: "rise-performance-platform-site",
        storage: Boolean(env.SYNC_STATE),
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/state") {
      return handleSyncRequest(request, env);
    }

    if (url.pathname === "/api/atlas/access/diagnose") {
      if (request.method === "OPTIONS") return noContent();
      if (request.method !== "GET") {
        return apiResponse({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { allow: "GET, OPTIONS" } });
      }
      return handleAtlasAccessDiagnoseRequest(request, env);
    }

    if (url.pathname === "/api/atlas/access/invite") {
      if (request.method === "OPTIONS") return noContent();
      if (request.method !== "POST") {
        return apiResponse({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { allow: "POST, OPTIONS" } });
      }
      return handleAtlasAccessInviteRequest(request, env);
    }

    if (request.method === "OPTIONS") {
      return noContent();
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          allow: "GET, HEAD, OPTIONS",
        },
      });
    }

    if (url.pathname === "/api/site-map" || url.pathname === "/api/routes") {
      return apiResponse({
        service: "rise-performance-platform-site",
        routes: SITE_ROUTES,
      });
    }

    if (url.pathname === "/api/build-info") {
      return apiResponse({
        service: "rise-performance-platform-site",
        build: BUILD_INFO,
      });
    }

    const authAlias = atlasAuthAliasResponse(url.pathname);
    if (authAlias) {
      return withCommonHeaders(authAlias);
    }

    const assetResponse = await fetchAsset(request, env);
    if (assetResponse) {
      return withCommonHeaders(assetResponse);
    }

    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  },
};
