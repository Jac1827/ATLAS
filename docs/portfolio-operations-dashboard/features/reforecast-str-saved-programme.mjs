import {strRegistryExtensionIssues} from './reforecast-str-registry-extension.mjs?v=e029a084505a92e0';
import {hashReforecastWorkbook,encodeOriginalWorkbook} from './reforecast-intake.mjs?v=87e68da483f77228';
import {workbookEvidenceHash} from './workbook-integrity.mjs?v=612a2cdba3c9dba2';
import {createStrOverlayDraft} from './reforecast-str-overlay.mjs?v=ecc60c5b054f76d1';

const SCHEMA='atlas.saved-str-monthly-programme.v1',PERIOD=/^20\d{2}-(0[1-9]|1[0-2])$/;
const finite=value=>typeof value==='number'&&Number.isFinite(value),clone=structuredClone;
const bytesOf=input=>typeof input==='string'?new TextEncoder().encode(input):input instanceof ArrayBuffer?new Uint8Array(input):ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):input?.encoding==='base64'?Uint8Array.from(atob(input.data),c=>c.charCodeAt(0)):null;
const decimal=value=>{const [coefficient,exponent='0']=String(value).split('e'),[whole,fraction='']=coefficient.split('.');return {integer:BigInt(whole+fraction),scale:fraction.length-Number(exponent)};};
const sum=values=>{if(values.some(v=>!finite(v)))return null;const parts=values.map(decimal),scale=Math.max(0,...parts.map(p=>p.scale));return Number(parts.reduce((total,p)=>total+p.integer*10n**BigInt(scale-p.scale),0n))/10**scale;};
const difference=(a,b)=>finite(a)&&finite(b)?sum([a,-b]):null;
function issue(code,message,detail={}){return {code,severity:'blocking',message,...detail};}
const contentFingerprint=value=>{const {fingerprint,...content}=value;return workbookEvidenceHash(content);};

/** Retain the saved programme's exact monthly cells. Group allocations are
 * source groups, never invented physical unit identifiers or new assumptions. */
export async function parseSavedStrMonthlyProgramme(input,{fileName='Saved STR.riseb.json',propertyId,programmeId,periods}={}){
 const bytes=bytesOf(input);if(!bytes?.length||bytes.length>1024*1024)throw Error('Choose a saved STR JSON of at most 1 MB.');
 let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('The saved STR source must be valid UTF-8 JSON.');}
 const state=payload.state;
 if(payload.formatVersion!==1||!Array.isArray(state?.properties)||!Array.isArray(state.strPrograms)||!Array.isArray(state.lines))throw Error('A supported saved Budget Builder programme with retained GL lines is required.');
 if(!Array.isArray(periods)||!periods.length||periods.length>24||periods.some(p=>!PERIOD.test(p))||new Set(periods).size!==periods.length)throw Error('Choose distinct complete forecast months for this saved programme.');
 periods=[...periods].sort();
 const properties=state.properties.filter(p=>p.id===propertyId),programmes=state.strPrograms.filter(p=>p.id===programmeId&&p.propertyId===propertyId);
 if(properties.length!==1||programmes.length!==1)throw Error('Select exactly one saved property and one of its programmes.');
 const property=properties[0],programme=programmes[0],config=programme.config,blockers=[];
 if(!['rise_internal','rise_str'].includes(programme.operatorId))throw Error('Select an explicitly identified RISE programme; reference operators remain separate.');
 if(!config||config.propertyId!==propertyId||config.programmeId!==programmeId)blockers.push(issue('saved_str_configuration_identity','Saved configuration must identify this exact property and programme.'));
 const seenGroups=new Set(),groupAllocations=(config?.unitPicks||[]).map((pick,index)=>{
  const matches=(property.units||[]).filter(group=>group.id===pick.groupId);
  if(seenGroups.has(pick.groupId)||matches.length!==1||!Number.isInteger(pick.units)||pick.units<0)blockers.push(issue('saved_str_group_allocation','Each allocation requires a unique retained source group and a nonnegative integer count.',{sourceGroupId:pick.groupId}));seenGroups.add(pick.groupId);
  return {sourceGroupId:pick.groupId,units:pick.units,sourceGroup:matches.length===1?clone(matches[0]):null,sourcePath:`/state/strPrograms/${state.strPrograms.indexOf(programme)}/config/unitPicks/${index}`};
 });
 if(!groupAllocations.length)blockers.push(issue('saved_str_group_allocations_missing','Retain the saved programme group allocations before applying its monthly cells.'));
 const allocatedUnits=sum(groupAllocations.map(row=>row.units)),unitRamp=periods.map(period=>{const year=period.slice(0,4),index=Number(period.slice(5))-1,series=config?.unitRamp?.[year],units=Array.isArray(series)&&series.length===12?series[index]:null;if(!Number.isInteger(units)||units<0||!finite(allocatedUnits)||units>allocatedUnits)blockers.push(issue('saved_str_monthly_units','An exact saved monthly unit count within its group allocation is required; no default ramp is inferred.',{period}));return {period,units,sourcePath:`/state/strPrograms/${state.strPrograms.indexOf(programme)}/config/unitRamp/${year}/${index}`};});
 const lineEvidence=state.lines.flatMap((line,index)=>line.propertyId===propertyId&&line.strProgramId===programmeId?[{sourceLineIndex:index,line:clone(line)}]:[]),cells=[],seenIds=new Set(),seenKeys=new Set();
 if(!lineEvidence.length)blockers.push(issue('saved_str_lines_missing','The saved programme has no retained monthly GL output.'));
 for(const {sourceLineIndex,line}of lineEvidence){
  if(!line.id||seenIds.has(line.id))blockers.push(issue('saved_str_line_identity','Source programme line identifiers must be unique.',{sourceLineId:line.id}));seenIds.add(line.id);
  if(!line.gl||!['income','contra_income','expense','capital','debt','below_noi'].includes(line.nature))blockers.push(issue('saved_str_gl_classification','Every saved contribution requires a source GL and financial classification.',{sourceLineId:line.id}));
  for(const period of periods){const year=period.slice(0,4),index=Number(period.slice(5))-1,series=line.yearData?.[year],amount=Array.isArray(series)&&series.length===12?series[index]:null,key=JSON.stringify([line.gl,period]);
   if(!finite(amount))blockers.push(issue('saved_str_monthly_value','A saved monthly GL value is missing; blank cannot become zero.',{sourceLineId:line.id,period}));
   if(seenKeys.has(key))blockers.push(issue('saved_str_duplicate_gl_month','Multiple source lines share one GL/month. Review an explicit aggregation before applying.',{sourceGL:line.gl,period}));seenKeys.add(key);
   cells.push({sourceLineId:line.id,sourceLineIndex,sourceGL:line.gl,sourceName:line.name||'',nature:line.nature,department:line.department??null,period,sourceAmount:finite(amount)?amount:null,sourcePath:`/state/lines/${sourceLineIndex}/yearData/${year}/${index}`,sourceKind:'saved_json_monthly_programme'});
  }
 }
 // Programme annual totals can differ from its saved rounded monthly cells.
 // Disclose both; never alter a cell to force the programme summary to match.
 const sourceRollupDifferences=[];
 for(const year of [...new Set(periods.map(p=>p.slice(0,4)))]){
  const saved=programme.byYear?.[year];if(!saved)continue;
  const totals=natures=>sum(lineEvidence.filter(({line})=>natures.includes(line.nature)).flatMap(({line})=>Array.isArray(line.yearData?.[year])&&line.yearData[year].length===12?line.yearData[year]:[null]));
  const income=totals(['income']),contra=totals(['contra_income']),expense=totals(['expense']);
  for(const [metric,computed]of Object.entries({totalRevenue:income,expense,furnishCapex:totals(['capital']),uplift:finite(income)&&finite(contra)&&finite(expense)?sum([income,contra,-expense]):null}))if(finite(saved[metric])&&computed!==saved[metric])sourceRollupDifferences.push({year,metric,savedProgrammeTotal:saved[metric],savedMonthlyGLTotal:computed,difference:difference(computed,saved[metric]),authority:'saved_monthly_gl_cells'});
 }
 const result={schemaVersion:SCHEMA,fileName,sourceHash:await hashReforecastWorkbook(bytes),byteLength:bytes.length,originalFile:encodeOriginalWorkbook(bytes),savedAt:payload.savedAt||null,sourcePropertyId:propertyId,programmeId,periods:[...periods].sort(),property:clone(property),programme:clone(programme),groupAllocations,allocatedUnits,unitRamp,lineEvidence,cells,sourceRollups:clone(programme.byYear||{}),sourceRollupDifferences,referenceDisposition:'Other operators and reference datasets remain retained in the original JSON and are not applied as RISE contributions.',blockers};
 result.fingerprint=contentFingerprint(result);return result;
}

/** Reviewable additive contribution. The caller must persist and approve its
 * source receipt before the server applies it to the separate STR overlay. */
export async function prepareSavedStrMonthlyContribution(source,{publication,registry,parentRegistry=registry,mappings=[],actor,reason,reviewedAt=new Date().toISOString(),allowHelloLandingGl5144=false,rollupReview}={}){
 if(source?.schemaVersion!==SCHEMA||contentFingerprint(source)!==source.fingerprint)throw Error('Saved STR evidence changed. Reopen the exact source before reviewing.');
 const reread=await parseSavedStrMonthlyProgramme(source.originalFile,{fileName:source.fileName,propertyId:source.sourcePropertyId,programmeId:source.programmeId,periods:source.periods});
 if(reread.fingerprint!==source.fingerprint)throw Error('Saved STR evidence does not reproduce the retained original JSON.');
 const base=createStrOverlayDraft(publication,{actor,timestamp:reviewedAt}),blockers=clone(source.blockers),cells=[],seen=new Set();
 if(typeof reason!=='string'||reason.trim().length<3)blockers.push(issue('saved_str_review_reason','Record the reason for using this exact saved programme.'));
 if(parentRegistry?.version!==base.registryVersionId)blockers.push(issue('saved_str_mapping_version','Read the exact Conventional parent registry before reviewing an STR extension.'));
 blockers.push(...strRegistryExtensionIssues(parentRegistry,registry,mappings));
 if(source.periods.some(period=>!base.periods.includes(period)))blockers.push(issue('saved_str_parent_months','Saved contribution months must belong to the exact Conventional publication.'));
 if(source.sourceRollupDifferences.length&&!(rollupReview?.confirmed===true&&rollupReview.sourceHash===source.sourceHash&&rollupReview.authority==='saved_monthly_gl_cells'&&String(rollupReview.reason||'').trim().length>=3))blockers.push(issue('saved_str_rollup_reconciliation','Review the difference between saved monthly GL cells and saved programme summaries; keep the exact monthly cells.',{differences:clone(source.sourceRollupDifferences)}));
 for(const cell of source.cells){
  const matches=mappings.filter(m=>m.sourceLineId===cell.sourceLineId&&m.sourceGL===cell.sourceGL),mapping=matches.length===1?matches[0]:null,accounts=(registry?.accounts||[]).filter(a=>a.accountCode===mapping?.accountCode),account=accounts.length===1?accounts[0]:null;
  if(!mapping?.confirmed||!account){blockers.push(issue('saved_str_gl_mapping','Confirm exactly one canonical GL mapping for every saved source line.',{sourceLineId:cell.sourceLineId,sourceGL:cell.sourceGL,period:cell.period}));continue;}
  if(String(mapping.reason||'').trim().length<3)blockers.push(issue('saved_str_mapping_reason','Record why this source GL and label belong to the selected canonical account, including any displaced Conventional income component.',{sourceLineId:cell.sourceLineId,sourceGL:cell.sourceGL,accountCode:account.accountCode}));
  if(mapping.signMultiplier!==undefined&&mapping.signMultiplier!==1)blockers.push(issue('saved_str_signed_source','Saved monthly contributions retain their exact source sign; review another source instead of reversing the saved amount.',{sourceLineId:cell.sourceLineId}));
  if(account.accountCode==='5144'&&!allowHelloLandingGl5144)blockers.push(issue('saved_str_protected_gl','GL 5144 requires explicit approval for this RISE source so existing Hello Landing values remain separate.',{period:cell.period}));
  if((cell.nature==='capital')!==(account.nature==='capital'))blockers.push(issue('saved_str_capital_mapping','Keep saved capital contributions separate from operating income and expenses.',{sourceLineId:cell.sourceLineId}));
  if(cell.nature==='contra_income'?!['income','contra_income'].includes(account.nature):cell.nature!==account.nature)blockers.push(issue('saved_str_financial_classification','The canonical GL must preserve the financial effect of the saved signed contribution.',{sourceLineId:cell.sourceLineId,sourceNature:cell.nature,canonicalNature:account.nature}));
  if(account.effectiveFrom&&cell.period<account.effectiveFrom||account.retiredAfter&&cell.period>account.retiredAfter)blockers.push(issue('saved_str_mapping_period','The canonical mapping is not effective for this saved source month.',{accountCode:account.accountCode,period:cell.period}));
  const key=JSON.stringify([account.accountCode,cell.period]);if(seen.has(key))blockers.push(issue('saved_str_duplicate_target','Reviewed source lines collide on one canonical GL/month; no implicit aggregation is allowed.',{accountCode:account.accountCode,period:cell.period}));seen.add(key);
  const parent=(publication.snapshot.lines||[]).filter(row=>row.accountCode===account.accountCode&&row.period===cell.period),absent=parent.length===0;
  if(parent.some(row=>row.closed===true)||publication.source?.actuals?.cutoffPeriod&&cell.period<=publication.source.actuals.cutoffPeriod)blockers.push(issue('saved_str_closed_month','Apply saved STR contributions only to eligible open months; governed actuals remain unchanged.',{period:cell.period}));
  if(parent.length>1||parent.length===1&&!finite(parent[0].forecast))blockers.push(issue('saved_str_parent_value','The Conventional parent must contain one exact numeric GL/month amount; blank is not zero.',{accountCode:account.accountCode,period:cell.period}));
  if(absent&&mapping.parentDisposition!=='no_parent_publication_row')blockers.push(issue('saved_str_parent_absence','Explicitly review this prospective GL absent from the exact Conventional publication.',{accountCode:account.accountCode,period:cell.period}));
  const parentAmount=parent.length===1&&finite(parent[0].forecast)?parent[0].forecast:null;
  cells.push({...clone(cell),accountCode:account.accountCode,mappingVersion:registry.version,amount:cell.sourceAmount,application:'add',parentAmount,parentDisposition:absent?'no_parent_publication_row':'existing_parent_cell',combinedForecast:finite(cell.sourceAmount)&&(absent||parentAmount!==null)?sum([parentAmount??0,cell.sourceAmount]):null,actorId:actor,reviewedAt,reason:String(reason||'').trim()});
 }
 const result={schemaVersion:SCHEMA,sourceKind:'saved_json_monthly_programme',sourceHash:source.sourceHash,sourceFingerprint:source.fingerprint,sourcePropertyId:source.sourcePropertyId,programmeId:source.programmeId,parentPublication:clone(base.parentPublication),mappingVersion:registry?.version||null,periods:clone(source.periods),application:'add',groupAllocations:clone(source.groupAllocations),unitRamp:clone(source.unitRamp),cells,mappings:clone(mappings),allowHelloLandingGl5144,rollupReview:clone(rollupReview||null),actorId:actor,reviewedAt,reason:String(reason||'').trim(),blockers,ready:blockers.length===0};
 result.fingerprint=contentFingerprint(result);return result;
}
