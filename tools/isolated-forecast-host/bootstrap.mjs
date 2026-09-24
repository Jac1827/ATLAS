// Serialized into the first script in each staged HTML head; never changes production assets.
export function bootstrap(config, centralConfig) {
  'use strict';
  function stop(message) {
    // An exception alone would leave later application scripts running with production defaults.
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'";
    document.head.appendChild(meta);
    document.addEventListener('DOMContentLoaded', () => { document.body.textContent = message; }, {once: true});
    throw new Error(message);
  }
  if (location.origin !== config.appOrigin) stop('Isolated test configuration does not match this host.');
  const key = 'atlas_forecast_test_project_v1';
  try {
    const previous = localStorage.getItem(key);
    if (previous !== config.projectRef) {
      // Clear an old project's credentials once. Preserve valid login across iframe loads/reloads.
      for (const name of ['atlas_central_auth_session_v1', 'atlas_central_profile_v1', 'atlas_central_last_auth_event_v1', 'atlas_central_magic_link_cooldowns_v1']) localStorage.removeItem(name);
      localStorage.setItem(key, config.projectRef);
    }
    localStorage.setItem('atlas_central_runtime_config_v1', JSON.stringify(centralConfig));
  } catch { stop('Browser storage is unavailable. The isolated test app cannot start safely.'); }
  Object.defineProperty(window, 'ATLAS_CENTRAL_CONFIG', {value: Object.freeze(centralConfig), writable: false, configurable: false});
  window.ATLAS_ISOLATED_FORECAST_TEST = Object.freeze({projectRef: config.projectRef, serverIntegrations: false});
  const fetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    // Precreated password users only: do not trigger Supabase Auth email delivery from this host.
    if (url.origin === config.supabaseUrl && /^\/auth\/v1\/(?:otp|recover|signup|resend|invite|admin)(?:\/|$)/.test(url.pathname))
      return Promise.reject(new Error('Auth email and account provisioning are disabled on the isolated test host. Use a precreated password account.'));
    return fetch(input, options);
  };
  // Avoid following the unrelated legacy app's links into production from a test session.
  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== config.appOrigin) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    if (window !== window.top) return;
    const banner = document.createElement('div');
    banner.id = 'atlas-isolated-test-banner';
    banner.textContent = `ISOLATED FORECAST TEST · ${config.projectRef} · Synthetic data only · Email and shared sync unavailable`;
    banner.style.cssText = 'position:relative;z-index:2147483647;padding:8px 12px;background:#fff1b8;color:#332500;font:13px system-ui;text-align:center';
    document.body.prepend(banner);
  }, {once: true});
}
