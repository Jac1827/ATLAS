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
  headers.set("access-control-allow-headers", "content-type, authorization");
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
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}

function withCommonHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
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
