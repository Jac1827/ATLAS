const {readDashboardSource}=require('./dashboard-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const html = readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const jobs = [];
const ctx = vm.createContext({ console, performance, setTimeout: fn => { jobs.push(fn); return jobs.length; } });
ctx.window = ctx;
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], ctx);
let renders = 0;
let workspaceRenders = 0;
Object.assign(ctx, {
  atlasSharedRenderTimer: null, atlasSharedRenderNeedsWorkspace: false,
  atlasDashboardInitializationComplete: true,
  renderTab: () => renders++, runAtlasInitialRenderPass: () => workspaceRenders++,
  dataImportIsMetadataSheetName: name => name === 'Parameters'
});
ctx.scheduleAtlasSharedRender();
ctx.scheduleAtlasSharedRender(true);
ctx.scheduleAtlasSharedRender();
assert.equal(jobs.length, 1);
jobs.shift()();
assert.equal(workspaceRenders, 1);
assert.equal(renders, 0);
ctx.AtlasReplayWriteFence = {};
ctx.scheduleAtlasSharedRender(true);
assert.equal(jobs.length, 0, 'Active replay defers scheduling before workspace mutation');
delete ctx.AtlasReplayWriteFence;
ctx.scheduleAtlasSharedRender(true);
ctx.AtlasReplayGeneration = 1;
ctx.AtlasReplayWriteFence = {};
jobs.shift()();
assert.equal(workspaceRenders, 1, 'A queued callback cannot render during replay');
assert.equal(ctx.atlasSharedRenderNeedsWorkspace, false);
delete ctx.AtlasReplayWriteFence;
ctx.scheduleAtlasSharedRender(true);
ctx.AtlasReplayGeneration = 2;
jobs.shift()();
assert.equal(workspaceRenders, 1, 'A callback from before a completed replay cannot mutate the newer workspace');
ctx.scheduleAtlasSharedRender(true);
jobs.shift()();
assert.equal(workspaceRenders, 2, 'Fresh post-replay renders remain available');
assert.equal(ctx.dataImportIsBoxScoreSheet([['Current Rent'], ['1000']], 'Rent Roll'), false);
assert.equal(ctx.dataImportIsBoxScoreSheet([['Availability (As of 09/18/2026)']], 'Anthem'), true);
assert.equal(ctx.dataImportIsBoxScoreSheet([['Lead Conversions']], 'Parameters'), false);
assert.equal(ctx.dataImportIsBoxScoreSheet(Array.from({ length: 10000 }, () => ['Expense', 100]), 'Budget'), false);

// The authenticated source/cache barrier and deferred reads are exercised against
// the complete application in workspace-startup-browser.test.mjs, including RLS access loss.
assert.match(html, /fetchProfile\(\{claim:false,signal:atlasWorkspaceAccess.controller.signal\}\)/);
assert.match(html, /requestAnimationFrame\(\(\)=>setTimeout\(async\(\)=>\{/);
assert.match(html, /Promise.allSettled/);
console.log('PASS scheduled render coalescing, replay fence/generation cancellation, parser candidate selection, authorization barrier and post-paint refresh wiring');
