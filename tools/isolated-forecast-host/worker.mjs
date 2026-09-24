import {APP_PATH, contentSecurityPolicy, validateConfig} from './policy.mjs';

export function createWorker(input) {
  // Validate again when the Worker starts; a modified/missing config fails closed.
  const config = validateConfig(input);
  const headers = {'content-security-policy': contentSecurityPolicy(config), 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-atlas-environment': 'isolated-forecast-test'};
  const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {...headers, 'content-type': 'application/json'}});
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.origin !== config.appOrigin) return json(421, {message: 'This test build is bound to its explicit test origin.'});
      if (url.pathname === '/__atlas_test_health') return json(200, {environment: 'isolated-forecast-test', projectRef: config.projectRef, appOrigin: config.appOrigin, apiOrigin: config.apiOrigin, serverIntegrations: false});
      if (url.pathname.startsWith('/api/') || url.pathname === '/api' || !['GET', 'HEAD'].includes(request.method))
        return json(503, {message: 'Server integrations are unavailable on the isolated Forecast test host. Use precreated password accounts; financial RPCs go directly to the test database.'});
      if (url.pathname === '/') return new Response(null, {status: 302, headers: {...headers, location: `${config.appOrigin}${APP_PATH}`}});
      const result = await env.ASSETS.fetch(request);
      const resultHeaders = new Headers(result.headers);
      for (const [key, value] of Object.entries(headers)) resultHeaders.set(key, value);
      const redirect = resultHeaders.get('location');
      if (redirect && new URL(redirect, request.url).origin !== config.appOrigin) return json(502, {message: 'External redirects are disabled on the isolated test host.'});
      return new Response(result.body, {status: result.status, statusText: result.statusText, headers: resultHeaders});
    }
  };
}
