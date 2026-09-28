import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {patchPropertySpecialsClient,patchPropertySpecialsReferences,patchPropertySpecialsSettings,PROPERTY_SPECIALS_ASSETS} from './property-specials-compat.mjs';

const prefix = 'retained auth/session/profile/startup bytes\n';
const suffix = '\n    async evictionCase(action, body = {}, binary = false) {\n      retainedOtherService();\n    },\nretained client tail';
const oldMethod = '    async propertySpecials(action, body = {}) {\n      return oldWebsiteRequest(action,body);\n    },';
const newMethod = '    async propertySpecials(action, body = {}) {\n      return diagnosedWebsiteRequest(action,body);\n    },';
const retained = prefix + oldMethod + suffix;
const current = 'new auth MUST NOT enter retained client\n' + newMethod + suffix + '\nnew startup MUST NOT enter retained client';
assert.equal(patchPropertySpecialsClient(retained, current), prefix + newMethod + suffix);
for (const source of [retained.replace('async propertySpecials','async renamed'),retained.replace('async evictionCase','async movedNextMethod'),retained.replace(suffix,'\n    async unrelatedInsertedMethod() {\n      mustNotBeSwallowed();\n    },'+suffix),retained+'\n'+retained]) {
  assert.throws(() => patchPropertySpecialsClient(source,current), /method boundary changed/);
}
assert.throws(() => patchPropertySpecialsClient(retained,current+'\n'+current), /method boundary changed/);

const core=readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
const normalizer='retained preface\n    websiteSettingsUpdatedAt: String(input.websiteSettingsUpdatedAt || ""),\n    generalManagerName: String(input.generalManagerName ?? defaults.generalManagerName).trim(),\nretained tail';
const revised=patchPropertySpecialsSettings(normalizer,core);
assert.ok(revised.startsWith('retained preface\n'));assert.ok(revised.endsWith('    generalManagerName: String(input.generalManagerName ?? defaults.generalManagerName).trim(),\nretained tail'));
const fields=revised.slice(revised.indexOf('    websiteSettingsUpdatedAt:'),revised.indexOf('    generalManagerName:'));
const normalize=vm.runInNewContext('(input)=>({'+fields+'})');
assert.equal(Object.hasOwn(normalize({}),'websiteSettingsRevision'),false);
const draft=normalize({websiteSettingsRevision:'r1',websiteSettingsExpectedRevision:'',websiteSettingsSyncPending:true,websiteSettingsBaseUrls:{communityWebsiteUrl:'https://example.com/',floorPlanRatesPageUrl:'https://example.com/plans'}});
assert.equal(draft.websiteSettingsExpectedRevision,'');assert.equal(draft.websiteSettingsRevision,'r1');assert.equal(draft.websiteSettingsSyncPending,true);assert.equal(draft.websiteSettingsBaseUrls.floorPlanRatesPageUrl,'https://example.com/plans');
assert.throws(()=>patchPropertySpecialsSettings(normalizer.replace('generalManagerName','movedNeighbor'),core),/normalizer boundary changed/);
assert.throws(()=>patchPropertySpecialsSettings(normalizer,core.replace('websiteSettingsSyncPending:', 'unreviewedField:')),/normalizer boundary changed/);

const sources = Object.fromEntries(PROPERTY_SPECIALS_ASSETS.map(name => [name,'source bytes for '+name]));
const refs = PROPERTY_SPECIALS_ASSETS.map(name => `<script src="./${name}?v=old-version"></script>`).join('\n') + '\nconst fallback="./centralization/atlas-central-client.js?v=old-version";';
const index = 'retained startup\n' + refs + '\nretained operational writes';
const patched = patchPropertySpecialsReferences(index,sources);
let expected = index;
for (const name of PROPERTY_SPECIALS_ASSETS) expected = expected.replaceAll('./'+name+'?v=old-version','./'+name+'?v='+createHash('sha256').update(sources[name]).digest('hex').slice(0,16));
assert.equal(patched,expected, 'Only all four reviewed script version references may change');
assert.throws(() => patchPropertySpecialsReferences(index.replace('./centralization/atlas-central-client.js?v=old-version','./missing.js'),sources), /reference boundary changed/);
assert.throws(() => patchPropertySpecialsReferences(index+'\n<script src="./concession-insights.js?v=duplicate"></script>',sources), /reference boundary changed/);
assert.throws(() => patchPropertySpecialsReferences(index,{}), /Missing reviewed/);
console.log('PASS bounded website-special compatibility patch preserves all unrelated auth/startup bytes, hashes four references, and fails closed on changed boundaries.');
