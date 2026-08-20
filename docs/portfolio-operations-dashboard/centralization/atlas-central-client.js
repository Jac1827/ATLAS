/* Atlas central platform client.
   This file contains only browser-safe public configuration and runtime logic.
   Never place a Supabase service-role key or database password in this file. */
(function () {
  "use strict";

  const CONFIG_STORAGE_KEY = "atlas_central_runtime_config_v1";
  const SESSION_STORAGE_KEY = "atlas_central_auth_session_v1";
  const PROFILE_STORAGE_KEY = "atlas_central_profile_v1";

  const DEFAULT_CONFIG = {
    enabled: false,
    provider: "supabase-postgres",
    appBaseUrl: "",
    apiBaseUrl: "",
    supabaseUrl: "",
    supabaseAnonKey: "",
    documentKey: "atlas_dashboard_state_v1",
    realtime: false,
    autosave: false,
    autoPullOnStartup: false,
    allowedEmailDomains: []
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
    config.enabled = Boolean(config.enabled);
    config.provider = String(config.provider || DEFAULT_CONFIG.provider).trim();
    config.appBaseUrl = trimTrailingSlash(config.appBaseUrl);
    config.apiBaseUrl = trimTrailingSlash(config.apiBaseUrl);
    config.supabaseUrl = trimTrailingSlash(config.supabaseUrl);
    config.supabaseAnonKey = String(config.supabaseAnonKey || "").trim();
    config.documentKey = String(config.documentKey || DEFAULT_CONFIG.documentKey).trim() || DEFAULT_CONFIG.documentKey;
    config.realtime = Boolean(config.realtime);
    config.autosave = Boolean(config.autosave);
    config.autoPullOnStartup = Boolean(config.autoPullOnStartup);
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
    const response = await fetch(url, {
      ...options,
      headers: {
        ...baseHeaders(getConfig(), options.auth !== false),
        ...(options.headers || {})
      }
    });
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

  async function sendMagicLink(email) {
    const config = requireConfigured();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!isEmailAllowed(cleanEmail, config)) throw new Error("This email domain is not approved for Atlas.");
    if (!cleanEmail) throw new Error("Email is required.");
    const redirectTo = window.location?.href?.split("#")[0] || config.appBaseUrl || undefined;
    return request(authUrl("/otp"), {
      method: "POST",
      auth: false,
      body: JSON.stringify({
        email: cleanEmail,
        create_user: false,
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
    const query = `?user_id=eq.${encodeURIComponent(userId)}&select=user_id,email,display_name,role,status,allowed_community_ids,updated_at&limit=1`;
    const rows = await fetchJson(`/atlas_user_profiles${query}`);
    const profile = Array.isArray(rows) ? rows[0] : null;
    saveProfile(profile || null);
    return profile || null;
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
    const result = await fetchJson("/rpc/atlas_update_app_document", {
      method: "POST",
      headers: { prefer: "params=single-object" },
      body: JSON.stringify(args)
    });
    return Array.isArray(result) ? result[0] : result;
  }

  async function insertRows(table, rows, options = {}) {
    await refreshSession().catch(() => null);
    const payload = Array.isArray(rows) ? rows : [rows];
    return fetchJson(`/${table}`, {
      method: "POST",
      headers: { prefer: options.returning === false ? "return=minimal" : "return=representation" },
      body: JSON.stringify(payload)
    });
  }

  async function uploadReadOnlySnapshot(snapshot, options = {}) {
    await refreshSession().catch(() => null);
    if (!snapshot || typeof snapshot !== "object") throw new Error("Snapshot payload is required.");
    const hash = await computeSha256(snapshot);
    const migrationRows = await insertRows("atlas_migration_runs", {
      phase: options.phase || "phase_3_central_runtime",
      source_module: options.sourceModule || "atlas_browser",
      status: "snapshot_captured",
      dry_run: true,
      pre_counts: snapshot.reconciliation?.recordCounts || {},
      pre_totals: {
        financialTotals: snapshot.reconciliation?.financialTotals || {},
        operatingTotals: snapshot.reconciliation?.operatingTotals || {},
        bonusData: snapshot.reconciliation?.bonusData || {}
      },
      reconciliation_status: "snapshot_only",
      exception_count: Array.isArray(snapshot.exceptions) ? snapshot.exceptions.length : 0,
      notes: "Read-only browser snapshot captured by Atlas central runtime. No mapped rows promoted."
    });
    const migrationRun = Array.isArray(migrationRows) ? migrationRows[0] : migrationRows;
    const snapshotRows = await insertRows("atlas_legacy_snapshots", {
      migration_run_id: migrationRun?.migration_run_id || null,
      source_module: options.sourceModule || "atlas_browser",
      source_key: snapshot.snapshotType || "atlas_central_migration_read_only_snapshot_v1",
      source_label: options.sourceLabel || "Atlas browser read-only migration snapshot",
      source_version: snapshot.generatedAt || "",
      source_payload: snapshot,
      source_hash: hash,
      read_only_locked: true
    });
    return {
      migrationRun,
      snapshot: Array.isArray(snapshotRows) ? snapshotRows[0] : snapshotRows,
      sourceHash: hash
    };
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
    sendMagicLink,
    signInWithPassword,
    signOut,
    fetchUser,
    fetchProfile,
    computeSha256,
    readDocument,
    saveDocument,
    insertRows,
    uploadReadOnlySnapshot
  };
})();
