import {hashReforecastWorkbook,encodeOriginalWorkbook,normalizeReforecastNumber,normalizeReforecastPeriod,loadXlsx} from './reforecast-intake.mjs?v=87e68da483f77228';
import {pdfItemsToText} from './financial-package.mjs?v=9e34c3c633e9477e';

// Provider evidence is never a financial close or an approval. Restricted detail stays in the source bundle.
export const PROVIDER_PARSER_VERSION='atlas-provider-statement/1';
const PERIOD=/^20\d{2}-(0[1-9]|1[0-2])$/;
const finite=Number.isFinite, clone=value=>JSON.parse(JSON.stringify(value));
const money=value=>finite(value)?Math.round((value+Math.sign(value)*Number.EPSILON)*100)/100:null;
const sum=values=>values.length&&values.every(finite)?money(values.reduce((a,b)=>a+b,0)):null;
const issue=(code,message,source={})=>({code,message,severity:'blocking',...source});
const days=period=>new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).getUTCDate();
const pct=value=>typeof value==='string'&&value.trim().endsWith('%')?normalizeReforecastNumber(value.trim().slice(0,-1)):normalizeReforecastNumber(value);
const dateValue=value=>value instanceof Date&&!Number.isNaN(value.valueOf())?value.toISOString().slice(0,10):/^20\d{2}-\d{2}-\d{2}$/.test(String(value))?String(value):null;
const unitFields=['unitId','occupiedNights','rent','utilities','lateFee','damages','parking','pet','other','totalRevenue','netRentPercent','netRent','installOtherFees','ffeServiceFee','wifiServiceFee','partnerAdjustment','netAllocation'];
const reservationFields=['unitId','reservationId','startDate','endDate','standby','rent','utilities','lateFee','damages','parking','pet','other','totalRevenue','netRentPercent','netRent','partnerAdjustment','reservationNet'];
const revenueFields=['rent','utilities','lateFee','damages','parking','pet','other'];
const summaryLabels={totalRevenue:'Total Revenue',managementFee:'Management Fee',installOtherFees:'Install / Other Fees',ffeServiceFee:'FF&E Service Fee',wifiServiceFee:'WiFi Service Fee',partnerAdjustment:'Partner Adjustment',netAllocation:'Net Allocation'};
const headerNames={unitnumber:'unitId',unitid:'unitId'};
Object.assign(headerNames,{referenceid:'reservationId',reservationid:'reservationId',occupiednights:'occupiedNights',startdate:'startDate',enddate:'endDate',standby:'standby',rent:'rent',utilities:'utilities',latefee:'lateFee',damages:'damages',parking:'parking',pet:'pet',other:'other',totalrevenue:'totalRevenue',netrent:'netRent',netrentpercent:'netRentPercent',netrentpercentage:'netRentPercent',installotherfees:'installOtherFees',ffeservicefee:'ffeServiceFee',wifiservicefee:'wifiServiceFee',partneradjustment:'partnerAdjustment',netallocation:'netAllocation',reservationnet:'reservationNet'});
const keyOf=value=>String(value??'').trim().toLowerCase().replace('%','percent').replace(/[^a-z]/g,'');

function detailRow(input,fields,source){
 const row={source};
 for(const field of fields){const value=Array.isArray(input)?input[fields.indexOf(field)]:input[field];
  row[field]=['unitId','reservationId'].includes(field)?(value==null||value===''?null:String(value)):
   ['startDate','endDate'].includes(field)?dateValue(value):field==='standby'?(value===true||/^yes$/i.test(String(value))?true:value===false||/^no$/i.test(String(value))?false:null):
   field==='netRentPercent'?(typeof value==='number'&&value>=0&&value<=1?value*100:pct(value)):normalizeReforecastNumber(value);
 }
 return row;
}
function extractText(text){
 const result={summary:{},units:[],reservations:[],issues:[],propertyName:null,propertyId:null,period:null};
 let section=null,page=1;
 for(const [index,raw] of String(text||'').split(/\r?\n/).entries()){
  const line=raw.trim(),source={page,line:index+1};
  if(line==='\f'){page++;continue;}
  const period=line.match(/\bMonth\s+([A-Za-z]+\s+20\d{2})\b/i);
  if(period){const value=normalizeReforecastPeriod(period[1]);if(result.period&&result.period!==value)result.issues.push(issue('multiple_statement_periods','Use one monthly statement per source file.',source));result.period=value;}
  const property=line.match(/\bProperty Name\s+(.+?)(?=\s+Total Revenue\b|$)/i);if(property)result.propertyName=property[1].trim();
  const propertyId=line.match(/\b(?:Autopilot Revenue Share|Property ID)\s+(\d+)/i);if(propertyId)result.propertyId=propertyId[1];
  const occupancy=line.match(/Occupancy Rate\s+([\d.]+)%/i);if(occupancy)result.summary.occupancyPercent=pct(occupancy[1]);
  if(!section)for(const [key,label] of Object.entries(summaryLabels)){
   const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll(' ','\\s*');
   const match=line.match(new RegExp(escaped+'\\s+(\\(?\\$?[-+]?\\d[\\d,]*(?:\\.\\d+)?\\)?)','i'));
   if(match)result.summary[key]=normalizeReforecastNumber(match[1]);
  }
  if(/Reservation(?: Level)? Detail/i.test(line)||/Unit Number\s+Reference ID/i.test(line)){section='reservations';continue;}
  if(/Unit(?: Level)? Detail/i.test(line)||/Unit Number\s+Occupied Nights/i.test(line)){section='units';continue;}
  if(!section||!line||/^(?:Unit Number|Summary|Financial Summary)/i.test(line))continue;
  const tokens=line.match(/\([^)]*\)|\S+/g)||[],fields=section==='units'?unitFields:reservationFields;
  if(tokens.length===fields.length){result[section].push(detailRow(tokens,fields,source));}
  else if(tokens.some(token=>/\$|%/.test(token))&&!/^Net Allocation\b/i.test(line))result.issues.push(issue('unparsed_statement_detail','A detail row could not be read completely. Review the original file.',source));
 }
 return result;
}
function extractRows(rows){
 const result={summary:{},units:[],reservations:[],issues:[]};let header=null,previousSheet=null;
 for(const [index,item] of (rows||[]).entries()){
  const cells=Array.isArray(item)?item:item.cells||[],source={sheet:item.sheet||'Statement',row:item.row||index+1};
  if(previousSheet&&source.sheet!==previousSheet)header=null;previousSheet=source.sheet;
  const keys=cells.map(keyOf);
  if(keys.includes('unitnumber')||keys.includes('unitid')){header=cells.map(value=>headerNames[keyOf(value)]||null);continue;}
  if(header&&cells.some(value=>value!==null&&value!==''&&value!==undefined)){
   if(/^(?:Reservation(?: Level)? Detail|Unit(?: Level)? Detail)$/i.test(String(cells[0]))){header=null;continue;}
   if(/^Net Allocation$/i.test(String(cells[0]))&&cells.length<=2)continue;
   const fields=header.includes('reservationId')?reservationFields:unitFields;
   if(cells[header.indexOf('unitId')]!=null){const mapped=Object.fromEntries(header.flatMap((key,i)=>key?[[key,cells[i]]]:[]));result[fields===unitFields?'units':'reservations'].push(detailRow(mapped,fields,source));continue;}
  }
  for(let i=0;i<cells.length-1;i++){
   const label=keyOf(cells[i]),value=cells[i+1];
   for(const [field,name] of Object.entries(summaryLabels))if(label===keyOf(name))result.summary[field]=normalizeReforecastNumber(value);
   if(label==='occupancyrate')result.summary.occupancyPercent=typeof value==='number'&&value>=0&&value<=1?value*100:pct(value);
   if(label==='month')result.period=normalizeReforecastPeriod(value);
   if(label==='propertyname')result.propertyName=String(value??'');
   if(label==='propertyid'||label==='autopilotrevenueshare')result.propertyId=String(value??'');
  }
 }
 return result;
}

export function parseHelloLandingStatement({text,rows,units,reservations,metadata={},mapping=null}={}){
 const parsed=rows?extractRows(rows):extractText(text),issues=[...parsed.issues],checks=[];
 const period=parsed.period||metadata.period||null;
 if(!PERIOD.test(period||''))issues.push(issue('missing_statement_month','An explicit full statement month is required.'));
 if(metadata.provider&&metadata.provider!=='hello_landing')issues.push(issue('unsupported_provider','This parser applies only to Hello Landing Autopilot statements.'));
 if(parsed.period&&metadata.period&&parsed.period!==metadata.period)issues.push(issue('statement_period_conflict','The selected period does not match the statement month.'));
 if(!metadata.communityId)issues.push(issue('missing_community_assignment','Select the canonical community and review the property assignment.'));
 if(!/^[a-f0-9]{64}$/i.test(metadata.sourceHash||''))issues.push(issue('missing_source_hash','The original source bytes must be hashed before review.'));
 const detailUnits=units?units.map((row,index)=>detailRow(row,unitFields,row.source||{row:index+1})):parsed.units;
 const detailReservations=reservations?reservations.map((row,index)=>detailRow(row,reservationFields,row.source||{row:index+1})):parsed.reservations;
 const summary={...Object.fromEntries(Object.keys(summaryLabels).map(key=>[key,null])),occupancyPercent:null,...parsed.summary};
 function check(code,expected,actual,tolerance=0){const difference=finite(expected)&&finite(actual)?money(actual-expected):null,status=difference===null?'unavailable':Math.abs(difference)<=tolerance?'reconciled':'mismatch';checks.push({code,expected,actual,difference,status});if(status!=='reconciled')issues.push(issue(code,status==='unavailable'?'Required statement evidence is missing.':'Statement values do not reconcile.'));}
 for(const key of Object.keys(summaryLabels))if(!finite(summary[key]))issues.push(issue('missing_summary_value','A required summary field is unavailable.',{field:key}));
 check('summary_net_allocation',summary.netAllocation,sum(Object.keys(summaryLabels).filter(key=>key!=='netAllocation').map(key=>summary[key])));
 if(!detailUnits.length)issues.push(issue('missing_unit_detail','Unit detail is required to reconcile a provider statement.'));
 if(!detailReservations.length)issues.push(issue('missing_reservation_detail','Reservation detail is required to reconcile a provider statement.'));
 const seenUnits=new Set(),seenReservations=new Set();
 for(const [index,row] of detailUnits.entries()){
  if(!row.unitId||seenUnits.has(row.unitId))issues.push(issue('duplicate_or_missing_unit','Each source unit must have one unit-summary row.',{row:index+1}));seenUnits.add(row.unitId);
  if(!Number.isInteger(row.occupiedNights)||row.occupiedNights<0||!PERIOD.test(period||'')||row.occupiedNights>days(period))issues.push(issue('invalid_occupied_nights','Unit nights must fit the full statement month.',{row:index+1}));
  check(`unit_${index+1}_revenue`,row.totalRevenue,sum(revenueFields.map(key=>row[key])));
  check(`unit_${index+1}_net_share`,row.netRent,finite(row.totalRevenue)&&finite(row.netRentPercent)&&row.netRentPercent>=0&&row.netRentPercent<=100?money(row.totalRevenue*row.netRentPercent/100):null,.01);
  check(`unit_${index+1}_allocation`,row.netAllocation,sum(['netRent','installOtherFees','ffeServiceFee','wifiServiceFee','partnerAdjustment'].map(key=>row[key])));
 }
 for(const [index,row] of detailReservations.entries()){
  if(!row.reservationId||seenReservations.has(row.reservationId)||!seenUnits.has(row.unitId))issues.push(issue('reservation_identity_conflict','A reservation must uniquely reconcile to an existing source unit.',{row:index+1}));seenReservations.add(row.reservationId);
  check(`reservation_${index+1}_revenue`,row.totalRevenue,sum(revenueFields.map(key=>row[key])));
  check(`reservation_${index+1}_net_share`,row.netRent,finite(row.totalRevenue)&&finite(row.netRentPercent)&&row.netRentPercent>=0&&row.netRentPercent<=100?money(row.totalRevenue*row.netRentPercent/100):null,.01);
  check(`reservation_${index+1}_net`,row.reservationNet,sum([row.netRent,row.partnerAdjustment]));
  if(!row.startDate||!row.endDate||row.endDate<=row.startDate)issues.push(issue('invalid_reservation_dates','Review the source reservation dates.',{row:index+1}));
 }
 const totals=Object.fromEntries(unitFields.filter(key=>!['unitId','netRentPercent'].includes(key)).map(key=>[key,sum(detailUnits.map(row=>row[key]))]));
 for(const key of ['totalRevenue','installOtherFees','ffeServiceFee','wifiServiceFee','partnerAdjustment','netAllocation'])check(`unit_total_${key}`,summary[key],totals[key]);
 check('management_fee',summary.managementFee,finite(totals.netRent)&&finite(totals.totalRevenue)?money(totals.netRent-totals.totalRevenue):null);
 for(const key of [...revenueFields,'totalRevenue','netRent','partnerAdjustment'])check(`reservation_total_${key}`,totals[key],sum(detailReservations.map(row=>row[key])));
 // Reservation Net intentionally excludes the unit-level service fees.
 const availableUnitNights=PERIOD.test(period||'')?detailUnits.length*days(period):null;
 check('occupancy_percent',summary.occupancyPercent,finite(totals.occupiedNights)&&availableUnitNights>0?money(totals.occupiedNights/availableUnitNights*100):null);
 if(PERIOD.test(period||''))for(const [index,unit] of detailUnits.entries()){
  const monthStart=Date.parse(period+'-01T00:00:00Z'),monthEnd=monthStart+days(period)*86400000;
  const stays=detailReservations.filter(row=>row.unitId===unit.unitId);
  const nights=stays.map(row=>row.startDate&&row.endDate?Math.max(0,(Math.min(Date.parse(row.endDate+'T00:00:00Z'),monthEnd)-Math.max(Date.parse(row.startDate+'T00:00:00Z'),monthStart))/86400000):null);
  check(`unit_${index+1}_reservation_nights`,unit.occupiedNights,stays.length?sum(nights):0);
  for(const key of [...revenueFields,'totalRevenue','netRent','partnerAdjustment'])check(`unit_${index+1}_reservation_${key}`,unit[key],stays.length?sum(stays.map(row=>row[key])):0);
 }
 const mappingApproved=mapping?.reviewState==='approved'&&mapping?.version&&mapping?.netIncomeMetric==='net_allocation';
 return {schemaVersion:1,parserVersion:PROVIDER_PARSER_VERSION,provider:metadata.provider||'hello_landing',streamId:metadata.streamId||'hello_landing',communityId:metadata.communityId||null,period,periodBasis:'calendar_month',currency:metadata.currency||null,
  metadata:{...clone(metadata),propertyName:parsed.propertyName||null,propertyId:parsed.propertyId||null},summary,units:detailUnits,reservations:detailReservations,checks,issues,status:issues.length?'needs_review':'reconciled',reviewState:'unreviewed',actualsAuthority:false,mapping:clone(mapping),
  metrics:{availableUnits:detailUnits.length,availableUnitNights,occupiedUnitNights:totals.occupiedNights,grossIncome:summary.totalRevenue,netIncome:mappingApproved?summary.netAllocation:null,netIncomeMappingApproved:Boolean(mappingApproved),netRent:totals.netRent,fees:sum([summary.managementFee,summary.installOtherFees,summary.ffeServiceFee,summary.wifiServiceFee,summary.partnerAdjustment])}};
}

export async function inspectProviderStatement(input,{extractedText,rows,xlsx,...metadata}={}){
 const bytes=input instanceof ArrayBuffer?new Uint8Array(input):ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
 if(!bytes||!bytes.length||bytes.length>50*1024*1024)throw Error('Choose a nonempty PDF or XLSX statement up to 50 MB.');
 const filename=metadata.filename||metadata.fileName||'',mimeType=metadata.mimeType||(/\.pdf$/i.test(filename)?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 const sourceHash=await hashReforecastWorkbook(bytes),originalFile=encodeOriginalWorkbook(bytes),formulaSources=[];
 if(extractedText===undefined&&!rows){
  if(/\.xlsx$/i.test(filename)){
   const XLSX=await loadXlsx(xlsx),book=XLSX.read(bytes,{type:'array',cellDates:true,cellFormula:true});rows=[];
   for(const sheet of book.SheetNames){
    for(const [address,cell] of Object.entries(book.Sheets[sheet]))if(!address.startsWith('!')&&cell.f){formulaSources.push({sheet,address,formula:cell.f,cachedValue:cell.t==='z'?null:cell.v??null});if(cell.t==='z')delete cell.v;}
    const data=XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:null,raw:true});
    for(const [index,cells] of data.entries())rows.push({sheet,row:index+1,cells});}
  }else if(/\.pdf$/i.test(filename)){
   const lib=await import('../vendor/pdfjs-5.6.205/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs-5.6.205/pdf.worker.min.mjs',import.meta.url).href;
   const task=lib.getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true}),parts=[];
   try{const pdf=await task.promise;if(pdf.numPages>100)throw Error('Use a statement with at most 100 pages.');for(let page=1;page<=pdf.numPages;page++){const source=await pdf.getPage(page);parts.push(pdfItemsToText((await source.getTextContent()).items));source.cleanup();}extractedText=parts.join('\n\f\n');}finally{await task.destroy();}
  }else throw Error('Choose a PDF or XLSX provider statement.');
 }
 const statement=parseHelloLandingStatement({text:extractedText,rows,metadata:{...metadata,filename,mimeType,sourceHash}});
 if(formulaSources.some(row=>row.cachedValue===null)){statement.issues.push(issue('missing_formula_cache','A source formula has no saved value. ATLAS never executes uploaded formulas.'));statement.status='needs_review';}
 return {...statement,formulaSources,source:{fileName:filename,filename,mimeType,sha256:sourceHash,byteLength:bytes.byteLength,originalFile}};
}

// Explicit allowlist: never pass restricted rows, free text, binaries, or unreviewed mappings to ordinary exports.
export function providerStatementPublicSummary(statement){return {provider:statement.provider,streamId:statement.streamId,communityId:statement.communityId,period:statement.period,periodBasis:statement.periodBasis,currency:statement.currency,parserVersion:statement.parserVersion,sourceHash:statement.metadata?.sourceHash||statement.source?.sha256||null,status:statement.status,reviewState:statement.reviewState,summary:clone(statement.summary),metrics:clone(statement.metrics),checks:(statement.checks||[]).map(({code,status,difference})=>({code,status,difference}))};}

// Unknown templates require explicit field mapping. This never extracts a value, assumes a missing fee, or approves a source.
export function mappedProviderStatement({metadata={},fields={},mapping={}}={}){
 const issues=[],checks=[],fieldEvidence={},numericFields=['calendarDays','availableUnits','availableUnitNights','occupiedUnitNights','occupancyPercent','grossIncome','netAllocation'];
 const reference=value=>typeof value==='string'&&value.trim()?value.trim():value&&typeof value==='object'&&(value.page||value.sheet&&value.address)?clone(value):null;
 const mappedValue=(key,required=true)=>{
  const input=fields[key],descriptor=input&&typeof input==='object'&&!Array.isArray(input)?input:{value:input};
  const sourceReference=reference(descriptor.sourceReference)||reference(mapping.sourceReference),raw=descriptor.value??null;
  const value=numericFields.includes(key)?(key==='occupancyPercent'?pct(raw):normalizeReforecastNumber(raw)):(typeof raw==='string'&&raw.trim()?raw.trim():null);
  fieldEvidence[key]={rawValue:clone(raw),value,sourceReference,method:'explicit_manual_mapping'};
  if(required&&(value===null||sourceReference===null))issues.push(issue('manual_field_unavailable','A required field needs a source value and page or cell reference.',{field:key}));
  if(!required&&value!==null&&!sourceReference)issues.push(issue('manual_field_reference_required','A populated optional field needs a source reference.',{field:key}));
  return value;
 };
 const period=mappedValue('period'),currency=mappedValue('currency'),values=Object.fromEntries(numericFields.map(key=>[key,mappedValue(key,key!=='availableUnits')]));
 if(!['rise_str','monthly_property_statement'].includes(metadata.provider))issues.push(issue('unsupported_manual_provider','Select RISE STR or a monthly property statement for manual mapping.'));
 if(!metadata.communityId||!metadata.streamId)issues.push(issue('manual_identity_required','Choose the canonical community and comparable revenue stream.'));
 if(!/^[a-f0-9]{64}$/i.test(metadata.sourceHash||''))issues.push(issue('missing_source_hash','Hash the immutable original source bytes before mapping.'));
 if(!PERIOD.test(period||'')||mapping.periodBasis!=='calendar_month')issues.push(issue('manual_full_month_required','Map one explicit full calendar month; annual, YTD and partial periods are ineligible.'));
 if(metadata.period&&period!==metadata.period)issues.push(issue('statement_period_conflict','The mapped source month differs from the selected month.'));
 if(!/^[A-Z]{3}$/.test(currency||'')||metadata.currency&&currency!==metadata.currency)issues.push(issue('manual_currency_required','Map the explicit source currency and resolve any selected-currency conflict.'));
 if(mapping.method!=='manual'||mapping.confirmed!==true||!mapping.version||!mapping.actor||!mapping.reviewedAt||!String(mapping.reason||'').trim())issues.push(issue('manual_mapping_review_required','Confirm the manual field mapping with its version, reviewer, time and explanation.'));
 const check=(code,expected,actual,tolerance=0)=>{const difference=finite(expected)&&finite(actual)?money(actual-expected):null,status=difference===null?'unavailable':Math.abs(difference)<=tolerance?'reconciled':'mismatch';checks.push({code,expected,actual,difference,status});if(status!=='reconciled')issues.push(issue(code,status==='unavailable'?'Required mapped evidence is unavailable.':'The mapped source values do not reconcile.'));};
 check('full_calendar_days',PERIOD.test(period||'')?days(period):null,values.calendarDays);
 for(const key of ['availableUnitNights','occupiedUnitNights'])if(!Number.isInteger(values[key])||values[key]<0)issues.push(issue('manual_unit_nights_invalid','Mapped statement unit-nights must be nonnegative whole nights.',{field:key}));
 if(finite(values.availableUnitNights)&&finite(values.occupiedUnitNights)&&values.occupiedUnitNights>values.availableUnitNights)issues.push(issue('manual_occupied_capacity_exceeded','Occupied unit-nights exceed the available unit-nights.'));
 if(values.availableUnits!==null&&(!Number.isInteger(values.availableUnits)||values.availableUnits<0))issues.push(issue('manual_unit_count_invalid','The mapped unit count must be a nonnegative integer.'));
 if(finite(values.availableUnits)&&finite(values.calendarDays)&&finite(values.availableUnitNights)&&values.availableUnitNights>values.availableUnits*values.calendarDays)issues.push(issue('manual_available_capacity_exceeded','Available unit-nights exceed the mapped roster capacity.'));
 if(!finite(values.occupancyPercent)||values.occupancyPercent<0||values.occupancyPercent>100)issues.push(issue('manual_occupancy_invalid','Map an occupancy percentage between zero and 100.'));
 check('occupancy_percent',values.occupancyPercent,values.availableUnitNights>0&&finite(values.occupiedUnitNights)?money(values.occupiedUnitNights/values.availableUnitNights*100):null,.01);
 const feeComponents=[],seenFees=new Set();
 if(!Array.isArray(fields.feeComponents)||mapping.feesComplete!==true)issues.push(issue('manual_fee_mapping_incomplete','Explicitly map every signed fee or adjustment, or confirm that there are none.'));
 for(const [index,input] of (Array.isArray(fields.feeComponents)?fields.feeComponents:[]).entries()){
  const id=typeof input.id==='string'?input.id.trim():'',amount=normalizeReforecastNumber(input.amount),sourceReference=reference(input.sourceReference)||reference(mapping.sourceReference);
  if(!id||seenFees.has(id)||amount===null||!sourceReference)issues.push(issue('manual_fee_component_invalid','Each signed fee needs a unique label, an amount and a source reference.',{component:index+1}));
  seenFees.add(id);feeComponents.push({id,amount});fieldEvidence['feeComponents.'+index]={rawValue:clone(input.amount??null),value:amount,sourceReference,method:'explicit_manual_mapping'};
 }
 const fees=Array.isArray(fields.feeComponents)&&mapping.feesComplete===true?(feeComponents.length?sum(feeComponents.map(row=>row.amount)):0):null;
 check('summary_net_allocation',values.netAllocation,sum([values.grossIncome,fees]));
 const netMappingApproved=mapping.reviewState==='approved'&&mapping.netIncomeMetric==='net_allocation'&&Boolean(mapping.version);
 return {schemaVersion:1,parserVersion:PROVIDER_PARSER_VERSION+'-manual',provider:metadata.provider||null,streamId:metadata.streamId||null,communityId:metadata.communityId||null,sourceHash:metadata.sourceHash||null,period,periodBasis:PERIOD.test(period||'')&&mapping.periodBasis==='calendar_month'?'calendar_month':'unavailable',currency,
  metadata:clone(metadata),summary:{totalRevenue:values.grossIncome,occupancyPercent:values.occupancyPercent,netAllocation:values.netAllocation,feeComponents,fees},units:[],reservations:[],checks,issues,status:issues.length?'needs_review':'reconciled',reviewState:'unreviewed',actualsAuthority:false,
  mapping:clone(mapping),mappingEvidence:{method:'explicit_manual_mapping',version:mapping.version||null,actor:mapping.actor||null,reviewedAt:mapping.reviewedAt||null,reason:mapping.reason||null,fields:fieldEvidence,feesComplete:mapping.feesComplete===true},
  metrics:{calendarDays:values.calendarDays,availableUnits:values.availableUnits,availableUnitNights:values.availableUnitNights,occupiedUnitNights:values.occupiedUnitNights,grossIncome:values.grossIncome,netIncome:netMappingApproved?values.netAllocation:null,netIncomeMappingApproved:netMappingApproved,netRent:null,fees}};
}

export function calculateStrLeasingSchedule({periods=[],streams=[]}={}){
 const issues=[],rows=[],seenStreams=new Set();
 if(!periods.length||periods.some(period=>!PERIOD.test(period))||new Set(periods).size!==periods.length)throw Error('Select unique full calendar months for the STR schedule.');
 for(const stream of streams){
  if(!stream.id||seenStreams.has(stream.id))throw Error('Each selected STR stream requires a unique identifier.');seenStreams.add(stream.id);
  const roster=new Map();for(const unit of stream.units||[]){if(!unit.id||roster.has(unit.id))throw Error('Each stream unit requires a unique identifier.');for(const value of [unit.availableFrom,unit.takeBackMonth])if(value&&!PERIOD.test(value))throw Error('Unit availability and take-backs require full months.');roster.set(unit.id,unit);}
  const months=new Map();for(const month of stream.monthly||[]){if(!PERIOD.test(month.period)||months.has(month.period))throw Error('Each STR stream month requires a unique full month.');months.set(month.period,month);}
  for(const period of periods){
   const input=months.get(period)||{},eligible=[...roster.values()].filter(unit=>(!unit.availableFrom||unit.availableFrom<=period)&&(!unit.takeBackMonth||unit.takeBackMonth>period));
   const included=input.includedUnitIds??eligible.map(unit=>unit.id),allowed=new Set(eligible.map(unit=>unit.id));
   const invalid=included.some(id=>!allowed.has(id))||new Set(included).size!==included.length;
   const availableUnits=input.availableUnits===undefined?included.length:normalizeReforecastNumber(input.availableUnits);
   const occupancyPercent=pct(input.occupancyPercent),grossRate=normalizeReforecastNumber(input.grossPerOccupiedNight),netRate=normalizeReforecastNumber(input.netPerOccupiedNight),feeRate=normalizeReforecastNumber(input.feePerAvailableUnit);
   const rowIssues=[];if(invalid)rowIssues.push('The included unit roster contains unavailable or duplicate units.');
   if(!Number.isInteger(availableUnits)||availableUnits<0||availableUnits!==included.length)rowIssues.push('Available units must equal the included roster count.');
   if(!finite(occupancyPercent)||occupancyPercent<0||occupancyPercent>100)rowIssues.push('Enter predicted occupancy from 0 to 100 percent.');
   if(!finite(grossRate)||grossRate<0)rowIssues.push('A reviewed gross rate per occupied night is required.');
   if(input.netMethod&&!['per_occupied_night','gross_plus_signed_fees'].includes(input.netMethod))rowIssues.push('Select a reviewed net-income method.');
   const availableUnitNights=!invalid&&Number.isInteger(availableUnits)&&availableUnits===included.length?availableUnits*days(period):null;
   const occupiedUnitNights=finite(availableUnitNights)&&finite(occupancyPercent)&&occupancyPercent>=0&&occupancyPercent<=100?availableUnitNights*occupancyPercent/100:null;
   const grossIncome=finite(occupiedUnitNights)&&finite(grossRate)&&grossRate>=0?money(occupiedUnitNights*grossRate):null;
   const grossPotentialIncome=finite(availableUnitNights)&&finite(grossRate)&&grossRate>=0?money(availableUnitNights*grossRate):null;
   const vacancyLoss=finite(grossIncome)?money(grossIncome-grossPotentialIncome):null;
   const fees=finite(availableUnits)&&finite(feeRate)?money(availableUnits*feeRate):null;
   const netMethod=input.netMethod||(finite(netRate)?'per_occupied_night':null);
   const netIncome=netMethod==='gross_plus_signed_fees'?(finite(grossIncome)&&finite(fees)?money(grossIncome+fees):null):netMethod==='per_occupied_night'&&finite(occupiedUnitNights)&&finite(netRate)?money(occupiedUnitNights*netRate):null;
   issues.push(...rowIssues.map(message=>issue('str_schedule_input',message,{streamId:stream.id,period})));
   rows.push({streamId:stream.id,period,includedUnitIds:[...included],availableUnits,occupancyPercent,availableUnitNights,occupiedUnitNights,grossPotentialIncome,grossIncome,vacancyLoss,netIncome,netMethod,fees,feesAppliedToNet:netMethod==='gross_plus_signed_fees',source:clone(input.source||stream.source||null),status:rowIssues.length?'unavailable':'ready'});
  }
 }
 return {rows,issues,status:issues.length?'needs_review':'ready'};
}

export function recommendStrStatementBehavior({statements=[],communityId,provider,streamId,asOfPeriod,currency=null,weights=[1,1,1],reviewedAssumption=null}={}){
 if(!PERIOD.test(asOfPeriod||''))throw Error('The recommendation requires a full forecast month.');
 const eligible=statements.filter(row=>row.communityId===communityId&&row.provider===provider&&row.streamId===streamId&&PERIOD.test(row.period||'')&&row.period<asOfPeriod&&row.periodBasis==='calendar_month'&&row.reviewState==='approved'&&row.status==='reconciled'&&row.readbackVerified===true&&!row.reopened&&!row.stale&&/^[a-f0-9]{64}$/i.test(row.metadata?.sourceHash||row.sourceHash||row.source?.sha256||'')&&row.metrics?.occupiedUnitNights>0&&finite(row.metrics?.grossIncome));
 const counts=new Map();for(const row of eligible)counts.set(row.period,(counts.get(row.period)||0)+1);
 if([...counts.values()].some(count=>count>1))return {status:'unavailable',reason:'ambiguous_statement_vintage',sampleCount:0,evidence:[]};
 const selected=eligible.sort((a,b)=>b.period.localeCompare(a.period)).slice(0,3).reverse();
 if(selected.length&&selected.some(row=>!row.currency||row.currency!==(currency||selected[0].currency)))return {status:'unavailable',reason:'incomparable_currency',sampleCount:selected.length,evidence:[]};
 if(selected.length<3){
  if(reviewedAssumption?.reviewState==='approved'&&reviewedAssumption.actor&&reviewedAssumption.reason&&reviewedAssumption.reviewedAt&&finite(reviewedAssumption.grossPerOccupiedNight)&&reviewedAssumption.grossPerOccupiedNight>=0)return {status:'proposed',basis:'reviewed_assumption',sampleCount:selected.length,grossPerOccupiedNight:reviewedAssumption.grossPerOccupiedNight,netPerOccupiedNight:finite(reviewedAssumption.netPerOccupiedNight)?reviewedAssumption.netPerOccupiedNight:null,evidence:[],assumption:clone(reviewedAssumption)};
  return {status:'unavailable',reason:'insufficient_history',sampleCount:selected.length,requiredSampleCount:3,evidence:[]};
 }
 if(weights.length!==3||weights.some(value=>!finite(value)||value<0)||weights.reduce((a,b)=>a+b,0)<=0)throw Error('Provide three nonnegative weights with a positive total.');
 const total=weights.reduce((a,b)=>a+b,0),evidence=selected.map((row,index)=>({period:row.period,sourceHash:row.metadata?.sourceHash||row.sourceHash||row.source?.sha256,publicationId:row.publicationId||row.id||row.reviewReceiptId||null,weight:weights[index],occupiedUnitNights:row.metrics.occupiedUnitNights,availableUnitNights:row.metrics.availableUnitNights,grossPerOccupiedNight:row.metrics.grossIncome/row.metrics.occupiedUnitNights,netPerOccupiedNight:row.metrics.netIncomeMappingApproved&&finite(row.metrics.netIncome)?row.metrics.netIncome/row.metrics.occupiedUnitNights:null,mappingVersion:row.mapping?.version||null}));
 const weighted=key=>evidence.every(row=>finite(row[key]))?evidence.reduce((value,row)=>value+row[key]*row.weight,0)/total:null;
 return {status:'proposed',basis:'trailing_three_approved_statements',sampleCount:3,grossPerOccupiedNight:weighted('grossPerOccupiedNight'),netPerOccupiedNight:weighted('netPerOccupiedNight'),evidence,weights:[...weights],requiresAcceptance:true};
}

export function calculateContractDriver({contract,periods=[],userRate=null,inflation=null,communityId=null,location=null}={}){
 if(!periods.length||periods.some(period=>!PERIOD.test(period)))throw Error('Contract drivers require full calendar months.');
 const assumption=userRate?.reviewState==='approved'&&userRate.reason&&userRate.actor&&finite(userRate.monthlyAmount)?userRate:null;
 const reviewed=contract?.reviewState==='approved'&&contract?.sourceHash&&contract?.effectiveFrom&&contract?.effectiveTo&&finite(contract?.monthlyAmount);
 const escalation=contract?.escalation;
 const invalidEscalation=escalation&&(!escalation.clauseReference||!PERIOD.test(escalation.effectiveMonth||'')||!finite(escalation.rate));
 const rateAt=period=>money(contract.monthlyAmount*(escalation&&period>=escalation.effectiveMonth?1+escalation.rate:1));
 const inflationReady=inflation?.confirmed===true&&inflation.communityId===communityId&&communityId&&location&&inflation.location===location&&finite(inflation.percentage)&&inflation.percentage>=-100&&inflation.source&&inflation.ownerId&&/^20\d{2}-\d{2}-\d{2}$/.test(inflation.effectiveDate||'');
 return periods.map(period=>{
  const inside=reviewed&&period>=contract.effectiveFrom&&period<=contract.effectiveTo;
  const partial=inside&&(contract.effectiveDate?.slice(0,7)===period&&!contract.effectiveDate.endsWith('-01')||contract.endDate?.slice(0,7)===period&&Number(contract.endDate.slice(-2))!==days(period));
  if(assumption)return {period,status:'available',amount:money(assumption.monthlyAmount),method:'user_entered',coverage:'User Override',contractBacked:false,assumption:clone(assumption),sourceHash:contract?.sourceHash||null};
  if(!reviewed)return {period,status:'unavailable',amount:null,contractBacked:false,reason:'missing_or_unreviewed_contract_terms'};
  if(invalidEscalation)return {period,status:'unavailable',amount:null,contractBacked:false,reason:'unreviewed_escalation'};
  if(partial)return {period,status:'unavailable',amount:null,coverage:'Partial Contract - Review Proration',contractBacked:false,reason:'Review the contractual billing or proration rule for the partial month.',sourceHash:contract.sourceHash};
  if(inside)return {period,status:'available',amount:rateAt(period),method:'contract_clause',coverage:'Contract Backed',contractBacked:true,sourceHash:contract.sourceHash,clauseReference:escalation?.clauseReference||null,calculation:'Applicable signed monthly rate and effective escalation clause'};
  if(period>contract.effectiveTo&&inflationReady&&period>=inflation.effectiveDate.slice(0,7)){
   const priorRate=rateAt(contract.effectiveTo),amount=money(priorRate*(1+inflation.percentage/100));
   return {period,status:'available',amount,method:'out_of_contract_estimate',coverage:'Out of Contract - Estimated',contractBacked:false,priorRate,inflationPercentage:inflation.percentage,calculation:`${priorRate} × (1 + ${inflation.percentage} / 100)`,confidence:'estimated',assumption:clone(inflation),sourceHash:contract.sourceHash};
  }
  return {period,status:'unavailable',amount:null,coverage:'Out of Contract - Estimated',contractBacked:false,reason:period<contract.effectiveFrom?'No prior applicable contract rate exists for this month.':'A property and location specific inflation assumption with source, effective date and owner is required.'};
 });
}

export function createContractOverride(input={}){
 const {scenarioId,revisionId,periods,accountCode,originalValue,overrideValue,reason,actor,timestamp}=input;
 if(!scenarioId||!revisionId||!Array.isArray(periods)||!periods.length||periods.some(period=>!PERIOD.test(period))||new Set(periods).size!==periods.length||!accountCode||!finite(originalValue)||!finite(overrideValue)||!reason?.trim()||!actor||!timestamp)throw Error('A contract override needs its revision, full periods, GL, original and override amounts, reason, actor, and time.');
 return clone({...input,recordType:'forecast_override',originalValue:money(originalValue),overrideValue:money(overrideValue)});
}

// Candidates for the governed mapping workflow; callers must persist and approve a registry version.
export const UTILITY_RELATIONSHIP_CANDIDATES=Object.freeze([
 {expenseAccount:'6461',incomeAccount:'5917',utility:'electricity',relationship:'usage_recovery'},
 {expenseAccount:'6463',incomeAccount:'5915',utility:'water_sewer',relationship:'usage_recovery'},
 {expenseAccount:'6464',incomeAccount:'5912',utility:'gas',relationship:'usage_recovery'},
 {expenseAccount:'6465',incomeAccount:'5143',utility:'internet',relationship:'usage_recovery'},
 {accountCode:'5956',nature:'income',category:'utility_setup_credit',relationship:'separate_income'},
 ...[['6450','common_electricity','electricity'],['6451','common_water_sewer','water_sewer'],['6452','common_gas','gas'],['6460','vacant_electricity','electricity']].map(([accountCode,category,utility])=>({accountCode,nature:'expense',category,utility,relationship:'unrecouped'}))
 ].map(Object.freeze));
