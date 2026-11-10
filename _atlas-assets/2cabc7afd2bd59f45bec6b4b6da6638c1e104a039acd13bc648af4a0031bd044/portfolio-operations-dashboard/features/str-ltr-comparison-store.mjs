import {readStrProgrammes} from './saved-str-programmes.mjs?v=4a0adbdd42b3b0b1';
import {readSourceBundle} from './reforecast-store.mjs?v=b59fd4df88ff8fe3';
import {resolveImportCommunity} from './community-budget-identity.mjs?v=789e1cbad26c5366';
import {canonicalJson,sha256} from './financial-snapshot.mjs?v=848d058bdec07b4e';

// Comparisons are separate, actor-scoped browser working drafts. This adapter
// contains no programme-save, programme-apply, or property-budget write path.
export const COMPARISON_SCHEMA='atlas.str-ltr-comparison.v1';
export const COMPARISON_DB='atlas-str-ltr-comparisons-v1';
const clone=structuredClone,finite=v=>typeof v==='number'&&Number.isFinite(v);
const uuid=()=>crypto.randomUUID(),period=(year,index)=>`${year}-${String(index+1).padStart(2,'0')}`;
const propertyId=p=>typeof p==='string'?p:p?.id;
const fingerprint=value=>sha256(canonicalJson(value));
const errorText=e=>e?.message||String(e);
const withoutVolatile=value=>{const copy=clone(value);delete copy.loadedAt;delete copy.sourceFingerprint;if(copy.program)delete copy.program.selectionKey;if(copy.source){delete copy.source.loadedAt;delete copy.source.year;if(copy.source.concessionsByYear)delete copy.source.concession;}return copy;};
export const comparisonSourceFingerprint=inputs=>fingerprint(withoutVolatile(inputs));

export function defaultComparisonScenario(year){
 if(!Number.isInteger(Number(year))||Number(year)<2000||Number(year)>2099)throw Error('Select a valid comparison year.');
 return {year:Number(year),startMonth:1,endMonth:12,mode:'budget',view:'annual',occupancy:{mode:'source',str:null,ltr:null},rentOverrides:{},concession:{type:'source',value:0,leaseTermMonths:12,eligiblePct:1,startMonth:1,endMonth:12,timing:'upfront'},allocations:{},capital:[],strOverrides:{},apartmentAssignments:{}};
}
export function createComparisonRecord(inputs,{name,scenario}={}){
 if(!inputs?.program||!inputs.property)throw Error('Load a saved STR programme before creating a comparison.');
 return {schemaVersion:COMPARISON_SCHEMA,id:uuid(),name:name?.trim()||`${inputs.program.name} comparison`,propertyId:inputs.property.id,programmeId:inputs.program.id,communityId:inputs.program.communityId||null,scenario:scenario?clone(scenario):defaultComparisonScenario(inputs.source?.year||inputs.program.years?.[0]),inputs:clone(inputs),revision:0,createdAt:new Date().toISOString(),updatedAt:null,persistence:'browser'};
}

function validateComparison(record){
 if(record?.schemaVersion!==COMPARISON_SCHEMA||!record.id||!String(record.name||'').trim()||record.name.length>180||!record.propertyId||!record.inputs?.property||!record.inputs?.program||record.inputs.property.id!==record.propertyId||record.inputs.program.id!==record.programmeId)throw Error('A named comparison must retain its exact property and STR programme.');
 const s=record.scenario;
 if(!s||!Number.isInteger(s.year)||s.year<2000||s.year>2099||!Number.isInteger(s.startMonth)||!Number.isInteger(s.endMonth)||s.startMonth<1||s.endMonth>12||s.startMonth>s.endMonth||!['budget','performance','investment'].includes(s.mode)||!['annual','monthly'].includes(s.view))throw Error('Choose valid comparison dates and a comparison mode before saving.');
 if(!['source','custom','full'].includes(s.occupancy?.mode))throw Error('Choose an occupancy mode.');
 if(s.occupancy.mode==='custom'&&['str','ltr'].some(key=>!finite(s.occupancy[key])||s.occupancy[key]<0||s.occupancy[key]>1))throw Error('STR and LTR occupancy must both be between 0% and 100%.');
 if(Object.values(s.rentOverrides||{}).some(value=>!finite(value)||value<0))throw Error('Rent overrides must be valid nonnegative amounts.');
 if(record.inputs.sourceFingerprint!==comparisonSourceFingerprint(record.inputs))throw Error('The retained source snapshot changed. Use Refresh sources to replace it explicitly.');
 const inspect=value=>{if(typeof value==='number'&&!Number.isFinite(value))throw Error('A comparison contains an invalid numeric value.');if(value&&typeof value==='object')Object.values(value).forEach(inspect);};inspect(record);
 return record;
}
function verifySaved(row){
 if(!row)return null;const {contentHash,...body}=row;
 if(contentHash!==fingerprint(body))throw Error('This comparison could not be verified. Recover its retained edit or load a different comparison.');
 validateComparison(row);return clone(row);
}

// Preserve numerical source evidence, including explicit zero and missing cells.
// Property GL actuals have NO implicit programme or floor-plan attribution.
export function normalizeComparisonActuals(bundle,{state,property,year,registry}={}){
 const accounts=new Map((registry?.accounts||bundle?.registry?.accounts||[]).map(a=>[String(a.accountCode||a.gl),a]));
 const closes=new Map((bundle?.actuals?.closeVersions||[]).map(row=>[row.period,row]));
 if(bundle){return (bundle.actuals?.lines||[]).map(row=>{
  const gl=String(row.accountCode||row.gl||''),account=accounts.get(gl),close=closes.get(row.period);
  const status=row.status||row.closeStatus||(close?'closed':'preliminary');
  return {...clone(row),gl,name:account?.name||account?.accountName||row.accountName||gl,nature:account?.nature||row.nature||null,amount:finite(row.amount)?row.amount:null,status:['closed','preliminary','incomplete'].includes(status)?status:'incomplete',programId:row.programId||row.programmeId||row.strProgramId||null,groupId:row.groupId||null,scope:row.programId||row.programmeId||row.strProgramId?'programme':row.groupId?'floor_plan':'property',allocationMethod:row.allocationMethod||null,source:'ATLAS governed financial records',updatedAt:row.updatedAt||close?.approvedAt||null,closeVersionId:row.closeVersionId||close?.versionId||null};
 });}
 const marker=state?.periods?.[`${property?.id}|${year}`],closed=Number(marker?.closedThrough||0);
 return Object.values(state?.actuals||{}).filter(row=>row.propertyId===property?.id&&Number(row.year)===Number(year)).flatMap(row=>(row.monthly||[]).flatMap((value,index)=>{
  // Legacy entry initializes unrecorded future cells to zero. Only its declared
  // loaded/closed period is usable; a zero-filled array is not data availability.
  if(index>=closed)return [];
  const gl=String(row.gl),account=accounts.get(gl),sourceLine=state.lines?.find(line=>line.propertyId===property.id&&String(line.gl)===gl);
  return [{period:period(year,index),gl,name:account?.name||sourceLine?.name||gl,nature:account?.nature||sourceLine?.nature||null,amount:finite(value)?value:null,status:finite(value)?'preliminary':'incomplete',scope:'property',programId:null,groupId:null,source:row.source||'Browser imported actuals',updatedAt:row.updatedAt||marker?.loadedAt||null,allocationMethod:null,closeVersionId:null,closeEvidence:'Browser closed-through marker; governed close unverified'}];
 }));
}

const WORD_NUMBERS={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
export function normalizeComparisonConcession(data,{year}={}){
 const current=data?.current||{},offer=(data?.offers||[]).find(row=>row.id===current.offerId&&!row.deletedAt);
 const evidence={source:offer?.source==='website'?'ATLAS website review':offer?.source==='manual'?'ATLAS recorded concession':'ATLAS concessions',reviewedAt:offer?.lastVerifiedAt||current.lastVerifiedAt||null,offerId:offer?.id||null,description:offer?.text||'',restrictions:offer?.restrictions||'',status:current.status||'unavailable',pages:clone(offer?.pages||[])};
 if(data?.error||['failed','conflict','unavailable'].includes(current.status))return {...evidence,type:null,value:null,available:false,reason:data?.error||'The current offer requires website review; the last offer is retained as evidence only.'};
 if(current.status==='none')return {...evidence,type:'none',value:0,available:true,leaseTermMonths:12,eligiblePct:1,startMonth:1,endMonth:12,timing:'upfront'};
 if(!offer)return {...evidence,type:null,value:null,available:false,reason:'No current recorded concession is available. Enter the lease terms for this scenario.'};
 const components=(offer.components||[]).filter(row=>row.type==='rent'),rent=components.length===1?components[0]:null;
 if(components.length>1)return {...evidence,type:null,value:null,available:false,reason:'Multiple rent components require an explicit scenario concession.'};
 let text=String(rent?.text||offer.text||'').toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,word=>WORD_NUMBERS[word]);
 let type=null,value=null,matches=[];
 for(const [kind,re]of [['weeks',/(\d+(?:\.\d+)?)\s*weeks?\s*(?:of\s*)?(?:free|off)/g],['months',/(\d+(?:\.\d+)?)\s*months?\s*(?:of\s*)?(?:free|off)/g],['credit',/\$\s*([\d,]+(?:\.\d+)?)\s*(?:rent\s*)?(?:credit|off)/g],['percent',/(\d+(?:\.\d+)?)\s*%\s*(?:off|discount)/g]])for(const match of text.matchAll(re))matches.push([kind,Number(match[1].replaceAll(',',''))]);
 if(matches.length===1){[type,value]=matches[0];if(type==='percent')value/=100;}
 const lease=Number(text.match(/(\d+)\s*[- ]?month\s*(?:lease|term)/)?.[1]||String(rent?.eligibility||offer.restrictions||'').match(/(\d+)\s*[- ]?month\s*(?:lease|term)/i)?.[1])||null;
 const explicit=offer.model||offer.concession;
 if(explicit&&['weeks','months','credit','percent','none'].includes(explicit.type)&&finite(explicit.value)){type=explicit.type;value=explicit.value;}
 const restricted=Boolean(offer.restrictions||rent?.eligibility||/up to|select |selected |new residents|approved |certain /i.test(text));
 if(!type||restricted&&!explicit?.eligibilityConfirmed||!lease&&!explicit?.leaseTermMonths)return {...evidence,type:null,value:null,available:false,suggestion:type?{type,value,leaseTermMonths:lease}:null,reason:!type?'Recorded offer needs explicit numerical lease terms.':restricted?'Offer eligibility is conditional; confirm the eligible leases and timing in this scenario.':'The recorded concession has no lease-term basis; enter the lease term and timing.'};
 const start=offer.start||offer.observedStart||String(offer.firstObservedAt||'').slice(0,10),end=offer.end||String(offer.closedAt||'').slice(0,10);
 if(end&&end<`${year}-01-01`||start&&start>`${year}-12-31`)return {...evidence,type:null,value:null,available:false,effectiveStart:start||null,effectiveEnd:end||null,reason:'The recorded offer does not cover this reporting year; enter an explicit scenario concession.'};
 return {...evidence,type,value,available:true,leaseTermMonths:explicit?.leaseTermMonths||lease,eligiblePct:explicit?.eligiblePct??1,startMonth:start&&Number(start.slice(0,4))===Number(year)?Number(start.slice(5,7)):1,endMonth:end&&Number(end.slice(0,4))===Number(year)?Number(end.slice(5,7)):12,timing:explicit?.timing||'upfront',timingBasis:explicit?'Recorded structured concession':'One-time credit at modeled lease activation; offer observation dates retained',effectiveStart:start||null,effectiveEnd:end||null};
}

function sourceBudgetLines(bundle,state,property,year,R,limitations){
 const approved=(bundle?.baseline?.lines||[]).filter(line=>Number(line.period?.slice(0,4))===year);
 if(approved.length){
  const rows=new Map(),accounts=new Map((bundle.registry?.accounts||[]).map(a=>[String(a.accountCode),a]));
  for(const line of approved){const gl=String(line.accountCode),a=accounts.get(gl)||{},retained=(state.lines||[]).find(row=>row.propertyId===property.id&&String(row.gl)===gl&&!row.strProgramId&&!row.strProgram);let row=rows.get(gl);if(!row){row={gl,name:a.name||a.accountName||a.category||line.accountName||retained?.name||gl,nature:a.nature||line.nature||retained?.nature||null,behavior:line.behavior||retained?.behavior||null,year,monthly:Array(12).fill(null),source:'ATLAS approved property budget',scope:'property',sourceReferences:[]};rows.set(gl,row);}row.monthly[Number(line.period.slice(5))-1]=finite(line.amount)?line.amount:null;row.sourceReferences.push(clone(line));}
  return [...rows.values()];
 }
 if(R.engine?.computeProperty){try{const computed=R.engine.computeProperty(clone(state),property.id,state.activeScenario||state.scenarios?.[0]?.id,year);return Object.values(computed.results||{}).filter(row=>row.line.propertyId===property.id&&!row.line.strProgram&&!row.line.strProgramId).map(row=>{
  // The builder displays zero for an imported year absent from its workbook.
  // That display default is not financial source evidence for a comparison.
  const missingImportedYear=(row.line.method==='imported'||!row.line.method&&row.line.yearData)&&!Array.isArray(row.line.yearData?.[year]),unavailable=missingImportedYear||row.audit?.error;
  return {gl:String(row.line.gl),name:row.line.name,nature:row.line.nature,behavior:row.line.behavior||null,year,monthly:Array.from({length:12},(_,month)=>!unavailable&&finite(row.monthly?.[month])?row.monthly[month]:null),source:missingImportedYear?`Retained property budget has no imported values for ${year}`:row.audit?.error?'Retained property budget driver could not be evaluated':'ATLAS property budget engine — retained comparison snapshot',scope:'property',sourceLineId:row.line.id,...(row.audit?.error?{sourceError:String(row.audit.error)}:{})};
 });}catch{limitations.push(`Property budget driver values for ${year} could not be calculated; only retained monthly lines are available.`);}}
 return (state.lines||[]).filter(line=>line.propertyId===property.id&&!line.strProgramId&&!line.strProgram).map(line=>({gl:String(line.gl),name:line.name,nature:line.nature,behavior:line.behavior||null,year,monthly:Array.from({length:12},(_,month)=>finite(line.yearData?.[year]?.[month])?line.yearData[year][month]:null),source:Array.isArray(line.yearData?.[year])?'Retained property budget monthly lines':`Retained property budget has no monthly values for ${year}`,scope:'property',sourceLineId:line.id}));
}
function retainedLibraries(R,payload,limitations,registry){
 const saved=payload.sourceContext?.libraries||{},coa=new Map((R.COA||[]).map(account=>[String(account.gl),clone(account)]));for(const account of saved.coaEdits||[])coa.set(String(account.gl),clone(account));
 for(const account of registry?.accounts||[]){const gl=String(account.accountCode||account.gl||'');if(gl)coa.set(gl,{...coa.get(gl),...clone(account),gl,name:account.name||account.accountName||coa.get(gl)?.name||gl});}
 const bindings={assumptions:'ASSUMPTIONS',curves:'CURVES',utilityProviders:'UTILITY_PROVIDERS',utilityBenchmarks:'UTILITY_BENCHMARKS'},libraries={coa:[...coa.values()]};
 for(const [key,global]of Object.entries(bindings))if(saved[key]!==undefined||R[global]!==undefined)libraries[key]=clone(saved[key]??R[global]);
 if(!saved.assumptions&&R.ASSUMPTIONS)limitations.push('The saved programme lacks its assumption library. Current ATLAS assumptions were captured when this comparison loaded; review them before relying on results.');
 return libraries;
}
function withRetainedLibraries(R,libraries,operation){
 const bindings={assumptions:'ASSUMPTIONS',curves:'CURVES',utilityProviders:'UTILITY_PROVIDERS',utilityBenchmarks:'UTILITY_BENCHMARKS'},before=[];
 try{for(const [key,global]of Object.entries(bindings))if(libraries[key]!==undefined){before.push([global,R[global],Object.hasOwn(R,global)]);R[global]=clone(libraries[key]);}return operation();}
 finally{for(const [key,value,existed]of before)if(existed)R[key]=value;else delete R[key];}
}
async function readComparisonSources(central,communityId,years){
 const periods=years.flatMap(year=>Array.from({length:12},(_,i)=>period(year,i))),chunks=[];for(let i=0;i<periods.length;i+=24)chunks.push(periods.slice(i,i+24));
 const parts=await Promise.all(chunks.map(periods=>readSourceBundle(central,{communityId,periods})));
 if(parts.length===1)return parts[0];
 const registries=[...new Set(parts.map(part=>canonicalJson(part.registry)))];if(registries.length!==1)throw Error('The chart of accounts changed while source years were loading. Retry Refresh sources.');
 return {communityId,periods,sourceVersion:fingerprint(parts.map(part=>part.sourceVersion)),registry:parts[0].registry,baseline:{lines:parts.flatMap(part=>part.baseline?.lines||[]),leasing:parts.flatMap(part=>part.baseline?.leasing||[]),versionIds:[...new Set(parts.flatMap(part=>part.baseline?.versionIds||[]))]},actuals:{lines:parts.flatMap(part=>part.actuals?.lines||[]),closeVersions:parts.flatMap(part=>part.actuals?.closeVersions||[]),coveragePolicies:parts.flatMap(part=>part.actuals?.coveragePolicies||[])}};
}
function normalizeProgram(record,kind='shared'){
 const p=record.revision.payload,id=p.sourceProgrammeId||record.head.programme_id;
 // Several saved records may share one builder programme ID. Keep that ID for
 // GL attribution, and use the saved head identity for selection and refresh.
 const selectionKey=kind==='shared'?`shared:${record.head.programme_id}`:`browser:${encodeURIComponent(p.sourcePropertyId)}:${encodeURIComponent(id)}`;
 return {id,selectionKey,sharedId:kind==='shared'?record.head.programme_id:null,name:p.name,version:record.revision.revision,revisionId:record.revision.revision_id||null,contentHash:record.revision.content_hash||fingerprint(p),communityId:record.head.community_id||null,propertyId:p.sourcePropertyId,status:p.programme?.status||p.config?.status||(p.programme?.applied?'Working draft · applied budget model':'Proposed / working draft'),kind,config:clone(p.config||p.programme?.config||{}),years:clone(p.years||[]),record:clone(record)};
}
function localRecord(R,property,programme){
 const state=R.app.state,years=(R.YEARS||[R.app.year?.()]).map(Number).filter(Number.isInteger),config=clone(programme.config||{}),lines=state.lines.filter(row=>row.propertyId===property.id&&row.strProgramId===programme.id);
 const payload={name:programme.name,sourcePropertyId:property.id,sourceProgrammeId:programme.id,config,property:clone(property),programme:clone(programme),lines:clone(lines),years,sourceContext:{property:clone(property),lines:clone(state.lines.filter(row=>row.propertyId===property.id)),programmes:clone((state.strPrograms||[]).filter(row=>row.propertyId===property.id)),scenario:clone(R.app.scenario?.()||null)}};
 return {head:{programme_id:programme.id,community_id:null},revision:{revision:programme.revision||0,created_at:programme.updatedAt||null,content_hash:fingerprint(payload),payload}};
}

export function createComparisonStore({RBB,R=RBB,central=globalThis.parent?.ATLAS_CENTRAL||globalThis.ATLAS_CENTRAL,onStatus=()=>{},onState=()=>{},indexedDB=globalThis.indexedDB}={}){
 if(!R?.app?.state)throw Error('Open Budget Builder before opening comparisons.');
 const context=()=>{const session=central?.getSession?.(),config=central?.getConfig?.()||{};if(central&&(!session?.user?.id||session.expires_at&&session.expires_at*1000<=Date.now()))throw Error('Sign in again before saving or reading comparison records.');return {actor:central?session.user.id:'standalone',backend:config.supabaseUrl||'',api:config.apiBaseUrl||'',accessApi:config.accessApiBaseUrl||'',workspace:config.workspaceId||'portfolio-operations-dashboard',access:central?.getAccessContextKey?.()||canonicalJson(central?.getStoredProfile?.()||{})};};
 const bound=context(),scope=fingerprint({...bound,access:undefined});
 const guard=()=>{if(canonicalJson(context())!==canonicalJson(bound))throw Error('Your account or property access changed. Reopen the comparison workspace.');};
 const status=(state,message,error)=>{onStatus({state,message,error});onState(state,message);};
 let catalog=new Map(),dbPromise=null;
 async function db(){guard();if(!indexedDB)throw Error('Browser storage is unavailable. Keep this page open and download a recovery copy.');if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const open=indexedDB.open(COMPARISON_DB,1);open.onupgradeneeded=()=>{open.result.createObjectStore('comparisons',{keyPath:'key'});open.result.createObjectStore('recovery',{keyPath:'key'});};open.onsuccess=()=>{open.result.onversionchange=()=>{open.result.close();dbPromise=null;};resolve(open.result);};open.onerror=()=>{dbPromise=null;reject(open.error||Error('Comparison storage could not be opened.'));};open.onblocked=()=>{dbPromise=null;reject(Error('Close older comparison tabs and retry saving.'));};});return dbPromise;}
 async function access(storeName,mode,operation){const database=await db();guard();return new Promise((resolve,reject)=>{const tx=database.transaction(storeName,mode),store=tx.objectStore(storeName);let value,failure;const set=valueToSet=>{value=valueToSet;},fail=error=>{failure=error;tx.abort();};try{operation(store,set,fail);}catch(error){fail(error);}tx.oncomplete=()=>{try{guard();resolve(value);}catch(error){reject(error);}};tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('Comparison storage write failed; edits remain open.'));});}
 const getProperty=value=>{const p=typeof value==='object'?value:R.app.state.properties.find(row=>row.id===(value||R.app.state.activeProperty));if(!p)throw Error('Select a property.');return p;};
 async function communityFor(property){guard();if(!central)return null;const results=await Promise.allSettled([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000')]);guard();if(results[0].status==='rejected')throw results[0].reason;const communities=results[0].value,aliases=results[1].status==='fulfilled'?results[1].value:[];const explicit=property.atlasCommunityId||property.sourceIds?.atlasCommunityId||property.communityId;if(explicit&&communities.some(c=>c.community_id===explicit))return explicit;const match=resolveImportCommunity({embeddedNames:[property.name]},communities,aliases);if(!match.communityId)throw Error('This property needs its canonical ATLAS community mapping before shared programmes can be loaded.');return match.communityId;}
 async function listPrograms(value){
  guard();const property=getProperty(value),rows=[],issues=[];let cid=null;
  if(central){try{cid=await communityFor(property);const saved=await readStrProgrammes(central,[cid]);guard();rows.push(...saved.map(row=>normalizeProgram(row)));}catch(error){guard();issues.push('Shared STR programmes unavailable: '+errorText(error));}}
  else issues.push('Standalone browser: shared STR programme service is unavailable.');
  for(const programme of R.app.state.strPrograms||[])if(programme.propertyId===property.id&&!rows.some(row=>row.id===programme.id))rows.push(normalizeProgram(localRecord(R,property,programme),'browser'));
  for(const [key,row] of catalog)if(row.selectedPropertyId===property.id)catalog.delete(key);
  rows.sort((a,b)=>a.name.localeCompare(b.name));for(const row of rows){row.selectedPropertyId=property.id;row.communityId||=cid;catalog.set(`${property.id}:${row.selectionKey}`,clone(row));}
  Object.defineProperty(rows,'issues',{value:issues,enumerable:false});return rows;
 }
 async function loadProgram(id,value,options={}){
  guard();const selected=getProperty(value);let descriptor=typeof id==='object'?id:catalog.get(`${selected.id}:${id}`)||catalog.get(`${selected.id}:shared:${id}`);
  if(!descriptor){const rows=await listPrograms(selected),exact=rows.filter(row=>row.selectionKey===id||row.sharedId===id),matches=exact.length?exact:rows.filter(row=>row.id===id);if(matches.length>1)throw Error('Several saved STR programmes share this source identity. Select the exact saved programme.');descriptor=matches[0];}
  if(!descriptor)throw Error('This saved STR programme is unavailable for the selected property.');
  if(descriptor.selectedPropertyId&&descriptor.selectedPropertyId!==selected.id)throw Error('Select a programme belonging to this property.');
  let record=descriptor.record;
  if(descriptor.kind==='shared'){const rows=await readStrProgrammes(central,[descriptor.communityId],descriptor.sharedId,options.revisionId||null);guard();record=rows[0];if(!record)throw Error('The selected STR saved version is no longer accessible.');}
  else{const live=(R.app.state.strPrograms||[]).find(p=>p.id===descriptor.id&&p.propertyId===selected.id);if(!live)throw Error('This retained programme is no longer present in the browser working draft.');record=localRecord(R,selected,live);}
  const program=normalizeProgram(record,descriptor.kind),payload=record.revision.payload,property=clone(payload.property||payload.sourceContext?.property);
  if(!property?.id)throw Error('The saved STR programme has no retained property source.');
  program.communityId||=descriptor.communityId;program.selectedPropertyId=selected.id;
  const state=clone(R.app.state);state.properties=[property];state.activeProperty=property.id;state.lines=clone(payload.sourceContext?.lines||[]).filter(line=>line.strProgramId!==program.id).concat(clone(payload.lines||[]));state.strPrograms=clone(payload.sourceContext?.programmes||[]).filter(p=>p.id!==program.id).concat(clone(payload.programme||[]));
  if(payload.sourceContext?.scenario){state.scenarios=[clone(payload.sourceContext.scenario)];state.activeScenario=payload.sourceContext.scenario.id;}
  state.actuals=Object.fromEntries(Object.entries(state.actuals||{}).filter(([,row])=>row.propertyId===selected.id));state.actualsDetail=(state.actualsDetail||[]).filter(row=>row.propertyId===selected.id);state.periods=Object.fromEntries(Object.entries(state.periods||{}).filter(([key])=>key.startsWith(selected.id+'|')));
  if(selected.id!==property.id){state.actuals={};state.actualsDetail=[];state.periods={};}
  const year=Number(options.year||program.years?.[0]||R.app.year?.()),retainedYears=state.lines.filter(line=>line.propertyId===property.id).flatMap(line=>Object.keys(line.yearData||{})),years=[...new Set([year,...program.years,...retainedYears,...Object.keys(program.config.unitRamp||{})].map(Number))].filter(y=>Number.isInteger(y)&&y>=2000&&y<2100).sort(),limitations=[];let bundle=null,specials=null;
  const requests=await Promise.allSettled([program.communityId&&central?readComparisonSources(central,program.communityId,years):Promise.reject(Error('No shared financial community mapping is available.')),program.communityId&&central?.propertySpecials?central.propertySpecials('read',{communityId:program.communityId,communityName:selected.name}):Promise.reject(Error('ATLAS website concession service is unavailable.'))]);guard();
  if(requests[0].status==='fulfilled')bundle=requests[0].value;else limitations.push('Governed actuals and approved GL source unavailable: '+errorText(requests[0].reason));
  if(requests[1].status==='fulfilled'){specials=requests[1].value;if(specials.communityId&&specials.communityId!==program.communityId)throw Error('The concession source belongs to another community.');}else limitations.push('Current concessions unavailable: '+errorText(requests[1].reason));
  const registry=clone(bundle?.registry||{version:null,accounts:[]}),actuals=bundle?normalizeComparisonActuals(bundle,{state,property,year,registry}):years.flatMap(year=>normalizeComparisonActuals(null,{state,property,year,registry})),concession=normalizeComparisonConcession(specials,{year});
  if(!concession.available)limitations.push(concession.reason);
  if(!actuals.length)limitations.push('No recorded actuals are available for this reporting year.');
  else if(actuals.some(row=>row.scope==='property'))limitations.push('Property-level actuals require an explicit GL allocation rule before attribution to this STR programme.');
  if(!bundle&&actuals.length)limitations.push('Browser imported actuals are preliminary; their governed close status could not be verified.');
  if(payload.configurationChangedSinceApplied)limitations.push('Saved programme drivers differ from its retained applied GL values. The comparison models the saved proposed drivers.');
  const references=[{kind:descriptor.kind==='shared'?'saved_str_programme':'browser_str_programme',programmeId:program.id,sharedId:program.sharedId,revisionId:program.revisionId,version:program.version,contentHash:program.contentHash,savedAt:record.revision.created_at||null},{kind:'ltr_floor_plan_rent',source:'Saved STR builder LT Rent column (property.units.marketRent)',propertyId:property.id},{kind:'actuals',sourceVersion:bundle?.sourceVersion||null,closeVersions:clone(bundle?.actuals?.closeVersions||[])},{kind:'chart_of_accounts',version:registry.version},{kind:'concession',offerId:concession.offerId,reviewedAt:concession.reviewedAt,source:concession.source}];
  const libraries=retainedLibraries(R,payload,limitations,registry),budgetLines=withRetainedLibraries(R,libraries,()=>years.flatMap(year=>sourceBudgetLines(bundle,state,property,year,R,limitations)));
  const source={year,years,actuals,concession,concessionsByYear:Object.fromEntries(years.map(y=>[y,normalizeComparisonConcession(specials,{year:y})])),budgetLines,libraries,registry,references,limitations,loadedAt:new Date().toISOString(),actualsMeta:{latestMonth:actuals.filter(row=>finite(row.amount)).map(row=>row.period).sort().at(-1)||null,latestClosedMonth:actuals.filter(row=>row.status==='closed').map(row=>row.period).sort().at(-1)||null,updatedAt:actuals.map(row=>row.updatedAt).filter(Boolean).sort().at(-1)||null,status:actuals.length?(actuals.every(row=>row.status==='closed')?'closed':'preliminary'):'unavailable',missingCoverage:clone(bundle?.actuals?.coveragePolicies||[]),closeVersions:clone(bundle?.actuals?.closeVersions||[])},budgetLeasing:clone(bundle?.baseline?.leasing||[]),sourceVersion:bundle?.sourceVersion||null};
  const inputs={program,property,state,source,loadedAt:source.loadedAt};inputs.sourceFingerprint=comparisonSourceFingerprint(inputs);return inputs;
 }
 async function read(id){guard();const value=await access('comparisons','readonly',(store,set)=>{const req=store.get(`${scope}:${id}`);req.onsuccess=()=>set(req.result?.record||null);});return verifySaved(value);}
 async function listScenarios(value){guard();const selected=getProperty(value),values=await access('comparisons','readonly',(store,set)=>{const req=store.getAll();req.onsuccess=()=>set(req.result.filter(row=>row.scope===scope&&(row.record.propertyId===selected.id||row.record.inputs?.program?.selectedPropertyId===selected.id)).map(row=>row.record));});return values.map(verifySaved).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));}
 async function save(record,{expectedRevision=record?.revision||0}={}){
  guard();const retained=clone(record);validateComparison(retained);const recoveryVersion=uuid(),key=`${scope}:${retained.id}`;status('saving','Saving comparison in this browser…');
  try{
   await access('recovery','readwrite',(store)=>store.put({key,scope,record:retained,recoveryVersion,updatedAt:new Date().toISOString()}));guard();
   const saved=await access('comparisons','readwrite',(store,set,fail)=>{const req=store.get(key);req.onsuccess=()=>{try{guard();const existing=verifySaved(req.result?.record);if((existing?.revision||0)!==expectedRevision)throw Error('This comparison changed in another tab. Your edit is retained for recovery; reopen the saved comparison or duplicate the recovered edit.');const next={...retained,revision:expectedRevision+1,updatedAt:new Date().toISOString(),persistence:'browser'};delete next.contentHash;next.contentHash=fingerprint(next);store.put({key,scope,record:next});set(next);}catch(error){fail(error);}};});
   const verified=await read(saved.id);if(canonicalJson(verified)!==canonicalJson(saved))throw Error('The saved comparison changed before readback. Your edit is retained.');
   await access('recovery','readwrite',store=>{const req=store.get(key);req.onsuccess=()=>{if(req.result?.recoveryVersion===recoveryVersion)store.delete(key);};});
   status('saved','Saved in this browser');return verified;
  }catch(error){status('failed','Save failed — your open edit is retained. '+errorText(error),error);throw error;}
 }
 async function listRecovery(value){guard();const pid=propertyId(value);return access('recovery','readonly',(store,set)=>{const req=store.getAll();req.onsuccess=()=>set(req.result.filter(row=>row.scope===scope&&(!pid||row.record.propertyId===pid||row.record.inputs?.program?.selectedPropertyId===pid)).map(row=>({record:clone(row.record),updatedAt:row.updatedAt,recoveryVersion:row.recoveryVersion})));});}
 async function duplicate(record,name){guard();const next=clone(record);next.id=uuid();next.name=name?.trim()||`${record.name} — copy`;next.revision=0;next.createdAt=new Date().toISOString();next.updatedAt=null;delete next.contentHash;if(next.snapshot){next.snapshot.name=next.name;if(next.snapshot.scenario)Object.assign(next.snapshot.scenario,{id:next.id,name:next.name,revision:1});if(next.snapshot.metadata)Object.assign(next.snapshot.metadata,{scenarioName:next.name,name:next.name,comparisonRevision:1,comparisonId:next.id});}return save(next);}
 async function completeRecovery({id,recoveryVersion,replacement}){
  guard();const saved=await read(replacement?.id);if(!saved||saved.contentHash!==replacement.contentHash)throw Error('The recovered copy must be saved and verified before clearing its pending edit.');
  return access('recovery','readwrite',(store,set,fail)=>{const req=store.get(`${scope}:${id}`);req.onsuccess=()=>{const pending=req.result;if(!pending){set(false);return;}if(pending.recoveryVersion!==recoveryVersion){set(false);return;}if(saved.id===pending.record.id||canonicalJson(saved.inputs)!==canonicalJson(pending.record.inputs)||canonicalJson(saved.scenario)!==canonicalJson(pending.record.scenario)){fail(Error('The recovered copy differs from the exact pending comparison edit.'));return;}store.delete(`${scope}:${id}`);set(true);};});
 }
 async function refreshedInputs(record){const selected=R.app.state.properties.find(p=>p.id===(record.inputs?.program?.selectedPropertyId||record.propertyId));if(!selected)throw Error('The comparison property is no longer available.');const p=record.inputs.program;return loadProgram({...p,selectedPropertyId:selected.id},selected,{year:record.scenario.year});}
 async function checkSources(record){guard();const inputs=await refreshedInputs(record);return {changed:inputs.sourceFingerprint!==record.inputs.sourceFingerprint,sourceFingerprint:inputs.sourceFingerprint,inputs};}
 async function refreshSources(record){guard();const inputs=await refreshedInputs(record),next=clone(record);next.inputs=inputs;next.propertyId=inputs.property.id;next.programmeId=inputs.program.id;next.communityId=inputs.program.communityId;next.refreshedAt=new Date().toISOString();delete next.results;delete next.snapshot;return next;}
 return {listPrograms,loadProgram,listScenarios,save,read,duplicate,checkSources,refreshSources,listRecovery,completeRecovery,guard,persistence:'browser',close:async()=>{(await dbPromise)?.close();dbPromise=null;}};
}
