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
  compatibilityDate: "2026-09-01",
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
const ATLAS_DLR_ALLOWED_ROLES = new Set(["admin", "centra", "executive", "regional", "community_manager", "finance", "viewer"]);
const ATLAS_DLR_WRITE_ROLES = new Set(["admin", "centra", "executive", "regional", "community_manager", "finance"]);
const ATLAS_DLR_MANUAL_RUN_ROLES = new Set(["admin", "centra", "executive", "regional", "finance"]);
const ATLAS_DLR_BROAD_ACCESS_ROLES = new Set(["admin", "centra", "executive", "finance"]);
const ATLAS_DLR_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ATLAS_DLR_DELIVERABLE_SNAPSHOT_STATUSES = new Set(["reviewed", "approved", "queued", "sent"]);
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

async function supabaseRequest(config, path, { method = "GET", token = "", service = false, body = null, prefer = "", headers: extraHeaders = {} } = {}) {
  const key = service ? config.serviceKey : config.anonKey;
  const headers = new Headers({
    accept: "application/json",
    apikey: key,
    authorization: `Bearer ${service ? config.serviceKey : token || config.anonKey}`,
  });
  if (body !== null) headers.set("content-type", "application/json");
  if (prefer) headers.set("prefer", prefer);
  Object.entries(extraHeaders || {}).forEach(([name, value]) => {
    if (value !== undefined && value !== null) headers.set(name, String(value));
  });
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

async function requireAtlasAccessUser(request, env, allowedRoles = ATLAS_DLR_ALLOWED_ROLES) {
  const config = getAtlasSupabaseConfig(env);
  if (!config.serviceKey) {
    const error = new Error("ATLAS central reporting is not configured. Add SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY to the worker environment.");
    error.status = 503;
    throw error;
  }
  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("Sign in to ATLAS before using central DLR reporting.");
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
    `/rest/v1/atlas_user_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,email,display_name,role,status,allowed_community_ids&limit=1`,
    { service: true }
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  const role = String(profile?.role || "").toLowerCase();
  const status = String(profile?.status || "").toLowerCase();
  if (!profile || status !== "active" || !allowedRoles.has(role)) {
    const error = new Error("Your ATLAS role does not have access to central DLR reporting.");
    error.status = 403;
    throw error;
  }
  return { config, token, user, profile, role };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function cleanDlrStatus(value, fallback = "reviewed") {
  const status = cleanText(value, fallback).toLowerCase();
  return ["draft", "reviewed", "approved", "queued", "sent", "superseded", "blocked"].includes(status) ? status : fallback;
}

function normalizeDlrWeekday(value) {
  const weekday = cleanText(value).toLowerCase();
  return ATLAS_DLR_WEEKDAYS.includes(weekday) ? weekday : "";
}

function normalizeDlrWeekdays(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeDlrWeekday).filter(Boolean))];
}

function normalizeTimeValue(value, fallback = "08:00") {
  const text = cleanText(value);
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeEmailList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
  return [...new Set(source
    .map(item => {
      if (item && typeof item === "object") return cleanEmail(item.email || item.address || item.value);
      return cleanEmail(item);
    })
    .filter(item => /^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(item)))];
}

function normalizeDlrRecipientEntries(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
  const byEmail = new Map();
  source.forEach(item => {
    const raw = item && typeof item === "object" ? item : { email: item };
    const email = cleanEmail(raw.email || raw.address || raw.value);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(email)) return;
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        name: cleanText(raw.name || raw.displayName),
        source: cleanText(raw.source || raw.type || "dlr")
      });
    }
  });
  return [...byEmail.values()];
}

function normalizeDlrDeliverySettingsForServer(input = {}, env = {}) {
  const source = input && typeof input === "object" ? input : {};
  const frequencyMode = ["manual", "daily", "weekly", "selected_days", "daily_and_weekly"].includes(cleanText(source.frequencyMode).toLowerCase())
    ? cleanText(source.frequencyMode).toLowerCase()
    : "manual";
  const weeklySendDay = normalizeDlrWeekday(source.weeklySendDay) || "monday";
  const selectedWeekdays = normalizeDlrWeekdays(source.selectedWeekdays);
  const automationMode = ["draft_only", "approval_required", "fully_automated"].includes(cleanText(source.automationMode).toLowerCase())
    ? cleanText(source.automationMode).toLowerCase()
    : "draft_only";
  return {
    frequencyMode,
    selectedWeekdays: selectedWeekdays.length ? selectedWeekdays : (frequencyMode === "selected_days" ? [weeklySendDay] : []),
    weeklySendDay,
    sendTime: normalizeTimeValue(source.sendTime, "08:00"),
    timezone: cleanText(source.timezone || env.ATLAS_DLR_DELIVERY_TIMEZONE || "America/New_York"),
    automationMode,
    sendWithoutBoxScore: source.sendWithoutBoxScore !== undefined ? Boolean(source.sendWithoutBoxScore) : true,
    notifyIfDataMissing: source.notifyIfDataMissing !== undefined ? Boolean(source.notifyIfDataMissing) : true,
    requireApprovalIfCritical: source.requireApprovalIfCritical !== undefined ? Boolean(source.requireApprovalIfCritical) : true,
    sendOnWeekends: Boolean(source.sendOnWeekends),
    sendOnHolidays: Boolean(source.sendOnHolidays),
    toInvestorContacts: source.toInvestorContacts !== undefined ? Boolean(source.toInvestorContacts) : true,
    roleRecipients: Array.isArray(source.roleRecipients) ? source.roleRecipients.map(item => cleanText(item)).filter(Boolean) : [],
    cc: normalizeEmailList(source.cc),
    bcc: normalizeEmailList(source.bcc),
    emailContentMode: cleanText(source.emailContentMode || "executive_snapshot_commentary"),
    attachmentMode: cleanText(source.attachmentMode || "none"),
    emailCharts: Array.isArray(source.emailCharts) ? source.emailCharts.map(item => cleanText(item)).filter(Boolean) : []
  };
}

function coerceDateOnly(value, fallback = new Date()) {
  const text = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  const parsed = text ? new Date(text) : fallback;
  const date = parsed instanceof Date ? parsed : new Date(parsed);
  if (Number.isNaN(date.getTime())) return coerceDateOnly(fallback, new Date());
  return date.toISOString().slice(0, 10);
}

function monthStartDateOnly(value) {
  const dateOnly = coerceDateOnly(value);
  return `${dateOnly.slice(0, 7)}-01`;
}

async function sha256Hex(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMetric(value, suffix = "") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return `${Math.round(numeric * 10) / 10}${suffix}`;
}

function formatCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return `$${Math.round(numeric).toLocaleString("en-US")}`;
}

function buildDlrReadiness(report = {}) {
  const availability = report.dataAvailability && typeof report.dataAvailability === "object" ? report.dataAvailability : {};
  const traffic = report.trafficMetrics && typeof report.trafficMetrics === "object" ? report.trafficMetrics : {};
  const criticalValues = [
    traffic.applications,
    traffic.guestCards,
    traffic.tours,
    report.occupancyPct,
    report.leasedPct
  ].map(value => Number(value));
  const criticalMissing = criticalValues.every(value => !Number.isFinite(value) || value === 0);
  return {
    dailyBoxScoreReady: Boolean(report.dailyBoxScoreSourceFile || report.dailyBoxScoreImportedAt || traffic.sourceMode === "daily_box_score"),
    pricingReady: availability.pricingReady !== false,
    renewalReady: availability.renewalReady !== false,
    criticalMissing,
    sourceMode: cleanText(traffic.sourceMode || report.trafficMetricsSourceMode || "atlas_saved_data")
  };
}

function buildDlrSnapshotRecord(body = {}, access = {}, env = {}) {
  const report = body.report && typeof body.report === "object" ? body.report : {};
  const communityName = cleanText(body.communityName || report.communityName || report.communityIdentifier);
  if (!communityName) {
    const error = new Error("A DLR community name is required before publishing a central snapshot.");
    error.status = 400;
    throw error;
  }
  const reportingDate = coerceDateOnly(body.reportingDate || report.reportDateIso || report.generatedAt || new Date());
  const settings = normalizeDlrDeliverySettingsForServer(body.deliverySettings || report.deliverySettings || {}, env);
  const recipients = normalizeDlrRecipientEntries(body.recipients || body.recipientSnapshot || []);
  const readiness = {
    ...buildDlrReadiness(report),
    ...(body.readiness && typeof body.readiness === "object" ? body.readiness : {})
  };
  return {
    communityName,
    reportingDate,
    reportingMonth: monthStartDateOnly(reportingDate),
    settings,
    recipients,
    readiness,
    record: {
      community_id: isUuid(body.communityId || report.communityId) ? cleanText(body.communityId || report.communityId) : null,
      community_name: communityName,
      reporting_date: reportingDate,
      reporting_month: monthStartDateOnly(reportingDate),
      report_period_label: cleanText(body.reportPeriodLabel || report.reportPeriodLabel || report.reportingPeriodRangeLabel || report.reportMonthLabel),
      status: cleanDlrStatus(body.status || (settings.automationMode === "approval_required" ? "reviewed" : "approved")),
      source_module: cleanText(body.sourceModule || "atlas_dlr_browser"),
      source_identifier: cleanText(body.sourceIdentifier || report.dailyBoxScoreSourceFile || report.sourceSummary),
      source_hash: cleanText(body.sourceHash),
      report_payload: report,
      delivery_settings: settings,
      recipient_snapshot: recipients,
      readiness,
      prepared_by: access.user?.id || null,
      approved_by: body.status === "approved" ? access.user?.id || null : null,
      approved_at: body.status === "approved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }
  };
}

function atlasProfileAllowedCommunityIds(profile = {}) {
  return Array.isArray(profile.allowed_community_ids)
    ? profile.allowed_community_ids.map(item => cleanText(item).toLowerCase()).filter(Boolean)
    : [];
}

async function findAtlasCommunityForDlr(config, communityName = "", communityId = "") {
  if (isUuid(communityId)) {
    const rows = await supabaseRequest(
      config,
      `/rest/v1/atlas_communities?community_id=eq.${encodeURIComponent(cleanText(communityId))}&deleted_at=is.null&select=community_id,display_name,canonical_name&limit=1`,
      { service: true }
    );
    const match = Array.isArray(rows) ? rows[0] : null;
    if (match) return match;
  }
  const name = cleanText(communityName);
  if (!name) return null;
  for (const column of ["display_name", "canonical_name", "source_identifier"]) {
    const rows = await supabaseRequest(
      config,
      `/rest/v1/atlas_communities?${column}=eq.${encodeURIComponent(name)}&deleted_at=is.null&select=community_id,display_name,canonical_name&limit=1`,
      { service: true }
    );
    const match = Array.isArray(rows) ? rows[0] : null;
    if (match) return match;
  }
  return null;
}

async function requireAtlasDlrCommunityAccess(access, communityName = "", communityId = "") {
  if (ATLAS_DLR_BROAD_ACCESS_ROLES.has(access.role)) return findAtlasCommunityForDlr(access.config, communityName, communityId);
  const community = await findAtlasCommunityForDlr(access.config, communityName, communityId);
  const resolvedId = cleanText(community?.community_id || communityId).toLowerCase();
  if (!resolvedId) {
    const error = new Error("ATLAS could not match this DLR community to a central community record for scoped access.");
    error.status = 403;
    throw error;
  }
  if (!atlasProfileAllowedCommunityIds(access.profile).includes(resolvedId)) {
    const error = new Error("Your ATLAS community scope does not include this DLR community.");
    error.status = 403;
    throw error;
  }
  return community;
}

async function findExistingDlrSnapshot(config, communityName, reportingDate, reportHash) {
  const rows = await supabaseRequest(
    config,
    `/rest/v1/atlas_dlr_snapshots?community_name=eq.${encodeURIComponent(communityName)}&reporting_date=eq.${encodeURIComponent(reportingDate)}&report_hash=eq.${encodeURIComponent(reportHash)}&select=*&limit=1`,
    { service: true }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function insertDlrSnapshot(config, snapshot) {
  const reportHash = await sha256Hex({
    communityName: snapshot.communityName,
    reportingDate: snapshot.reportingDate,
    report: snapshot.record.report_payload
  });
  const record = { ...snapshot.record, report_hash: reportHash };
  try {
    const rows = await supabaseRequest(config, "/rest/v1/atlas_dlr_snapshots", {
      method: "POST",
      service: true,
      body: record,
      prefer: "return=representation"
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (error.status === 409) {
      const existing = await findExistingDlrSnapshot(config, snapshot.communityName, snapshot.reportingDate, reportHash);
      if (existing) return existing;
    }
    throw error;
  }
}

async function upsertDlrDeliverySubscription(config, snapshot, savedSnapshot, access) {
  const existingRows = await supabaseRequest(
    config,
    `/rest/v1/atlas_dlr_delivery_subscriptions?community_name=eq.${encodeURIComponent(snapshot.communityName)}&deleted_at=is.null&select=*&limit=1`,
    { service: true }
  );
  const settings = snapshot.settings;
  const recipientConfig = {
    to: snapshot.recipients,
    cc: settings.cc,
    bcc: settings.bcc,
    toInvestorContacts: settings.toInvestorContacts,
    roleRecipients: settings.roleRecipients,
    emailContentMode: settings.emailContentMode,
    attachmentMode: settings.attachmentMode,
    emailCharts: settings.emailCharts
  };
  const record = {
    community_id: savedSnapshot?.community_id || null,
    community_name: snapshot.communityName,
    status: "active",
    frequency_mode: settings.frequencyMode,
    selected_weekdays: settings.selectedWeekdays,
    weekly_send_day: settings.weeklySendDay,
    send_time: settings.sendTime,
    timezone: settings.timezone,
    automation_mode: settings.automationMode,
    send_without_box_score: settings.sendWithoutBoxScore,
    notify_if_data_missing: settings.notifyIfDataMissing,
    require_approval_if_critical: settings.requireApprovalIfCritical,
    send_on_weekends: settings.sendOnWeekends,
    send_on_holidays: settings.sendOnHolidays,
    recipient_config: recipientConfig,
    last_snapshot_id: savedSnapshot?.dlr_snapshot_id || null,
    updated_by: access.user?.id || null,
    updated_at: new Date().toISOString()
  };
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing?.dlr_subscription_id) {
    const rows = await supabaseRequest(
      config,
      `/rest/v1/atlas_dlr_delivery_subscriptions?dlr_subscription_id=eq.${encodeURIComponent(existing.dlr_subscription_id)}`,
      { method: "PATCH", service: true, body: record, prefer: "return=representation" }
    );
    return Array.isArray(rows) ? rows[0] : rows;
  }
  const rows = await supabaseRequest(config, "/rest/v1/atlas_dlr_delivery_subscriptions", {
    method: "POST",
    service: true,
    body: {
      ...record,
      created_by: access.user?.id || null
    },
    prefer: "return=representation"
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

function getDlrCapabilityStatus(env) {
  const config = getAtlasSupabaseConfig(env);
  return {
    persistentDatabase: Boolean(config.serviceKey),
    scheduledWorker: true,
    transactionalEmail: Boolean(env.EMAIL?.send),
    senderConfigured: Boolean(cleanText(env.ATLAS_DLR_FROM_EMAIL)),
    timezone: cleanText(env.ATLAS_DLR_DELIVERY_TIMEZONE || "America/New_York"),
    emailProvider: cleanText(env.ATLAS_DLR_EMAIL_PROVIDER || "cloudflare_email_service")
  };
}

async function handleAtlasDlrSnapshotRequest(request, env) {
  try {
    const access = await requireAtlasAccessUser(request, env, ATLAS_DLR_WRITE_ROLES);
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") return apiResponse({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    const snapshot = buildDlrSnapshotRecord(body, access, env);
    const community = await requireAtlasDlrCommunityAccess(access, snapshot.communityName, snapshot.record.community_id);
    if (community?.community_id) snapshot.record.community_id = community.community_id;
    const savedSnapshot = await insertDlrSnapshot(access.config, snapshot);
    const subscription = await upsertDlrDeliverySubscription(access.config, snapshot, savedSnapshot, access);
    return apiResponse({
      ok: true,
      capabilities: getDlrCapabilityStatus(env),
      snapshot: savedSnapshot,
      subscription
    });
  } catch (error) {
    return apiResponse({ ok: false, error: jsonSafeError(error) }, { status: error.status || 500 });
  }
}

async function handleAtlasDlrStatusRequest(request, env) {
  try {
    const access = await requireAtlasAccessUser(request, env);
    const url = new URL(request.url);
    const communityName = cleanText(url.searchParams.get("communityName"));
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 5) || 5));
    if (!ATLAS_DLR_BROAD_ACCESS_ROLES.has(access.role) && !communityName) {
      return apiResponse({ ok: false, error: "Choose a community before checking DLR delivery status." }, { status: 400 });
    }
    await requireAtlasDlrCommunityAccess(access, communityName);
    const communityFilter = communityName ? `community_name=eq.${encodeURIComponent(communityName)}&` : "";
    const [snapshots, subscriptions, deliveries] = await Promise.all([
      supabaseRequest(
        access.config,
        `/rest/v1/atlas_dlr_snapshots?${communityFilter}deleted_at=is.null&select=dlr_snapshot_id,community_name,reporting_date,reporting_month,status,report_hash,report_period_label,prepared_at,approved_at,readiness,recipient_snapshot&order=reporting_date.desc,prepared_at.desc&limit=${limit}`,
        { service: true }
      ),
      supabaseRequest(
        access.config,
        `/rest/v1/atlas_dlr_delivery_subscriptions?${communityFilter}deleted_at=is.null&select=*&order=updated_at.desc&limit=${limit}`,
        { service: true }
      ),
      supabaseRequest(
        access.config,
        `/rest/v1/atlas_dlr_delivery_history?${communityFilter}select=*&order=created_at.desc&limit=${limit}`,
        { service: true }
      )
    ]);
    return apiResponse({
      ok: true,
      capabilities: getDlrCapabilityStatus(env),
      snapshots,
      subscriptions,
      deliveries
    });
  } catch (error) {
    return apiResponse({ ok: false, error: jsonSafeError(error) }, { status: error.status || 500 });
  }
}

function getLocalDateParts(date = new Date(), timeZone = "America/New_York") {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hourCycle: "h23",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const weekday = cleanText(parts.weekday).toLowerCase();
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday,
    dateOnly: `${parts.year}-${parts.month}-${parts.day}`,
    minutesOfDay: (Number(parts.hour) * 60) + Number(parts.minute)
  };
}

function timeToMinutes(value) {
  const [hour, minute] = normalizeTimeValue(value).split(":").map(Number);
  return (hour * 60) + minute;
}

function subscriptionDueCadences(subscription = {}, now = new Date(), options = {}) {
  const settings = normalizeDlrDeliverySettingsForServer({
    frequencyMode: subscription.frequency_mode,
    selectedWeekdays: subscription.selected_weekdays,
    weeklySendDay: subscription.weekly_send_day,
    sendTime: subscription.send_time,
    timezone: subscription.timezone,
    automationMode: subscription.automation_mode,
    sendWithoutBoxScore: subscription.send_without_box_score,
    notifyIfDataMissing: subscription.notify_if_data_missing,
    requireApprovalIfCritical: subscription.require_approval_if_critical,
    sendOnWeekends: subscription.send_on_weekends,
    sendOnHolidays: subscription.send_on_holidays,
    recipient_config: subscription.recipient_config
  });
  const local = getLocalDateParts(now, settings.timezone);
  const weekend = local.weekday === "saturday" || local.weekday === "sunday";
  if (!options.force && !settings.sendOnWeekends && weekend) return { settings, local, cadences: [], reason: "Weekend delivery is disabled." };
  if (!options.force && settings.frequencyMode === "manual") return { settings, local, cadences: [], reason: "Manual-only subscription." };
  if (!options.force && local.minutesOfDay < timeToMinutes(settings.sendTime)) {
    return { settings, local, cadences: [], reason: "Scheduled send time has not arrived." };
  }
  const cadences = [];
  if (options.force) {
    cadences.push("manual");
  } else if (settings.frequencyMode === "daily") {
    cadences.push("daily");
  } else if (settings.frequencyMode === "weekly" && settings.weeklySendDay === local.weekday) {
    cadences.push("weekly");
  } else if (settings.frequencyMode === "selected_days" && settings.selectedWeekdays.includes(local.weekday)) {
    cadences.push("selected_days");
  } else if (settings.frequencyMode === "daily_and_weekly") {
    cadences.push("daily");
    if (settings.weeklySendDay === local.weekday) cadences.push("weekly");
  }
  return { settings, local, cadences: [...new Set(cadences)], reason: cadences.length ? "" : "This weekday is not in the delivery schedule." };
}

async function deliveryAlreadyRecorded(config, communityName, cadence, scheduledDate) {
  const rows = await supabaseRequest(
    config,
    `/rest/v1/atlas_dlr_delivery_history?community_name=eq.${encodeURIComponent(communityName)}&cadence=eq.${encodeURIComponent(cadence)}&scheduled_date=eq.${encodeURIComponent(scheduledDate)}&select=dlr_delivery_id,status&limit=1`,
    { service: true }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function latestDlrSnapshotForSubscription(config, subscription) {
  if (subscription.last_snapshot_id) {
    const rows = await supabaseRequest(
      config,
      `/rest/v1/atlas_dlr_snapshots?dlr_snapshot_id=eq.${encodeURIComponent(subscription.last_snapshot_id)}&deleted_at=is.null&select=*&limit=1`,
      { service: true }
    );
    const snapshot = Array.isArray(rows) ? rows[0] : null;
    if (snapshot && ATLAS_DLR_DELIVERABLE_SNAPSHOT_STATUSES.has(cleanText(snapshot.status).toLowerCase())) return snapshot;
  }
  const rows = await supabaseRequest(
    config,
    `/rest/v1/atlas_dlr_snapshots?community_name=eq.${encodeURIComponent(subscription.community_name)}&deleted_at=is.null&select=*&order=reporting_date.desc,prepared_at.desc&limit=5`,
    { service: true }
  );
  return (Array.isArray(rows) ? rows : []).find(row => ATLAS_DLR_DELIVERABLE_SNAPSHOT_STATUSES.has(cleanText(row.status).toLowerCase())) || null;
}

function buildDlrEmailMessage(snapshot = {}, subscription = {}, env = {}) {
  const report = snapshot.report_payload && typeof snapshot.report_payload === "object" ? snapshot.report_payload : {};
  const traffic = report.trafficMetrics && typeof report.trafficMetrics === "object" ? report.trafficMetrics : {};
  const renewal = report.renewalSnapshot && typeof report.renewalSnapshot === "object" ? report.renewalSnapshot : {};
  const pricing = report.pricing && typeof report.pricing === "object" ? report.pricing : {};
  const communityName = cleanText(report.communityName || snapshot.community_name || subscription.community_name);
  const reportDateLabel = cleanText(report.reportDateLabel || snapshot.reporting_date);
  const reportMonthLabel = cleanText(report.reportMonthLabel || snapshot.reporting_month);
  const subject = `ATLAS RISE DLR Investor Overview | ${communityName} | ${reportDateLabel || reportMonthLabel}`;
  const rows = [
    ["Occupancy", formatMetric(report.occupancyPct, "%")],
    ["Leased", formatMetric(report.leasedPct, "%")],
    ["90-day projection", formatMetric(report.trendingOccupancyPct, "%")],
    ["Guest cards", formatMetric(traffic.rolledGuestCards ?? traffic.guestCards)],
    ["Tours", formatMetric(traffic.tours)],
    ["Applications", formatMetric(traffic.applications)],
    ["Approved applications", formatMetric(traffic.approvals)],
    ["Move-ins / move-outs", `${formatMetric(traffic.moveIns)} / ${formatMetric(traffic.moveOuts)}`],
    ["Renewal retention", formatMetric(renewal.retentionRate, "%")],
    ["Projected attrition", formatMetric(renewal.projectedAttrition)],
    ["Avg budget rent", formatCurrency(pricing.avgBudgetRent)],
    ["Avg in-place rent", formatCurrency(pricing.avgInPlaceRent)]
  ];
  const notes = report.notes && typeof report.notes === "object" ? report.notes : {};
  const noteText = [notes.highlights, notes.wins, notes.marketing, notes.applications, notes.tours]
    .map(value => Array.isArray(value) ? value.join(" ") : cleanText(value))
    .filter(Boolean)
    .slice(0, 3);
  const text = [
    subject,
    "",
    `Reporting period: ${report.reportingPeriodRangeLabel || report.reportPeriodLabel || reportMonthLabel || "Current DLR"}`,
    `Generated from central ATLAS snapshot ${snapshot.dlr_snapshot_id || ""}.`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(noteText.length ? ["", "Management notes:", ...noteText.map(item => `- ${item}`)] : [])
  ].join("\n");
  const htmlRows = rows.map(([label, value]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #dbe4ec;color:#475569">${escapeHtml(label)}</td><td style="padding:8px 10px;border-bottom:1px solid #dbe4ec;color:#0f172a;font-weight:700">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fb;color:#0f172a;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:720px;margin:0 auto;padding:24px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0f5f78;font-weight:700">ATLAS RISE Daily Leasing Report</div>
    <h1 style="font-size:24px;line-height:1.2;margin:8px 0 4px">${escapeHtml(communityName)}</h1>
    <div style="font-size:14px;color:#475569;margin-bottom:18px">${escapeHtml(report.reportingPeriodRangeLabel || report.reportPeriodLabel || reportDateLabel || reportMonthLabel)}</div>
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe4ec">${htmlRows}</table>
    ${noteText.length ? `<div style="margin-top:18px;background:#fff;border:1px solid #dbe4ec;padding:14px"><div style="font-weight:700;margin-bottom:8px">Management Notes</div>${noteText.map(item => `<p style="font-size:14px;line-height:1.55;margin:8px 0;color:#334155">${escapeHtml(item)}</p>`).join("")}</div>` : ""}
    <p style="font-size:12px;color:#64748b;margin-top:18px">Sent by the ATLAS centralized reporting worker from a persisted, reviewed DLR snapshot.</p>
  </div>
</body></html>`;
  return {
    subject,
    text,
    html,
    fromEmail: cleanEmail(env.ATLAS_DLR_FROM_EMAIL || ""),
    fromName: cleanText(env.ATLAS_DLR_FROM_NAME || "ATLAS RISE Reports")
  };
}

function resolveDeliveryRecipients(snapshot = {}, subscription = {}) {
  const config = subscription.recipient_config && typeof subscription.recipient_config === "object" ? subscription.recipient_config : {};
  const snapshotRecipients = normalizeDlrRecipientEntries(snapshot.recipient_snapshot || []);
  const configRecipients = normalizeDlrRecipientEntries(config.to || config.recipients || []);
  const to = normalizeEmailList(snapshotRecipients.length ? snapshotRecipients : configRecipients);
  const cc = normalizeEmailList(config.cc);
  const bcc = normalizeEmailList(config.bcc);
  return { to, cc, bcc };
}

async function insertDlrDeliveryHistory(config, record) {
  try {
    const rows = await supabaseRequest(config, "/rest/v1/atlas_dlr_delivery_history", {
      method: "POST",
      service: true,
      body: {
        ...record,
        updated_at: new Date().toISOString()
      },
      prefer: "return=representation"
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (error.status === 409) {
      return deliveryAlreadyRecorded(config, record.community_name, record.cadence, record.scheduled_date);
    }
    throw error;
  }
}

async function recordDlrDelivery(config, subscription, cadence, local, status, details = {}) {
  return insertDlrDeliveryHistory(config, {
    dlr_snapshot_id: details.snapshot?.dlr_snapshot_id || null,
    dlr_subscription_id: subscription.dlr_subscription_id || null,
    community_id: subscription.community_id || details.snapshot?.community_id || null,
    community_name: subscription.community_name,
    cadence,
    scheduled_date: local.dateOnly,
    scheduled_for: details.scheduledFor || new Date().toISOString(),
    status,
    provider: details.provider || "cloudflare_email_service",
    provider_message_id: details.providerMessageId || null,
    from_email: details.fromEmail || null,
    to_emails: details.to || [],
    cc_emails: details.cc || [],
    bcc_emails: details.bcc || [],
    subject: details.subject || null,
    html_hash: details.htmlHash || null,
    text_hash: details.textHash || null,
    attempt_count: details.attemptCount || 0,
    last_attempt_at: details.lastAttemptAt || null,
    sent_at: details.sentAt || null,
    error_message: details.error || null,
    metadata: details.metadata || {}
  });
}

async function processDlrSubscriptionCadence(config, subscription, cadence, local, env, options = {}) {
  const existing = await deliveryAlreadyRecorded(config, subscription.community_name, cadence, local.dateOnly);
  if (existing && !options.force) {
    return { communityName: subscription.community_name, cadence, status: "already_recorded" };
  }
  if (subscription.automation_mode === "draft_only") {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "skipped", {
      error: "Subscription is draft-only; server-side email send was not attempted.",
      metadata: { source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "skipped", history };
  }
  if (subscription.automation_mode === "approval_required") {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "awaiting_approval", {
      error: "Subscription requires approval before server-side delivery.",
      metadata: { source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "awaiting_approval", history };
  }
  const snapshot = await latestDlrSnapshotForSubscription(config, subscription);
  if (!snapshot) {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "no_snapshot", {
      error: "No reviewed DLR snapshot was available for this community.",
      metadata: { source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "no_snapshot", history };
  }
  const readiness = snapshot.readiness && typeof snapshot.readiness === "object" ? snapshot.readiness : {};
  if (subscription.require_approval_if_critical && readiness.criticalMissing) {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "awaiting_approval", {
      snapshot,
      error: "Critical DLR data is missing, so approval is required before delivery.",
      metadata: { readiness, source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "awaiting_approval", history };
  }
  const recipients = resolveDeliveryRecipients(snapshot, subscription);
  if (!recipients.to.length) {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "no_recipients", {
      snapshot,
      error: "No DLR recipients are configured for this community.",
      metadata: { source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "no_recipients", history };
  }
  const message = buildDlrEmailMessage(snapshot, subscription, env);
  const htmlHash = await sha256Hex(message.html);
  const textHash = await sha256Hex(message.text);
  if (!env.EMAIL?.send || !message.fromEmail) {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "provider_not_configured", {
      snapshot,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: message.subject,
      htmlHash,
      textHash,
      fromEmail: message.fromEmail,
      error: "Cloudflare Email Service binding or ATLAS_DLR_FROM_EMAIL is not configured.",
      metadata: { source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "provider_not_configured", history };
  }
  if (options.dryRun) {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "queued", {
      snapshot,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: message.subject,
      htmlHash,
      textHash,
      fromEmail: message.fromEmail,
      metadata: { dryRun: true, source: options.source || "manual_run" }
    });
    return { communityName: subscription.community_name, cadence, status: "dry_run_queued", history };
  }
  try {
    const result = await env.EMAIL.send({
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      from: message.fromName ? { email: message.fromEmail, name: message.fromName } : message.fromEmail,
      subject: message.subject,
      html: message.html,
      text: message.text
    });
    const sentAt = new Date().toISOString();
    const history = await recordDlrDelivery(config, subscription, cadence, local, "sent", {
      snapshot,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: message.subject,
      htmlHash,
      textHash,
      fromEmail: message.fromEmail,
      providerMessageId: result?.messageId || null,
      attemptCount: 1,
      lastAttemptAt: sentAt,
      sentAt,
      metadata: { source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "sent", history };
  } catch (error) {
    const history = await recordDlrDelivery(config, subscription, cadence, local, "failed", {
      snapshot,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: message.subject,
      htmlHash,
      textHash,
      fromEmail: message.fromEmail,
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
      error: jsonSafeError(error),
      metadata: { source: options.source || "scheduled_worker" }
    });
    return { communityName: subscription.community_name, cadence, status: "failed", history };
  }
}

async function processDlrScheduledDeliveries(env, options = {}) {
  const config = getAtlasSupabaseConfig(env);
  if (!config.serviceKey) {
    const result = { ok: false, error: "ATLAS central reporting database is not configured." };
    console.log({ event: "atlas_dlr_scheduler_skipped", ...result });
    return result;
  }
  const now = options.triggeredAt instanceof Date ? options.triggeredAt : new Date(options.triggeredAt || Date.now());
  const subscriptionRows = await supabaseRequest(
    config,
    "/rest/v1/atlas_dlr_delivery_subscriptions?status=eq.active&deleted_at=is.null&select=*&order=community_name.asc",
    { service: true }
  );
  const subscriptions = Array.isArray(subscriptionRows) ? subscriptionRows : [];
  const filtered = options.communityName
    ? subscriptions.filter(row => cleanText(row.community_name).toLowerCase() === cleanText(options.communityName).toLowerCase())
    : subscriptions;
  const results = [];
  for (const subscription of filtered) {
    const due = subscriptionDueCadences(subscription, now, options);
    if (!due.cadences.length) {
      results.push({ communityName: subscription.community_name, status: "not_due", reason: due.reason });
      continue;
    }
    for (const cadence of due.cadences) {
      try {
        results.push(await processDlrSubscriptionCadence(config, subscription, cadence, due.local, env, options));
      } catch (error) {
        results.push({ communityName: subscription.community_name, cadence, status: "error", error: jsonSafeError(error) });
      }
    }
  }
  const result = {
    ok: true,
    source: options.source || "scheduled_worker",
    cron: options.cron || "",
    checked: filtered.length,
    processed: results.filter(item => !["not_due", "already_recorded"].includes(item.status)).length,
    results
  };
  console.log({ event: "atlas_dlr_scheduler_completed", checked: result.checked, processed: result.processed });
  return result;
}

async function handleAtlasDlrRunRequest(request, env) {
  try {
    const access = await requireAtlasAccessUser(request, env, ATLAS_DLR_MANUAL_RUN_ROLES);
    const body = await readJsonBody(request) || {};
    const communityName = cleanText(body.communityName);
    if (!ATLAS_DLR_BROAD_ACCESS_ROLES.has(access.role) && !communityName) {
      return apiResponse({ ok: false, error: "Choose a community before running the DLR delivery queue." }, { status: 400 });
    }
    await requireAtlasDlrCommunityAccess(access, communityName);
    const result = await processDlrScheduledDeliveries(env, {
      source: "manual_api",
      communityName,
      force: Boolean(body.force),
      dryRun: Boolean(body.dryRun),
      triggeredBy: access.user?.id || null,
      triggeredAt: new Date()
    });
    return apiResponse(result);
  } catch (error) {
    return apiResponse({ ok: false, error: jsonSafeError(error) }, { status: error.status || 500 });
  }
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
        dlrReporting: getDlrCapabilityStatus(env),
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

    if (url.pathname === "/api/atlas/dlr/status") {
      if (request.method === "OPTIONS") return noContent();
      if (request.method !== "GET") {
        return apiResponse({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { allow: "GET, OPTIONS" } });
      }
      return handleAtlasDlrStatusRequest(request, env);
    }

    if (url.pathname === "/api/atlas/dlr/snapshots") {
      if (request.method === "OPTIONS") return noContent();
      if (request.method !== "POST") {
        return apiResponse({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { allow: "POST, OPTIONS" } });
      }
      return handleAtlasDlrSnapshotRequest(request, env);
    }

    if (url.pathname === "/api/atlas/dlr/deliveries/run") {
      if (request.method === "OPTIONS") return noContent();
      if (request.method !== "POST") {
        return apiResponse({ ok: false, error: "Method Not Allowed" }, { status: 405, headers: { allow: "POST, OPTIONS" } });
      }
      return handleAtlasDlrRunRequest(request, env);
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

  async scheduled(controller, env) {
    try {
      await processDlrScheduledDeliveries(env, {
        source: "scheduled_worker",
        cron: controller?.cron || "",
        triggeredAt: new Date()
      });
    } catch (error) {
      console.log({ event: "atlas_dlr_scheduler_error", error: jsonSafeError(error) });
    }
  },
};
