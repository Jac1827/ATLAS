const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
const boxScoreSources = require('../docs/portfolio-operations-dashboard/application-source-bridge.js');
const rows = [
  ['Availability (As of 09/18/2026)'],
  ['Unit Type', 'Avg. Market Rent (Budgeted)', 'Avg. Scheduled Rent', 'Avg. Net Effective Rent', 'Units', 'Rentable Units'],
  ['A1', '1675', '1738', '1650', '16', '16'],
  ['Total:', '1675', '1738', '1650', '16', '16']
];
const context = {
  console,
  Date,
  Map,
  Set,
  window: { AtlasApplicationSources: boxScoreSources },
  dataImport2State: { customFields: [], mappingRules: [], learningSettings: { autoMapThreshold: 95, trustConfirmationCount: 3 } },
  DATA_IMPORT_FIELD_ALIASES: {
    avg_market_rent_budgeted: ['avg market rent budgeted', 'average market rent budgeted'],
    avg_scheduled_rent: ['avg scheduled rent', 'average scheduled rent'],
    avg_ner: ['avg ner', 'average ner', 'average net effective rent'],
    net_effective_rent: ['net effective rent', 'ner', 'effective rent'],
    current_rent: ['current rent', 'rent amount', 'lease rent'],
    total_units: ['units'],
    rentable_units: ['rentable units']
  },
  DATA_IMPORT_DESTINATION_GROUPS: [],
  XLSX: {
    read: () => ({ SheetNames: ['Anthem House'], Sheets: { 'Anthem House': rows } }),
    utils: { sheet_to_json: sheet => sheet }
  }
};
vm.createContext(context);
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) {
  vm.runInContext(match[0], context);
}
Object.assign(context, {
  dataImportGetReportDef: type => type === 'box_score' ? { primaryFields: ['avg_market_rent_budgeted', 'avg_scheduled_rent', 'avg_ner', 'total_units', 'rentable_units'] } : null,
  dataImportFindSavedRuleForHeader: () => null,
  dataImportGetOrderedMappingRules: () => [],
  dataImportIsSupportedFileName: () => true,
  dataImportGetFileExtension: () => '.xlsx',
  dataImportIsMetadataSheetName: () => false,
  dataImportRowsToText: value => JSON.stringify(value),
  DATA_IMPORT_MAX_SAMPLE_CHARS: 100000
});

(async () => {
  const sample = await context.dataImportReadFileSample({ name: 'Box Score.xlsx', arrayBuffer: async () => new ArrayBuffer(0) });
  const parsedNer = sample.qualifiedFields.find(field => field.canonicalField === 'avg_ner');
  assert(parsedNer, 'Preview must reuse the section-aware Box Score parser');
  assert.match(parsedNer.qualifiedHeader, /Anthem House \/ availability.*\/ Avg\. Net Effective Rent/i);

  const detected = context.dataImportDetectFields(sample, { reportType: 'box_score', sourceSystem: 'Entrata' });
  assert(detected.mappedFields.some(field => field.canonicalField === 'avg_ner'));
  assert.equal(detected.lowConfidence.length, 0);

  const unsafeFallback = context.dataImportSuggestDestinationForHeader('Avg. Net Effective Rent', { reportType: 'box_score', sourceSystem: 'Entrata' });
  assert.equal(unsafeFallback.field, '');
  assert.equal(unsafeFallback.requiresReview, true);
  assert.match(unsafeFallback.reason, /section-qualified/i);

  assert.equal(context.dataImportMappingReviewLabel(97, 'Suggested'), 'High-confidence mapping awaiting confirmation');
  assert.equal(context.dataImportLearningStatus(2, 0), 'Suggested');
  assert.equal(context.dataImportLearningStatus(3, 0), 'Trusted');
  context.dataImport2State.learningSettings.trustConfirmationCount = 2;
  assert.equal(context.dataImportLearningStatus(2, 0), 'Trusted');
  console.log('PASS section-aware Box Score preview, rent fallback guard, transparent confidence state, and configurable trust promotion.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
