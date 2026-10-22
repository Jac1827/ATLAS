const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const root = 'docs/portfolio-operations-dashboard/';
const core = fs.readFileSync(root + 'workspace-core.js', 'utf8');
const reports = fs.readFileSync(root + 'features/reports-workspace.js', 'utf8');
const presentation = fs.readFileSync(root + 'features/presentation-slides.mjs', 'utf8');
const extract = (source, name) => source.match(new RegExp('^function ' + name + '\\([^]*?^\\}', 'm'))[0];

function fixture() {
  const htmlCharts = [], pptxCharts = [], slides = [];
  const c = {
    console, Map, Number, currentMonth: 9,
    RISE_PRESENTATION_BRAND: { blue: '#123456', cyan: '#234567', mint: '#345678', sky: '#456789' },
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    getSummaryOccPct: () => 0,
    getSummaryLeasedPct: () => 0,
    getCommunityPerformancePlan: () => ({}),
    formatPortfolioTrendValue: () => 'No prior period',
    formatSignedDisplay: value => String(value ?? 0),
    getDashboardMonthLabel: () => 'October',
    getInvestorPortfolioName: () => 'Portfolio',
    getMonthlyPresentationCurrentEntry: () => ({}),
    buildRegionalPricingWorksheetSnapshot: () => ({}),
    getCompCalculatorScopeMeta: () => ({}),
    getRegionalPricingActionLabel: () => 'Hold',
    formatPresentationCurrencyValue: () => '—',
    formatPresentationPercentValue: () => '—',
    getDetailPresentationPhoto: () => '',
    getDetailPhotoBank: () => [],
    getPresentationCommunityStaffForDetail: () => [],
    buildInvestorPropertyPacketHighlights: () => [],
    buildPresentationTeamPanel: () => '',
    buildCommunityMarketSurveyCharts: () => '',
    buildCommunitySpotlightPricingPanel: () => '',
    buildMonthlyInvestorPresentationMetricCards: () => [],
    buildMonthlyInvestorPresentationNarrative: () => [],
    buildMonthlyInvestorPresentationOpportunities: () => [],
    buildMonthlyInvestorPresentationAgenda: () => [],
    buildMonthlyInvestorPresentationCoverSlide: () => '',
    buildMonthlyInvestorPresentationContentsSlide: () => '',
    buildMonthlyPresentationCommunitySnapshotSlide: () => '',
    renderMonthlyInvestorPresentationSlide: (_report, title, _ribbon, html) => `<section data-title="${title}">${html}</section>`,
    getMonthlyInvestorPresentationPrimaryPhotoAsset: () => null,
    getPhotoAssetDataForPptx: async () => null,
    addPptxDeckShell: async (slide, _pptx, _report, config) => { slide.title = config.title; },
    addPptxMemberStrip: async () => {},
    addPptxPanel: () => {},
    addPptxBulletPanel: () => {},
    addPptxTextPanel: () => {},
    addPptxMetricGrid: (slide, _pptx, cards) => { slide.cards.push(...cards); },
    getPptxColorHex: color => color.replace('#', ''),
    getPptxShapeType: (_pptx, type) => type
  };
  vm.createContext(c);
  vm.runInContext([
    extract(core, 'atlasReputationDisplay'),
    extract(core, 'monthlyOccupancyBudgetAvailable'),
    extract(core, 'monthlyOccupancyBudgetNote'),
    extract(core, 'monthlyOccupancyBudgetCoverageNote'),
    extract(core, 'formatMonthlyOccupancyBudgetAttainment'),
    extract(core, 'buildDeckHorizontalCompareChart'),
    extract(core, 'addPptxBarPanel'),
    extract(reports, 'buildMonthlyPresentationCommunitySpotlightSlide'),
    extract(reports, 'buildMonthlyInvestorPresentationSlides'),
    presentation.replace('export default async function', 'async function')
  ].join('\n'), c);
  const htmlChart = c.buildDeckHorizontalCompareChart;
  c.buildDeckHorizontalCompareChart = (title, items, options) => {
    const html = htmlChart(title, items, options);
    htmlCharts.push({ title, items, options, html });
    return html;
  };
  const pptxChart = c.addPptxBarPanel;
  c.addPptxBarPanel = (slide, pptx, config) => {
    const drawing = { texts: [], shapes: [], addText(text) { this.texts.push(text); }, addShape(type, props) { this.shapes.push({ type, ...props }); } };
    pptxChart(drawing, pptx, config);
    pptxCharts.push({ ...config, drawing });
  };
  const pptx = { addSlide() {
    const slide = { cards: [], texts: [], addText(text) { this.texts.push(text); }, addImage() {} };
    slides.push(slide);
    return slide;
  } };
  return { c, htmlCharts, pptxCharts, slides, pptx };
}

const report = aggregate => ({
  title: 'Monthly reputation export test', subtitle: 'Selected communities', currentMonthLabel: 'October 2026', currentMonthIdx: 9,
  selectedSections: ['reputation'], photoPool: [], investorGroups: ['Portfolio'], regionalStaff: [],
  aggregate: { totalUnits: 300, ...aggregate, googleQuarterlyRating: 4.99, googleLifetimeRating: 4.88 },
  details: [
    { name: 'Missing score', oraScore: null, googleReviewScore: null },
    { name: 'Measured zero', oraScore: 0, googleReviewScore: 0 },
    { name: 'Recorded score', oraScore: 85, googleReviewScore: 4.25 }
  ].map(({ name, ...summary }) => ({ name, summary: { ...summary, googleQuarterlyRating: 4.99, googleLifetimeRating: 4.88 }, record: { currentMonth: 9 }, recommendations: [] }))
});

(async () => {
  for (const aggregate of [{ oraScore: 0, googleReviewScore: 0 }, { oraScore: null, googleReviewScore: null }]) {
    const f = fixture(), data = report(aggregate);
    const html = f.c.buildMonthlyInvestorPresentationSlides(data);
    await f.c.buildMonthlyInvestorPresentationPptxSlides(f.pptx, data);
    const expectedOra = aggregate.oraScore === null ? '—' : '0.0';
    const expectedGoogle = aggregate.googleReviewScore === null ? '—' : '0.00';
    assert(html.includes(`deck-metric-label">ORA</div><div class="deck-metric-value">${expectedOra}</div>`));
    assert(html.includes(`deck-metric-label">Google Review Score</div><div class="deck-metric-value">${expectedGoogle}</div>`));
    const cards = f.slides.find(slide => slide.title === 'Renewals, Retention & Resident Experience').cards;
    assert.equal(cards.find(card => card.label === 'ORA').value, expectedOra);
    assert.equal(cards.find(card => card.label === 'Google Review Score').value, expectedGoogle);
    for (const [name, expected] of [['Missing score', '—'], ['Measured zero', '0.0'], ['Recorded score', '85.0']]) {
      const detail = data.details.find(row => row.name === name);
      assert(f.c.buildMonthlyPresentationCommunitySpotlightSlide(data, detail).includes(`<strong>${expected}</strong><span>ORA average</span>`));
      assert.equal(f.slides.find(slide => slide.title === name).cards.find(card => card.label === 'ORA average').value, expected);
    }
    const htmlChart = f.htmlCharts.find(chart => chart.title.startsWith('ORA by Community'));
    const pptxChart = f.pptxCharts.find(chart => chart.title.startsWith('ORA by Community'));
    for (const chart of [htmlChart, pptxChart]) {
      assert.equal(chart.options?.preserveMissing ?? chart.preserveMissing, true);
      assert.deepEqual(Array.from(chart.items, item => item.value), [null, 0, 85]);
      assert.deepEqual(Array.from(chart.items, item => item.note), ['Google Review Score —', 'Google Review Score 0.00', 'Google Review Score 4.25']);
    }
    assert.equal((htmlChart.html.match(/class="deck-chart-row"/g) || []).length, 3, 'Keep every community label and its gap');
    assert(htmlChart.html.includes('— · Goal 62'));
    assert(htmlChart.html.includes('0.0 · Goal 62'));
    assert(htmlChart.html.includes('85.0 · Goal 62'));
    assert.equal((htmlChart.html.match(/class="deck-chart-bar"/g) || []).length, 1, 'Only a measured positive score has a filled bar');
    assert(pptxChart.drawing.texts.includes('— · Goal 62'));
    assert(pptxChart.drawing.texts.includes('0.0 · Goal 62'));
    assert(pptxChart.drawing.texts.includes('85.0 · Goal 62'));
    assert.equal(pptxChart.drawing.shapes.filter(shape => shape.type === 'roundRect').length, 1);
    assert(!/Quarterly Google|Lifetime Google|4\.99|4\.88/.test(html), 'Legacy undated ratings are not active monthly values');
    assert(!JSON.stringify(f.slides).includes('4.99'));
  }
  console.log('PASS monthly reputation HTML/PPTX exports: canonical Google score, aggregate and community zero/null, retained chart labels/gaps, and no legacy quarterly/lifetime fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
