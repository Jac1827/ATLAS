#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateConfig, browserConfig} from './isolated-forecast-host/policy.mjs';
import {bootstrap} from './isolated-forecast-host/bootstrap.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const support = path.join(repository, 'tools/isolated-forecast-host');
const extensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.wasm']);
const serialize = value => JSON.stringify(value).replaceAll('<', '\\u003c');

export function configFromEnvironment(env) {
  return validateConfig({workerName: env.ATLAS_TEST_WORKER_NAME, appOrigin: env.ATLAS_TEST_APP_ORIGIN,
    apiOrigin: env.ATLAS_TEST_API_ORIGIN, supabaseUrl: env.ATLAS_TEST_SUPABASE_URL, supabasePublicKey: env.ATLAS_TEST_SUPABASE_PUBLIC_KEY});
}

export function prepareHtml(html, config) {
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('An HTML asset lacks a head; refusing to serve it without the test bootstrap');
  if (html.includes('data-atlas-isolated-test')) throw new Error('Refusing to inject the test bootstrap twice');
  const script = `<script data-atlas-isolated-test>(${bootstrap.toString()})(${serialize(config)},${serialize(browserConfig(config))});</script>`;
  return html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}\n${script}`)
    .replaceAll('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', '/portfolio-operations-dashboard/assets/xlsx.full.min.js');
}

export async function prepareTestHost({env = process.env, out, sourceDirectory = path.join(repository, 'docs')} = {}) {
  const config = configFromEnvironment(env);
  if (!out || !path.isAbsolute(out)) throw new Error('--out must be a new absolute directory outside the repository');
  const parent = await fs.realpath(path.dirname(out));
  const target = path.join(parent, path.basename(out));
  const repo = await fs.realpath(repository);
  if (target === repo || target.startsWith(repo + path.sep)) throw new Error('Test output must stay outside the repository');
  // No overwrite option: a bad path cannot erase an existing directory or prior test evidence.
  await fs.mkdir(target);
  let count = 0;
  async function copy(directory, relative = '') {
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) throw new Error('Symlinked assets are not allowed in isolated output');
      const name = path.join(relative, entry.name);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) { await copy(path.join(directory, entry.name), name); continue; }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
      const dest = path.join(target, 'assets', name);
      await fs.mkdir(path.dirname(dest), {recursive: true});
      const src = path.join(directory, entry.name);
      if (path.extname(entry.name).toLowerCase() === '.html') await fs.writeFile(dest, prepareHtml(await fs.readFile(src, 'utf8'), config));
      else await fs.copyFile(src, dest);
      count++;
    }
  }
  // Write deployable entry/config only after the asset copy finishes successfully.
  await copy(sourceDirectory);
  for (const name of ['policy.mjs', 'worker.mjs']) await fs.copyFile(path.join(support, name), path.join(target, name));
  await fs.writeFile(path.join(target, 'test-config.mjs'), `export default ${serialize(config)};\n`);
  await fs.writeFile(path.join(target, 'entry.mjs'), "import config from './test-config.mjs';\nimport {createWorker} from './worker.mjs';\nexport default createWorker(config);\n");
  const wrangler = {name: config.workerName, main: './entry.mjs', compatibility_date: '2026-09-24', workers_dev: true,
    preview_urls: false, assets: {directory: './assets', binding: 'ASSETS', run_worker_first: true, html_handling: 'none', not_found_handling: 'none'}};
  await fs.writeFile(path.join(target, 'wrangler.jsonc'), JSON.stringify(wrangler, null, 2) + '\n');
  await fs.writeFile(path.join(target, 'README.txt'), `ISOLATED FORECAST TEST\nProject: ${config.projectRef}\nApp: ${config.appOrigin}/portfolio-operations-dashboard/index.html\nAssets: ${count}\nNo secrets, email, schedules, shared storage or application-server endpoints are configured.\nCore Auth/REST calls go directly to the explicit test Supabase project.\nUse precreated password accounts. Configure test Auth redirects before using any auth email flow.\nDo not deploy the repository root wrangler.jsonc for this test.\nReview tools/isolated-forecast-host/README.md before explicit deployment.\n`);
  return {directory: target, workerName: config.workerName, projectRef: config.projectRef, assets: count};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Usage: node tools/prepare-forecast-test-host.mjs --out /absolute/new/directory (requires ATLAS_TEST_* environment values)');
    const result = await prepareTestHost({out: process.argv[3]});
    console.log(`Prepared ${result.assets} assets for ${result.workerName} in ${result.directory}. Nothing was deployed or migrated.`);
  } catch (error) {
    console.error(`Test host preparation stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
