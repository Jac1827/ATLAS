#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function resolveBrowserClientPath() {
  const pluginRoots = [
    "/Users/jacheflin/.codex/plugins/cache/openai-bundled/browser",
    "/Users/jacheflin/.codex/plugins/cache/openai-bundled/browser-use",
  ];

  for (const pluginRoot of pluginRoots) {
    const versionDirs = fs.existsSync(pluginRoot)
      ? fs.readdirSync(pluginRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      : [];

    for (const version of versionDirs) {
      const candidate = path.join(pluginRoot, version, "scripts", "browser-client.mjs");
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

const browserClientPath = resolveBrowserClientPath();

const publishedPages = [
  {
    label: "performance platform",
    relativePath: "docs/index.html",
    markers: [
      "<title>RISE Performance Platform</title>",
      "Performance Platform",
      "Save To Cloud",
      "Pull From Cloud",
      "Copy Bundle",
    ],
  },
  {
    label: "operations dashboard",
    relativePath: "docs/portfolio-operations-dashboard/index.html",
    markers: [
      "<title>ATLAS RISE Ops Dashboard</title>",
      "ATLAS Portfolio Tracker Reports for RISE logo",
      "Portfolio Home",
      "Community Setup",
      "Data Import",
    ],
  },
  {
    label: "financial accountability",
    relativePath: "docs/portfolio-operations-dashboard/financial-accountability.html",
    markers: [
      "<title>ATLAS RISE Financial Accountability</title>",
      "ATLAS RISE Financial Accountability",
      "Back To ATLAS",
      "Upload Financial Data",
    ],
  },
];

const sourceParityPairs = [
  {
    label: "operations dashboard",
    sourcePath: "rise_leasing_dashboard-5-12.html",
    publishedPath: "docs/portfolio-operations-dashboard/index.html",
  },
  {
    label: "financial accountability",
    sourcePath: "financial-accountability.html",
    publishedPath: "docs/portfolio-operations-dashboard/financial-accountability.html",
  },
  {
    label: "performance platform",
    sourcePath: "index.html",
    publishedPath: "docs/index.html",
  },
];

function fail(message) {
  throw new Error(message);
}

function readUtf8(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function requireIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    fail(`${label} is missing expected marker: ${needle}`);
  }
}

function summarizeFirstDiff(label, sourcePath, publishedPath, sourceText, publishedText) {
  const sourceLines = sourceText.split(/\r?\n/);
  const publishedLines = publishedText.split(/\r?\n/);
  const max = Math.max(sourceLines.length, publishedLines.length);
  for (let index = 0; index < max; index += 1) {
    const sourceLine = sourceLines[index];
    const publishedLine = publishedLines[index];
    if (sourceLine !== publishedLine) {
      const lineNumber = index + 1;
      return [
        `Source/doc drift detected for ${label}`,
        `  source: ${sourcePath}`,
        `  published: ${publishedPath}`,
        `  first differing line: ${lineNumber}`,
        `  source    : ${sourceLine ?? "<missing>"}`,
        `  published : ${publishedLine ?? "<missing>"}`,
      ].join("\n");
    }
  }
  return `Source/doc drift detected for ${label}`;
}

function validateRelativeRefs(relativePath, html) {
  const attrRe = /(?:href|src)=(["'])(.*?)\1/g;
  const pageDir = path.dirname(path.join(repoRoot, relativePath));
  for (const match of html.matchAll(attrRe)) {
    const ref = match[2];
    if (
      !ref ||
      ref.includes("${") ||
      ref.startsWith("http:") ||
      ref.startsWith("https:") ||
      ref.startsWith("data:") ||
      ref.startsWith("mailto:") ||
      ref.startsWith("#") ||
      ref.startsWith("javascript:")
    ) {
      continue;
    }
    const target = path.resolve(pageDir, ref.split("?")[0].split("#")[0]);
    if (!fs.existsSync(target)) {
      fail(`${relativePath} points to a missing asset: ${ref}`);
    }
  }
}

function runStaticChecks() {
  for (const pair of sourceParityPairs) {
    const sourceFullPath = path.join(repoRoot, pair.sourcePath);
    const publishedFullPath = path.join(repoRoot, pair.publishedPath);
    const source = fs.readFileSync(sourceFullPath);
    const published = fs.readFileSync(publishedFullPath);
    if (!source.equals(published)) {
      const sourceText = source.toString("utf8");
      const publishedText = published.toString("utf8");
      fail(summarizeFirstDiff(pair.label, pair.sourcePath, pair.publishedPath, sourceText, publishedText));
    }
  }

  for (const page of publishedPages) {
    const fullPath = path.join(repoRoot, page.relativePath);
    if (!fs.existsSync(fullPath)) {
      fail(`Missing published page: ${page.relativePath}`);
    }
    const html = readUtf8(page.relativePath);
    page.markers.forEach((marker) => requireIncludes(html, marker, page.relativePath));
    validateRelativeRefs(page.relativePath, html);
  }
}

async function tryRunBrowserChecks() {
  if (!browserClientPath) {
    return {
      mode: "static-only",
      reason: "browser-client.mjs was not found in the installed browser-use plugin cache",
    };
  }

  try {
    const browserClient = await import(browserClientPath);
    const setupRuntime = browserClient.setupAtlasRuntime || browserClient.setupBrowserRuntime;
    if (typeof setupRuntime !== "function") {
      return {
        mode: "static-only",
        reason: "browser-client.mjs does not export a supported setup runtime function",
      };
    }
    await setupRuntime({ globals: globalThis, backend: "iab" });
    await agent.browser.nameSession("🔎 daily glitch review smoke");
  } catch (error) {
    return {
      mode: "static-only",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const pageUrls = {
    performance: pathToFileURL(path.join(repoRoot, "docs/index.html")).href,
    operations: pathToFileURL(path.join(repoRoot, "docs/portfolio-operations-dashboard/index.html")).href,
    financial: pathToFileURL(path.join(repoRoot, "docs/portfolio-operations-dashboard/financial-accountability.html")).href,
  };

  async function requireVisible(locator, label) {
    if (!(await locator.isVisible())) {
      fail(`${label} was not visible`);
    }
  }

  async function requireCountAtLeast(locator, label, minimum) {
    const count = await locator.count();
    if (count < minimum) {
      fail(`${label} count was ${count}, expected at least ${minimum}`);
    }
  }

  async function requireNoConsoleErrors(tab, label) {
    const errors = await tab.dev.logs({ levels: ["error"], limit: 50 });
    if (errors.length > 0) {
      const lines = errors.map((entry) => `[${entry.level}] ${entry.message}`).join("\n");
      fail(`${label} emitted console errors:\n${lines}`);
    }
  }

  async function verifyPerformancePage(tab) {
    await tab.goto(pageUrls.performance);
    await tab.playwright.waitForLoadState({ state: "load", timeoutMs: 15000 });
    await requireNoConsoleErrors(tab, "docs/index.html");
    await requireVisible(tab.playwright.getByText("Performance Platform", { exact: false }), "Performance Platform title");
    await requireVisible(tab.playwright.getByText("Secure coaching, PIP, and roster management", { exact: false }), "performance subtitle");
  }

  async function verifyOperationsPage(tab) {
    await tab.goto(pageUrls.operations);
    await tab.playwright.waitForLoadState({ state: "load", timeoutMs: 15000 });
    await requireNoConsoleErrors(tab, "docs/portfolio-operations-dashboard/index.html");
    await requireVisible(tab.playwright.locator('img[src*="atlas-rise-logo"]'), "ATLAS logo");
    await requireVisible(tab.playwright.locator('img[src*="atlas-rise-tagline"]'), "tagline image");
    await requireVisible(tab.playwright.getByRole("button", { name: "Save Data" }), "Save Data button");
    await requireVisible(tab.playwright.getByRole("button", { name: "Portfolio Home" }), "Portfolio Home tab");
    await requireVisible(tab.playwright.getByRole("button", { name: "Community Setup" }), "Community Setup tab");
    await requireVisible(tab.playwright.getByRole("button", { name: "Data Import" }), "Data Import tab");
    await requireCountAtLeast(tab.playwright.locator("button.tab"), "operations workspace tabs", 8);
  }

  async function verifyFinancialPage(tab) {
    await tab.goto(pageUrls.financial);
    await tab.playwright.waitForLoadState({ state: "load", timeoutMs: 15000 });
    await requireNoConsoleErrors(tab, "docs/portfolio-operations-dashboard/financial-accountability.html");
    await requireVisible(tab.playwright.getByText("ATLAS RISE Financial Accountability", { exact: false }), "financial page header");
    await requireVisible(tab.playwright.getByRole("button", { name: "Back To ATLAS" }), "Back To ATLAS button");
  }

  const performanceTab = await agent.browser.tabs.new();
  await verifyPerformancePage(performanceTab);

  const operationsTab = await agent.browser.tabs.new();
  await verifyOperationsPage(operationsTab);

  const financialTab = await agent.browser.tabs.new();
  await verifyFinancialPage(financialTab);

  return { mode: "browser+static" };
}

async function main() {
  runStaticChecks();
  const browserResult = await tryRunBrowserChecks();
  if (browserResult.mode === "static-only") {
    console.log(
      `Daily Glitch Review smoke passed static coverage for docs/index.html, docs/portfolio-operations-dashboard/index.html, and docs/portfolio-operations-dashboard/financial-accountability.html. Browser checks were skipped: ${browserResult.reason}`,
    );
    return;
  }
  console.log(
    "Daily Glitch Review smoke passed static and browser coverage for docs/index.html, docs/portfolio-operations-dashboard/index.html, and docs/portfolio-operations-dashboard/financial-accountability.html.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
