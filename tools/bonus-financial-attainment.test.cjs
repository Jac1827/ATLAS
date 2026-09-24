const {readDashboardSource}=require('./dashboard-source.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = readDashboardSource(__dirname + '/../docs/portfolio-operations-dashboard/index.html');
const fn = name => html.match(new RegExp('^function ' + name + '\\([^]*?^\\}', 'm'))[0];

(async () => {
  const { bonusEvidence } = await import('../docs/portfolio-operations-dashboard/features/canonical-finance.mjs');
  const periods = ['2026-01', '2026-02', '2026-03'];
  const curve = [{ thresholdPct: 105, payoutPct: 100, label: 'Above goal' }, { thresholdPct: 100, payoutPct: 80, label: 'At goal' }, { thresholdPct: 95, payoutPct: 50, label: 'Below goal' }, { thresholdPct: 0, payoutPct: 0, label: 'Below threshold' }];
  let metric, evidence;
  const context = {
    atlasBonusResolvePlanForEmployee: () => ({ plan: { id: 'test-plan', targetBonusPercent: 0, metrics: [metric] } }),
    atlasBonusProration: () => ({ factor: 1 }),
    simpleHash: () => 'test',
    atlasBonusState: () => ({ overrides: [], approvalStatusByRowId: {} }),
    atlasBonusGetCommunityOperatingType: () => 'stabilized',
    communityCommandBonusGoalResult: () => null,
    atlasBonusFinancialEvidence: () => evidence,
    atlasBonusMetricPotential: () => 100
  };
  vm.createContext(context);
  ['atlasBonusMetricActual', 'atlasBonusPerformanceRatio', 'atlasBonusCurvePayoutPct', 'atlasBonusBuildRow'].forEach(name => vm.runInContext(fn(name), context));
  const check = (key, actuals, expectedVariance, expectedAttainment, expectedPayout) => {
    metric = { id: 'test-' + key, metricKey: key, name: key, goal: 100, goalLogic: '>=', favorable: key === 'expenses' ? 'lower' : 'higher', inputType: 'automatic', thresholdCurve: curve };
    const before = JSON.stringify(metric);
    const envelopes = periods.map((period, index) => {
      const budget = (index + 1) * 100;
      return { communityId: 'community', period, registryVersion: 'atlas-finance-v1', accountingBasis: 'accrual', currency: 'USD', actualCloseVersion: 'close-' + index, budgetVersion: 'budget', targetApprovalStatus: 'approved', [key]: { actual: actuals[index], budget }, effectiveBaseline: { communityId: 'community', period, status: 'available', sourceType: index ? 'approved_reforecast' : 'original_budget', versionId: index ? 'forecast' : 'budget', publicationId: index ? 'publication' : null, contentHash: 'hash-' + index, verified: true, approved: true, locked: true, lines: [{ accountCode: key === 'expenses' ? '6100' : '5120', amount: budget, nature: key === 'expenses' ? 'expense' : 'income', placement: 'above_noi' }] } };
    });
    evidence = bonusEvidence(envelopes, key, periods, { requireEffectiveBaseline: true });
    const row = context.atlasBonusBuildRow({ employeeId: 'employee', communityName: 'Community', bonusRole: 'Manager' }, { periodKey: '2026-Q1' });
    const result = row.metricResults[0];
    assert.equal(evidence.mathematicalVariance, expectedVariance);
    assert(Math.abs(evidence.attainment - expectedAttainment) < 1e-9);
    assert(Math.abs(result.achievementPct - expectedAttainment) < 1e-9, key + ' direction must be applied once');
    assert.equal(result.payoutPct, expectedPayout);
    assert.equal(row.proposedPayout, expectedPayout);
    assert.equal(result.financialEvidence.mathematicalVariance, expectedVariance);
    assert.equal(JSON.stringify(result.metric), before, 'Scoring must not mutate the retained canonical metric definition.');
    assert.equal(row.finalPayout, null);
    assert.equal(row.canonicalPayable, false);
    return result;
  };
  assert.equal(check('expenses', [90, 190, 280], -40, 106 + 2 / 3, 100).financialEvidence.favorability, 'favorable');
  assert.equal(check('expenses', [110, 210, 320], 40, 93 + 1 / 3, 0).financialEvidence.favorability, 'unfavorable');
  check('expenses', [100, 200, 300], 0, 100, 80);
  check('revenue', [110, 210, 320], 40, 106 + 2 / 3, 100);
  check('revenue', [90, 190, 280], -40, 93 + 1 / 3, 0);
  const raw = { goal: 100, favorable: 'lower', thresholdCurve: curve };
  assert(Math.abs(context.atlasBonusCurvePayoutPct(raw, 90).ratio - 100 / 90 * 100) < 1e-9, 'Raw lower-is-better metrics retain their configured policy.');
  assert.equal(context.atlasBonusCurvePayoutPct({ ...raw, favorable: 'higher' }, 90).ratio, 90);
  assert.equal(raw.favorable, 'lower');
  console.log('PASS lower/higher expense and revenue Bonus scoring use governed attainment once, retain raw signed variances and canonical metric definitions, preserve raw metric policies, and remain nonpayable proposals.');
})().catch(error => { console.error(error); process.exitCode = 1; });
