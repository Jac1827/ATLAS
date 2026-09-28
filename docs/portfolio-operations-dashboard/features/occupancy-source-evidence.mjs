// Aggregate source evidence only. Never publishes occupancy, collections, or a financial baseline.
const text = value => String(value ?? '').trim();
const norm = value => text(value).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
const suffix = value => norm(text(value).split(':').pop());
const numeric = value => {
  if (value == null || typeof value === 'boolean' || !text(value) || /^(?:=|#)|^(?:n\/a|[-–—])$/i.test(text(value))) return null;
  const raw = text(value).replace(/^\((.*)\)$/, '-$1').replace(/[$,\s]/g, '');
  return /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null;
};
const count = value => { const n = numeric(value); return Number.isInteger(n) && n >= 0 ? n : null; };
const sum = values => values.length && values.every(value => value !== null) ? values.reduce((a, b) => a + b, 0) : null;
const ratio = (a, b) => a !== null && b > 0 ? a / b * 100 : null;
function isoDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value); let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/), y, m, d;
  if (match) [, y, m, d] = match;
  else if ((match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, m, d, y] = match;
  else return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}
function periodFromRows(rows) {
  for (const row of rows.slice(0, 6)) {
    const raw = text(row?.[0]), dates = raw.match(/\d{1,2}\/\d{1,2}\/\d{4}/g);
    if (dates?.length === 2) { const a = isoDate(dates[0]), b = isoDate(dates[1]); if (a && b && a.slice(0, 7) === b.slice(0, 7)) return a.slice(0, 7); }
    const m = raw.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i);
    if (m) return `${m[2]}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`;
  }
  return null;
}
function table(rows, anchor, headerTest, totalTest) {
  const start = rows.findIndex(row => anchor.test(text(row?.[0])));
  if (start < 0) return null;
  const header = rows.findIndex((row, i) => i > start && i <= start + 5 && headerTest(row));
  if (header < 0) return null;
  const end = rows.findIndex((row, i) => i > header && totalTest(row));
  if (end < 0) return null;
  return {start, header, end, headers: rows[header], total: rows[end], detail: rows.slice(header + 1, end)};
}
function readControl(t, label, {integer = false, occurrence = 0} = {}) {
  if (!t) return {value:null, row:null, column:null, header:label};
  const columns = t.headers.flatMap((header, i) => suffix(header) === label ? [i] : []), column = columns[occurrence];
  const parse = integer ? count : numeric;
  return {value: column == null ? null : parse(t.total[column]), row:t.end + 1, column:column == null ? null : column + 1, header:column == null ? label : text(t.headers[column])};
}
function boxEvidence(rows) {
  const t = table(rows, /^availability\b/i, r => norm(r?.[0]) === 'unit type', r => /^total:?$/i.test(text(r?.[0])));
  if (!t) return {status:'unavailable', reason:'Availability totals are missing; filtered-empty is not zero.'};
  const controls = {};
  const get = (field, label, integer = true) => (controls[field] = readControl(t, label, {integer})).value;
  const totalUnits = get('totalUnits', 'units'), rentableUnits = get('rentableUnits', 'rentable units');
  const excludedUnits = get('excludedUnits', 'excluded');
  const occupiedParts = ['occupied no notice','notice rented','notice unrented'].map((label,i) => get(['occupiedNoNotice','noticeRented','noticeUnrented'][i],label));
  const occupiedUnits = get('occupiedUnits','occupied') ?? sum(occupiedParts);
  const vacantRentedUnits = get('vacantRentedUnits','vacant rented') ?? sum(['vacant rented ready units','vacant rented not ready units'].map((label,i)=>get(['vacantRentedReady','vacantRentedNotReady'][i],label)));
  const leasedUnits = get('leasedUnits','leased units') ?? sum([occupiedUnits,vacantRentedUnits]);
  const availableUnits = get('availableUnits','available');
  const totalEffectiveRent = get('totalEffectiveRent','total effective rent',false), totalBudgetedRent = get('totalBudgetedRent','total budgeted rent',false);
  const anchor = text(rows[t.start]?.[0]), asOf = isoDate(anchor.match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0]);
  const valid = !!asOf && [totalUnits,rentableUnits,occupiedUnits,leasedUnits,vacantRentedUnits].every(v=>v !== null) && rentableUnits > 0 && rentableUnits <= totalUnits && occupiedUnits <= rentableUnits && leasedUnits <= rentableUnits && leasedUnits === occupiedUnits + vacantRentedUnits && (excludedUnits === null || rentableUnits + excludedUnits === totalUnits);
  return {status:valid?'valid':'unavailable',reason:valid?'Reported leased units include occupied and vacant-rented inventory.':'Availability counts are missing or do not reconcile.',asOf,measurementBasis:t.headers.some(h=>suffix(h)==='units')&&t.headers.some(h=>suffix(h)==='rentable units')?'units':null,totalUnits,rentableUnits,excludedUnits,occupiedUnits,leasedUnits,vacantRentedUnits,availableUnits,leasedPercent:valid?ratio(leasedUnits,rentableUnits):null,totalEffectiveRent,totalBudgetedRent,controls};
}
function agingEvidence(rows) {
  const header = rows.findIndex(row => row.some(v=>norm(v)==='31-60 days') && row.some(v=>norm(v)==='90+ days'));
  if (header < 0) return {status:'unavailable',above30:null,reason:'Named aging buckets are missing.'};
  const end = rows.findIndex((row,i) => i > header && row.some(v => /(?:^|\s)total:$/i.test(text(v))));
  if (end < 0) return {status:'unavailable',above30:null,reason:'Aging totals are missing; filtered-empty is not zero.'};
  const t = {headers:rows[header],total:rows[end],end}, controls = Object.fromEntries([['days31to60','31-60 days'],['days61to90','61-90 days'],['days90plus','90+ days'],['days0to30Excluded','0-30 days']].map(([field,label])=>[field,readControl(t,label)]));
  const above30 = sum(['days31to60','days61to90','days90plus'].map(key=>controls[key].value));
  return {status:above30===null?'unavailable':'valid',above30,controls,excluded:['0–30 days','prepayments','unallocated charges/credits','balance'],reason:'Only the three older aging buckets are included; report filters still limit coverage.'};
}
function rentEvidence(rows) {
  const header = rows.findIndex(row => row.some(v=>norm(v)==='unit status') && row.some(v=>norm(v)==='expected move-out'));
  if (header < 0) return {status:'unavailable',reason:'Current unit detail headers are missing.'};
  const end = rows.findIndex((row,i)=>i>header && row.some(v=>/(?:^|\s)total:$/i.test(text(v))));
  if (end < 0) return {status:'unavailable',reason:'Current unit total is missing.'};
  const columns = rows[header].map(norm), idx = label => columns.indexOf(label);
  const unitCol = idx('bldg-unit'), statusCol = idx('unit status');
  if(unitCol<0||statusCol<0)return {status:'unavailable',reason:'Current unit identity or status header is missing.'};
  const units = new Map(), duplicateUnits = new Set();
  for (const row of rows.slice(header+1,end)) {
    const unit = text(row[unitCol]); if (!unit) continue;
    if (units.has(unit)) duplicateUnits.add(unit);
    units.set(unit,norm(row[statusCol]));
  }
  if(!units.size)return {status:'unavailable',reason:'Current unit inventory is missing; an empty detail is not a zero-unit source.'};
  const vacantRented = new Set([...units].filter(([,status])=>status.startsWith('vacant rented')).map(([unit])=>unit));
  const start = rows.findIndex(row=>norm(row?.[0])==='future resident details');
  const futureHeader = rows.findIndex((row,i)=>i>start && i<=start+3 && row.some(v=>norm(v)==='lease start') && row.some(v=>norm(v)==='move-in'));
  if (start<0 || futureHeader<0) return {status:'unavailable',signedVacantUnits:vacantRented.size,datedMoveIns:[],undatedUnits:vacantRented.size,complete:false,reason:'Future resident details are unavailable.'};
  const fh=rows[futureHeader].map(norm), fidx=label=>fh.indexOf(label), perUnit=new Map(), ambiguous=new Set();
  if(fidx('bldg-unit')<0)return {status:'unavailable',signedVacantUnits:vacantRented.size,datedMoveIns:[],undatedUnits:vacantRented.size,complete:false,reason:'Future unit identities cannot be joined to current vacant-rented inventory.'};
  for (const row of rows.slice(futureHeader+1)) {
    if (row.some(v=>/(?:^|\s)total:$/i.test(text(v)))) break;
    const unit=text(row[fidx('bldg-unit')]);
    if (!unit || !vacantRented.has(unit)) continue;
    const item={moveIn:isoDate(row[fidx('move-in')]),leaseStart:isoDate(row[fidx('lease start')])};
    if (perUnit.has(unit) && JSON.stringify(perUnit.get(unit))!==JSON.stringify(item)) ambiguous.add(unit);
    perUnit.set(unit,item);
  }
  const dates=new Map(),starts=new Map();let dated=0;
  for(const [unit,value] of perUnit) {
    if(ambiguous.has(unit)||duplicateUnits.has(unit))continue;
    if(value.moveIn){dates.set(value.moveIn,(dates.get(value.moveIn)||0)+1);dated++;}
    if(value.leaseStart)starts.set(value.leaseStart,(starts.get(value.leaseStart)||0)+1);
  }
  const list=m=>[...m].sort(([a],[b])=>a.localeCompare(b)).map(([date,count])=>({date,count}));
  return {status:duplicateUnits.size||ambiguous.size?'unavailable':'valid',signedVacantUnits:vacantRented.size,datedMoveIns:list(dates),datedLeaseStarts:list(starts),undatedUnits:vacantRented.size-dated,complete:dated===vacantRented.size && !duplicateUnits.size && !ambiguous.size,duplicateUnitCount:duplicateUnits.size,ambiguousFutureUnitCount:ambiguous.size,sourceRows:{currentHeader:header+1,currentTotal:end+1,futureHeader:futureHeader+1},reason:'Scheduled move-ins for unique currently vacant-rented units only; undated inventory is not assigned to a month.'};
}
/** Parses cached numeric totals by exact header meaning. PII never leaves this function. */
export function parseOccupancySheet({rows=[],reportType,sourceSheet='',metadata={},fileHash='',sourceFile='',reportParameters=[]}={}) {
  if(!['box_score','rent_roll','delinquency'].includes(reportType))return null;
  const titles={box_score:/(?:^|-\s*)box score(?:\s+v?\d+(?:\.\d+)*)?$/i,rent_roll:/(?:^|-\s*)rent roll(?:\s+v?\d+(?:\.\d+)*)?$/i,delinquency:/(?:^|-\s*)(?:resident aged receivables|delinquent and prepaid report)(?:\s+v?\d+(?:\.\d+)*)?$/i};
  const title=rows.findIndex((row,i)=>i<6 && titles[reportType].test(text(row?.[0])));
  if(title<0)return null;
  const embeddedCommunity=text(rows[title+1]?.[0]);
  const identityMatches=!!embeddedCommunity && norm(embeddedCommunity)===norm(sourceSheet);
  const sourcePeriod=periodFromRows(rows), empty=rows.some(row=>row.some(v=>/selected report filters returned no data/i.test(text(v))));
  const parameterKeys=new Set(['calculate delinquency using','period','lease statuses','minimum unpaid balance','inter-company','unpaid deposits','lease occupancy types','lease terms (student)','unit status','future resident details includes','future residents not assigned a unit','consider proration for scheduled charges']);
  const reportScope=reportParameters.filter(row=>parameterKeys.has(norm(row?.[0]))).map(row=>({label:text(row[0]),value:text(row[1])}));
  const base={schemaVersion:1,reportType,reportScope,propertySource:embeddedCommunity,sourceSheet,period:sourcePeriod,sourceFile,sourceFingerprint:fileHash,sourceEffectiveAt:text(metadata.dataAsOf||metadata.generatedAt),status:identityMatches&&sourcePeriod&&!empty?'valid':'unavailable',reason:!identityMatches?'Embedded community and source sheet disagree.':!sourcePeriod?'Source period is unavailable.':empty?'Source reports no data; this is not zero.':null};
  if(base.status!=='valid')return base;
  return {...base,...(reportType==='box_score'?{snapshot:boxEvidence(rows)}:reportType==='rent_roll'?{pipeline:rentEvidence(rows)}:{aging:agingEvidence(rows)})};
}
const unavailable = reason => ({status:'unavailable',reason});
const sameCommunity=(row,name,id)=>row.communityId?row.communityId===id:row.communityName===name;
function sourceTime(row) { const n=Date.parse(row?.dataAsOf||row?.occupancyEvidence?.sourceEffectiveAt||'');return Number.isFinite(n)?n:null; }
function selectSource(importState,type,communityName,communityId,period,asOf) {
  const cut=asOf?Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(asOf)?`${asOf}T23:59:59.999Z`:asOf):null;
  const records=(importState?.canonicalRecords||[]).filter(r=>r.reportType===type && sameCommunity(r,communityName,communityId) && (!period||r.periodKey===period));
  if(asOf&&!Number.isFinite(cut))return {rows:[],...unavailable('Requested source cutoff is invalid.')};
  const approved=records.filter(r=>!r.deletedAt && !r.rolledBackAt && r.fileHash && !(importState.sourceArchive||[]).some(a=>a.fileHash===r.fileHash&&(a.deletedAt||a.rolledBackAt||/rolled\s*back/i.test(a.importStatus||''))) && ((importState.sourceArchive||[]).some(a=>a.importStatus==='Approved' && a.reportType===type && a.fileHash===r.fileHash && (!a.batchId||a.batchId===r.batchId)) || (importState.lineage||[]).some(l=>l.currentState===true && sameCommunity(l,r.communityName,communityId) && l.periodKey===r.periodKey && l.reportType===type && l.fileHash===r.fileHash)));
  if(approved.some(r=>sourceTime(r)===null))return {rows:[],...unavailable('An approved source has no effective date; its precedence requires review.')};
  const eligible=approved.filter(r=>!Number.isFinite(cut)||sourceTime(r)<=cut);
  if(!eligible.length)return {rows:[],...unavailable('No scoped approved source with an effective date is available.')};
  const latest=Math.max(...eligible.map(sourceTime)), rows=eligible.filter(r=>sourceTime(r)===latest);
  if(rows.some(r=>r.downstreamEligible===false))return {rows:[],...unavailable('The latest approved source is held from downstream use; no older fallback is selected.')};
  if(new Set(rows.map(r=>`${r.fileHash}|${r.periodKey}`)).size!==1)return {rows:[],...unavailable('Latest source versions conflict; choose the approved controlling source.')};
  const first=rows[0];return {rows,status:'valid',sourceFingerprint:first.fileHash,sourceFile:first.sourceFile,asOf:new Date(latest).toISOString(),period:first.periodKey};
}
function field(rows,key,parser=numeric) {
  const values=rows.filter(r=>Object.hasOwn(r.values||{},key)).map(r=>parser(r.values[key]));
  return values.length&&values.every(v=>v!==null&&v===values[0])?values[0]:null;
}
function retainedEvidence(source,key) {
  const items=source.rows.map(r=>r.occupancyEvidence).filter(Boolean);
  if(!items.length)return null;
  if(items.some(e=>e.status!=='valid'||e.period!==source.period||e.sourceFingerprint!==source.sourceFingerprint))return unavailable('Retained source aggregate identity or period is invalid.');
  const unique=[...new Map(items.filter(e=>e[key]).map(e=>[JSON.stringify(e[key]),e[key]])).values()];
  return unique.length===1?unique[0]:unique.length>1?unavailable('Retained source aggregate controls conflict.'):null;
}
/** Reads only the caller's authorized community. Original import records and history are never modified. */
export function readOccupancySourceEvidence({communityId,communityName,period='',asOf='',record,importState={}}={}) {
  const missing=unavailable('Authorized community identity is required.');
  const out={snapshot:{...missing,communityId,occupiedUnits:null,leasedUnits:null,rentableUnits:null,totalUnits:null},closing:{...missing,kind:'application_to_lease_activity',applications:null,leases:null},pipeline:{...missing,communityId,signedVacantUnits:null,datedMoveIns:[],undatedUnits:null,complete:false},movements:{...unavailable('Remaining future move-outs are not established by period activity totals.'),communityId,remainingMoveOuts:null,period:null,asOf:null,complete:false,basis:'remaining_scheduled'},economic:{...unavailable('Effective-rent estimate source evidence is incomplete.'),basis:'effective_rent_less_aged_over30',actualCashCollected:null,value:null}};
  if(!communityId||!communityName)return out;
  const b=selectSource(importState,'box_score',communityName,communityId,period,asOf), a=selectSource(importState,'delinquency',communityName,communityId,period,asOf), r=selectSource(importState,'rent_roll',communityName,communityId,period,asOf);
  const cite=s=>({communityId,period:s.period||null,asOf:s.asOf||null,sourceFingerprint:s.sourceFingerprint||null,sourceFile:s.sourceFile||null,reportScope:s.rows.find(row=>row.occupancyEvidence)?.occupancyEvidence?.reportScope||[]});
  const bs=retainedEvidence(b,'snapshot');
  const printedDates=[...new Set(b.rows.filter(row=>/^availability$/i.test(text(row.section))).map(row=>isoDate(row.sectionPeriod?.asOf)).filter(Boolean))];
  const observedDate=bs?isoDate(bs.asOf):printedDates.length===1?printedDates[0]:null;
  const occupied=bs?bs.occupiedUnits:field(b.rows,'occupied_units',count)??sum(['occupied_no_notice','notice_rented','notice_unrented'].map(k=>field(b.rows,k,count)));
  const vacant=bs?bs.vacantRentedUnits:field(b.rows,'vacant_rented',count);
  const leased=bs?bs.leasedUnits:field(b.rows,'source_leased_units',count)??sum([occupied,vacant]);
  const rentable=bs?bs.rentableUnits:field(b.rows,'rentable_units',count), total=bs?bs.totalUnits:field(b.rows,'total_units',count);
  const measurementBasis=bs?bs.measurementBasis:field(b.rows,'measurement_basis',value=>['units','beds'].includes(norm(value))?norm(value):null);
  const observationInScope=!!observedDate&&(!asOf||(Number.isFinite(Date.parse(asOf))&&observedDate<=new Date(Date.parse(asOf)).toISOString().slice(0,10)));
  const valid=b.status==='valid' && observationInScope && (!bs||bs.status==='valid') && [occupied,leased,rentable,total].every(v=>count(v)!==null) && rentable>0 && occupied<=leased && leased<=rentable && rentable<=total && (vacant===null || vacant===undefined || leased===occupied+vacant);
  out.snapshot={...cite(b),sourceEffectiveAt:b.asOf||null,sourcePeriod:b.period||null,period:observedDate?.slice(0,7)||null,asOf:observedDate,status:valid?'valid':'unavailable',reason:valid?'Source leased count includes the vacant-rented pipeline.':bs?.reason||b.reason||'Missing or conflicting leased inventory controls.',occupiedUnits:valid?occupied:null,leasedUnits:valid?leased:null,rentableUnits:valid?rentable:null,totalUnits:valid?total:null,leasedPercent:valid?ratio(leased,rentable):null,measurementBasis};
  const conversionRows=b.rows.filter(row=>/^lead conversions$/i.test(text(row.section)));
  const applications=field(conversionRows,'applications',count), leases=field(conversionRows,'leases_completed',count);
  const closingValid=b.status==='valid' && applications>0 && leases!==null && leases<=applications;
  out.closing={...cite(b),kind:'application_to_lease_activity',applications,leases,rate:closingValid?leases/applications:null,status:closingValid?'valid':'unavailable',reason:closingValid?'Latest completed leases / completed applications: same-period activity proxy, not a matched applicant cohort.':'Latest activity needs a positive application denominator and lease count no greater than applications; no default or older fallback is used.'};
  const rp=retainedEvidence(r,'pipeline');
  if(rp)out.pipeline={...rp,...cite(r),source:cite(r),status:rp.status,complete:rp.complete===true};
  const aged=retainedEvidence(a,'aging');
  const samePeriod=b.period&&b.period===a.period;
  const effective=bs?.totalEffectiveRent??field(b.rows,'total_effective_rent'), budget=bs?.totalBudgetedRent??field(b.rows,'total_budgeted_rent');
  const aging=aged?.status==='valid'?aged.above30:null;
  const economicValid=valid && observedDate?.slice(0,7)===b.period && a.status==='valid' && samePeriod && effective!==null && budget>0 && aging!==null;
  out.economic={status:economicValid?'valid':'unavailable',basis:'effective_rent_less_aged_over30',label:'Effective-rent occupancy estimate',actualCashCollected:null,totalEffectiveRent:effective??null,totalBudgetedRent:budget??null,agedAbove30:aging,percent:economicValid?(effective-aging)/budget*100:null,value:economicValid?(effective-aging)/budget:null,period:samePeriod?b.period:null,sources:[cite(b),cite(a)],reason:economicValid?'Effective rent less 31–60, 61–90 and 90+ aging / budgeted rent. Cash receipts are not supplied by these reports.':'Matching source period, effective rent, budgeted rent and all three older aging buckets are required.'};
  return out;
}
