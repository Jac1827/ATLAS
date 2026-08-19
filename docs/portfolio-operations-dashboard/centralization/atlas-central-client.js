/* Atlas central platform client shim.
   This file is intentionally inert until a hosted build provides
   window.ATLAS_CENTRAL_CONFIG. Do not hardcode secrets here. */
(function () {
  "use strict";

  const DEFAULT_CONFIG = {
    enabled: false,
    provider: "supabase-postgres",
    appBaseUrl: "",
    apiBaseUrl: "",
    supabaseUrl: "",
    supabaseAnonKey: "",
    realtime: false
  };

  function normalizeConfig(input) {
    const raw = input && typeof input === "object" ? input : {};
    const config = { ...DEFAULT_CONFIG, ...raw };
    config.enabled = Boolean(config.enabled);
    config.provider = String(config.provider || DEFAULT_CONFIG.provider).trim();
    config.appBaseUrl = String(config.appBaseUrl || "").replace(/\/+$/, "");
    config.apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/+$/, "");
    config.supabaseUrl = String(config.supabaseUrl || "").replace(/\/+$/, "");
    config.supabaseAnonKey = String(config.supabaseAnonKey || "").trim();
    config.realtime = Boolean(config.realtime);
    return config;
  }

  function getConfig() {
    return normalizeConfig(window.ATLAS_CENTRAL_CONFIG);
  }

  function getStatus() {
    const config = getConfig();
    const hasDatabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
    const hasApiConfig = Boolean(config.apiBaseUrl);
    const configured = config.enabled && (hasDatabaseConfig || hasApiConfig);
    return {
      configured,
      mode: configured ? "centralized" : "legacy-migration",
      provider: config.provider,
      realtime: configured && config.realtime,
      message: configured
        ? "Central Atlas data source is configured for this hosted build."
        : "Central Atlas data source is not configured. Browser data is available only for migration snapshots, backup, and controlled import/export."
    };
  }

  function requireConfigured() {
    const status = getStatus();
    if (!status.configured) {
      throw new Error(status.message);
    }
    return getConfig();
  }

  async function fetchJson(path, options = {}) {
    const config = requireConfigured();
    const base = config.apiBaseUrl || config.appBaseUrl;
    if (!base) throw new Error("Central API base URL is not configured.");
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(options.headers || {})
      },
      credentials: "include"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Central request failed with HTTP ${response.status}`);
    }
    return payload;
  }

  window.ATLAS_CENTRAL = {
    getConfig,
    getStatus,
    requireConfigured,
    fetchJson
  };
})();
