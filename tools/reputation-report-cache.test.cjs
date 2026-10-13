const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const reports = fs.readFileSync('docs/portfolio-operations-dashboard/features/reports-workspace.js', 'utf8');
const extract = (source, name) => source.match(new RegExp('^function ' + name + '\\([^]*?^\\}', 'm'))[0];
const c = { console, performance, DOMException };
c.window = c;
vm.createContext(c);
// Use the actual preview context, exact input serializer and retained-preview
// controller; only source/access reads and the expensive report body are stubs.
vm.runInContext(`
  const PROPERTIES = [{ name: 'One' }], savedData = { One: { currentMonth: 9 } };
  const dataImport2State = {}, atlasCommunityGoalStore = { actor: 'actor', scopes: new Map() };
  const photoAssetUrlCache = new Map(), portfolioMonthScopeByPeriod = {};
  const communityProgressViewMode = 'portfolio', bonusQuarter = 'Q4', regionalAssignments = {};
  const jacsTeamBonus = {}, communityCommandState = {}, atlasSharedData = {};
  const localStorage = { getItem: () => null };
  const activeTab = 8, reportHubType = 'community_progress', reportHubPerspective = 'portfolio';
  const portfolioReportFilters = {}, portfolioReportSections = ['reputation'];
  const reportHubCommunityProgressCommunities = ['One'], reportHubLvrCommunity = 'One';
  const atlasWorkspaceAccess = { epoch: 1, validated: true, hasData: true };
  const ATLAS_STATE_DB_NAME = 'db';
  let reportBuilds = 0, score = null;
  window.AtlasReputation = { revision: 'actor:1' };
  window.ATLAS_CENTRAL = { getSession: () => ({ user: { id: 'actor' } }), getConfig: () => ({ supabaseUrl: 'test' }), getAccessContextKey: () => 'actor|scope' };
  function getAtlasTodayISODate() { return '2026-10-13'; }
  function getProp() { return PROPERTIES[0]; }
  function getCommunityScopeMode() { return 'portfolio'; }
  function getReportHubYear() { return 2026; }
  function getReportHubMonthIndex() { return 9; }
  function getSelectedDashboardMonthIndex() { return 9; }
  function getAtlasRenderContextKey() { return 'actor|scope|8'; }
  function getAtlasCentralStatus() { return { configured: true }; }
  function shouldBlockAtlasSensitiveAccess() { return false; }
  function atlasAccessDecision() { return { ok: true }; }
  function getCommunityProgressReportCommunityNames() { return ['One']; }
  function getPersistedCommunityRecordForScope() { return savedData.One; }
  function buildCommunityProgressSingleReportData() { return { score }; }
  function renderCommunityProgressReportingWorkspace() { reportBuilds++; return 'ORA:' + String(score); }
`, c);
vm.runInContext(extract(core, 'atlasExactPresentationInputString') + '\n' +
  reports.slice(0, reports.indexOf('function atlasReportPortfolioDetails')) + '\n' +
  extract(reports, 'atlasReportPreviewContext') + '\nconst atlasReportRenderedMarkup = new WeakMap();', c);
const run = text => vm.runInContext(text, c);
const records = run('savedData'), originalRecords = JSON.stringify(records);
const firstContext = c.atlasReportPreviewContext(), firstInputs = c.atlasCommunityProgressPreviewInputs();
assert.equal(typeof firstInputs, 'string', 'Exercise the actual cacheable exact inputs');
assert.equal(c.renderCommunityProgressReportingWorkspace(), 'ORA:null');
assert.equal(c.renderCommunityProgressReportingWorkspace(), 'ORA:null');
assert.equal(run('reportBuilds'), 1, 'Identical reputation revision reuses the retained preview');

run("score = 0; AtlasReputation.revision = 'actor:2'");
assert.equal(run('savedData'), records);
assert.equal(JSON.stringify(records), originalRecords, 'Canonical reputation save does not mutate imported records');
assert.notEqual(c.atlasReportPreviewContext(), firstContext);
assert.notEqual(c.atlasCommunityProgressPreviewInputs(), firstInputs);
assert.equal(c.renderCommunityProgressReportingWorkspace(), 'ORA:0');
assert.equal(c.renderCommunityProgressReportingWorkspace(), 'ORA:0');
assert.equal(run('reportBuilds'), 2, 'New revision rebuilds once and retains the measured zero');

run("score = 82; AtlasReputation.revision = 'actor:3'; atlasReportVisibleRender = true");
const placeholder = c.renderCommunityProgressReportingWorkspace();
assert(placeholder.includes('data-atlas-report-placeholder'));
const request = run('atlasReportPreparation');
assert.equal(c.atlasReportPreparationCurrent(request), true);
assert.equal(request.children[0].score, 82);
run("score = null; AtlasReputation.revision = 'actor:4'");
assert.equal(c.atlasReportPreparationCurrent(request), false, 'A mid-preparation save invalidates the old score snapshot');
c.renderCommunityProgressReportingWorkspace();
assert.equal(request.cancelled, true);
const replacement = run('atlasReportPreparation');
assert.notEqual(replacement, request);
assert.equal(replacement.children[0].score, null, 'The replacement preparation reads the new unavailable value');
assert.equal(c.atlasReportPreparationCurrent(replacement), true);
assert.equal(JSON.stringify(records), originalRecords);
console.log('PASS reputation report cache: exact revision invalidation without savedData mutation, stable-revision reuse, zero/null preservation and stale staged-request replacement.');
