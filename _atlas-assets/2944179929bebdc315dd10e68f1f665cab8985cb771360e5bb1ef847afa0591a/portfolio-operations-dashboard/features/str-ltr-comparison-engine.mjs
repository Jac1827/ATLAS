/** Read-only comparison built on the existing STR preview and ATLAS chart of accounts.
 * Missing evidence is null; an explicit modeled zero remains zero. Money is rounded
 * at the report boundary, never while calculating fees, allocations or thresholds.
 */
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
export const COMPARISON_ENGINE_VERSION = '1.0.1';
const num = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const n = value => num(value) ?? 0;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const arr = value => Array(12).fill(value);
const sum = values => values.reduce((total, value) => total + n(value), 0);
const strictSum = values => values.some(value => num(value) === null) ? null : sum(values);
const round = value => num(value) === null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
const sub = (a, b) => num(a) === null || num(b) === null ? null : a - b;
const period = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const METRICS = ['income', 'expenses', 'directContribution', 'allocatedExpenses', 'noi', 'capex', 'cashFlow'];
const zeroMetrics = () => Object.fromEntries(METRICS.map(key => [key, 0]));
const nullMetrics = () => Object.fromEntries(METRICS.map(key => [key, null]));
const diffMetrics = (a, b) => Object.fromEntries(METRICS.map(key => [key, round(sub(a[key], b[key]))]));
const aggregateMetrics = rows => Object.fromEntries(METRICS.map(key => [key, round(strictSum(rows.map(row => row[key])))]));
const sourceText = value => typeof value === 'string' ? value : value?.source || value?.label || 'ATLAS source';

function getAccount(RBB, code, fallback = {}) {
  return RBB.glIndex?.[String(code)] || (RBB.COA || []).find(row => String(row.gl) === String(code)) || fallback;
}
function sectionOf(nature) { return nature === 'capital' ? 'capex' : /income/.test(nature || '') ? 'income' : 'expenses'; }
function monthlyValues(line, year) {
  const values = line.yearData?.[year] || (n(line.year) === year || !line.year ? line.monthly : null);
  return Array.isArray(values) ? Array.from({length:12}, (_, m) => num(values[m])) : null;
}
function retainedMonthlyConcession(lines,propertyId,year) {
  const eligible=(lines||[]).filter(line=>(!line.propertyId||line.propertyId===propertyId)&&!line.strProgram&&!line.strProgramId);
  const totals=code=>{
    const rows=eligible.filter(line=>String(line.gl)===code).map(line=>monthlyValues(line,year)).filter(Boolean);
    return rows.length?Array.from({length:12},(_,m)=>strictSum(rows.map(row=>row[m]))):null;
  };
  const credits=totals('5250'),gross=totals('5120');
  if(!credits||!gross||credits.some(value=>value===null)||gross.some(value=>value===null)) return null;
  const monthlyPct=gross.map((value,m)=>value>0?Math.abs(credits[m])/value:credits[m]===0?0:null);
  return monthlyPct.some(value=>value===null)?null:monthlyPct;
}
function programConfig(program) { return program.config || program.revision?.payload?.config || program.record?.revision?.payload?.config; }

/** The legacy preview intentionally limits ordinary input to 99%. For a modeled
 * 100% case, extend its linear booking economics and re-run its utility tariff.
 * Fixed fees, permit restrictions and available/blocked nights are unchanged. */
function previewAt(RBB, state, config, year, occupancy = null, adrMultiplier = 1) {
  const cfg = clone(config);
  if (occupancy !== null) {
    cfg.occMode = 'monthly'; cfg.occMonthly = {...cfg.occMonthly, [year]:arr(Math.min(.99, occupancy))};
  }
  if (adrMultiplier !== 1) {
    const original = RBB.str.preview(state, cfg, year);
    cfg.adrMode = 'monthly'; cfg.adrMonthly = {...cfg.adrMonthly, [year]:original.adr.map(v => v * adrMultiplier)};
    cfg.adr = original.adrBase * adrMultiplier;
  }
  const pv = RBB.str.preview(state, cfg, year);
  if (occupancy !== null && occupancy > .99) {
    const factor = occupancy / .99;
    const variable = ['booked','stays','gross','cleanFeeRev','resortFee','parkingFee','petFee','ancillaryRev',
      'platformFees','roomFees','cleanFeeCommission','ancillaryFees','discounts','refunds','chargebacks',
      'ccFees','ccBase','net','taxable','lodgingTax','cleaning','linen','supplies','rm','damage','mgmtFee',
      'promo','revenueDeductions','totalStrRevenue'];
    for (const key of variable) if (Array.isArray(pv[key])) pv[key] = pv[key].map(value => value * factor);
    pv.guestSvc = pv.guestSvc.map((value, m) => {
      const fixed = pv.unitRamp[m] * n(pv.resolved?.guestSvcPerUnitMo);
      return fixed + (value - fixed) * factor;
    });
    pv.occ = arr(occupancy);
    if (RBB.str.utilityModel) {
      const prop = state.properties.find(row => row.id === cfg.propertyId);
      pv.utilities = RBB.str.utilityModel(prop, cfg, year, pv.unitRamp, pv.booked, pv.available,
        (key, fallback) => num(cfg[key]) ?? num(pv.resolved?.[key]) ?? num(RBB.str.DEFAULTS?.[key]) ?? fallback ?? 0);
      pv.utilTotal = pv.utilities.total;
    }
  }
  return pv;
}

function sourceAssumption(RBB, property, key) {
  return RBB.ASSUMPTIONS?.[property.id]?.[key] || RBB.ASSUMPTIONS?.global?.[key] || null;
}

/** A one-time credit is attached to a new cohort, not repeatedly to every unit.
 * Annual percentages from ATLAS remain recurring GPR deductions; new-lease
 * percentages/weeks/months use lease-term economics with explicit timing. */
export function concessionSchedule({rent, ramp, occupancy, concession, openingUnits = 0, priorCohorts = []}) {
  const c = concession || {type:'none'};
  const type = c.type || 'none', value = Math.max(0, n(c.value));
  const lease = Math.max(1, n(c.leaseTermMonths) || 12), eligible = clamp(num(c.eligiblePct) ?? 1, 0, 1);
  const result = arr(0), first = clamp(n(c.startMonth) || 1, 1, 12) - 1, last = clamp(n(c.endMonth) || 12, 1, 12) - 1;
  for(const cohort of priorCohorts) {
    const term=Math.max(1,n(cohort.leaseTermMonths)||12);
    for(let m=0;m<12;m++) if(m>=cohort.startMonth&&m<cohort.startMonth+term) result[m]+=cohort.amount/term;
  }
  if(type==='source_monthly') {
    for(let m=0;m<12;m++) result[m]+=ramp[m]*rent*n(c.monthlyPct?.[m]);
    return result;
  }
  if (type === 'none' || !value || rent === null) return result;
  if (c.timing === 'recurring' || type === 'source_rate') {
    const perUnit = type === 'weeks' ? rent * value * 12 / 52 : type === 'months' ? rent * value : type === 'credit' ? value : rent * value;
    const finish=type==='source_rate'?last:Math.min(last,first+lease-1);
    for (let m = first; m <= finish; m++) result[m] += ramp[m] * perUnit * eligible * (c.basis === 'gross' || (type==='source_rate'&&c.basis!=='occupied') ? 1 : occupancy[m]);
    return result;
  }
  let previous = Math.max(0, openingUnits);
  for (let m = 0; m < 12; m++) {
    let cohort = Math.max(0, ramp[m] - previous);
    previous = ramp[m];
    if (m === first && c.includeExisting) cohort += Math.min(ramp[m], openingUnits);
    if (m < first || m > last || !cohort) continue;
    const credit = type === 'weeks' ? rent * value * 12 / 52 : type === 'months' ? rent * value : type === 'percent' ? rent * lease * value : value;
    const amount = cohort * occupancy[m] * eligible * credit;
    if (c.timing === 'amortized') {
      for (let k = m; k < Math.min(12, m + lease); k++) result[k] += amount / lease;
    } else result[m] += amount;
  }
  return result;
}

function solveThreshold(evaluate, target, high, hardMax) {
  if (num(target) === null) return {value:null, feasible:false, reason:'The comparison NOI is incomplete.'};
  const atZero = evaluate(0);
  if (num(atZero) === null) return {value:null, feasible:false, reason:'Operating cost coverage is incomplete.'};
  if (atZero >= target) return {value:0, feasible:true};
  let upper = high, atUpper = evaluate(upper);
  while (atUpper < target && upper < hardMax) { upper = Math.min(hardMax, upper * 2); atUpper = evaluate(upper); }
  if (num(atUpper) === null || atUpper < target) return {value:null, feasible:false, reason:`Not reached within ${hardMax === 1 ? '100% eligible occupancy' : 'the ADR search horizon'}.`};
  let low = 0;
  for (let i = 0; i < 34; i++) { const middle = (low + upper) / 2; if (evaluate(middle) >= target) upper = middle; else low = middle; }
  return {value:upper, feasible:true};
}

export function calculatePayback(monthly) {
  if(!monthly.length) return {available:false,months:null,horizonMonths:0,reached:false,incrementalInvestment:null,incrementalCashFlow:null,reason:'Payback unavailable: there are no comparable recorded months in this period.',extrapolated:false};
  let cumulative = 0, invested = false, months = null;
  const investments = monthly.map(row => sub(row.str.capex, row.ltr.capex));
  const flows = monthly.map(row => sub(row.str.noi, row.ltr.noi));
  if (investments.some(v => v === null) || flows.some(v => v === null)) return {available:false,months:null,horizonMonths:monthly.length,reached:false,incrementalInvestment:investments.some(v=>v===null)?null:round(sum(investments)),incrementalCashFlow:flows.some(v=>v===null)?null:round(sum(flows)),reason:'Payback unavailable: NOI or capital evidence is incomplete.',extrapolated:false};
  for (let i = 0; i < monthly.length; i++) {
    const investment = investments[i], flow = flows[i], before = cumulative;
    if (investment > 0) invested = true;
    cumulative += flow - investment;
    // Return only a recovery that survives all later scheduled conversion costs.
    if (invested && cumulative >= 0 && months === null) months = i + (flow > 0 ? clamp((investment - before) / flow, 0, 1) : 1);
    if (cumulative < 0) months = null;
  }
  const incrementalInvestment = sum(investments), incrementalCashFlow = sum(flows);
  if (!invested && incrementalInvestment <= 0) return {available:true,months:incrementalCashFlow >= 0 ? 0 : null,horizonMonths:monthly.length,reached:incrementalCashFlow >= 0,incrementalInvestment:round(incrementalInvestment),incrementalCashFlow:round(incrementalCashFlow),reason:incrementalCashFlow >= 0 ? 'No positive incremental conversion investment in this reporting period.' : 'Incremental operating cash flow is nonpositive.',extrapolated:false};
  return {available:true,months:months === null ? null : round(months),horizonMonths:monthly.length,reached:months !== null,incrementalInvestment:round(incrementalInvestment),incrementalCashFlow:round(incrementalCashFlow),reason:months !== null ? 'Conversion investment recovered within the modeled period.' : incrementalCashFlow <= 0 ? 'Incremental operating cash flow is nonpositive.' : 'Payback is not reached within the modeled horizon; no stabilized extrapolation is assumed.',extrapolated:false};
}

function normalizeActuals(state, source, property, year) {
  if (Array.isArray(source.actuals)) return source.actuals.filter(row => !row.propertyId || row.propertyId === property.id).map(row => ({...row,gl:String(row.gl || row.accountCode || ''),amount:num(row.amount)}));
  const close = state.periods?.[`${property.id}|${year}`] || {};
  const rows = [];
  for (const rec of Object.values(state.actuals || {})) {
    if (rec.propertyId !== property.id || Number(rec.year) !== year) continue;
    for (let m = 0; m < 12; m++) {
      const value = num(rec.monthly?.[m]);
      // Legacy manual records filled future months with zeros. Only closed,
      // explicitly loaded, or nonzero months demonstrate a recorded observation.
      if (value === null || (value === 0 && m >= n(close.closedThrough) && !rec.loadedMonths?.includes(m + 1))) continue;
      rows.push({gl:String(rec.gl),period:period(year,m+1),amount:value,programId:rec.programId || rec.strProgramId,
        groupId:rec.groupId,status:m < n(close.closedThrough) ? 'closed' : 'preliminary',updatedAt:rec.updatedAt || close.loadedAt,source:rec.source,scope:rec.programId || rec.strProgramId ? 'program' : 'property'});
    }
  }
  return rows;
}

export function calculateComparison(args) {
  const RBB=args.RBB, libraries=args.source?.libraries;
  if(!libraries) return calculateRetainedComparison(args);
  const mapping={assumptions:'ASSUMPTIONS',curves:'CURVES',utilityProviders:'UTILITY_PROVIDERS',utilityBenchmarks:'UTILITY_BENCHMARKS',coa:'COA'};
  const originals=new Map();
  // The legacy preview closes over RBB. Retained libraries are scoped only for
  // this synchronous call, then the exact original identities are restored.
  // No budget/program objects are changed, including when calculation throws.
  try {
    for(const [key,target] of Object.entries(mapping)) if(libraries[key]) { originals.set(target,RBB[target]);RBB[target]=clone(libraries[key]); }
    if(libraries.coa) { originals.set('glIndex',RBB.glIndex);RBB.glIndex=Object.fromEntries(RBB.COA.map(row=>[String(row.gl),row])); }
    return calculateRetainedComparison(args);
  } finally { for(const [key,value] of originals) RBB[key]=value; }
}

function calculateRetainedComparison({RBB, state, property, program, scenario = {}, source = {}}) {
  RBB = {...RBB,str:RBB?.str || RBB?.strBuilder};
  if (!RBB?.str?.preview) throw new Error('The existing ATLAS STR calculation model is unavailable.');
  const originalCfg = program && programConfig(program);
  if (!originalCfg) throw new Error('Select a saved STR program with retained calculation drivers.');
  property = clone(property || state?.properties?.find(row => row.id === originalCfg.propertyId));
  if (!property) throw new Error('The selected program property is unavailable.');
  if (originalCfg.propertyId !== property.id) throw new Error('The selected program does not belong to this property.');
  state = {...clone(state),properties:[property],lines:clone(state?.lines || [])};
  const cfg = {...clone(originalCfg),...clone(scenario.strOverrides || {}),propertyId:property.id};
  // Scenario driver editing never changes inventory identity or the saved ramp.
  cfg.unitPicks = clone(originalCfg.unitPicks); cfg.unitRamp = clone(originalCfg.unitRamp);
  const year = n(scenario.year) || n(source.year) || n(state.budgetYear) || n(RBB.BUDGET_YEAR);
  if (!Number.isInteger(year) || year < 2000) throw new Error('Choose a valid reporting year.');
  const start = clamp(n(scenario.startMonth) || 1,1,12), requestedEnd = clamp(n(scenario.endMonth) || 12,start,12);
  const mode = ['performance','investment'].includes(scenario.mode) ? scenario.mode : 'budget';
  const warnings = [...(source.limitations || [])], assumptions = [], allocations = [];
  const picks = (cfg.unitPicks || []).filter(row => n(row.units) > 0).map(pick => {
    const group = (property.units || []).find(row => row.id === pick.groupId);
    if (!group) throw new Error(`Floor plan ${pick.groupId} no longer exists in the retained source.`);
    const sourceRent = num(group.marketRent), override = num(scenario.rentOverrides?.[group.id]);
    return {id:group.id,code:group.code || group.id,name:group.planName || group.label || group.code || group.id,
      sqft:num(group.avgSqft),units:n(pick.units),ltRent:override ?? sourceRent,sourceLtRent:sourceRent,rentSource:override === null ? 'STR builder LT Rent / saved floor-plan marketRent' : 'Comparison scenario override'};
  });
  if (!picks.length) throw new Error('This saved program has no selected floor-plan quantities.');
  const inventory = sum(picks.map(row => row.units));
  const occupancy = scenario.occupancy || {mode:'source'};
  const occupancyMode = ['custom','full'].includes(occupancy.mode) ? occupancy.mode : 'source';
  if (occupancyMode === 'custom' && (num(occupancy.str) === null || num(occupancy.ltr) === null || occupancy.str < 0 || occupancy.str > 1 || occupancy.ltr < 0 || occupancy.ltr > 1)) throw new Error('Custom STR and LTR occupancy must be between 0% and 100%.');
  const strOccupancy = occupancyMode === 'full' ? 1 : occupancyMode === 'custom' ? Number(occupancy.str) : null;
  const pv = previewAt(RBB,state,cfg,year,strOccupancy);
  if (pv.unitRamp.some(units => units > inventory + .0001 || units < 0)) throw new Error('The saved ramp exceeds its selected inventory. Correct the STR program before comparing it.');
  const leasingRows=(source.budgetLeasing||[]).filter(row=>row.period?.startsWith(`${year}-`));
  const propertyOcc=property.occupancyByYear?.[year] || property.occupancy?.conventional;
  const defaultLtrOccupancy = leasingRows.length?Array.from({length:12},(_,m)=>{
    const row=leasingRows.find(item=>item.period===period(year,m+1));
    return row&&n(row.units)>0&&num(row.occupiedUnits)!==null?row.occupiedUnits/row.units:num(propertyOcc?.[m]);
  }):propertyOcc;
  if (!defaultLtrOccupancy && occupancyMode === 'source') warnings.push('LTR occupancy is missing in ATLAS; enter a custom assumption before relying on LTR NOI.');
  const ltrOcc = occupancyMode === 'full' ? arr(1) : occupancyMode === 'custom' ? arr(Number(occupancy.ltr)) : Array.from({length:12},(_,m)=>num(defaultLtrOccupancy?.[m]));
  const programId = program.id || program.programmeId || cfg.programmeId;
  const actualRecords = normalizeActuals(state,source,property,year).filter(row => row.period?.startsWith(`${year}-`));
  const loadedRecords = actualRecords.filter(row => row.amount !== null && Number(row.period.slice(5)) >= start && Number(row.period.slice(5)) <= requestedEnd);
  const propertyLatest = loadedRecords.map(row => row.period).sort().at(-1) || null;
  const scopeCandidates=loadedRecords.filter(row=>(row.programId&&(row.programId===programId||row.programId===cfg.programmeId))||row.scope==='program'||(row.groupId&&picks.some(pick=>pick.id===row.groupId))||(!row.programId&&(scenario.actualAllocations?.[row.gl]||scenario.allocations?.[row.gl]?.actual)));
  const latest = scopeCandidates.map(row=>row.period).sort().at(-1)||null;
  const firstExposure = pv.unitRamp.findIndex((units,m)=>m>=start-1&&units>0);
  const firstProgramRecord = loadedRecords.filter(row=>(row.programId&&(row.programId===programId||row.programId===cfg.programmeId))||row.scope==='program').map(row=>Number(row.period.slice(5))-1).sort((a,b)=>a-b)[0];
  const actualStart = Math.max(start,Math.min(firstExposure<0?start:firstExposure+1,firstProgramRecord===undefined?13:firstProgramRecord+1));
  const reportingStart=mode==='budget'?start:actualStart;
  const end = mode === 'budget' ? requestedEnd : latest ? Number(latest.slice(5)) : reportingStart - 1;
  const monthIndices = Array.from({length:Math.max(0,end-reportingStart+1)},(_,i)=>i+reportingStart-1);
  const sourceIndices = Array.from({length:requestedEnd-start+1},(_,i)=>i+start-1);
  const activeIndices = mode === 'budget' ? sourceIndices : monthIndices;
  if (!activeIndices.length) warnings.push('No recorded actuals are available in the selected period. Performance and investment results remain unavailable.');
  if (picks.some(row => row.sourceLtRent === null)) warnings.push('One or more floor plans have no saved LT Rent. Enter a rent override to complete the LTR model.');
  if (picks.length > 1) warnings.push('Floor-plan ramp and STR financial results are allocated by selected unit count; no apartment-level actuals are implied.');
  const useSourceConcession=!scenario.concession?.type||scenario.concession.type==='source';
  let concession = useSourceConcession ? clone(source.concessionsByYear?.[year] || source.concession) : clone(scenario.concession);
  if(source.years?.length&&!source.years.map(Number).includes(year)) warnings.push('This year is not retained in the frozen source. Refresh sources explicitly before relying on this period.');
  const concessionAssumption = sourceAssumption(RBB,property,'concession_pct');
  const concessionEvidence = clone(concession);
  const concessionOfferUnverified=useSourceConcession&&(!concession?.type||concession.available===false);
  const retainedMonthlyConcessions=concessionOfferUnverified?retainedMonthlyConcession(source.budgetLines||state.lines,property.id,year):null;
  if(retainedMonthlyConcessions) {
    concession={type:'source_monthly',monthlyPct:retainedMonthlyConcessions,timing:'recurring',basis:'gross',source:`Retained FY${year} monthly concessions GL 5250 / gross potential rent GL 5120`,reviewedAt:concessionAssumption?.asOf||concessionAssumption?.date||null,currentOfferVerified:false};
    warnings.push('Current website concession terms are unavailable or incomplete. LTR uses the retained monthly budget concession rates, including recorded burnoff; this is not a verified current offer.');
  } else if(concessionOfferUnverified&&num(concessionAssumption?.value)!==null) {
    concession={type:'source_rate',value:Number(concessionAssumption.value),timing:'recurring',basis:'gross',source:'Retained ATLAS budget concession assumption: '+sourceText(concessionAssumption),reviewedAt:concessionAssumption.asOf||concessionAssumption.date||null,currentOfferVerified:false};
    warnings.push('Current website concession terms are unavailable or incomplete. LTR uses the retained budget concession percentage of gross potential rent; this is not a verified current offer.');
  }
  const concessionMissing = !concession?.type || concession.available === false;
  if (concessionMissing) { concession = {...concession,type:'none',value:0,source:concession?.source || 'No recorded concession found; editable assumption'}; warnings.push('No complete recorded concession was found. LTR income currently assumes no concession; confirm or enter an explicit scenario.'); }
  const badDebtSource = sourceAssumption(RBB,property,'bad_debt_pct');
  const badDebt = num(scenario.ltrOverrides?.badDebtPct) ?? num(scenario.badDebtPct) ?? num(source.badDebtPct) ?? num(badDebtSource?.value);
  if (badDebt === null) warnings.push('Bad debt / collection loss has no source assumption; a zero deduction is provisional until entered.');
  const lossToLease = num(scenario.lossToLeasePct) ?? num(sourceAssumption(RBB,property,'loss_to_lease_pct')?.value) ?? 0;
  const opening = RBB.str.openingStrUnits ? RBB.str.openingStrUnits(cfg,year) : n(cfg.beginningStrUnits?.[year]);
  picks.forEach(row => {
    row.ramp = pv.unitRamp.map(units => units * row.units / inventory);
    const priorCohorts=[];
    for(const key of Object.keys(cfg.unitRamp||{}).filter(value=>Number(value)<year).sort()) {
      const priorYear=Number(key),priorRamp=cfg.unitRamp[key];
      const priorConcession=scenario.concession?.type&&scenario.concession.type!=='source'?concession:source.concessionsByYear?.[priorYear];
      if(priorConcession?.timing!=='amortized'||!Array.isArray(priorRamp)) continue;
      const term=Math.max(1,n(priorConcession.leaseTermMonths)||12),eligible=clamp(num(priorConcession.eligiblePct)??1,0,1);
      let previous=RBB.str.openingStrUnits?RBB.str.openingStrUnits(cfg,priorYear):0;
      for(let m=0;m<12;m++) {
        const cohort=Math.max(0,n(priorRamp[m])-previous)*row.units/inventory;
        previous=n(priorRamp[m]);
        const offset=(priorYear-year)*12+m;
        if(!cohort||offset+term<=0||m<(n(priorConcession.startMonth)||1)-1||m>(n(priorConcession.endMonth)||12)-1) continue;
        const priorOcc=occupancyMode==='full'?1:occupancyMode==='custom'?Number(occupancy.ltr):num(property.occupancyByYear?.[priorYear]?.[m]);
        if(priorOcc===null) { warnings.push('Prior-year concession runoff has no recorded cohort occupancy; confirm the prior lease schedule.');continue; }
        const value=n(priorConcession.value),credit=priorConcession.type==='weeks'?row.ltRent*value*12/52:priorConcession.type==='months'?row.ltRent*value:priorConcession.type==='percent'?row.ltRent*term*value:value;
        priorCohorts.push({startMonth:offset,leaseTermMonths:term,amount:cohort*priorOcc*eligible*credit});
      }
    }
    row.concessions = concessionSchedule({rent:row.ltRent,ramp:row.ramp,occupancy:ltrOcc,concession,openingUnits:opening*row.units/inventory,priorCohorts});
    row.concessionCohorts=priorCohorts;
    row.activationMonth = row.ramp.findIndex(value=>value>0) + 1 || null;
    row.activationDate = row.activationMonth ? `${period(year,row.activationMonth)}-01` : null;
  });

  let budgetLines = source.budgetLines;
  if (!Array.isArray(budgetLines)) {
    budgetLines = state.lines.filter(line => line.propertyId === property.id && !line.strProgram && !line.strProgramId);
    if (RBB.engine?.computeProperty) {
      try { const calculated = RBB.engine.computeProperty(state,property.id,state.activeScenario || state.scenarios?.[0]?.id,year);
        budgetLines = Object.values(calculated.results).filter(row=>!row.line.strProgram&&!row.line.strProgramId).map(row=>({...row.line,monthly:row.monthly,year}));
      } catch { warnings.push('Some property driver lines could not be evaluated; only retained monthly amounts are available.'); }
    }
  }
  budgetLines = budgetLines.filter(line => (!line.propertyId || line.propertyId === property.id) && !line.strProgram && !line.strProgramId && (!line.year || Number(line.year) === year));
  const expenseSources = budgetLines.filter(line => (line.nature || getAccount(RBB,line.gl).nature) === 'expense');
  const hasExpenseEvidence = expenseSources.length > 0;
  if (!hasExpenseEvidence) warnings.push('Property operating expense source lines are unavailable; allocated expenses and after-allocation NOI remain incomplete.');
  const totalPropertyUnits = n(property.totalUnits) || sum((property.units||[]).filter(row=>row.cat!=='str').map(row=>row.units));
  const selectedSqft = sum(picks.map(row=>n(row.sqft)*row.units));
  const propertySqft = num(property.sqft) || sum((property.units||[]).filter(row=>row.cat!=='str').map(row=>n(row.avgSqft)*n(row.units)));
  const directCodes = new Set((RBB.str.GL_MAP || []).filter(row=>row.nature==='expense').map(row=>String(row.gl)));
  for (const utility of pv.utilities?.rows || []) directCodes.add(String(utility.gl));
  const glMap = new Map();
  function lineFor(code, nature, fallbackName) {
    code = String(code); const account = getAccount(RBB,code);
    const section = sectionOf(nature || account.nature), key = `${section}|${code}`;
    if (!glMap.has(key)) glMap.set(key,{code,name:account.name || fallbackName || code,section,nature:nature || account.nature,
      source:[],allocationMethod:[],str:arr(0),ltr:arr(0),strShared:arr(0),ltrShared:arr(0),actual:arr(null),actualStatus:arr(null),strApplicable:false,mapped:!!account.name,sourceStatus:account.placeholder?'provisional account':'mapped'});
    if (!account.name) warnings.push(`GL ${code} is not mapped in the existing ATLAS chart of accounts.`);
    return glMap.get(key);
  }
  function add(code,nature,name,side,values,sourceLabel,method='direct',shared=false) {
    const row = lineFor(code,nature,name);
    if(side==='str'&&!/not applicable|not_applicable|scenario exclusion|Property allocation replaced/i.test(method)) row.strApplicable=true;
    row[side] = row[side].map((v,m)=>v===null||num(values[m])===null?null:v+values[m]);
    if (shared) row[`${side}Shared`] = row[`${side}Shared`].map((v,m)=>v===null||num(values[m])===null?null:v+values[m]);
    if (!row.source.includes(sourceLabel)) row.source.push(sourceLabel);
    if (!row.allocationMethod.includes(`${side}: ${method}`)) row.allocationMethod.push(`${side}: ${method}`);
  }
  function zeroUtilityEvidence(utility) {
    // The existing STR builder treats an explicit zero unit-usage assumption as
    // an unserved utility. Preserve that modeled zero when supported; absence of
    // a provider, missing usage, or an unrelated zero LTR bill is not evidence.
    const override=cfg.utilities?.[utility.key];
    if(num(override?.perOccUsage)===0) return 'Explicit saved program zero per-unit usage assumption';
    if(!utility.provider||num(utility.provider.perOccUnitKwh)!==0) return null;
    const sourceLines=expenseSources.filter(line=>String(line.gl)===String(utility.gl));
    if(!sourceLines.length||!sourceLines.every(line=>{
      const monthly=monthlyValues(line,year);
      return monthly&&monthly.every(value=>value!==null&&value===0);
    })) return null;
    return `Saved provider zero per-unit usage corroborated by the complete zero FY${year} GL ${utility.gl} budget`;
  }
  function directSeries(model) {
    const result = [];
    for (const mapping of RBB.str.GL_MAP || []) {
      if (mapping.key === 'displacedNet') continue; // Counterfactual displacement is not an STR expense.
      const capital = mapping.nature === 'capital' || mapping.key === 'listingSetup' || mapping.key === 'ffe';
      const values = (model[mapping.key] || arr(0)).map(value=>mapping.nature==='contra_income'?-Math.abs(n(value)):n(value));
      result.push({code:mapping.gl,name:mapping.name,nature:capital?'capital':mapping.nature,values});
    }
    for (const utility of model.utilities?.rows || []) {
      if (utility.present) result.push({code:utility.gl,name:utility.name,nature:'expense',values:utility.cost});
      else if(!/Switched off/.test(utility.reason||'')) {
        const evidence=zeroUtilityEvidence(utility);
        result.push({code:utility.gl,name:utility.name,nature:'expense',values:model.unitRamp.map(units=>evidence||!units?0:null),...(evidence?{method:evidence}:{})});
      }
    }
    return result.map(row=>{
      const raw=scenario.allocations?.[String(row.code)]?.str;
      const rule=typeof raw==='string'?{method:raw}:raw;
      if(!rule) return row;
      if(['none','not_applicable'].includes(rule.method)) return {...row,values:arr(0),method:'Explicit scenario exclusion / not applicable'};
      if(['custom','usage'].includes(rule.method)) {
        const share=num(rule.pct)??num(rule.share);
        return {...row,values:row.values.map(value=>value===null||share===null?null:value*share),method:`Explicit ${rule.method} share of program amount`};
      }
      return row;
    });
  }
  directSeries(pv).forEach(row=>add(row.code,row.nature,row.name,'str',row.values,row.method || 'Saved STR program preview',row.method||'direct'));
  if ((pv.utilities?.rows || []).some(row=>!row.present && !/Switched off/.test(row.reason||'') && !zeroUtilityEvidence(row) && !['none','not_applicable'].includes(scenario.allocations?.[String(row.gl)]?.str?.method))) warnings.push('Some STR utility services have no provider or usage evidence. Enter an explicit not-applicable GL rule or provide the utility assumptions before relying on NOI.');
  for(const utility of pv.utilities?.rows||[]) {
    const evidence=!utility.present&&!/Switched off/.test(utility.reason||'')?zeroUtilityEvidence(utility):null;
    if(evidence) assumptions.push({name:`${utility.label||utility.name} modeled zero`,value:0,source:evidence,note:utility.provider?.note||'This is a budget assumption, not observed zero actual expense.'});
    if(evidence&&utility.provider?.note) warnings.push(`${utility.label||utility.name} uses a supported zero budget assumption. Source note: ${utility.provider.note}`);
  }
  const gpr = arr(0), vacancy = arr(0), concessions = arr(0), collections = arr(0), leaseLoss = arr(0);
  for (let m=0;m<12;m++) {
    gpr[m] = strictSum(picks.map(row=>row.ramp[m]===0?0:row.ltRent===null?null:row.ramp[m]*row.ltRent));
    vacancy[m] = gpr[m]===0?0:gpr[m]===null||ltrOcc[m]===null?null:-gpr[m]*(1-ltrOcc[m]);
    concessions[m] = -sum(picks.map(row=>row.concessions[m])) || 0;
    collections[m] = gpr[m]===null?null:-gpr[m]*(badDebt??0);
    leaseLoss[m] = gpr[m]===null?null:-gpr[m]*lossToLease;
  }
  add('5120','income','Gross potential rent','ltr',gpr,'Saved floor-plan LT Rent × matching active unit months');
  add('5220','contra_income','Vacancy loss','ltr',vacancy,'LTR occupancy scenario');
  add('5250','contra_income','Concessions','ltr',concessions,sourceText(concession));
  add('5255','contra_income','Bad debt','ltr',collections,badDebt===null?'Missing source: provisional zero collection loss':sourceText(badDebtSource));
  if (lossToLease) add('5125','contra_income','Loss to lease','ltr',leaseLoss,'ATLAS loss-to-lease assumption');
  for (const displaced of RBB.str.DISPLACED_SOURCES || []) {
    const detail = pv.displacedAncillary?.[displaced.key];
    const override=displaced.key==='otherResident'?num(scenario.ltrOverrides?.otherIncomePerOccUnitMonth):null;
    if (detail) add(RBB.str.DISPLACED_GL?.[displaced.key] || displaced.gls[0],'income',displaced.label,'ltr',pv.unitRamp.map((units,m)=>units===0?0:ltrOcc[m]===null?null:units*(override??n(detail.rate))*ltrOcc[m]),override===null?detail.source || 'Existing ATLAS resident income drivers':'Explicit other LTR income per occupied unit month');
  }
  function allocate(line, side, model=pv) {
    const code=String(line.gl), configured=scenario.allocations?.[code]?.[side];
    const rule=typeof configured==='string'?{method:configured}:configured || {method:side==='str'&&directCodes.has(code)?'none':'units'};
    const method=rule.method || 'units', values=monthlyValues(line,year);
    if(side==='str'&&directCodes.has(code)&&!rule.includeProperty) return {values:arr(0),method:'Property allocation replaced by direct program cost; counted once'};
    if (method==='none' || method==='not_applicable') return {values:arr(0),method:'not applicable / direct program cost replaces property allocation'};
    const allocated=Array.from({length:12},(_,m)=>{
      if(model.unitRamp[m]===0) return 0;
      if (!values || values[m]===null) return model.unitRamp[m]===0?0:null;
      const exposure=inventory?model.unitRamp[m]/inventory:0;
      let share;
      if(method==='direct') share=1;
      else if(method==='custom'||method==='usage') share=num(rule.pct) ?? num(rule.share);
      else if(method==='sqft') share=propertySqft?selectedSqft/propertySqft:null;
      else share=totalPropertyUnits?inventory/totalPropertyUnits:null;
      if(share===null) return null;
      let value=values[m]*share*exposure;
      if (line.behavior==='variable_occupancy' || rule.occupancySensitive) {
        const baseline=num(defaultLtrOccupancy?.[m]);
        const active=side==='ltr'?ltrOcc[m]:model.occ[m];
        if(baseline===null||active===null) return null;
        value=baseline>0?value*active/baseline:active===0?0:null;
      }
      return value;
    });
    return {values:allocated,method};
  }
  for (const line of expenseSources) for(const side of ['str','ltr']) {
    if(side==='ltr'&&String(line.gl)==='6586'&&num(scenario.ltrOverrides?.leasingCostPerTurn)!==null) continue;
    const allocated=allocate(line,side);
    add(line.gl,'expense',line.name,side,allocated.values,sourceText(line.source || 'Property operating budget'),allocated.method,true);
    allocations.push({code:String(line.gl),name:line.name || getAccount(RBB,line.gl).name,side,method:allocated.method,pct:scenario.allocations?.[line.gl]?.[side]?.pct ?? null,amount:round(strictSum(activeIndices.map(m=>allocated.values[m])))});
  }
  const leasingCost=num(scenario.ltrOverrides?.leasingCostPerTurn),turnoverSource=sourceAssumption(RBB,property,'turnover_rate');
  const turnoverRate=num(scenario.ltrOverrides?.turnoverRate)??num(turnoverSource?.value);
  if(leasingCost!==null) {
    add('6586','expense','Turn cleaning / modeled turnover cost','ltr',pv.unitRamp.map((units,m)=>turnoverRate===null||ltrOcc[m]===null?null:units*ltrOcc[m]*turnoverRate/12*leasingCost),'Explicit cost per modeled annual turnover × source or overridden turnover rate','direct');
    if(turnoverRate===null) warnings.push('A leasing cost per turn is entered but turnover rate is missing; enter it to complete LTR expenses.');
  }
  for(const capital of scenario.capital || []) {
    const code=String(capital.gl || '1504'), side=capital.side==='ltr'?'ltr':'str', amounts=arr(0);
    if(Array.isArray(capital.monthly)) for(let m=0;m<12;m++) amounts[m]=num(capital.monthly[m]);
    else if(capital.recurring) for(let m=0;m<12;m++) amounts[m]=n(capital.amount)*(capital.perUnit?pv.unitRamp[m]:1);
    else amounts[clamp(n(capital.month)||1,1,12)-1]=n(capital.amount);
    add(code,'capital',capital.name || 'Scenario capital investment',side,amounts,'Explicit comparison capital timing');
  }
  warnings.push('Listing setup and FF&E replacement funding are shown with conversion / recurring capital, outside operating NOI. This report reclassifies the existing program presentation without changing its budget GLs.');

  const rows=[...glMap.values()];
  const scopedRecords=[];
  for(const record of actualRecords) {
    if(record.programId && record.programId!==programId && record.programId!==cfg.programmeId) continue;
    if(record.groupId&&!picks.some(pick=>pick.id===record.groupId)) continue;
    const month=Number(record.period?.slice(5))-1;
    if(month<0||month>11||record.amount===null) continue;
    const account=getAccount(RBB,record.gl), nature=record.nature||account.nature;
    let amount=record.amount, method='direct program record';
    if(record.groupId&&!record.programId&&record.scope!=='program') {
      const pick=picks.find(row=>row.id===record.groupId),group=property.units.find(row=>row.id===record.groupId);
      const recordedUnits=num(record.units)??num(group?.units);
      if(!recordedUnits) continue;
      amount*=pick.ramp[month]/recordedUnits;
      method='allocated floor-plan actuals by selected active units';
    }
    if(!record.programId && !record.groupId && record.scope!=='program' && record.scope!=='floor_plan') {
      const rule=scenario.actualAllocations?.[record.gl] || scenario.allocations?.[record.gl]?.actual;
      if(!rule || ['none','not_applicable'].includes(rule.method)) continue;
      const share=rule.method==='direct'?1:rule.method==='sqft'?(propertySqft?selectedSqft/propertySqft:null):rule.method==='units'?(totalPropertyUnits?pv.unitRamp[month]/totalPropertyUnits:null):num(rule.pct);
      if(share===null) continue;
      amount*=share; method=`allocated property actuals: ${rule.method}`;
    }
    // Create account rows only after attribution has been accepted. Unrelated
    // property ledger accounts must not become comparison zeros or unmapped GL
    // warnings merely because the property has loaded those records.
    const existing=rows.find(row=>row.code===record.gl);
    const row=existing || lineFor(record.gl,nature,record.name);
    if(!existing) rows.push(row);
    if(nature==='contra_income') amount=-Math.abs(amount);
    row.actual[month]=(row.actual[month]??0)+amount;
    row.actualStatus[month]=record.status || 'preliminary';
    if(!row.allocationMethod.includes(method)) row.allocationMethod.push(method);
    scopedRecords.push({...record,amount,method});
  }
  // The retained report reconciles at the cent, across monthly GL detail and
  // annual totals. Fee and tariff calculations above used full precision.
  for(const row of rows) for(const key of ['str','ltr','strShared','ltrShared','actual']) row[key]=row[key].map(round);
  const missingCoverage=[];
  function metricFor(side,m,actual=false) {
    const metric=zeroMetrics();
    for(const section of ['income','expenses','capex']) {
      const sectionRows=rows.filter(row=>row.section===section);
      const amounts=sectionRows.map(row=>{
        if(!actual) return row[side][m];
        const required=row.strApplicable || row.actual[m]!==null;
        if(required && row.actual[m]===null) missingCoverage.push({period:period(year,m+1),section,gl:row.code});
        return required?row.actual[m]:0;
      });
      metric[section==='expenses'?'expenses':section==='capex'?'capex':'income']=strictSum(amounts);
    }
    if(actual && !scopedRecords.some(rec=>rec.period===period(year,m+1))) return nullMetrics();
    metric.allocatedExpenses=actual?0:strictSum(rows.filter(row=>row.section==='expenses').map(row=>row[`${side}Shared`][m]));
    metric.directContribution=sub(metric.income,sub(metric.expenses,metric.allocatedExpenses));
    if(!hasExpenseEvidence&&!actual) { metric.allocatedExpenses=null; metric.expenses=null; }
    metric.noi=sub(metric.income,metric.expenses);
    metric.cashFlow=sub(metric.noi,metric.capex);
    return metric;
  }
  const allMonths=Array.from({length:12},(_,m)=>{
    const budget=metricFor('str',m),ltr=metricFor('ltr',m),actual=metricFor('actual',m,true),str=mode==='investment'?actual:budget;
    return {period:period(year,m+1),month:m+1,units:pv.unitRamp[m],str,ltr,budget,actual,difference:diffMetrics(str,ltr),
      nights:{physical:pv.available[m],blocked:pv.blocked[m],permitRestricted:pv.permitCapped?.[m]||0,rentable:pv.rentable[m],occupied:pv.booked[m]},ltrBridge:{grossPotentialRent:gpr[m],vacancyLoss:vacancy[m],concessions:concessions[m],badDebt:collections[m],netEffectiveRent:sub(gpr[m],-concessions[m])}};
  });
  const monthly=activeIndices.map(m=>allMonths[m]);
  const totals=Object.fromEntries(['str','ltr','budget','actual'].map(side=>[side,monthly.length?aggregateMetrics(monthly.map(row=>row[side])):nullMetrics()]));
  totals.difference=diffMetrics(totals.str,totals.ltr);
  totals.incrementalNoiPerUnit=inventory?round(totals.difference.noi===null?null:totals.difference.noi/inventory):null;
  const actualIndices=sourceIndices.filter(m=>latest&&m>=actualStart-1&&m<=Number(latest.slice(5))-1);
  const actualMissing=missingCoverage.filter(row=>actualIndices.includes(Number(row.period.slice(5))-1));
  const usedScoped=scopedRecords.filter(row=>actualIndices.includes(Number(row.period.slice(5))-1));
  const actualStatus=!usedScoped.length?'unavailable':actualMissing.length||usedScoped.some(row=>row.status==='incomplete')?'incomplete':usedScoped.every(row=>row.status==='closed')?'closed':'preliminary';
  if(!usedScoped.length && loadedRecords.length) warnings.push('Property actuals are loaded but cannot be attributed to this STR program. Choose explicit actual allocation rules or load program-tagged records.');
  if(actualMissing.length) warnings.push(`Actuals are incomplete: ${actualMissing.length} required GL/month observations are missing. Missing revenue and expenses are not treated as zero.`);
  const actuals={status:actualStatus,latestMonth:latest,latestPropertyMonth:propertyLatest,period:latest?`${period(year,actualStart)} – ${latest}`:null,updatedAt:scopeCandidates.map(row=>row.updatedAt).filter(Boolean).sort().at(-1)||source.actualsMeta?.updatedAt||null,
    coverage:{records:usedScoped.length,missing:actualMissing,revenueComplete:!actualMissing.some(row=>row.section==='income')&&!!usedScoped.length,expensesComplete:!actualMissing.some(row=>row.section==='expenses')&&!!usedScoped.length},
    allocationMethod:[...new Set(usedScoped.map(row=>row.method))].join('; ')||'Unavailable; property totals are not automatically program actuals'};

  const modelIndices=activeIndices;
  const modelCache=new Map();
  function modelNoi(occupancyOverride,adrFactor=1) {
    if(!hasExpenseEvidence||!modelIndices.length) return null;
    const cacheKey=`${occupancyOverride}|${adrFactor}`;
    if(modelCache.has(cacheKey)) return modelCache.get(cacheKey);
    const model=previewAt(RBB,state,cfg,year,occupancyOverride,adrFactor);
    const direct=directSeries(model);
    const result=strictSum(modelIndices.map(m=>{
      const revenue=strictSum(direct.filter(row=>/income/.test(row.nature)).map(row=>row.values[m]));
      const expense=strictSum(direct.filter(row=>row.nature==='expense').map(row=>row.values[m]));
      const shared=strictSum(expenseSources.map(line=>allocate(line,'str',model).values[m]));
      return shared===null||expense===null||revenue===null?null:revenue-expense-shared;
    }));
    modelCache.set(cacheKey,result);return result;
  }
  const booked=sum(modelIndices.map(m=>pv.booked[m])),rentable=sum(modelIndices.map(m=>pv.rentable[m]));
  const currentAdr=modelIndices.length?(booked?sum(modelIndices.map(m=>pv.gross[m]))/booked:pv.adrBase):null;
  const currentOccupancy=modelIndices.length?(rentable?booked/rentable:0):null;
  function breakEvenFor(target, share=1) {
    if(!rentable||share<=0) return {adr:null,occupancy:null,feasible:false,adrFeasible:false,occupancyFeasible:false,reason:'No eligible rentable nights in the selected exposure period.'};
    const adr=solveThreshold(factor=>modelNoi(strOccupancy,factor)===null?null:modelNoi(strOccupancy,factor)*share,target,2,64);
    const occ=solveThreshold(value=>modelNoi(value)===null?null:modelNoi(value)*share,target,1,1);
    return {adr:adr.value===null?null:round(adr.value*currentAdr),occupancy:occ.value===null?null:Math.round(occ.value*1e6)/1e6,feasible:adr.feasible&&occ.feasible,adrFeasible:adr.feasible,occupancyFeasible:occ.feasible,reason:occ.reason||adr.reason||null};
  }
  const breakEven={operating:breakEvenFor(0),ltrParity:breakEvenFor(totals.ltr.noi),currentAdr:round(currentAdr),currentOccupancy,
    assumptions:'Eligible rentable nights, saved ADR seasonality, stay length, channel mix, fee rates, fixed costs, allocation rules and reporting dates remain fixed. Occupancy thresholds use a flat eligible-night occupancy; ADR thresholds scale the saved monthly rate curve. Capital is excluded from operating thresholds.'};
  const priorInvestmentExcluded=opening>0||sum((pv.furnish||[]).slice(0,reportingStart-1))>0||sum((pv.listingSetup||[]).slice(0,reportingStart-1))>0;
  function conversionPayback(rows) {
    const result=calculatePayback(rows);
    if(rows.length&&priorInvestmentExcluded) return {...result,available:false,months:null,reached:false,priorInvestmentExcluded:true,reason:'Conversion payback unavailable: initial conversion investment precedes the selected period. Prior investment and incremental cash flows are required to establish recovery; the displayed capital and cash flows cover only this period.'};
    return result;
  }
  const payback=conversionPayback(monthly.map(row=>({...row,str:row.budget})));
  const floorPlans=picks.map(pick=>{
    const share=pick.units/inventory;
    const planMonths=monthly.map(row=>{
      const m=row.month-1;
      const bySide={};
      for(const side of ['str','ltr','budget','actual']) {
        bySide[side]=Object.fromEntries(METRICS.map(key=>[key,row[side][key]===null?null:row[side][key]*share]));
        if(side==='ltr') {
          const thisRent=pick.ltRent===null||ltrOcc[m]===null?null:pick.ramp[m]*pick.ltRent*(ltrOcc[m]-(badDebt??0)-lossToLease)-pick.concessions[m];
          const totalRent=gpr[m]===null||vacancy[m]===null?null:gpr[m]+vacancy[m]+concessions[m]+collections[m]+leaseLoss[m];
          bySide[side].income=thisRent===null||totalRent===null||row.ltr.income===null?null:thisRent+(row.ltr.income-totalRent)*share;
          bySide[side].directContribution=sub(bySide[side].income,sub(bySide[side].expenses,bySide[side].allocatedExpenses));
          bySide[side].noi=sub(bySide[side].income,bySide[side].expenses);bySide[side].cashFlow=sub(bySide[side].noi,bySide[side].capex);
        }
      }
      return {...row,...bySide,units:pick.ramp[m],nights:Object.fromEntries(Object.entries(row.nights).map(([key,value])=>[key,value*share]))};
    });
    const sides=Object.fromEntries(['str','ltr','budget','actual'].map(side=>[side,planMonths.length?aggregateMetrics(planMonths.map(row=>row[side])):nullMetrics()]));
    const planExposure=sum(activeIndices.map(m=>pick.ramp[m]));
    const planGross=!activeIndices.length||pick.ltRent===null?null:pick.ltRent*planExposure;
    const planConcessions=activeIndices.length?sum(activeIndices.map(m=>pick.concessions[m])):null;
    return {...pick,...sides,monthly:planMonths,difference:diffMetrics(sides.str,sides.ltr),exposureUnitMonths:planExposure,
      ltrBridge:{grossPotentialRent:round(planGross),concessions:planConcessions===null?null:round(-planConcessions),netEffectiveRent:planGross===null||!planExposure?null:round((planGross-planConcessions)/planExposure),netEffectiveRentBasis:'Per active unit month in the selected period; concession recognition follows lease-term timing',leaseTermMonths:n(concession.leaseTermMonths)||12},
      allocationMethod:'Selected unit count; LTR rent and concessions use this floor plan',actualMethod:actuals.status==='unavailable'?'Unavailable':'Allocated program actuals by selected unit count',
      breakEven:{operating:breakEven.operating,ltrParity:breakEvenFor(sides.ltr.noi,share),currentAdr:breakEven.currentAdr,currentOccupancy},payback:conversionPayback(planMonths.map(row=>({...row,str:row.budget})))};
  });
  // Attribute residual rounding cents to the last plan rather than publish
  // floor-plan totals that differ from the program control total.
  if(floorPlans.length) for(const side of ['str','ltr','budget','actual']) for(const key of METRICS) {
    const target=totals[side][key];
    if(target!==null&&floorPlans.every(row=>row[side][key]!==null)) floorPlans.at(-1)[side][key]=round(floorPlans.at(-1)[side][key]+target-sum(floorPlans.map(row=>row[side][key])));
  }
  floorPlans.forEach(row=>{row.difference=diffMetrics(row.str,row.ltr);});
  const gl=rows.map(row=>{
    const budget=activeIndices.length?round(strictSum(activeIndices.map(m=>row.str[m]))):null,ltr=activeIndices.length?round(strictSum(activeIndices.map(m=>row.ltr[m]))):null;
    const actual=activeIndices.length?round(strictSum(activeIndices.map(m=>row.actual[m]===null&&!row.strApplicable?0:row.actual[m]))):null;
    const str=mode==='investment'?actual:budget,difference=round(sub(str,ltr));
    return {code:row.code,name:row.name,section:row.section,nature:row.nature,str,ltr,budget,actual,difference,
      percent:ltr===null||ltr===0||difference===null?null:difference/Math.abs(ltr),favorable:difference===null?null:row.section==='income'?difference>=0:difference<=0,
      source:row.source.join('; '),allocationMethod:row.allocationMethod.join('; '),mapped:row.mapped,sourceStatus:row.sourceStatus,
      strStatus:str===null?'missing':str===0?'confirmed modeled zero':'modeled',ltrStatus:ltr===null?'missing':ltr===0?'confirmed modeled zero':'modeled',
      monthly:activeIndices.map(m=>({period:period(year,m+1),str:mode==='investment'?row.actual[m]:row.str[m],ltr:row.ltr[m],budget:row.str[m],actual:row.actual[m]}))};
  }).sort((a,b)=>a.section.localeCompare(b.section)||a.code.localeCompare(b.code));
  assumptions.push({name:'Occupancy mode',value:occupancyMode,source:'Comparison scenario'},
    {name:'STR occupancy over eligible rentable nights',value:currentOccupancy,source:occupancyMode==='source'?'Saved STR monthly occupancy drivers':'Modeled scenario; recorded actuals remain unchanged'},
    {name:'LTR occupancy',value:strictSum(activeIndices.filter(m=>pv.unitRamp[m]>0).map(m=>ltrOcc[m]))===null||!sum(activeIndices.map(m=>pv.unitRamp[m]))?null:sum(activeIndices.map(m=>n(ltrOcc[m])*pv.unitRamp[m]))/sum(activeIndices.map(m=>pv.unitRamp[m])),source:occupancyMode==='source'?'ATLAS occupancy schedule weighted by matching active unit months':'Comparison scenario weighted by matching active unit months'},
    {name:'LTR alternative',value:'Counterfactual model; never observed LTR actuals',source:'Matched selected floor-plan inventory and exposure'},
    {name:'Concessions',value:clone(concession),source:sourceText(concession),reviewedAt:concession.reviewedAt||null,evidence:concessionEvidence},
    {name:'Net effective rent lease-term basis',value:n(concession.leaseTermMonths)||12,source:'Lease term in months; recognized concession timing shown separately'},
    {name:'Bad debt percentage',value:badDebt,source:sourceText(badDebtSource||'Missing')},
    {name:'LTR turnover rate',value:turnoverRate,source:scenario.ltrOverrides?.turnoverRate!==undefined?'Comparison override':sourceText(turnoverSource||'No standalone turnover assumption; property GL expense allocation retained')},
    {name:'LTR leasing / turnover cost per turn',value:leasingCost,source:leasingCost===null?'Property budget GL costs retained; no additional turnover cost fabricated':'Comparison override replaces allocated GL 6586'},
    {name:'Physical available nights',value:sum(activeIndices.map(m=>pv.available[m])),source:'Saved unit ramp × calendar days'},
    {name:'Blocked nights',value:sum(activeIndices.map(m=>pv.blocked[m])),source:'Saved STR blocked-night drivers'},
    {name:'Permit-restricted nights',value:sum(activeIndices.map(m=>pv.permitCapped?.[m]||0)),source:'Saved STR annual permit limit'},
    {name:'Eligible rentable nights',value:rentable,source:'Physical nights less blocked and permit restrictions'},
    {name:'Occupied nights',value:booked,source:'Modeled STR occupancy'},
    {name:'Capital presentation',value:'Furnishing, listing setup and FF&E replacement funding are separate from NOI.',source:'Existing STR model costs, reclassified for investment comparison'});
  const sensitivity=[];
  // At uniform occupancy, each month's share of booked nights equals its share
  // of eligible nights. This is the actual weighted ADR at full occupancy (and
  // at every positive sampled occupancy), without another preview per cell.
  const sensitivityAdr=rentable?sum(modelIndices.map(m=>pv.adr[m]*pv.rentable[m]))/rentable:currentAdr;
  if(modelIndices.length&&currentAdr>0) for(const occ of [.25,.5,.75,.9,1]) for(const factor of [.6,.8,1,1.2,1.4]) {
    const strNoi=modelNoi(occ,factor);
    sensitivity.push({adr:round(sensitivityAdr*factor),occupancy:occ,strNoi:round(strNoi),ltrNoi:totals.ltr.noi,difference:round(sub(strNoi,totals.ltr.noi))});
  }
  const incomplete=totals.difference.noi===null||concessionMissing||concessionOfferUnverified||badDebt===null||!hasExpenseEvidence||(mode!=='budget'&&actualStatus!=='closed');
  const positive=n(totals.difference.noi)>0;
  const action=incomplete?'Validate evidence':positive?(payback.reached?'Maintain; evaluate expansion':'Maintain and review conversion costs'):'Adjust or reconsider';
  const recommendation={action,text:incomplete?'The current evidence is incomplete. Resolve missing source assumptions and actual coverage before treating this scenario as an investment decision.':positive?`The model supports maintaining this inventory${payback.reached?' and evaluating a measured expansion':''}; STR produces higher NOI than the LTR alternative over the same dates.`:'The modeled LTR alternative produces equal or higher NOI. Review ADR, occupancy, operating fees and conversion investment before expanding the program.',
    drivers:[`Incremental modeled NOI: ${round(sub(totals.budget.noi,totals.ltr.noi)) ?? 'unavailable'}.`,`Incremental capital in the selected period: ${payback.incrementalInvestment ?? 'unavailable'}.`,breakEven.ltrParity.occupancy===null?'LTR parity occupancy is infeasible or unavailable.':`LTR parity occupancy: ${(breakEven.ltrParity.occupancy*100).toFixed(1)}%.`,payback.reason],confidence:incomplete?'limited':'modeled'};
  for(const section of ['income','expenses']) {
    const top=gl.filter(row=>row.section===section&&row.difference!==null&&row.difference!==0).sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference)).slice(0,2);
    for(const row of top) recommendation.drivers.push(`${row.code} ${row.name}: STR minus LTR ${round(row.difference)} ${section==='expenses'?(row.difference>0?'additional cost':'cost reduction'):(row.difference>0?'additional income':'income reduction')}. Source: ${row.source||row.allocationMethod||'Retained GL evidence'}.`);
  }
  const unresolved=gl.filter(row=>row.str===null||row.ltr===null);
  if(unresolved.length) recommendation.drivers.push(`Missing amounts: ${unresolved.slice(0,6).map(row=>`${row.code} ${row.name}`).join('; ')}${unresolved.length>6?`; ${unresolved.length-6} more`:''}.`);
  if(breakEven.ltrParity.occupancy!==null) recommendation.drivers.push(`Occupancy headroom to LTR parity: ${((currentOccupancy-breakEven.ltrParity.occupancy)*100).toFixed(1)} percentage points at the current ADR.`);
  if(breakEven.ltrParity.adr!==null) recommendation.drivers.push(`ADR headroom to LTR parity: ${round(currentAdr-breakEven.ltrParity.adr)} at the current occupancy and saved monthly rate pattern.`);
  const bridgeAmount=values=>activeIndices.length?round(strictSum(activeIndices.map(m=>values[m]))):null;
  const snapshot={schemaVersion:1,engineVersion:COMPARISON_ENGINE_VERSION,createdAt:source.loadedAt||program.savedAt||null,metadata:{propertyId:property.id,propertyName:property.name,programId,programName:program.name||cfg.name||'Saved STR program',programVersion:program.version||program.revision?.revision||null,programStatus:program.status||'proposed',scenarioName:scenario.name||'Comparison',year,startMonth:reportingStart,endMonth:end,requestedStartMonth:start,requestedEndMonth:requestedEnd,mode,view:scenario.view||'annual',inventoryUnits:inventory,inventoryLabel:'Floor-plan estimates',periodLabel:activeIndices.length?`${period(year,reportingStart)} – ${period(year,end)}`:'No comparable recorded period',actualsPeriod:actuals.period,partialYear:reportingStart!==1||end!==12||pv.unitRamp.some(units=>units!==inventory),sourceReferences:clone(source.references||[])},
    totals,monthly,floorPlans,gl,assumptions,allocations,capital:gl.filter(row=>row.section==='capex'),limitations:[...new Set(warnings)],actuals,breakEven,payback,recommendation,sensitivity,
    occupancy:{mode:occupancyMode,str:currentOccupancy,ltr:assumptions.find(row=>row.name==='LTR occupancy').value,strMonthly:pv.occ.slice(),ltrMonthly:ltrOcc.slice()},
    ltrBridge:{grossPotentialRent:bridgeAmount(gpr),vacancyLoss:bridgeAmount(vacancy),concessions:bridgeAmount(concessions),badDebt:bridgeAmount(collections),effectiveIncome:totals.ltr.income,netEffectiveRent:strictSum(activeIndices.map(m=>gpr[m]))===null||!sum(activeIndices.map(m=>pv.unitRamp[m]))?null:round((sum(activeIndices.map(m=>gpr[m]))+sum(activeIndices.map(m=>concessions[m])))/sum(activeIndices.map(m=>pv.unitRamp[m]))),netEffectiveRentBasis:'Per active unit month in the selected period; concession recognition follows lease-term timing',leaseTermMonths:n(concession.leaseTermMonths)||12},scenario:clone(scenario)};
  return snapshot;
}
