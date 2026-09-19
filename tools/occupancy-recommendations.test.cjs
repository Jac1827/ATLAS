const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
const ctx = vm.createContext({ console, Date, MONTHS: Array(12).fill('Sep') });
for (const name of ['buildRecommendationsForRecord', 'getReportedOccupancyBaseUnits', 'getOccupancyBaseUnits', 'normalizeCorporateLeaseUnits']) {
  vm.runInContext(html.match(new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'))[0], ctx);
}
Object.assign(ctx, {
  normalizeSavedCommunityRecord: (_, r) => r,
  getPropertyByName: () => ({}), getResolvedTotalUnitsForRecord: (_, r) => r.total,
  getCorporateLeaseUnitsForRecord: () => 0,
  computeScheduleFromContext: () => [],
  getApplicationDecisionMetrics: () => ({ applications: 0 }),
  getRenewalSummaryForMonth: () => ({}), getLeadSourceTotal: () => 0,
  buildFunnelConversionMetrics: () => ({}), getExplicitLeaseSignedCount: () => 0,
  getRecordComparableSnapshotUnits: r => r.monthlyData[8].occupiedSnapshot,
  getRecordSavedBudgetOccPct: () => 95,
  getImportReadinessStatus: () => ({})
});
const r = {total:222, currentMonth:8, currentOccupied:184, monthlyData:Array.from({length:12},()=>({}))};
r.monthlyData[8] = {sourceTotalUnits:222, rentableUnits:220, occupiedSnapshot:184, metricProvenance:{occupiedSnapshot:{revisionKey:'audited'}}};
let recs = ctx.buildRecommendationsForRecord('Citrus Ridge', r);
assert(recs.some(x => x.body.includes('83.6% occupied')), 'Recommendations must use 184/220, not 184/222');
assert(!recs.some(x => x.title === 'Health Status Pending'), 'Audited occupancy is reportable without legacy DLR readiness');
r.monthlyData[8].occupiedSnapshot = 0;
assert(ctx.buildRecommendationsForRecord('Citrus Ridge', r).some(x => x.body.includes('0.0% occupied')));
r.monthlyData[8].occupiedSnapshot = null;
assert(!ctx.buildRecommendationsForRecord('Citrus Ridge', r).some(x => x.title === 'Occupancy is trailing budget'), 'Missing must not become zero');
console.log('PASS recommendations use rentable inventory, recognize audited occupancy, preserve zero and missing');
vm.runInContext(html.match(/^function escapeHtml\([^\n]*\) \{[\s\S]*?^\}/m)[0], ctx);
Object.assign(ctx, {communityName:'Ivy & "Elm"', monthIdx:8, year:2026, dlrCentralPublishBusy:false, dlrCentralRunBusy:false});
const actionNames = ['publishDlrSnapshotToCentral', 'refreshDlrCentralStatus', 'runDlrServerDeliveryQueue', 'draftDlrOutlookEmail', 'downloadDlrInvestorOverviewHtml', 'openDlrInvestorOverview'];
for (const action of actionNames) {
  const template = html.split('\n').find(line => line.includes('onclick="' + action + '(') && line.includes('JSON.stringify(communityName)'));
  assert(template, action + ' control exists');
  const rendered = vm.runInContext('`' + template + '`', ctx);
  const handler = rendered.match(/onclick="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let received;
  ctx[action] = arg => {received = typeof arg === 'string' ? arg : arg.communityName;};
  vm.runInContext(handler, ctx);
  assert.equal(received, ctx.communityName, action + ' receives the exact community through a valid HTML attribute');
}
console.log('PASS all six report controls preserve community identity and valid handlers');
vm.runInContext(html.match(/^function getDlrReportCommunityName\([^\n]*\) \{[\s\S]*?^\}/m)[0], ctx);
Object.assign(ctx, {getReportHubMonthIndex:()=>8, getReportableCommunityNames:()=>['Doro','Citrus Ridge'],
  resolveDlrReportCommunityName:n=>n, getProp:()=>({name:'Inactive community'}), getPrimaryReportCommunityName:()=> 'Doro'});
assert.equal(ctx.getDlrReportCommunityName(), 'Doro', 'Initial DLR preview must use a community represented by the selector');
ctx.getProp = () => ({name:'Citrus Ridge'});
assert.equal(ctx.getDlrReportCommunityName(), 'Citrus Ridge');
console.log('PASS initial report community matches selectable scope');
