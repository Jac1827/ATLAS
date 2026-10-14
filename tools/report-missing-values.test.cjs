const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const c = { console };
vm.createContext(c);
for (const match of source.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], c);
Object.assign(c, {
  normalizeDlrDeliverySettings: settings => settings,
  buildAtlasDlrDeepLink: () => 'https://example.test/report',
  getSummaryOccPct: summary => summary.occPct,
  getSummaryLeasedPct: summary => summary.leasedPct,
  getCurrentCalendarDayContext: () => ({ isCurrentCalendarMonth: true, dayOfMonth: 14, daysInMonth: 31 }),
  resolveExportBrandLogoSrc: () => 'https://example.test/logo.png',
  formatPresentationTimestamp: () => 'Test date',
  buildDlrOccupancyPositionChart: () => '',
  buildDlrRenewalHealthChart: () => '',
  renderDashboardDlrActivityMiniTable: () => ''
});
for (const missing of [null, undefined, '', ' ', NaN, Infinity, false]) {
  assert.equal(c.formatDlrSignedNumber(missing), 'N/A', `signed missing ${String(missing)}`);
  assert.equal(c.formatDlrTrendDelta(missing, 5), '');
  assert.equal(c.formatPortfolioReportValueWithTrend(missing, 'number', 5), '—');
  assert.equal(c.formatPortfolioTrendValue(5, missing), '');
  assert.equal(c.formatPortfolioProjectedTrendValue(missing, 5, 'count_pct', 9, 2026), '');
}
const report = {
  communityName: 'Synthetic Community', reportMonthLabel: 'October 2026', reportPeriodLabel: 'Test period',
  occupancyPct: 95, trendingOccupancyPct: null, forwardLook: [], pricing: {},
  notes: {tours:[],applications:[],highlights:[],wins:[]},
  trafficMetrics: { moveIns: 5, moveOuts: null, rolledGuestCards: 0, guestCards: 7 },
  applicationTrendRows: [{ windowKey: 'mtd', currentValue: null, previousValue: 5, deltaValue: -5 }],
  renewalSnapshot: { retentionRate: null, expirations: 5 }
};
const text = c.buildDlrEmailPlainTextBody(report);
const html = c.buildDlrEmailHtml(report, { emailCharts: ['application_trend'], emailContentMode: 'detailed_email' });
for (const output of [text, html]) {
  assert(output.includes('Comparison unavailable'));
  assert(!/projected to soften|trailing the prior|Net move-ins are positive|Renewal retention is/.test(output));
  assert(!output.includes('■ 0.0%'));
}
assert(text.includes('Net Move-Ins: N/A'));
assert(text.includes('MTD Activity: 0 leads'));
assert(html.includes('Net N/A'));
assert.match(c.buildDlrInvestorOverviewDocument(report), /Net Absorption<\/div>\s*<div[^>]*>N\/A<\/div>/);
const svg = c.buildDlrEmailSnapshotSvg(report);
assert(svg.includes('N/A approved · N/A denied'));
assert(svg.includes('N/A signed / 5 exp'));
assert(!svg.includes('undefined occupied units'));
for (const section of ['overview', 'traffic', 'leasing', 'budget', 'renewals', 'finances', 'marketing']) {
  const rows = c.buildPortfolioSectionMetrics(section, {});
  assert(rows.every(row => row.value === '—' || row.value === '— / —'), `${section} missing values: ${JSON.stringify(rows)}`);
}
assert.equal(c.buildPortfolioSectionMetrics('finances', {nerDelta: 0}).at(-1).value, '$0');
report.trafficMetrics.moveOuts = 5;
report.trendingOccupancyPct = 95;
report.applicationTrendRows[0] = {windowKey:'mtd',currentValue:0,previousValue:5,deltaValue:-5};
assert(c.buildDlrEmailPlainTextBody(report).includes('Net Move-Ins: 0'));
assert(c.buildDlrEmailHtml(report).includes('▼ -100.0%'));
assert.equal(c.formatDlrSignedNumber(2), '+2');
assert.equal(c.formatPortfolioReportValueWithTrend(0, 'number', 5), '0 · ▼100.0% MoM');
console.log('PASS missing values and verified zeros remain distinct in DLR HTML/text, summaries, portfolio sections, and trends');
