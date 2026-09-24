// This module is shared by the local preparer and the test-only Worker.
export const APP_PATH = '/portfolio-operations-dashboard/index.html';
export const PRODUCTION_REFS = ['rmyhmvjcswfwaracgriy', 'dgkedyzdhneiypqeimhd'];
const PRODUCTION_HOSTS = ['jac1827.github.io', 'rise-performance-platform-site.jacquelyn-heflin.workers.dev'];

function origin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an explicit HTTPS origin`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${label} must be an HTTPS origin without credentials, port, path, query or fragment`);
  if (PRODUCTION_HOSTS.includes(url.hostname) || PRODUCTION_REFS.some(ref => url.hostname.includes(ref)) || url.hostname.includes('rise-performance-platform-site'))
    throw new Error(`${label} cannot use a known production host`);
  return url;
}

export function validateConfig(input = {}) {
  const name = String(input.workerName || '');
  if (!/^atlas-forecast-test-[a-z0-9](?:[a-z0-9-]{0,35}[a-z0-9])?$/.test(name))
    throw new Error('ATLAS_TEST_WORKER_NAME must use the atlas-forecast-test- prefix and a unique lowercase suffix');
  const app = origin(input.appOrigin, 'ATLAS_TEST_APP_ORIGIN');
  if (!app.hostname.startsWith(`${name}.`) || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(app.hostname))
    throw new Error('ATLAS_TEST_APP_ORIGIN must be the matching dedicated Worker workers.dev origin');
  const api = origin(input.apiOrigin, 'ATLAS_TEST_API_ORIGIN');
  if (api.origin !== app.origin) throw new Error('ATLAS_TEST_API_ORIGIN must equal the isolated app origin; server integrations are disabled');
  const database = origin(input.supabaseUrl, 'ATLAS_TEST_SUPABASE_URL');
  const match = database.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (!match) throw new Error('ATLAS_TEST_SUPABASE_URL must use the isolated project or branch project-ref.supabase.co origin');
  const key = String(input.supabasePublicKey || '');
  if (/^sb_publishable_[a-zA-Z0-9_-]{20,}$/.test(key)) {
    // Opaque publishable keys cannot identify their project locally; the URL is authoritative.
  } else {
    let claims;
    try {
      const parts = key.split('.');
      if (parts.length !== 3) throw new Error();
      claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch { throw new Error('ATLAS_TEST_SUPABASE_PUBLIC_KEY must be a publishable key or a project-matching anon JWT'); }
    if (claims.role !== 'anon' || claims.ref !== match[1]) throw new Error('Only an anon JWT for the exact test project is permitted; secret/service-role keys are forbidden');
  }
  return Object.freeze({workerName: name, appOrigin: app.origin, apiOrigin: api.origin, supabaseUrl: database.origin, supabasePublicKey: key, projectRef: match[1]});
}

export function browserConfig(config) {
  return {
    enabled: true, provider: 'supabase-postgres', appBaseUrl: `${config.appOrigin}${APP_PATH}`,
    apiBaseUrl: '', accessApiBaseUrl: config.apiOrigin,
    supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabasePublicKey,
    documentKey: `atlas_forecast_test_${config.projectRef}`, applicationPublication: true,
    realtime: false, autosave: false, autoPullOnStartup: false, allowMagicLinkSignup: false,
    allowedEmailDomains: []
  };
}

export function contentSecurityPolicy(config) {
  // Forecast PDF parsing/export and XLSX all use repository-local libraries.
  return [
    "default-src 'self'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' data: https://fonts.gstatic.com https://unpkg.com",
    "img-src 'self' data: blob:", "media-src 'self' blob:",
    `connect-src 'self' ${config.supabaseUrl}`,
    "worker-src 'self' blob:", "frame-src 'self' blob:", "frame-ancestors 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'"
  ].join('; ');
}
