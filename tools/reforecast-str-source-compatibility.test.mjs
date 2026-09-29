import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseSavedStrMonthlyProgramme,prepareSavedStrMonthlyContribution} from '../docs/portfolio-operations-dashboard/features/reforecast-str-saved-programme.mjs';
import {parseSavedStrJson,recoverStrOverlayFromJson,savedStrJsonBytes} from '../docs/portfolio-operations-dashboard/features/reforecast-str-json-recovery.mjs';

const periods=['2026-09','2026-10'],monthly=(sept,oct)=>[0,0,0,0,0,0,0,0,sept,oct,0,0];
const publication={verified:true,approved:true,locked:true,publicationId:'parent',revisionId:'parent-revision',contentHash:'parent-hash',communityId:'community',periods,source:{},snapshot:{identity:{communityId:'community',mappingRegistryVersion:'registry',baselineVersionIds:['original']}}};
const options={propertyId:'P',programmeId:'STR',periods};
const recovery={publication,propertyId:'P',programmeId:'STR',actor:'reviewer',reason:'Review exact selected saved source'};
const line=(id,propertyId,strProgramId,sept,oct)=>({id,propertyId,strProgramId,gl:'5144',nature:'income',yearData:{2026:monthly(sept,oct)}});
const payload={formatVersion:2,savedAt:'2026-09-29T00:00:00Z',state:{budgetYear:2026,properties:[{id:'P',name:'Selected',units:[{id:'group',units:2}]},{id:'Q',name:'Other property'}],strPrograms:[{id:'STR',propertyId:'P',operatorId:'rise_internal',applied:true,lineIds:['selected'],config:{propertyId:'P',programmeId:'STR',unitPicks:[{groupId:'group',units:2}],unitRamp:{2026:monthly(0,2)},adrMode:'monthly',adrMonthly:{2026:monthly(0,null)},occMode:'monthly',occMonthly:{2026:monthly(0,.5)}}},{id:'SIBLING',propertyId:'P',operatorId:'hello_landing',lineIds:['sibling'],config:{propertyId:'P',programmeId:'SIBLING'}}],lines:[line('conventional','P',null,999,999),line('other-property','Q','STR',888,888),line('sibling','P','SIBLING',777,777),line('selected','P','STR',0,null)]},strProgrammeSourceContext:{lines:[line('selected','P','STR',666,666)],programmes:[]},ui:{strCfg:{propertyId:'P',programmeId:'STR',unitRamp:{2026:monthly(2,2)},adrMode:'monthly',adrMonthly:{2026:monthly(555,555)},occMode:'monthly',occMonthly:{2026:monthly(.99,.99)}}}};
const raw=value=>JSON.stringify(value,null,2);
const parse=value=>parseSavedStrMonthlyProgramme(raw(value),options);
const recover=async value=>recoverStrOverlayFromJson(await parseSavedStrJson(raw(value)),recovery);
for(const formatVersion of [1,2]){
 const value=structuredClone(payload);value.formatVersion=formatVersion;
 const input=raw(value),bytes=new TextEncoder().encode(input),hash=createHash('sha256').update(bytes).digest('hex');
 const source=await parse(value),evidence=await parseSavedStrJson(input),before=structuredClone(publication),draft=recoverStrOverlayFromJson(evidence,recovery);
 assert.equal(source.sourceHash,hash);assert.equal(evidence.sourceHash,hash);assert.equal(source.byteLength,bytes.length);assert.equal(evidence.byteLength,bytes.length);
 assert.deepEqual(Buffer.from(source.originalFile.data,'base64'),Buffer.from(bytes));assert.deepEqual(Buffer.from(savedStrJsonBytes(evidence)),Buffer.from(bytes));
 assert.deepEqual(source.lineEvidence.map(row=>row.line.id),['selected']);assert.equal(source.lineEvidence[0].sourceLineIndex,3);assert.deepEqual(source.cells.map(row=>row.sourceAmount),[0,null]);assert(source.blockers.some(row=>row.code==='saved_str_monthly_value'));assert(!source.blockers.some(row=>row.code==='saved_str_line_mapping'));
 assert.deepEqual(source.programme.config,value.state.strPrograms[0].config);assert.deepEqual(source.unitRamp.map(row=>row.units),[0,2]);assert.equal(source.cells[0].sourcePath,'/state/lines/3/yearData/2026/8');
 assert.deepEqual(draft.strRecoveryEvidence.lineEvidence,[value.state.lines[3]]);assert.deepEqual(draft.strRecoveryEvidence.programme.config,value.state.strPrograms[0].config);
 assert.deepEqual(draft.strStreams[0].monthly.map(row=>row.grossPerOccupiedNight),[0,null]);assert.deepEqual(draft.strStreams[0].monthly.map(row=>row.occupancyPercent),[0,50]);
 assert.equal(draft.strStreams[0].reviewed,false);assert.equal(draft.strStreams[0].sourceReviewId,null);assert.equal(draft.strStreams[0].application,'add');assert.equal(draft.strStreams[0].monthly[0].feePerAvailableUnit,null);assert(draft.strRecoveryEvidence.blockers.some(row=>row.code==='saved_str_source_review_required'));assert.deepEqual(publication,before);
}
for(const formatVersion of [0,3,'1','2',null]){
 const value=structuredClone(payload);value.formatVersion=formatVersion;
 await assert.rejects(parse(value),/format 1 or 2/);await assert.rejects(parseSavedStrJson(raw(value)),/format 1 or 2/);
}
for(const formatVersion of [1,2])for(const mutate of [
 value=>value.state.properties.push(structuredClone(value.state.properties[0])),
 value=>value.state.strPrograms.push({...value.state.strPrograms[0],propertyId:'Q'}),
 value=>value.state.strPrograms[0].propertyId='absent',
 value=>value.state.lines.push(null),
 value=>value.state.properties[0].id=''
]){
 const value=structuredClone(payload);value.formatVersion=formatVersion;mutate(value);await assert.rejects(parse(value),/identified|unique identity/);await assert.rejects(parseSavedStrJson(raw(value)),/identified|unique identity/);
}
for(const formatVersion of [1,2])for(const mutate of [
 value=>value.state.lines.push(structuredClone(value.state.lines[3])),
 value=>value.state.strPrograms[0].lineIds=['selected','selected'],
 value=>value.state.strPrograms[0].lineIds=['conventional'],
 value=>value.state.strPrograms[0].lineIds=['other-property'],
 value=>value.state.strPrograms[0].lineIds=['sibling'],
 value=>value.state.lines[3].strProgramId='SIBLING'
]){
 const value=structuredClone(payload);value.formatVersion=formatVersion;mutate(value);const source=await parse(value),draft=await recover(value);
 assert(source.blockers.some(row=>['saved_str_line_identity','saved_str_line_mapping'].includes(row.code)));assert(draft.strRecoveryEvidence.blockers.some(row=>['saved_str_line_identity','saved_str_line_mapping'].includes(row.code)));
 assert(source.lineEvidence.every(row=>row.line.propertyId==='P'&&row.line.strProgramId==='STR'));assert(draft.strRecoveryEvidence.lineEvidence.every(row=>row.propertyId==='P'&&row.strProgramId==='STR'));
}
const legacy=structuredClone(payload);legacy.formatVersion=1;delete legacy.state.strPrograms[0].lineIds;assert(!(await parse(legacy)).blockers.some(row=>row.code==='saved_str_line_mapping'),'Legacy programmes without declared line lists remain supported');
const missingV2LineList=structuredClone(legacy);missingV2LineList.formatVersion=2;assert((await parse(missingV2LineList)).blockers.some(row=>row.code==='saved_str_line_mapping'));assert((await recover(missingV2LineList)).strRecoveryEvidence.blockers.some(row=>row.code==='saved_str_line_mapping'));
for(const config of [null,{...payload.state.strPrograms[0].config,propertyId:'Q'},{...payload.state.strPrograms[0].config,programmeId:'SIBLING'}]){
 const value=structuredClone(payload);value.state.strPrograms[0].config=config;const source=await parse(value),draft=await recover(value);
 assert(source.blockers.some(row=>row.code==='saved_str_configuration_identity'));assert(draft.strRecoveryEvidence.blockers.some(row=>['saved_str_config_missing','saved_str_configuration_identity'].includes(row.code)));
 if(config===null){assert.equal(draft.strStreams[0].monthly[0].grossPerOccupiedNight,null);assert.equal(source.unitRamp[0].units,null);}
}
const evidence=await parseSavedStrJson(raw(payload));assert.throws(()=>recoverStrOverlayFromJson(evidence,{...recovery,propertyId:'Q'}),/exactly one/);await assert.rejects(parseSavedStrMonthlyProgramme(raw(payload),{...options,propertyId:'Q'}),/exactly one/);
await assert.rejects(parseSavedStrJson(new Uint8Array(1024*1024+1)),/at most 1 MB/);await assert.rejects(parseSavedStrMonthlyProgramme(new Uint8Array(1024*1024+1),options),/at most 1 MB/);
const complete=structuredClone(payload);complete.state.lines[3].yearData[2026][9]=10;const completeSource=await parse(complete),parent=structuredClone(publication);parent.snapshot.lines=periods.map(period=>({accountCode:'5144',period,forecast:100}));
const reviewOptions={publication:parent,registry:{version:'registry',accounts:[{accountCode:'5144',nature:'income'}]},mappings:[{sourceLineId:'selected',sourceGL:'5144',accountCode:'5144',confirmed:true,reason:'Explicitly reviewed source account'}],actor:'reviewer',reason:'Review exact source contribution'};
assert((await prepareSavedStrMonthlyContribution(completeSource,reviewOptions)).blockers.some(row=>row.code==='saved_str_protected_gl'),'V2 does not bypass protected account approval');
const explicitlyReviewed=await prepareSavedStrMonthlyContribution(completeSource,{...reviewOptions,allowHelloLandingGl5144:true});assert.equal(explicitlyReviewed.ready,true);assert.deepEqual(explicitlyReviewed.cells.map(row=>row.combinedForecast),[100,110]);
await assert.rejects(prepareSavedStrMonthlyContribution(completeSource,{...reviewOptions,publication:{...parent,approved:false}}),/Conventional publication/);

// Optional private acceptance: read the untouched user export and its independently
// retained server revision. No private data is written into the test or repository.
if(process.env.ATLAS_STR_SCOPED_BACKUP_JSON){
 const bytes=await fs.readFile(process.env.ATLAS_STR_SCOPED_BACKUP_JSON),expectedHash=process.env.ATLAS_STR_SCOPED_BACKUP_SHA256;
 assert.match(expectedHash||'',/^[a-f0-9]{64}$/,'Provide the independently verified private source hash');assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedHash);
 const saved=JSON.parse(bytes),identity={propertyId:saved.ui.strCfg.propertyId,programmeId:saved.ui.strCfg.programmeId},actualPeriods=['2026-09','2026-10','2026-11','2026-12'];
 const source=await parseSavedStrMonthlyProgramme(bytes,{...identity,periods:actualPeriods}),evidence=await parseSavedStrJson(bytes),draft=recoverStrOverlayFromJson(evidence,{...recovery,...identity,publication:{...publication,periods:actualPeriods}});
 assert.equal(saved.formatVersion,2);assert.equal(source.sourceHash,expectedHash);assert.equal(evidence.sourceHash,expectedHash);assert.equal(source.blockers.length,0,JSON.stringify(source.blockers));
 const selected=saved.state.lines.filter(row=>row.propertyId===identity.propertyId&&row.strProgramId===identity.programmeId);assert.equal(selected.length,31);assert.equal(source.cells.length,124);assert.deepEqual(source.lineEvidence.map(row=>row.line),selected);assert.deepEqual(draft.strRecoveryEvidence.lineEvidence,selected);
 assert.deepEqual(Buffer.from(source.originalFile.data,'base64'),bytes);assert.deepEqual(Buffer.from(savedStrJsonBytes(draft.strRecoveryEvidence)),bytes);assert.equal(draft.strStreams[0].reviewed,false);assert(draft.strRecoveryEvidence.blockers.some(row=>row.code==='saved_str_source_review_required'));
 if(process.env.ATLAS_STR_SCOPED_REVISION_JSON){const revision=JSON.parse(await fs.readFile(process.env.ATLAS_STR_SCOPED_REVISION_JSON));assert.equal(revision.payload.sourcePropertyId,identity.propertyId);assert.equal(revision.payload.sourceProgrammeId,identity.programmeId);assert.deepEqual(source.programme,revision.payload.programme);assert.deepEqual(selected,revision.payload.lines);assert.deepEqual(source.property,revision.payload.property);}
 console.log(JSON.stringify({privateScopedBackup:'passed',sourceHash:source.sourceHash,byteLength:bytes.length,formatVersion:saved.formatVersion,selectedLines:selected.length,selectedCells:source.cells.length,unrelatedSourceLinesExcluded:saved.state.lines.length-selected.length,exactOriginalBytes:true,exactRetainedRevisionCompared:Boolean(process.env.ATLAS_STR_SCOPED_REVISION_JSON),recoveryReviewRequired:true,workingRevisionBytes:new TextEncoder().encode(JSON.stringify(draft)).length}));
}
console.log('PASS saved STR v1/v2 compatibility, exact identities and bytes, sibling/source isolation, declared line mapping, proposed-driver separation, zero/null preservation and unchanged unreviewed recovery gates.');
