const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
const context = vm.createContext({ console, Date, Map, Set });
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], context);
let admin = true;
let saves = 0;
let archive = null;
Object.assign(context, {
  DATA_IMPORT_REPORT_ORDER: ['box_score', 'market_survey'],
  dataImport2State: { exceptions: [], batches: [], reportRequirementOverrides: [] },
  dataImportGetHealthCommunityNames: () => ['Student Housing'],
  dataImportGetMatrixCommunityNames: () => ['Student Housing', 'Inactive'],
  dataImportIsActiveReportingCommunity: name => name !== 'Inactive',
  dataImportCommunitySupportsReport: () => true,
  dataImportGetReportDef: type => ({ label: type, dependencies: [] }),
  dataImportEffectiveFreshness: () => ({ days: 7 }),
  dataImportLatestArchiveFor: (_, type) => type === 'box_score' ? { batchId: 'verified' } : archive,
  dataImportAgeForArchive: source => source.age || 0,
  dataImportHasSavedFallbackData: () => false,
  dataImportBuildStatusDateLabel: () => '',
  atlasProfileCanManageSettings: () => admin,
  getAtlasAccessProfile: () => ({}),
  atlasCurrentUserDisplayName: () => 'Test Admin',
  persistDataImport2State: () => saves++,
  renderTab: () => {}
});
let health = context.dataImportBuildHealthModel();
assert.equal(health.healthScore, 50);
assert.equal(health.missingFeeds, 1);
assert.equal(health.cells.length, 2, 'Inactive feeds are excluded');
context.setDataImportReportNotRequired('Student Housing', 'market_survey', true);
health = context.dataImportBuildHealthModel();
assert.equal(health.healthScore, 100);
assert.equal(health.missingFeeds, 0);
assert.equal(health.cells.length, 1);
assert.equal(health.fullyCurrentCommunities, 1);
assert.equal(context.dataImportBuildRecommendations(health).length, 0);
assert.equal(context.dataImportGetRequirementOverride('student housing', 'market_survey').updatedBy, 'Test Admin');
assert.equal(context.serializeDataImport2State().reportRequirementOverrides.length, 1);
archive = { age: 30 };
context.dataImport2State.exceptions = [{ communityName: 'Student Housing', reportType: 'market_survey', type: 'conflict' }];
health = context.dataImportBuildHealthModel();
assert.equal(health.staleFeeds, 0);
assert.equal(health.conflicts, 0);
context.setDataImportReportNotRequired('Student Housing', 'market_survey', false);
assert.equal(context.dataImportBuildHealthModel().conflicts, 1, 'Restoring exposes existing issues');
context.dataImport2State.exceptions = [];
assert.equal(context.dataImportBuildHealthModel().staleFeeds, 1);
archive = null;
assert.equal(context.dataImportBuildHealthModel().missingFeeds, 1);
admin = false;
context.setDataImportReportNotRequired('Student Housing', 'market_survey', true);
assert.equal(saves, 2, 'Unauthorized changes do not persist');
admin = true;
context.setDataImportReportNotRequired('Inactive', 'market_survey', true);
context.setDataImportReportNotRequired('Student Housing', 'unknown', true);
assert.equal(saves, 2);
context.setDataImportReportNotRequired('Student Housing', 'market_survey', true);
context.setDataImportReportNotRequired('Student Housing', 'box_score', true);
health = context.dataImportBuildHealthModel();
assert.equal(health.cells.length, 0);
assert.equal(health.fullyCurrentCommunities, 0, 'No required feeds is not measured freshness');
assert.match(context.renderDataImportHero(health), />N\/A</);
assert.match(context.renderDataImportMatrix(health), /type="checkbox"/);
admin = false;
assert.match(context.renderDataImportMatrix(health), /disabled/);
Object.assign(context, {
  defaultDataImportMappingRules: () => [],
  defaultDataImportPropertyAliases: () => [],
  defaultDataImportSourceDefinitions: () => [],
  defaultDataImportFreshnessPolicies: () => ({})
});
const restored = context.normalizeDataImport2State(JSON.parse(JSON.stringify(context.serializeDataImport2State())));
assert.equal(restored.reportRequirementOverrides.length, 2);
assert(restored.reportRequirementOverrides.every(item => item.excluded && item.updatedBy === 'Test Admin'));
assert.equal(context.normalizeDataImport2State({ reportRequirementOverrides: [{ communityName: 'Student Housing', reportType: 'unknown', excluded: true }] }).reportRequirementOverrides.length, 0);
console.log('Feed requirement override tests passed');
