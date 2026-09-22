const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8') + '\n' + fs.readFileSync('docs/portfolio-operations-dashboard/lead-source-review.js','utf8');
const ctx = vm.createContext({ console, window:{}, document:{getElementById:()=>null} });
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], ctx);
const item = { id: 'review1', originalField: 'source', currentField: 'applications', suggestedField: 'applications', status: 'Mapped' };
let saved;
let renders = 0;
Object.assign(ctx, {
  dataImport2State: { mappingDrafts: {}, customFields: [], selectedMappingIds: [], mappingAuditTrail:[{newRule:{id:"saved"}}], mappingRules:[] },
  DATA_IMPORT_FIELD_ALIASES: { applications: [], existing_other: [] },
  DATA_IMPORT_REPORT_TYPES: {},
  DATA_IMPORT_DESTINATION_GROUPS: [{ label: 'Leasing', fields: ['applications', 'registered_no_alias'] }],
  dataImportFindMappingReviewItem: id => id === item.id ? item : null,
  dataImportUpsertMappingRuleFromItem: (_, destination) => { saved = destination; return true; },
  dataImportMappingDestinationLabel: field => field,
  dataImportDestinationModules: () => [],
  persistDataImport2State: () => {}, renderTab: () => renders++,
  alert: () => {}, renderDataImportCustomFieldManager: () => '<form>Field editor</form>'
});
ctx.updateDataImportMappingDraft(item.id, 'existing_other');
ctx.saveDataImportMappingReviewItem(item.id);
assert.equal(saved, undefined, 'First approval opens preview');
ctx.saveDataImportMappingReviewItem(item.id);
assert.equal(saved, 'existing_other', 'Approval must save the choice, not the suggestion');
ctx.updateDataImportMappingDraft(item.id, '');
assert.equal(ctx.dataImportSelectedDestinationForItem(item), '', 'Cleared selection must not silently revert');
ctx.previewDataImportMappingItem(item.id);
let output = ctx.renderDataImportMappingReviewList([item]);
assert.match(output, /Proposed Mapping/);
assert.match(output, /Approve Mapping/);
ctx.updateDataImportMappingDraft(item.id, '__create_custom__');
output = ctx.renderDataImportMappingReviewList([item]);
assert.match(output, /Field editor/);
assert(renders >= 4, 'Draft changes refresh controls');
const destinations = ctx.dataImportDestinationGroups().flatMap(group => group.fields.map(field => field.key));
assert(destinations.includes('registered_no_alias'));
assert(destinations.includes('existing_other'));
assert.equal(new Set(destinations).size, destinations.length);
console.log('PASS custom destination approval, cleared draft, inline preview/editor, complete registered menu');
// The first edit of a seeded contract must also retain a rollback destination.
const upsertSource = html.match(/^function dataImportUpsertMappingRuleFromItem\([^\n]*\) \{[\s\S]*?^\}/m)[0];
vm.runInContext(upsertSource, ctx);
let sequence = 0;
Object.assign(ctx, {
  dataImportCanManageArchitecture: () => true,
  dataImportDestinationExists: () => true,
  dataImportNormalizeText: value => String(value).toLowerCase(),
  dataImportMakeId: prefix => prefix + (++sequence),
  dataImportLearningStatus: () => 'Trusted',
  dataImportSourceFilePattern: () => '',
  atlasCurrentUserDisplayName: () => 'Test authorized editor'
});
ctx.window.AtlasLeadSources = require('../docs/portfolio-operations-dashboard/lead-source-contract.js');
assert.equal(ctx.dataImportUpsertMappingRuleFromItem({id:'seed',originalField:'Email',currentField:'emails_online',sourceSystem:'Entrata',reportType:'box_score'},'text_chat_other',{leadPreviewApproved:true,skipLiveConfirm:true}),true);
assert.equal(ctx.dataImport2State.mappingAuditTrail[0].previousRule.canonicalField,'emails_online');
assert.equal(ctx.dataImport2State.mappingAuditTrail[0].previousMappingVersion,'atlas-lead-source-v1');
console.log('PASS first seeded-contract edit retains rollback destination and prior version');
ctx.DATA_IMPORT_DESTINATION_GROUPS=[{label:'Lead Sources',fields:ctx.window.AtlasLeadSources.fields}];
ctx.dataImport2State.selectedMappingPreviewId='';
for(const status of ['Mapped','Suggested','Trusted','Needs Mapping','Ignored']){
 const markup=ctx.renderDataImportMappingReviewList([{...item,status,currentField:'emails_online'}]);
 const menu=markup.match(/<select class="data-import2-map-select"[\s\S]*?<\/select>/)[0];
 assert(!menu.includes('disabled'),`${status} remains editable`);
 for(const field of ctx.window.AtlasLeadSources.fields)assert(menu.includes(`value="${field}"`),`${status} includes ${field}`);
}
console.log('PASS all five destination choices remain editable for mapped, suggested, trusted, needs-mapping and ignored rows');
