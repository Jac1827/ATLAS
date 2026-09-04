/* Atlas central platform client.
   This file contains only browser-safe public configuration and runtime logic.
   Never place a Supabase service-role key or database password in this file. */
(function () {
  "use strict";

  const CONFIG_STORAGE_KEY = "atlas_central_runtime_config_v1";
  const SESSION_STORAGE_KEY = "atlas_central_auth_session_v1";
  const PROFILE_STORAGE_KEY = "atlas_central_profile_v1";
  const LAST_AUTH_EVENT_STORAGE_KEY = "atlas_central_last_auth_event_v1";
  const MAGIC_LINK_COOLDOWN_STORAGE_KEY = "atlas_central_magic_link_cooldowns_v1";
  const SHARED_PROPERTY_GRAPH_DOCUMENT_KEY = "atlas_shared_property_graph_v1";
  const DEFAULT_ACCESS_API_BASE_URL = "https://rise-performance-platform-site.jacquelyn-heflin.workers.dev";
  const authRequestPromises = new Map();
  let refreshSessionPromise = null;

  const DEFAULT_CONFIG = {
    enabled: true,
    provider: "supabase-postgres",
    appBaseUrl: "https://jac1827.github.io/ATLAS/portfolio-operations-dashboard/index.html",
    apiBaseUrl: "",
    accessApiBaseUrl: DEFAULT_ACCESS_API_BASE_URL,
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
    config.accessApiBaseUrl = trimTrailingSlash(config.accessApiBaseUrl || config.apiBaseUrl || DEFAULT_ACCESS_API_BASE_URL);
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

  function currentOriginApiBaseUrl() {
    const origin = String(window.location?.origin || "").trim();
    return origin && /^https?:\/\//i.test(origin) && !isLocalBrowserUrl(origin) ? origin : "";
  }

  function isGithubPagesBaseUrl(value) {
    try {
      const host = new URL(String(value || "").trim()).hostname.toLowerCase();
      return host === "github.io" || host.endsWith(".github.io");
    } catch {
      return false;
    }
  }

  function accessApiUrl(path) {
    const config = requireConfigured();
    let base = trimTrailingSlash(config.accessApiBaseUrl || currentOriginApiBaseUrl() || DEFAULT_ACCESS_API_BASE_URL);
    if (isGithubPagesBaseUrl(base)) base = DEFAULT_ACCESS_API_BASE_URL;
    if (!base) throw new Error("ATLAS invitation service is not available from this page.");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function baseHeaders(config = getConfig(), includeAuth = true, options = {}) {
    const includeSupabasePublicHeaders = options.supabasePublicHeaders !== false;
    const headers = {
      accept: "application/json",
      "content-type": "application/json"
    };
    if (includeSupabasePublicHeaders && config.supabaseAnonKey) {
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

  function createCentralError(message, meta = {}) {
    const error = new Error(String(message || "Central request failed."));
    Object.entries(meta || {}).forEach(([key, value]) => {
      error[key] = value;
    });
    return error;
  }

  function isMissingProvisioningColumnError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return [
      "access_status",
      "account_status",
      "auth_user_id",
      "invitation_sent_at",
      "invitation_expires_at",
      "invitation_accepted_at",
      "password_reset_sent_at",
      "last_invite_error",
      "bonus_permissions"
    ].some(column => message.includes(column))
      && (
        message.includes("column")
        || message.includes("schema cache")
        || message.includes("could not find")
        || message.includes("does not exist")
      );
  }

  function normalizeAtlasAuthErrorMessage(rawMessage, status = 0, context = {}) {
    const message = String(rawMessage || "").trim();
    const lower = message.toLowerCase();
    const email = String(context.email || "").trim().toLowerCase();
    const emailSuffix = email ? ` for ${email}` : "";
    if (!message) {
      if (status === 401 || status === 400) return "ATLAS could not sign you in with that email and password.";
      return "ATLAS could not finish that request.";
    }
    if (lower.includes("invalid login credentials")) return `ATLAS could not sign you in${emailSuffix}. Check your email and password, then try again.`;
    if (lower.includes("email not confirmed")) return `Confirm your ATLAS email${emailSuffix ? emailSuffix : ""} before signing in.`;
    if (lower.includes("user already registered")) return `An ATLAS account already exists${emailSuffix}. Use Sign In instead of Activate My Account.`;
    if (lower.includes("signup is disabled")) return "ATLAS account activation is not available from this screen right now. Use your invite flow or contact an ATLAS admin.";
    if (lower.includes("password should be at least")) return "Choose a stronger password with at least 8 characters.";
    if (lower.includes("this email domain is not approved")) return "Use your approved ATLAS work email address to continue.";
    if (lower.includes("no active atlas access invite was found")) return `ATLAS could not find an active invite${emailSuffix}. Ask an ATLAS admin to send a fresh activation invite.`;
    if (lower.includes("authentication is required") || lower.includes("jwt expired") || lower.includes("refresh token")) return "Your ATLAS session expired. Sign in again to continue.";
    if (lower.includes("rate-limiting repeated auth requests")) return "Too many ATLAS sign-in attempts were sent too quickly. Wait a moment, then try again.";
    return message;
  }

  function saveLastAuthEvent(event = null) {
    if (!event) {
      try { sessionStorage.removeItem(LAST_AUTH_EVENT_STORAGE_KEY); } catch {}
      return null;
    }
    const normalized = {
      type: String(event.type || "").trim(),
      email: String(event.email || "").trim().toLowerCase(),
      message: String(event.message || "").trim(),
      at: String(event.at || new Date().toISOString())
    };
    try { sessionStorage.setItem(LAST_AUTH_EVENT_STORAGE_KEY, JSON.stringify(normalized)); } catch {}
    return normalized;
  }

  function consumeLastAuthEvent() {
    try {
      const raw = sessionStorage.getItem(LAST_AUTH_EVENT_STORAGE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(LAST_AUTH_EVENT_STORAGE_KEY);
      const parsed = safeJsonParse(raw, null);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function getRetryAfterSeconds(response) {
    const headerValue = String(response?.headers?.get("retry-after") || "").trim();
    const numeric = Number(headerValue);
    if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
    const parsedDate = Date.parse(headerValue);
    if (Number.isFinite(parsedDate)) {
      return Math.max(1, Math.ceil((parsedDate - Date.now()) / 1000));
    }
    return 0;
  }

  function normalizeCooldownMap(raw = {}) {
    const source = raw && typeof raw === "object" ? raw : {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(source)
        .map(([email, expiresAt]) => [String(email || "").trim().toLowerCase(), Number(expiresAt) || 0])
        .filter(([email, expiresAt]) => email && expiresAt > now)
    );
  }

  function getMagicLinkCooldownMap() {
    return normalizeCooldownMap(readLocalStorageJson(MAGIC_LINK_COOLDOWN_STORAGE_KEY, {}));
  }

  function saveMagicLinkCooldownMap(map = {}) {
    const normalized = normalizeCooldownMap(map);
    writeLocalStorageJson(MAGIC_LINK_COOLDOWN_STORAGE_KEY, normalized);
    return normalized;
  }

  function getMagicLinkCooldownSeconds(email = "") {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) return 0;
    const expiresAt = Number(getMagicLinkCooldownMap()[cleanEmail]) || 0;
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  }

  function setMagicLinkCooldown(email = "", seconds = 60) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    if (!cleanEmail || !safeSeconds) return 0;
    const next = getMagicLinkCooldownMap();
    next[cleanEmail] = Date.now() + (safeSeconds * 1000);
    saveMagicLinkCooldownMap(next);
    return safeSeconds;
  }

  function runSingleAuthRequest(key, task) {
    const requestKey = String(key || "").trim();
    if (!requestKey) return task();
    const existing = authRequestPromises.get(requestKey);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(task)
      .finally(() => {
        authRequestPromises.delete(requestKey);
      });
    authRequestPromises.set(requestKey, promise);
    return promise;
  }

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...baseHeaders(getConfig(), options.auth !== false, options),
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
      const retryAfterSeconds = getRetryAfterSeconds(response);
      const fallback = response.status === 429
        ? `Central request failed with HTTP 429. Supabase is rate-limiting repeated auth requests${retryAfterSeconds ? ` for about ${retryAfterSeconds} seconds` : ""}.`
        : `Central request failed with HTTP ${response.status}`;
      throw createCentralError(errorFromPayload(payload, fallback), {
        status: Number(response.status) || 0,
        retryAfterSeconds
      });
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
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");
    return runSingleAuthRequest(`password:${cleanEmail}`, async () => {
      try {
        const payload = await request(authUrl("/token?grant_type=password"), {
          method: "POST",
          auth: false,
          body: JSON.stringify({ email: cleanEmail, password })
        });
        saveSession(payload);
        await fetchProfile().catch(() => null);
        saveLastAuthEvent({ type: "password_sign_in", email: cleanEmail });
        return payload;
      } catch (error) {
        throw createCentralError(normalizeAtlasAuthErrorMessage(error?.message, Number(error?.status) || 0, { email: cleanEmail, action: "sign_in" }), {
          status: Number(error?.status) || 0,
          retryAfterSeconds: Number(error?.retryAfterSeconds) || 0
        });
      }
    });
  }

  async function sendMagicLink(email, options = {}) {
    const config = requireConfigured();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!isEmailAllowed(cleanEmail, config)) throw new Error("This email domain is not approved for Atlas.");
    if (!cleanEmail) throw new Error("Email is required.");
    const existingCooldown = getMagicLinkCooldownSeconds(cleanEmail);
    if (existingCooldown > 0) {
      throw createCentralError(`Wait ${existingCooldown} seconds before requesting another ATLAS sign-in link for ${cleanEmail}.`, {
        status: 429,
        retryAfterSeconds: existingCooldown
      });
    }
    const createUser = Boolean(options.createUser || config.allowMagicLinkSignup);
    return runSingleAuthRequest(`magic-link:${cleanEmail}`, async () => {
      const redirectTo = authRedirectUrl(config);
      try {
        const payload = await request(authUrl(withRedirectTo("/otp", redirectTo)), {
          method: "POST",
          auth: false,
          body: JSON.stringify({
            email: cleanEmail,
            create_user: createUser,
            options: redirectTo ? { email_redirect_to: redirectTo } : {}
          })
        });
        setMagicLinkCooldown(cleanEmail, 60);
        return payload;
      } catch (error) {
        const retryAfterSeconds = Math.max(0, Number(error?.retryAfterSeconds) || 0);
        if (Number(error?.status) === 429) {
          setMagicLinkCooldown(cleanEmail, retryAfterSeconds || 60);
          throw createCentralError(
            `ATLAS sign-in links were requested too quickly for ${cleanEmail}. Wait ${retryAfterSeconds || 60} seconds before trying again, or use Create Account / Sign In with password if the account already exists.`,
            {
              status: 429,
              retryAfterSeconds: retryAfterSeconds || 60
            }
          );
        }
        throw createCentralError(normalizeAtlasAuthErrorMessage(error?.message, Number(error?.status) || 0, { email: cleanEmail, action: "magic_link" }), {
          status: Number(error?.status) || 0,
          retryAfterSeconds
        });
      }
    });
  }

  async function requestPasswordReset(email) {
    const config = requireConfigured();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!isEmailAllowed(cleanEmail, config)) throw new Error("This email domain is not approved for Atlas.");
    if (!cleanEmail) throw new Error("Email is required.");
    return runSingleAuthRequest(`password-reset:${cleanEmail}`, async () => {
      const redirectTo = authRedirectUrl(config);
      try {
        const payload = await request(authUrl(withRedirectTo("/recover", redirectTo)), {
          method: "POST",
          auth: false,
          body: JSON.stringify({
            email: cleanEmail,
            ...(redirectTo ? { redirect_to: redirectTo } : {})
          })
        });
        saveLastAuthEvent({ type: "password_reset_requested", email: cleanEmail });
        return payload;
      } catch (error) {
        throw createCentralError(normalizeAtlasAuthErrorMessage(error?.message, Number(error?.status) || 0, { email: cleanEmail, action: "password_reset" }), {
          status: Number(error?.status) || 0,
          retryAfterSeconds: Number(error?.retryAfterSeconds) || 0
        });
      }
    });
  }

  async function refreshSession() {
    const currentSession = getSession();
    if (!currentSession?.refresh_token) return currentSession;
    const expiresAt = Number(currentSession.expires_at || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expiresAt && expiresAt - nowSeconds > 90) return currentSession;
    if (refreshSessionPromise) return refreshSessionPromise;
    refreshSessionPromise = (async () => {
      const session = getSession();
      if (!session?.refresh_token) return session;
      const latestExpiresAt = Number(session.expires_at || 0);
      const latestNowSeconds = Math.floor(Date.now() / 1000);
      if (latestExpiresAt && latestExpiresAt - latestNowSeconds > 90) return session;
      try {
        const payload = await request(authUrl("/token?grant_type=refresh_token"), {
          method: "POST",
          auth: false,
          body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        return saveSession(payload);
      } catch (error) {
        if ([400, 401, 403].includes(Number(error?.status))) saveSession(null);
        throw error;
      }
    })().finally(() => {
      refreshSessionPromise = null;
    });
    return refreshSessionPromise;
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

  async function updatePassword(password) {
    await refreshSession().catch(() => null);
    const cleanPassword = String(password || "");
    if (cleanPassword.length < 8) throw new Error("Choose a stronger password with at least 8 characters.");
    try {
      const payload = await request(authUrl("/user"), {
        method: "PUT",
        body: JSON.stringify({ password: cleanPassword })
      });
      saveLastAuthEvent({ type: "password_updated", email: userEmail() });
      return payload;
    } catch (error) {
      throw createCentralError(normalizeAtlasAuthErrorMessage(error?.message, Number(error?.status) || 0, { email: userEmail(), action: "update_password" }), {
        status: Number(error?.status) || 0,
        retryAfterSeconds: Number(error?.retryAfterSeconds) || 0
      });
    }
  }

  async function completeInviteActivation(password, displayName = "") {
    await updatePassword(password);
    const profile = await claimInvitedProfile(displayName).catch(async (error) => {
      await fetchProfile().catch(() => null);
      throw error;
    });
    saveLastAuthEvent({ type: "invite_activation_completed", email: userEmail() });
    return profile;
  }

  async function sendAccessInvitation(access = {}, options = {}) {
    const email = String(access.email || "").trim().toLowerCase();
    if (!email) throw new Error("Email is required.");
    const payload = {
      ...access,
      email,
      action: String(options.action || access.action || "invite").trim(),
      appBaseUrl: authRedirectUrl()
    };
    return request(accessApiUrl("/api/atlas/access/invite"), {
      method: "POST",
      supabasePublicHeaders: false,
      body: JSON.stringify(payload)
    });
  }

  async function diagnoseAccessProvisioning(email = "") {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) throw new Error("Email is required.");
    return request(accessApiUrl(`/api/atlas/access/diagnose?email=${encodeURIComponent(cleanEmail)}`), {
      method: "GET",
      supabasePublicHeaders: false
    });
  }

  function handleAuthRedirect() {
    const hash = String(window.location?.hash || "");
    const search = String(window.location?.search || "");
    const params = hash ? new URLSearchParams(hash.replace(/^#/, "")) : new URLSearchParams(search.replace(/^\?/, ""));
    const errorMessage = params.get("error_description") || params.get("error") || "";
    if (errorMessage) {
      saveLastAuthEvent({
        type: "auth_error",
        email: params.get("email") || "",
        message: errorMessage
      });
      if (window.history?.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search.replace(/([?&])(error|error_description|error_code)=[^&]*/g, "").replace(/[?&]$/, ""));
      }
      return null;
    }
    if (!params.get("access_token")) return null;
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
    saveLastAuthEvent({
      type: params.get("type") || "redirect_sign_in",
      email: params.get("email") || ""
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
    const query = `?user_id=eq.${encodeURIComponent(userId)}&select=user_id,email,display_name,profile_image_url,role,status,employee_id,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,bonus_permissions,access_notes,last_access_reviewed_at,updated_at&limit=1`;
    let rows;
    try {
      rows = await fetchJson(`/atlas_user_profiles${query}`);
    } catch (error) {
      if (!isMissingProvisioningColumnError(error)) throw error;
      const fallbackQuery = `?user_id=eq.${encodeURIComponent(userId)}&select=user_id,email,display_name,profile_image_url,role,status,employee_id,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,access_notes,last_access_reviewed_at,updated_at&limit=1`;
      rows = await fetchJson(`/atlas_user_profiles${fallbackQuery}`);
      rows = (Array.isArray(rows) ? rows : []).map(row => ({ ...row, bonus_permissions: [] }));
    }
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
    if (!cleanEmail) throw new Error("Email is required.");
    if (!password || String(password).length < 8) throw new Error("Use a password with at least 8 characters.");
    return runSingleAuthRequest(`signup:${cleanEmail}`, async () => {
      try {
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
        saveLastAuthEvent({ type: "password_sign_up", email: cleanEmail });
        return payload;
      } catch (error) {
        throw createCentralError(normalizeAtlasAuthErrorMessage(error?.message, Number(error?.status) || 0, { email: cleanEmail, action: "sign_up" }), {
          status: Number(error?.status) || 0,
          retryAfterSeconds: Number(error?.retryAfterSeconds) || 0
        });
      }
    });
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

  async function readDashboardViews() {
    await refreshSession().catch(() => null);
    return rpc("atlas_read_dashboard_views", {});
  }

  async function saveDashboardView(view = {}) {
    const payload = view && typeof view === "object" ? view : {};
    return rpc("atlas_save_dashboard_view", {
      p_view_key: String(payload.viewKey || payload.view_key || "").trim(),
      p_view_name: String(payload.viewName || payload.view_name || "My Dashboard").trim(),
      p_is_default: Boolean(payload.isDefault || payload.is_default),
      p_role_template_key: String(payload.roleTemplateKey || payload.role_template_key || "").trim() || null,
      p_layout: payload.layout && typeof payload.layout === "object" ? payload.layout : {},
      p_widgets: Array.isArray(payload.widgets) ? payload.widgets : [],
      p_source: String(payload.source || "atlas_dashboard_builder").trim()
    });
  }

  async function deleteDashboardView(viewKey = "") {
    return rpc("atlas_delete_dashboard_view", {
      p_view_key: String(viewKey || "").trim()
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
    const query = "select=invite_id,email,employee_id,display_name,role,status,access_status,account_status,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,bonus_permissions,access_notes,auth_user_id,claimed_user_id,claimed_at,invitation_sent_at,invitation_expires_at,invitation_accepted_at,password_reset_sent_at,last_invite_error,updated_at&order=updated_at.desc";
    let rows;
    try {
      rows = await fetchJson(`/atlas_user_access_invites?${query}`);
    } catch (error) {
      if (!isMissingProvisioningColumnError(error)) throw error;
      const fallbackQuery = "select=invite_id,email,employee_id,display_name,role,status,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,access_notes,claimed_user_id,claimed_at,updated_at&order=updated_at.desc";
      rows = await fetchJson(`/atlas_user_access_invites?${fallbackQuery}`);
      rows = (Array.isArray(rows) ? rows : []).map(row => ({
        ...row,
        access_status: ["suspended", "disabled", "revoked"].includes(String(row.status || "").toLowerCase()) ? "disabled" : "active",
        account_status: row.claimed_at ? "active" : "not_invited",
        auth_user_id: row.claimed_user_id || null,
        invitation_sent_at: "",
        invitation_expires_at: "",
        invitation_accepted_at: row.claimed_at || "",
        password_reset_sent_at: "",
        last_invite_error: ""
      }));
    }
    return Array.isArray(rows) ? rows : [];
  }

  async function readUserProfiles() {
    await refreshSession().catch(() => null);
    const query = "select=user_id,email,display_name,profile_image_url,role,status,account_status,employee_id,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,bonus_permissions,access_notes,last_access_reviewed_at,updated_at&order=display_name.asc";
    let rows;
    try {
      rows = await fetchJson(`/atlas_user_profiles?${query}`);
    } catch (error) {
      if (!isMissingProvisioningColumnError(error)) throw error;
      const fallbackQuery = "select=user_id,email,display_name,profile_image_url,role,status,employee_id,allowed_community_ids,allowed_market_values,allowed_region_values,locked_tab_ids,locked_page_keys,access_notes,last_access_reviewed_at,updated_at&order=display_name.asc";
      rows = await fetchJson(`/atlas_user_profiles?${fallbackQuery}`);
      rows = (Array.isArray(rows) ? rows : []).map(row => ({
        ...row,
        account_status: "active"
      }));
    }
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
    const query = "deleted_at=is.null&select=employee_id,employee_number,email,full_name,status,status_type,source_module,source_identifier,updated_at&order=full_name.asc";
    const rows = await fetchJson(`/atlas_employees?${query}`);
    return Array.isArray(rows) ? rows : [];
  }

  async function adminUpsertUserAccess(access = {}) {
    const payload = {
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
      p_bonus_permissions: Array.isArray(access.bonusPermissions) ? access.bonusPermissions : [],
      p_access_notes: String(access.accessNotes || access.access_notes || "").trim() || null
    };
    try {
      return await rpc("atlas_admin_upsert_user_access", payload);
    } catch (error) {
      if (/p_bonus_permissions|bonus_permissions|schema cache|function/i.test(String(error?.message || error))) {
        delete payload.p_bonus_permissions;
        return rpc("atlas_admin_upsert_user_access", payload);
      }
      throw error;
    }
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

  async function publishDlrSnapshot(payload = {}) {
    return request(accessApiUrl("/api/atlas/dlr/snapshots"), {
      method: "POST",
      headers: baseHeaders(getConfig(), true, { supabasePublicHeaders: false }),
      body: JSON.stringify(payload && typeof payload === "object" ? payload : {})
    });
  }

  async function readDlrDeliveryStatus(options = {}) {
    const params = new URLSearchParams();
    if (options.communityName) params.set("communityName", String(options.communityName));
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return request(accessApiUrl(`/api/atlas/dlr/status${query ? `?${query}` : ""}`), {
      method: "GET",
      headers: baseHeaders(getConfig(), true, { supabasePublicHeaders: false })
    });
  }

  async function runDlrDeliveryProcessor(options = {}) {
    return request(accessApiUrl("/api/atlas/dlr/deliveries/run"), {
      method: "POST",
      headers: baseHeaders(getConfig(), true, { supabasePublicHeaders: false }),
      body: JSON.stringify({
        communityName: String(options.communityName || ""),
        force: Boolean(options.force),
        dryRun: Boolean(options.dryRun)
      })
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
    requestPasswordReset,
    getMagicLinkCooldownSeconds,
    consumeLastAuthEvent,
    authRedirectUrl,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    updatePassword,
    completeInviteActivation,
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
    readDashboardViews,
    saveDashboardView,
    deleteDashboardView,
    insertRows,
    readLiveSessions,
    upsertLiveSession,
    endLiveSession,
    readAccessInvites,
    readUserProfiles,
    readCommunitiesForAccess,
    readEmployeesForAccess,
    adminUpsertUserAccess,
    sendAccessInvitation,
    diagnoseAccessProvisioning,
    uploadReadOnlySnapshot,
    upsertPeopleDirectory,
    upsertMarketingMetrics,
    upsertMaintenanceInspections,
    recordBonusCalculation,
    publishDlrSnapshot,
    readDlrDeliveryStatus,
    runDlrDeliveryProcessor
  };
})();
