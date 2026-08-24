/* Atlas central platform client.
   This file contains only browser-safe public configuration and runtime logic.
   Never place a Supabase service-role key or database password in this file. */
(function () {
  "use strict";

  const CONFIG_STORAGE_KEY = "atlas_central_runtime_config_v1";
  const SESSION_STORAGE_KEY = "atlas_central_auth_session_v1";
  const PROFILE_STORAGE_KEY = "atlas_central_profile_v1";
  const SHARED_PROPERTY_GRAPH_DOCUMENT_KEY = "atlas_shared_property_graph_v1";

  const DEFAULT_CONFIG = {
    enabled: true,
    provider: "supabase-postgres",
    appBaseUrl: "https://jac1827.github.io/ATLAS/portfolio-operations-dashboard/index.html",
    apiBaseUrl: "",
    supabaseUrl: "https://rmyhmvjcswfwaracgriy.supabase.co",
    supabaseAnonKey: "sb_publishable_2DEqeCNZFn6sNeVrSEfW8A_EI6tRb_1",
    documentKey: "atlas_dashboard_state_v1",
    realtime: false,
    autosave: false,
    autoPullOnStartup: false,
    allowMagicLinkSignup: false,
    allowedEmailDomains: ["risere.com", "riseresidential.com"]
  };

  function safeJsonParse(value, fallback = null) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  function readLocalStorageJson(key, fallback = null) {
    try { return safeJsonParse(localStorage.getItem(key), fallback); } catch { return fallback; }
  }

  function writeLocalStorageJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function trimTrailingSlash(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function normalizeConfig(input) {
    const raw = input && typeof input === "object" ? input : {};
    const config = { ...DEFAULT_CONFIG, ...raw };
    config.enabled = DEFAULT_CONFIG.enabled || Boolean(config.enabled);
    config.provider = String(config.provider || DEFAULT_CONFIG.provider).trim();
    config.appBaseUrl = trimTrailingSlash(config.appBaseUrl || DEFAULT_CONFIG.appBaseUrl);
    config.apiBaseUrl = trimTrailingSlash(config.apiBaseUrl);
    config.supabaseUrl = trimTrailingSlash(config.supabaseUrl || DEFAULT_CONFIG.supabaseUrl);
    config.supabaseAnonKey = String(config.supabaseAnonKey || DEFAULT_CONFIG.supabaseAnonKey || "").trim();
    config.documentKey = String(config.documentKey || DEFAULT_CONFIG.documentKey).trim() || DEFAULT_CONFIG.documentKey;
    config.realtime = Boolean(config.realtime);
    config.autosave = Boolean(config.autosave);
    config.autoPullOnStartup = Boolean(config.autoPullOnStartup);
    config.allowMagicLinkSignup = Boolean(config.allowMagicLinkSignup);
    config.allowedEmailDomains = Array.isArray(config.allowedEmailDomains)
      ? config.allowedEmailDomains.map(item => String(item || "").trim().toLowerCase()).filter(Boolean)
      : [];
    return config;
  }

  function getConfig() {
    const pageConfig = window.ATLAS_CENTRAL_CONFIG && typeof window.ATLAS_CENTRAL_CONFIG === "object"
      ? window.ATLAS_CENTRAL_CONFIG
      : {};
    const localConfig = readLocalStorageJson(CONFIG_STORAGE_KEY, {});
    return normalizeConfig({ ...pageConfig, ...localConfig });
  }

  function saveLocalConfig(input = {}) {
    const next = normalizeConfig({ ...getConfig(), ...input, enabled: true });
    writeLocalStorageJson(CONFIG_STORAGE_KEY, next);
    return next;
  }

  function clearLocalConfig() {
    try { localStorage.removeItem(CONFIG_STORAGE_KEY); } catch {}
    return getConfig();
  }

  function hasDatabaseConfig(config = getConfig()) {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey);
  }

  function hasApiConfig(config = getConfig()) {
    return Boolean(config.apiBaseUrl);
  }

  function getStoredSession() {
    const session = readLocalStorageJson(SESSION_STORAGE_KEY, null);
    return session && typeof session === "object" ? session : null;
  }

  function saveSession(session) {
    const normalized = session && typeof session === "object" ? { ...session } : null;
    if (!normalized) {
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
      try { localStorage.removeItem(PROFILE_STORAGE_KEY); } catch {}
      return null;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (normalized.expires_in && !normalized.expires_at) {
      normalized.expires_at = nowSeconds + Number(normalized.expires_in);
    }
    writeLocalStorageJson(SESSION_STORAGE_KEY, normalized);
    return normalized;
  }

  function getStoredProfile() {
    return readLocalStorageJson(PROFILE_STORAGE_KEY, null);
  }

  function saveProfile(profile) {
    if (!profile) {
      try { localStorage.removeItem(PROFILE_STORAGE_KEY); } catch {}
      return null;
    }
    writeLocalStorageJson(PROFILE_STORAGE_KEY, profile);
    return profile;
  }

  function getSession() {
    const session = getStoredSession();
    if (!session?.access_token) return null;
    return session;
  }

  function getSignedInUser() {
    const session = getSession();
    return session?.user || null;
  }

  function userEmail() {
    return String(getSignedInUser()?.email || "").trim().toLowerCase();
  }

  function isEmailAllowed(email, config = getConfig()) {
    const value = String(email || "").trim().toLowerCase();
    if (!value || !config.allowedEmailDomains.length) return true;
    return config.allowedEmailDomains.some(domain => value.endsWith(`@${domain.replace(/^@/, "")}`));
  }

  function getStatus() {
    const config = getConfig();
    const configured = config.enabled && (hasDatabaseConfig(config) || hasApiConfig(config));
    const session = getSession();
    const profile = getStoredProfile();
    const signedIn = Boolean(session?.access_token);
    return {
      configured,
      signedIn,
      mode: configured ? "centralized" : "legacy-migration",
      provider: config.provider,
      realtime: configured && config.realtime,
      autosave: configured && config.autosave,
      autoPullOnStartup: configured && config.autoPullOnStartup,
      documentKey: config.documentKey,
      userEmail: userEmail(),
      role: String(profile?.role || ""),
      profileStatus: String(profile?.status || ""),
      tokenExpiresAt: session?.expires_at ? new Date(Number(session.expires_at) * 1000).toISOString() : "",
      message: configured
        ? (signedIn ? "Central Atlas data source is configured and this browser has an authenticated session." : "Central Atlas data source is configured. Sign in to read or save shared Atlas data.")
        : "Central Atlas data source is not configured. Browser data is available only for migration snapshots, backup, and controlled import/export."
    };
  }

  function requireConfigured() {
    const config = getConfig();
    const status = getStatus();
    if (!status.configured) throw new Error(status.message);
    return config;
  }

  function authUrl(path) {
    const config = requireConfigured();
    if (!hasDatabaseConfig(config)) throw new Error("Supabase URL and anon key are required for browser auth.");
    return `${config.supabaseUrl}/auth/v1${path}`;
  }

  function isLocalBrowserUrl(value) {
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(String(value || "").trim());
  }

  function currentPageAuthUrl() {
    const current = trimTrailingSlash(window.location?.href?.split("#")[0] || "");
    return current && !isLocalBrowserUrl(current) ? current : "";
  }

  function authRedirectUrl(config = getConfig()) {
    return currentPageAuthUrl() || config.appBaseUrl || DEFAULT_CONFIG.appBaseUrl || "";
  }

  function withRedirectTo(path, redirectTo) {
    const url = String(redirectTo || "").trim();
    if (!url) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}redirect_to=${encodeURIComponent(url)}`;
  }

  function restUrl(path) {
    const config = requireConfigured();
    if (hasDatabaseConfig(config)) return `${config.supabaseUrl}/rest/v1${path}`;
    if (hasApiConfig(config)) return `${config.apiBaseUrl}${path}`;
    throw new Error("Central API base URL is not configured.");
  }

  function baseHeaders(config = getConfig(), includeAuth = true) {
    const headers = {
      accept: "application/json",
      "content-type": "application/json"
    };
    if (config.supabaseAnonKey) {
      headers.apikey = config.supabaseAnonKey;
      headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
    }
    if (includeAuth) {
      const token = getSession()?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function parseJsonResponse(response) {
    const text = await response.text().catch(() => "");
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  function errorFromPayload(payload, fallback) {
    if (payload && typeof payload === "object") {
      return payload.message || payload.error_description || payload.error || fallback;
    }
    return String(payload || fallback);
  }

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...baseHeaders(getConfig(), options.auth !== false),
          ...(options.headers || {})
        }
      });
    } catch (error) {
      const method = String(options.method || "GET").toUpperCase();
      const target = String(url || "").replace(getConfig().supabaseUrl || "", "");
      throw new Error(`Central ${method} request could not reach Supabase${target ? ` (${target})` : ""}. ${error?.message || error || "The browser blocked or interrupted the request."}`);
    }
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(errorFromPayload(payload, `Central request failed with HTTP ${response.status}`));
    }
    return payload;
  }

  async function fetchJson(path, options = {}) {
    return request(restUrl(path), options);
  }

  async function signInWithPassword(email, password) {
    const config = requireConfigured();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!isEmailAllowed(cleanEmail, config)) throw new Error("This email domain is not approved for Atlas.");
    if (!password) throw new Error("Password is required.");
    const payload = await request(authUrl("/token?grant_type=password"), {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email: cleanEmail, password })
    });
    saveSession(payload);
    await fetchProfile().catch(() => null);
    return payload;
  }

  async function sendMagicLink(email, options = {}) {
    const config = requireConfigured();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!isEmailAllowed(cleanEmail, config)) throw new Error("This email domain is not approved for Atlas.");
    if (!cleanEmail) throw new Error("Email is required.");
    const redirectTo = authRedirectUrl(config);
    return request(authUrl(withRedirectTo("/otp", redirectTo)), {
      method: "POST",
      auth: false,
      body: JSON.stringify({
        email: cleanEmail,
        create_user: Boolean(options.createUser || config.allowMagicLinkSignup),
        options: redirectTo ? { email_redirect_to: redirectTo } : {}
      })
    });
  }

  async function refreshSession() {
    const session = getSession();
    if (!session?.refresh_token) return session;
    const expiresAt = Number(session.expires_at || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expiresAt && expiresAt - nowSeconds > 90) return session;
    const payload = await request(authUrl("/token?grant_type=refresh_token"), {
      method: "POST",
      auth: false,
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    return saveSession(payload);
  }

  async function signOut() {
    const session = getSession();
    if (session?.access_token) {
      try {
        await request(authUrl("/logout"), { method: "POST" });
      } catch {}
    }
    saveSession(null);
    return true;
  }

  function handleAuthRedirect() {
    const hash = String(window.location?.hash || "");
    if (!hash || !hash.includes("access_token")) return null;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    if (!accessToken) return null;
    const expiresIn = Number(params.get("expires_in") || 3600);
    const session = saveSession({
      access_token: accessToken,
      refresh_token: params.get("refresh_token") || "",
      token_type: params.get("token_type") || "bearer",
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user: { email: params.get("email") || "" }
    });
    if (window.history?.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
    fetchUser().catch(() => null);
    return session;
  }

  async function fetchUser() {
    await refreshSession().catch(() => null);
    const payload = await request(authUrl("/user"), { method: "GET" });
    const session = getSession() || {};
    saveSession({ ...session, user: payload });
    return payload;
  }

  async function fetchProfile() {
    await refreshSession().catch(() => null);
    const user = getSignedInUser() || await fetchUser();
    const userId = user?.id;
    if (!userId) return null;
    const query = `?user_id=eq.${encodeURIComponent(userId)}&select=user_id,email,display_name,profile_image_url,role,status,employee_id,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,access_notes,last_access_reviewed_at,updated_at&limit=1`;
    const rows = await fetchJson(`/atlas_user_profiles${query}`);
    let profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile) {
      profile = await claimInvitedProfile().catch(() => null);
    }
    saveProfile(profile || null);
    return profile || null;
  }

  async function signUpWithPassword(email, password, displayName = "") {
    const config = requireConfigured();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!isEmailAllowed(cleanEmail, config)) throw new Error("This email domain is not approved for Atlas.");
    if (!password || String(password).length < 8) throw new Error("Use a password with at least 8 characters.");
    const redirectTo = authRedirectUrl(config);
    const payload = await request(authUrl(withRedirectTo("/signup", redirectTo)), {
      method: "POST",
      auth: false,
      body: JSON.stringify({
        email: cleanEmail,
        password,
        data: { display_name: String(displayName || "").trim() },
        ...(redirectTo ? { email_redirect_to: redirectTo } : {})
      })
    });
    if (payload?.access_token) {
      saveSession(payload);
      await fetchProfile().catch(() => null);
    }
    return payload;
  }

  async function rpc(functionName, args = {}) {
    await refreshSession().catch(() => null);
    const result = await fetchJson(`/rpc/${encodeURIComponent(functionName)}`, {
      method: "POST",
      body: JSON.stringify(args && typeof args === "object" ? args : {})
    });
    return Array.isArray(result) ? result[0] : result;
  }

  async function claimFirstAdmin(displayName = "") {
    const profile = await rpc("atlas_claim_first_admin", {
      p_display_name: String(displayName || "").trim() || null
    });
    saveProfile(profile || null);
    return profile;
  }

  async function claimInvitedProfile(displayName = "") {
    const profile = await rpc("atlas_claim_invited_profile", {
      p_display_name: String(displayName || "").trim() || null
    });
    saveProfile(profile || null);
    return profile;
  }

  async function updateCurrentProfile({ displayName = "", profileImageUrl = null } = {}) {
    const profile = await rpc("atlas_update_current_profile", {
      p_display_name: String(displayName || "").trim() || null,
      p_profile_image_url: String(profileImageUrl || "").trim() || null
    });
    saveProfile(profile || null);
    return profile;
  }

  async function computeSha256(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    if (window.crypto?.subtle && window.TextEncoder) {
      const bytes = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
    }
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return `simple:${Math.abs(hash)}`;
  }

  async function readDocument(documentKey = getConfig().documentKey) {
    await refreshSession().catch(() => null);
    const key = encodeURIComponent(documentKey);
    const query = `?document_key=eq.${key}&deleted_at=is.null&select=document_id,document_key,module_key,payload,payload_hash,version,updated_at,updated_by&limit=1`;
    const rows = await fetchJson(`/atlas_app_documents${query}`);
    return Array.isArray(rows) ? (rows[0] || null) : null;
  }

  async function saveDocument(options = {}) {
    await refreshSession().catch(() => null);
    const config = getConfig();
    const documentKey = String(options.documentKey || config.documentKey).trim() || DEFAULT_CONFIG.documentKey;
    const payload = options.payload && typeof options.payload === "object" ? options.payload : {};
    const sourceHash = options.sourceHash || await computeSha256(payload);
    const args = {
      p_document_key: documentKey,
      p_module_key: String(options.moduleKey || "dashboard"),
      p_payload: payload,
      p_expected_version: Number.isInteger(options.expectedVersion) ? options.expectedVersion : null,
      p_source_module: String(options.sourceModule || "atlas"),
      p_source_hash: sourceHash,
      p_metadata: options.metadata && typeof options.metadata === "object" ? options.metadata : {}
    };
    return rpc("atlas_update_app_document", args);
  }

  async function readSharedPropertyGraph(documentKey = SHARED_PROPERTY_GRAPH_DOCUMENT_KEY) {
    return readDocument(documentKey);
  }

  async function saveSharedPropertyGraph(payload = {}, options = {}) {
    return saveDocument({
      documentKey: options.documentKey || SHARED_PROPERTY_GRAPH_DOCUMENT_KEY,
      moduleKey: options.moduleKey || "shared-data",
      payload,
      expectedVersion: options.expectedVersion,
      sourceModule: options.sourceModule || "atlas_shared_data",
      metadata: {
        sharedDataType: "property_graph",
        ...(options.metadata || {})
      }
    });
  }

  async function insertRows(table, rows, options = {}) {
    await refreshSession().catch(() => null);
    const payload = Array.isArray(rows) ? rows : [rows];
    const headers = options.returning === false ? {} : { prefer: "return=representation" };
    return fetchJson(`/${table}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  }

  async function readLiveSessions({ activeWithinSeconds = 180 } = {}) {
    await refreshSession().catch(() => null);
    const cutoff = new Date(Date.now() - (Math.max(30, Number(activeWithinSeconds) || 180) * 1000)).toISOString();
    const query = [
      `last_seen_at=gte.${encodeURIComponent(cutoff)}`,
      "select=session_id,user_id,email,display_name,profile_image_url,role,current_tab,current_page,current_community_id,current_community_name,signed_in_at,last_seen_at",
      "order=last_seen_at.desc"
    ].join("&");
    const rows = await fetchJson(`/atlas_live_sessions?${query}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function upsertLiveSession(details = {}) {
    return rpc("atlas_upsert_live_session", {
      p_session_id: String(details.sessionId || "").trim(),
      p_current_tab: String(details.currentTab || "").trim() || null,
      p_current_page: String(details.currentPage || "").trim() || null,
      p_current_community_id: details.currentCommunityId || null,
      p_current_community_name: String(details.currentCommunityName || "").trim() || null,
      p_user_agent: String(details.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "") || "").slice(0, 500)
    });
  }

  async function endLiveSession(sessionId = "") {
    return rpc("atlas_end_live_session", { p_session_id: String(sessionId || "").trim() });
  }

  async function readAccessInvites() {
    await refreshSession().catch(() => null);
    const query = "select=invite_id,email,employee_id,display_name,role,status,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,access_notes,claimed_user_id,claimed_at,updated_at&order=updated_at.desc";
    const rows = await fetchJson(`/atlas_user_access_invites?${query}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function readUserProfiles() {
    await refreshSession().catch(() => null);
    const query = "select=user_id,email,display_name,profile_image_url,role,status,employee_id,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,access_notes,last_access_reviewed_at,updated_at&order=display_name.asc";
    const rows = await fetchJson(`/atlas_user_profiles?${query}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function readCommunitiesForAccess() {
    await refreshSession().catch(() => null);
    const query = "deleted_at=is.null&status=eq.active&select=community_id,display_name,market,regional_grouping,property_type&order=display_name.asc";
    const rows = await fetchJson(`/atlas_communities?${query}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function readEmployeesForAccess() {
    await refreshSession().catch(() => null);
    const query = "deleted_at=is.null&select=employee_id,employee_number,email,full_name,status,status_type&order=full_name.asc";
    const rows = await fetchJson(`/atlas_employees?${query}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function adminUpsertUserAccess(access = {}) {
    return rpc("atlas_admin_upsert_user_access", {
      p_email: String(access.email || "").trim().toLowerCase(),
      p_display_name: String(access.displayName || access.display_name || "").trim(),
      p_role: String(access.role || "").trim(),
      p_status: String(access.status || "pending").trim(),
      p_employee_id: access.employeeId || access.employee_id || null,
      p_allowed_community_ids: Array.isArray(access.allowedCommunityIds) ? access.allowedCommunityIds : [],
      p_allowed_market_values: Array.isArray(access.allowedMarketValues) ? access.allowedMarketValues : [],
      p_allowed_region_values: Array.isArray(access.allowedRegionValues) ? access.allowedRegionValues : [],
      p_locked_tab_ids: Array.isArray(access.lockedTabIds) ? access.lockedTabIds : [],
      p_locked_page_keys: Array.isArray(access.lockedPageKeys) ? access.lockedPageKeys : [],
      p_access_notes: String(access.accessNotes || access.access_notes || "").trim() || null
    });
  }

  function generateAtlasCentralUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, token => {
      const value = Math.floor(Math.random() * 16);
      const digit = token === "x" ? value : ((value & 0x3) | 0x8);
      return digit.toString(16);
    });
  }

  function getSignedInUserId() {
    const value = String(getSignedInUser()?.id || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
  }

  async function writeFallbackAuditLog({ action, entityTable, entityId, sourceModule, afterPayload, metadata }) {
    await insertRows("atlas_audit_log", {
      actor_user_id: getSignedInUserId(),
      action: String(action || "central_fallback_write"),
      entity_table: String(entityTable || "atlas_migration_runs"),
      entity_id: String(entityId || "direct"),
      source_module: String(sourceModule || "atlas_browser"),
      before_payload: null,
      after_payload: afterPayload && typeof afterPayload === "object" ? afterPayload : {},
      metadata: metadata && typeof metadata === "object" ? metadata : {}
    }, { returning: false }).catch(() => null);
  }

  async function uploadReadOnlySnapshotViaTables({ snapshot, hash, sourceModule, sourceKey, sourceLabel, sourceVersion, metadata, rpcError }) {
    const now = new Date().toISOString();
    const migrationRunId = generateAtlasCentralUuid();
    const snapshotId = generateAtlasCentralUuid();
    const reason = rpcError?.message || String(rpcError || "RPC write path was unavailable.");
    const versionKey = sourceVersion || now;
    const fallbackSourceKey = `${sourceKey || "atlas_central_migration_read_only_snapshot_v1"}:${versionKey}:${snapshotId.slice(0, 8)}`;
    const currentUserId = getSignedInUserId();

    await insertRows("atlas_migration_runs", {
      migration_run_id: migrationRunId,
      phase: String(metadata?.phase || "phase_3_central_runtime"),
      source_module: String(sourceModule || "atlas_browser"),
      status: "snapshot_captured",
      dry_run: true,
      started_by: currentUserId,
      started_at: now,
      pre_counts: metadata?.pre_counts || {},
      pre_totals: metadata?.pre_totals || {},
      post_counts: {},
      post_totals: {},
      reconciliation_status: "snapshot_only",
      exception_count: Number(metadata?.exception_count || 0),
      notes: `${String(metadata?.notes || "Read-only Atlas snapshot captured before central migration. No source rows were changed.")} RPC fallback used because the browser write call could not complete: ${reason}`.slice(0, 1800)
    }, { returning: false });

    await insertRows("atlas_legacy_snapshots", {
      snapshot_id: snapshotId,
      migration_run_id: migrationRunId,
      source_module: String(sourceModule || "atlas_browser"),
      source_key: fallbackSourceKey,
      source_label: sourceLabel || "Atlas browser read-only migration snapshot",
      source_version: sourceVersion || now,
      source_payload: snapshot,
      source_hash: hash,
      captured_by: currentUserId,
      captured_at: now,
      read_only_locked: true
    }, { returning: false });

    await writeFallbackAuditLog({
      action: "snapshot_upload_fallback",
      entityTable: "atlas_legacy_snapshots",
      entityId: snapshotId,
      sourceModule,
      afterPayload: { source_hash: hash, read_only_locked: true },
      metadata: { ...(metadata || {}), rpc_error: reason, fallback: "direct_table_insert" }
    });

    return {
      snapshot_id: snapshotId,
      migration_run_id: migrationRunId,
      source_hash: hash,
      captured_at: now,
      fallback: true,
      rpc_error: reason
    };
  }

  function summarizePeopleDryRunPayload(payload = {}) {
    const employees = Array.isArray(payload.employees) ? payload.employees : [];
    const communityKeys = new Set();
    const roleKeys = new Set();
    let assignmentCount = 0;

    employees.forEach(employee => {
      const assignments = Array.isArray(employee.assignments) ? employee.assignments : [];
      const employeeCommunity = String(employee.communityName || employee.community || employee.property || employee.propertyName || "").trim().toLowerCase();
      const employeeRole = String(employee.title || employee.role || employee.position || "").trim().toLowerCase();
      if (employeeCommunity) communityKeys.add(employeeCommunity);
      if (employeeRole) roleKeys.add(employeeRole);
      if (assignments.length) {
        assignmentCount += assignments.length;
        assignments.forEach(assignment => {
          const communityKey = String(assignment.communityId || assignment.communityName || assignment.community || assignment.property || "").trim().toLowerCase();
          const roleKey = String(assignment.roleId || assignment.title || assignment.role || assignment.bonusRoleType || "").trim().toLowerCase();
          if (communityKey) communityKeys.add(communityKey);
          if (roleKey) roleKeys.add(roleKey);
        });
      } else if (employeeCommunity || employeeRole) {
        assignmentCount += 1;
      }
    });

    return {
      employees: employees.length,
      communities: communityKeys.size,
      roles: roleKeys.size,
      assignments: assignmentCount,
      exceptions: Array.isArray(payload.validationIssues) ? payload.validationIssues.length : 0,
      dryRun: true,
      fallback: true
    };
  }

  async function recordPeopleDryRunViaTables(payload = {}, rpcError) {
    const now = new Date().toISOString();
    const migrationRunId = generateAtlasCentralUuid();
    const result = summarizePeopleDryRunPayload(payload);
    const reason = rpcError?.message || String(rpcError || "RPC write path was unavailable.");

    await insertRows("atlas_migration_runs", {
      migration_run_id: migrationRunId,
      phase: "people_directory",
      source_module: "people",
      status: "dry_run",
      dry_run: true,
      started_by: getSignedInUserId(),
      started_at: now,
      pre_counts: result,
      post_counts: result,
      pre_totals: {},
      post_totals: {},
      reconciliation_status: "dry_run_recorded",
      exception_count: result.exceptions,
      notes: `People dry run summary recorded by direct table fallback because the browser RPC write call could not complete: ${reason}`.slice(0, 1800)
    }, { returning: false });

    await writeFallbackAuditLog({
      action: "people_promotion_dry_run_fallback",
      entityTable: "atlas_employees",
      entityId: migrationRunId,
      sourceModule: "people",
      afterPayload: payload,
      metadata: { ...result, migrationRunId, rpc_error: reason, fallback: "direct_table_insert" }
    });

    return {
      ...result,
      migrationRunId,
      rpcError: reason
    };
  }

  async function uploadReadOnlySnapshot(snapshot, options = {}) {
    await refreshSession().catch(() => null);
    if (!snapshot || typeof snapshot !== "object") throw new Error("Snapshot payload is required.");
    const hash = await computeSha256(snapshot);
    const sourceModule = options.sourceModule || "atlas_browser";
    const sourceKey = snapshot.snapshotType || "atlas_central_migration_read_only_snapshot_v1";
    const sourceLabel = options.sourceLabel || "Atlas browser read-only migration snapshot";
    const sourceVersion = snapshot.generatedAt || "";
    const metadata = {
      phase: options.phase || "phase_3_central_runtime",
      pre_counts: snapshot.reconciliation?.recordCounts || {},
      pre_totals: {
        financialTotals: snapshot.reconciliation?.financialTotals || {},
        operatingTotals: snapshot.reconciliation?.operatingTotals || {},
        bonusData: snapshot.reconciliation?.bonusData || {}
      },
      exception_count: Array.isArray(snapshot.exceptions) ? snapshot.exceptions.length : 0,
      notes: "Read-only browser snapshot captured by Atlas central runtime. No mapped rows promoted.",
      browserHash: hash
    };
    let result;
    try {
      result = await rpc("atlas_upload_legacy_snapshot", {
        p_source_module: sourceModule,
        p_source_key: sourceKey,
        p_source_label: sourceLabel,
        p_source_version: sourceVersion,
        p_source_payload: snapshot,
        p_metadata: metadata
      });
    } catch (error) {
      result = await uploadReadOnlySnapshotViaTables({
        snapshot,
        hash,
        sourceModule,
        sourceKey,
        sourceLabel,
        sourceVersion,
        metadata,
        rpcError: error
      });
    }
    return {
      migrationRun: result?.migration_run_id ? { migration_run_id: result.migration_run_id } : null,
      snapshot: result?.snapshot_id ? { snapshot_id: result.snapshot_id } : null,
      sourceHash: result?.source_hash || hash,
      fallback: Boolean(result?.fallback),
      rpcError: result?.rpc_error || ""
    };
  }

  async function upsertPeopleDirectory(payload, options = {}) {
    const cleanPayload = payload && typeof payload === "object" ? payload : {};
    const dryRun = options.dryRun !== false;
    try {
      return await rpc("atlas_upsert_people_directory", {
        p_payload: cleanPayload,
        p_migration_run_id: options.migrationRunId || null,
        p_dry_run: dryRun
      });
    } catch (error) {
      if (!dryRun) throw error;
      return recordPeopleDryRunViaTables(cleanPayload, error);
    }
  }

  async function upsertMarketingMetrics(metrics, options = {}) {
    return rpc("atlas_upsert_marketing_metrics", {
      p_metrics: Array.isArray(metrics) ? metrics : [],
      p_dry_run: options.dryRun !== false
    });
  }

  async function upsertMaintenanceInspections(records, options = {}) {
    return rpc("atlas_upsert_maintenance_inspections", {
      p_records: Array.isArray(records) ? records : [],
      p_dry_run: options.dryRun !== false
    });
  }

  async function recordBonusCalculation(payload, options = {}) {
    const period = options.period && typeof options.period === "object" ? options.period : {};
    return rpc("atlas_record_bonus_calculation", {
      p_period_key: String(period.periodKey || payload?.periodKey || ""),
      p_year: Number(period.year || payload?.year || new Date().getFullYear()),
      p_quarter: String(period.quarter || payload?.quarter || "Q1"),
      p_start_date: String(period.start || payload?.periodStart || ""),
      p_end_date: String(period.end || payload?.periodEnd || ""),
      p_payload: payload && typeof payload === "object" ? payload : {},
      p_status: String(options.status || "draft")
    });
  }

  handleAuthRedirect();

  window.ATLAS_CENTRAL = {
    getConfig,
    saveLocalConfig,
    clearLocalConfig,
    getStatus,
    getSession,
    getStoredProfile,
    requireConfigured,
    fetchJson,
    rpc,
    sendMagicLink,
    authRedirectUrl,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    fetchUser,
    fetchProfile,
    claimFirstAdmin,
    claimInvitedProfile,
    updateCurrentProfile,
    computeSha256,
    readDocument,
    saveDocument,
    readSharedPropertyGraph,
    saveSharedPropertyGraph,
    insertRows,
    readLiveSessions,
    upsertLiveSession,
    endLiveSession,
    readAccessInvites,
    readUserProfiles,
    readCommunitiesForAccess,
    readEmployeesForAccess,
    adminUpsertUserAccess,
    uploadReadOnlySnapshot,
    upsertPeopleDirectory,
    upsertMarketingMetrics,
    upsertMaintenanceInspections,
    recordBonusCalculation
  };
})();
