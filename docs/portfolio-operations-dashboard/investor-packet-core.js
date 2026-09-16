/* Pure, read-only investor reporting model. Shared by browser exports and delivery. */
(function (root) {
  'use strict';
  const groups = [
    ['occupancy','Occupancy and leasing','totalUnits|Total units or beds|number;occupiedSnapshot|Occupied units|number;physicalOccupancy|Physical occupancy|percent;economicOccupancy|Economic occupancy|percent;leasedOccupancy|Leased occupancy|percent;preleasedOccupancy|Preleased occupancy|percent;noticeUnits|Notice-to-vacate units|number;availableUnits|Available units|number;downUnits|Down units|number;exposure30|30-day exposure|number;exposure60|60-day exposure|number;exposure90|90-day exposure|number;moveIns|Move-ins|number;moveOuts|Move-outs|number;netAbsorption|Net absorption|number;daysVacant|Average days vacant|number;noticeToReadyDays|Notice to ready days|number;readyToLeasedDays|Ready to leased days|number;renewalExpirations|Upcoming expirations|number;renewalOffers|Renewal offers issued|number;renewalAcceptance|Renewal acceptance rate|percent;renewalRentIncrease|Renewal rent increase|percent;retention|Resident retention|percent'],
    ['funnel','Marketing and leasing funnel','guestCards|Leads|number;costPerLead|Cost per lead|currency;qualifiedLeads|Qualified leads|number;toursScheduled|Tours scheduled|number;tours|Tours completed|number;applicationsStarted|Applications started|number;applications|Applications completed|number;approvalRate|Approval rate|percent;denialRate|Denial rate|percent;cancelled|Cancellations|number;leasesSignedActual|New leases signed|number;renewalSigned|Renewals signed|number;netLeases|Net leases|number;leadToTour|Lead-to-tour conversion|percent;tourToApplication|Tour-to-application conversion|percent;applicationToLease|Application-to-lease conversion|percent;leadToLease|Lead-to-lease conversion|percent;costPerLease|Cost per lease|currency;responseMinutes|Average response time (minutes)|number;followUpCompletion|Follow-up completion|percent'],
    ['revenue','Revenue and rent','revenue|Operating revenue|currency;grossPotentialRent|Gross potential rent|currency;scheduledRent|Scheduled rent|currency;marketRent|Asking rent|currency;signedRent|Signed rent|currency;nerActual|Effective rent after concessions|currency;rentPerUnitBed|Rent per unit or bed|currency;rentalIncome|Rental income|currency;otherIncome|Other income|currency;utilityReimbursement|Utility reimbursements|currency;parkingIncome|Parking income|currency;storageIncome|Storage income|currency;petIncome|Pet income|currency;amenityIncome|Amenity income|currency;vacancyLoss|Vacancy loss|currency;lossToLease|Loss-to-lease|currency;concessions|Concessions|currency;employeeModelLoss|Employee and model-unit loss|currency;badDebt|Bad debt|currency;revenuePerOccupied|Revenue per occupied unit|currency;revenuePerAvailable|Revenue per available unit|currency;rentGrowth|Actual rent growth|percent;newLeaseTradeOut|New-lease trade-out|percent;renewalTradeOut|Renewal trade-out|percent'],
    ['expenses','Operating expenses and NOI','expenses|Operating expenses|currency;payroll|Payroll and benefits|currency;contractLabor|Contract labor|currency;repairs|Repairs and maintenance|currency;turnExpense|Turn and make-ready expense|currency;utilities|Utilities|currency;marketingExpense|Marketing and advertising|currency;adminExpense|Administrative expense|currency;security|Security|currency;landscaping|Landscaping and contracts|currency;propertyTaxes|Property taxes|currency;insurance|Insurance|currency;managementFees|Management fees|currency;expensePerUnit|Expense per unit|currency;controllableExpensePerUnit|Controllable expense per unit|currency;noi|NOI|currency;noiMargin|NOI margin|percent;noiPerUnit|NOI per unit|currency;cashFlow|Cash flow before distributions|currency'],
    ['collections','Collections and receivables','billing|Current-month billing|currency;collections|Current-month collections|currency;collectionRate|Collection rate|percent;delinquency|Operational delinquency|currency;delinquencyPct|Delinquency / gross potential rent|percent;aging30|30-day aging|currency;aging60|60-day aging|currency;aging90|90-plus-day aging|currency;paymentPlans|Payment plans|number;evictionsFiled|Evictions filed|number;evictionsPending|Evictions pending|number;formerBalances|Former-resident balances|currency;writeOffs|Bad-debt write-offs|currency;recoveries|Recoveries|currency;depositLiability|Security-deposit liability|currency;subsidyReceivables|Subsidy / assistance receivables|currency;receivables|Outstanding receivables|currency'],
    ['maintenance','Maintenance and asset condition','openWorkOrders|Open work orders|number;completedWorkOrders|Completed work orders|number;completionHours|Average completion hours|number;emergencyWorkOrders|Emergency work orders|number;over48Hours|Work orders over 48 hours|number;repeatWorkOrders|Repeat work orders|number;preventiveCompletion|Preventive-maintenance completion|percent;unitsTurning|Units being turned|number;turnDays|Average turn time|number;unitsNotReady|Units not ready|number;makeReadyCost|Make-ready cost per unit|currency;deferredItems|Deferred-maintenance items|number;lifeSafetyFindings|Life-safety / inspection findings|number;majorIncidents|Major incidents / claims|number'],
    ['capital','Capital projects and value-add','capexSpent|CapEx spent|currency;capexBudget|Approved CapEx budget|currency;capexCommitted|Committed CapEx|currency;capexRemaining|CapEx budget remaining|currency;capexForecast|Forecast CapEx spend|currency;projectsUnderway|Projects underway|number;renovationsPlanned|Renovations planned|number;renovationsUnderway|Renovations underway|number;renovationsComplete|Renovations completed|number;renovationCost|Renovation cost per unit|currency;renovationDowntime|Renovation downtime days|number;rentPremium|Achieved rent premium|currency;yieldOnCost|Yield on cost|percent;projectROI|Project ROI|percent;paybackMonths|Estimated payback months|number'],
    ['debt','Debt, liquidity and covenants','loanBalance|Loan balance|currency;interestRate|Interest rate|percent;debtService|Monthly debt service|currency;dscr|DSCR|multiple;debtYield|Debt yield|percent;ltv|Loan-to-value|percent;replacementReserve|Replacement reserve|currency;operatingReserve|Operating reserve|currency;restrictedCash|Restricted cash|currency;availableCash|Available cash|currency;accountsPayable|Accounts payable|currency;fundingRequired|Near-term funding requirements|currency'],
    ['returns','Investor capital and returns','equityInvested|Original equity invested|currency;additionalCapital|Additional capital contributed|currency;unfundedCommitments|Unfunded capital commitments|currency;cashBalance|Cash balance|currency;distribution|Current-period distribution|currency;cumulativeDistributions|Cumulative distributions|currency;returnOfCapital|Return of capital|currency;returnOnCapital|Return on capital|currency;cashOnCash|Cash-on-cash return|percent;prefAccrual|Preferred-return accrual|currency;prefPaid|Preferred return paid|currency;equityMultiple|Equity multiple / MOIC|multiple;propertyIRR|Property-level IRR|percent;investorIRR|Investor-level IRR|percent;estimatedValue|Estimated property value|currency;netEquity|Estimated net equity|currency;exitCapRate|Exit cap rate assumption|percent;exitProceeds|Forecast sale / refinance proceeds|currency'],
    ['market','Market and competitive position','submarketOccupancy|Submarket occupancy|percent;compOccupancy|Comparable occupancy|percent;compRent|Comparable asking rent|currency;compEffectiveRent|Comparable effective rent|currency;compConcessions|Comparable concessions|currency;newSupply|Supply under construction|number;upcomingDeliveries|Upcoming deliveries|number;ora|ORA score|number;reviewScore|Online review score|number;forecastOccupancy|Forecast occupancy|percent;forecastNOI|Projected NOI|currency'],
    ['student','Student housing','bedOccupancy|Bed occupancy|percent;preleasingPace|Preleasing pace|percent;turnReadiness|Turn readiness|percent;guarantorCompletion|Guarantor completion|percent;academicYearPace|Academic-year comparison|percent'],
    ['senior','Senior housing','careLevelOccupancy|Occupancy by care level|percent;inquiryToMoveIn|Inquiry-to-move-in conversion|percent;careRevenue|Care revenue|currency;staffingHours|Staffing hours|number'],
    ['military','Military housing','projectPipeline|Base / project pipeline|number;eligibleOccupancy|Occupancy by eligibility class|percent;militaryReceivables|Military receivables|currency'],
    ['leaseup','Lease-up execution','weeklyVelocity|Weekly leasing velocity|number;monthlyVelocity|Monthly leasing velocity|number;unitsDelivered|Units delivered|number;unitsAccepted|Units accepted|number;deliveredLeased|Delivered inventory leased|percent;stabilizationTarget|Stabilization occupancy target|percent;requiredWeeklyLeases|Required leases per week|number;underwritingPace|Leasing pace vs underwriting|number;concessionBurnOff|Concession burn-off|currency']
  ];
  const flows = new Set('moveIns moveOuts netAbsorption guestCards tours applications applicationsApproved denied cancelled leasesSignedActual renewalSigned netLeases revenue rentalIncome otherIncome utilityReimbursement parkingIncome storageIncome petIncome amenityIncome vacancyLoss lossToLease concessions employeeModelLoss badDebt expenses payroll contractLabor repairs turnExpense utilities marketingExpense adminExpense security landscaping propertyTaxes insurance managementFees noi cashFlow billing collections writeOffs recoveries capexSpent distribution additionalCapital returnOfCapital returnOnCapital prefPaid debtService careRevenue staffingHours'.split(' '));
  const metrics = groups.flatMap(([group,title,list]) => list.split(';').map(line => {
    const [id,label,unit] = line.split('|');
    return {id,label,unit,group,groupTitle:title,aggregation:flows.has(id)?'sum':'end',definition:`${label}; ${flows.has(id)?'activity within the reporting period':'point-in-time or separately defined measure'}.`,version:'1'};
  }));
  const formulas = {
    physicalOccupancy:['occupiedSnapshot','totalUnits','ratio'], leasedOccupancy:['leasedSnapshot','totalUnits','ratio'],
    netAbsorption:['moveIns','moveOuts','subtract'], noi:['revenue','expenses','subtract'], noiMargin:['noi','revenue','ratio'],
    retention:['renewalSigned','renewalExpirations','ratio'], renewalAcceptance:['renewalSigned','renewalOffers','ratio'],
    approvalRate:['applicationsApproved','applications','ratio'], denialRate:['denied','applications','ratio'],
    leadToTour:['tours','guestCards','ratio'], tourToApplication:['applications','tours','ratio'],
    applicationToLease:['leasesSignedActual','applications','ratio'], leadToLease:['leasesSignedActual','guestCards','ratio'],
    collectionRate:['collections','billing','ratio'], delinquencyPct:['delinquency','grossPotentialRent','ratio'],
    revenuePerOccupied:['revenue','occupiedSnapshot','divide'], revenuePerAvailable:['revenue','totalUnits','divide'],
    expensePerUnit:['expenses','totalUnits','divide'], noiPerUnit:['noi','totalUnits','divide']
  };
  Object.entries(formulas).forEach(([id,[a,b,op]]) => { const m=metrics.find(x=>x.id===id); if(m) m.definition=`${a} ${op==='subtract'?'−':'÷'} ${b}${op==='ratio'?' × 100':''}; same community, period and basis. YTD rates require an explicit mapping; monthly rates are never summed.`; });
  const number = v => v===null||v===undefined||v===''||typeof v==='boolean'?null:(Number.isFinite(Number(v))?Number(v):null);
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const periodValid = p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p||'');
  function shift(p,n) { const [y,m]=p.split('-').map(Number); const d=new Date(Date.UTC(y,m-1+n,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`; }
  const missing = reason => ({value:null,source:'',status:'missing',reason});
  function at(obj,path) { return String(path).split('.').reduce((o,k)=>['__proto__','constructor','prototype'].includes(k)?undefined:(o&&Object.hasOwn(o,k)?o[k]:undefined),obj); }
  function read(record,period,id,basis='actual',config={},seen=new Set()) {
    if(!periodValid(period)) return missing('Invalid reporting period');
    const key=`${id}:${basis}`; if(seen.has(key)) return missing('Circular metric definition'); seen=new Set(seen); seen.add(key);
    const mapping=config.mappings?.[id]?.[basis];
    const entry=record.monthlyHistoryByPeriod?.[period];
    const financial=record.investorFinancialByPeriod?.[period];
    if(!mapping&&financial?.source&&number(financial[id]?.[basis])!==null) return {value:number(financial[id][basis]),source:financial.source+` / ${id}.${basis}`,status:'available',version:'budget-builder-v1'};
    if(!mapping && ['revenue','expenses'].includes(id) && ['actual','budget'].includes(basis) && config.ledgerBasis==='monthly') {
      const ledgerName=basis==='actual'?'financialLedger':'financialBudgetLedger';
      const ledger=record[ledgerName]?.[period];
      if(Array.isArray(ledger)&&ledger.length) {
        const sections=id==='revenue'?['operating income','operating revenue']:['operating expenses','operating expense'];
        const rows=ledger.map((r,i)=>({...r,index:i})).filter(r=>sections.includes(String(r.section||'').toLowerCase()));
        const keys=rows.map(r=>String(r.glCode??r.gl??''));
        const field=basis==='actual'?'actual':'budget';
        if(rows.length&&keys.every(Boolean)&&new Set(keys).size===keys.length&&rows.every(r=>number(r[field])!==null&&!/total|subtotal/i.test(r.lineItem||r.description||r.name||''))) {
          return {value:rows.reduce((s,r)=>s+Number(r[field]),0),status:'available',version:'monthly-ledger-v1',source:`ATLAS / ${ledgerName}.${period} / ${sections[0]} / ${field} / GL ${keys.join(', ')}; monthly basis confirmed in packet settings`};
        }
        return missing('Ledger requires complete numeric detail rows, unique GL codes and explicit operating sections');
      }
    }
    let path=mapping?.path || (basis==='actual'?`monthlyHistoryByPeriod.{period}.${id}`:basis==='budget'&&id==='physicalOccupancy'?'monthlyHistoryByPeriod.{period}.budgetOcc':'');
    const explicit=Boolean(mapping?.path);
    const inventoryFields={totalUnits:'totalUnits',occupiedSnapshot:'occupiedUnits',leasedSnapshot:'leasedUnits',availableUnits:'availableUnits'};
    if(!mapping&&basis==='actual'&&inventoryFields[id]) {
      const box=record.latestDlrSummary?.dailyBoxScore;
      const value=number(box?.[inventoryFields[id]]);
      if(String(box?.reportDateIso||'').slice(0,7)===period&&value!==null&&box?.sourceFileName) return {value,status:'available',version:'dlr-inventory-v1',source:`ATLAS / latestDlrSummary.dailyBoxScore.${inventoryFields[id]} / ${box.sourceFileName} / as of ${box.reportDateIso}`};
    }
    if(path) {
      // A mapping must contain a period token, preventing accidental reuse of current snapshots for history.
      if(!path.includes('{period}')&&!path.includes('{year}')) return missing('Source mapping must be period-specific');
      path=path.replaceAll('{period}',period).replaceAll('{year}',period.slice(0,4));
      const value=number(at(record,path));
      if(value!==null) {
        if(value===0&&!config.verifiedZeros?.[period]?.includes(`${id}:${basis}`)) return missing('Stored zero needs source verification');
        return {value:value*(number(mapping?.scale)??1),source:`ATLAS / ${path}${mapping?.citation?' / '+mapping.citation:''}`,status:'available',definition:mapping?.definition||'',version:mapping?.version||'1',explicit};
      }
    }
    if(['actual','budget','forecast','underwriting'].includes(basis) && formulas[id]) {
      const [a,b,op]=formulas[id], av=read(record,period,a,basis,config,seen), bv=read(record,period,b,basis,config,seen);
      if(av.value!==null&&bv.value!==null) {
        if(op!=='subtract'&&bv.value<=0) return missing('Denominator is zero or negative');
        return {value:op==='subtract'?av.value-bv.value:av.value/bv.value*(op==='ratio'?100:1),source:`Calculated: ${av.source}; ${bv.source}`,status:'available',version:'1'};
      }
    }
    return missing(explicit?'Mapped source is unavailable for this period':entry?'Metric not mapped or unavailable':'Exact reporting period is unavailable');
  }
  function format(value,unit='number') { if(value===null||value===undefined||!Number.isFinite(Number(value))) return '—'; return (unit==='currency'?'$':'')+Number(value).toLocaleString('en-US',{maximumFractionDigits:unit==='currency'?0:1})+(unit==='percent'?'%':unit==='multiple'?'×':''); }
  function delta(a,b) { return a===null||b===null?null:a-b; }
  function ytd(record,period,m,basis,config) {
    const target=`ytd${basis==='actual'?'Actual':'Budget'}`;
    if(config.mappings?.[m.id]?.[target]) return read(record,period,m.id,target,config);
    if(m.aggregation!=='sum') return read(record,period,m.id,`ytd${basis==='actual'?'Actual':'Budget'}`,config);
    const cells=Array.from({length:Number(period.slice(5))},(_,i)=>read(record,`${period.slice(0,4)}-${String(i+1).padStart(2,'0')}`,m.id,basis,config));
    if(cells.some(c=>c.value===null)) return missing('YTD requires all monthly periods');
    return {value:cells.reduce((s,c)=>s+c.value,0),source:cells.map(c=>c.source).join('; '),status:'available'};
  }
  function build({community,period,record={},config={},draft={},prior=null,now=new Date()}) {
    if(!community||!periodValid(period)) throw new Error('Select a community and reporting month.');
    const specialized=['student','senior','military','leaseup'];
    const selected=metrics.filter(m=>!specialized.includes(m.group)||(config.housingTypes||[]).includes(m.group));
    const rows=selected.map(m=>{
      const cells={current:read(record,period,m.id,'actual',config),budget:read(record,period,m.id,'budget',config),priorMonth:read(record,shift(period,-1),m.id,'actual',config),priorYear:read(record,shift(period,-12),m.id,'actual',config),underwriting:read(record,period,m.id,'underwriting',config),forecast:read(record,period,m.id,'forecast',config),ytdActual:ytd(record,period,m,'actual',config),ytdBudget:ytd(record,period,m,'budget',config)};
      const variance=delta(cells.current.value,cells.budget.value), mom=delta(cells.current.value,cells.priorMonth.value);
      const variancePct=variance===null||cells.budget.value===0?null:variance/Math.abs(cells.budget.value)*100;
      const base=prior?.rows?.find(x=>x.id===m.id);
      const threshold=m.unit==='percent'?(config.materialityPoints??2):m.unit==='currency'?(config.materialityDollars??5000):(config.materialityCount??5);
      const material=[mom,variance].some(v=>v!==null&&v!==0&&Math.abs(v)>=threshold);
      const definition=cells.current.definition||m.definition;
      return {...m,definition,cells,variance,variancePct,mom,material,yoy:delta(cells.current.value,cells.priorYear.value),underwritingVariance:delta(cells.current.value,cells.underwriting.value),ytdVariance:delta(cells.ytdActual.value,cells.ytdBudget.value),forecastChange:prior?.period?.slice(0,4)===period.slice(0,4)?delta(cells.forecast.value,base?.cells?.forecast?.value??null):null,definitionChanged:Boolean(base&&(base.definition!==definition||base.cells.current.version!==cells.current.version)),sourceChanged:Boolean(base&&String(base.cells.current.source).replaceAll(prior.period,'{period}')!==String(cells.current.source).replaceAll(period,'{period}'))};
    });
    const issues=[];
    const snapshotDate=String(record.latestDlrSummary?.dailyBoxScore?.reportDateIso||'');
    const monthEnd=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10);
    if(snapshotDate.slice(0,7)===period&&snapshotDate!==monthEnd&&rows.some(r=>String(r.cells.current.source).includes('latestDlrSummary.dailyBoxScore'))) issues.push({owner:'Operations',metric:'Inventory cutoff',issue:`Inventory uses the dated DLR snapshot ${snapshotDate}, not month-end ${monthEnd}; review comparability and source cutoff`});
    for(const [id,[a,b,op]] of Object.entries(formulas)) {
      const val=rows.find(r=>r.id===id)?.cells.current.value;
      const av=read(record,period,a,'actual',config).value,bv=read(record,period,b,'actual',config).value;
      if(val!==null&&val!==undefined&&av!==null&&bv!==null&&(op==='subtract'||bv>0)) {
        const expected=op==='subtract'?av-bv:av/bv*(op==='ratio'?100:1);
        if(Math.abs(val-expected)>(op==='ratio'?.11:1)) issues.push({owner:'Finance / data owner',metric:id,issue:`Reported metric does not reconcile to its component values (${a}, ${b}); check definition, units and cutoff`});
      }
    }
    rows.filter(r=>r.cells.current.value===null).forEach(r=>issues.push({owner:draft.metricOwners?.[r.id]||'Owner unassigned',metric:r.label,issue:r.cells.current.reason}));
    rows.filter(r=>r.material&&!draft.drivers?.some(d=>d.metric===r.id&&d.evidence&&d.owner&&d.action)).forEach(r=>issues.push({owner:draft.metricOwners?.[r.id]||'Owner unassigned',metric:r.label,issue:'Material movement needs evidence, owner and action'}));
    for(const d of draft.drivers||[]) if(d.classification==='confirmed'&&!d.evidence) issues.push({owner:d.owner||'Owner unassigned',metric:d.metric,issue:'Unsupported confirmed driver; treated as a hypothesis'});
    for(const r of rows.filter(r=>r.unit==='percent'&&['physicalOccupancy','leasedOccupancy','retention','collectionRate'].includes(r.id))) if(r.cells.current.value!==null&&(r.cells.current.value<0||r.cells.current.value>100)) issues.push({owner:'Data owner',metric:r.label,issue:'Rate outside expected 0–100 range; reconcile definition and denominator'});
    const partial=period>=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    if(partial) issues.unshift({owner:'Finance',metric:'Reporting cutoff',issue:'Open or future period; comparison with completed months may be misleading'});
    if(!prior) issues.push({owner:'Finance',metric:'Prior review',issue:'No saved prior-month review; narrative and commitment changes cannot be verified'});
    const noteFields=['performance','driversSummary','management','investmentPlan'];
    noteFields.filter(k=>draft[k]&&!draft[`${k}Source`]).forEach(k=>issues.push({owner:'Leadership',metric:k,issue:'Narrative has no supporting source note'}));
    const priorIssues=prior?.issues||[];
    const audit={resolved:priorIssues.filter(a=>!issues.some(b=>a.metric===b.metric&&a.issue===b.issue)),new:issues.filter(a=>!priorIssues.some(b=>a.metric===b.metric&&a.issue===b.issue)),continuing:issues.filter(a=>priorIssues.some(b=>a.metric===b.metric&&a.issue===b.issue))};
    return {schemaVersion:1,community,period,generatedAt:now.toISOString(),partial,rows,issues,audit,draft:JSON.parse(JSON.stringify(draft)),config:{housingTypes:config.housingTypes||[]},prior:prior?{period:prior.period,reviewedAt:prior.reviewedAt,actions:prior.draft?.actions||[],risks:prior.draft?.risks||[]}:null};
  }
  const executive=['physicalOccupancy','economicOccupancy','leasedOccupancy','preleasedOccupancy','revenue','expenses','noi','noiMargin','cashFlow','netAbsorption','nerActual','collectionRate','capexSpent','loanBalance','dscr','distribution','forecastOccupancy','forecastNOI'];
  function pages(packet) {
    const pages=[{title:'Executive dashboard',rows:executive.map(id=>packet.rows.find(r=>r.id===id)).filter(Boolean),kind:'executive'}];
    const priorities={expenses:['expenses','noi','noiMargin','noiPerUnit','payroll','utilities','repairs','turnExpense'],funnel:['guestCards','tours','applications','leasesSignedActual','leadToTour','tourToApplication','applicationToLease','costPerLease'],occupancy:['totalUnits','physicalOccupancy','economicOccupancy','leasedOccupancy','preleasedOccupancy','exposure30','exposure60','exposure90'],returns:['equityInvested','distribution','cumulativeDistributions','cashOnCash','prefAccrual','cashBalance','netEquity','exitProceeds']};
    for(const [id,title] of groups.filter(g=>packet.rows.some(r=>r.group===g[0]))) pages.push({title,rows:priorities[id]?priorities[id].map(key=>packet.rows.find(r=>r.id===key)).filter(Boolean):packet.rows.filter(r=>r.group===id).slice(0,8),kind:id});
    // Specialist metrics share the outlook page instead of forcing every housing type into the common core.
    const specialists=pages.filter(p=>['student','senior','military','leaseup'].includes(p.kind));
    const core=pages.filter(p=>!specialists.includes(p));
    if(specialists.length) core[core.length-1]={...core.at(-1),title:'Market, outlook and housing measures',rows:[...core.at(-1).rows.slice(0,4),...specialists.flatMap(p=>p.rows).slice(0,8)]};
    core.push({title:'Risks, decisions and action plan',rows:[],kind:'actions'});
    return core;
  }
  function table(rows,full=false) {
    const heads=['Metric','Current','Budget','Δ / pp','Δ %','Prior month',...(full?['Prior year','Underwriting','YTD actual','YTD budget','FY forecast']:[])];
    return `<table><thead><tr>${heads.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)} <a href="#source-${r.id}">[${metrics.findIndex(m=>m.id===r.id)+1}]</a></td>${[format(r.cells.current.value,r.unit),format(r.cells.budget.value,r.unit),format(r.variance,r.unit==='percent'?'number':r.unit),format(r.variancePct,'percent'),format(r.cells.priorMonth.value,r.unit),...(full?[format(r.cells.priorYear.value,r.unit),format(r.cells.underwriting.value,r.unit),format(r.cells.ytdActual.value,r.unit),format(r.cells.ytdBudget.value,r.unit),format(r.cells.forecast.value,r.unit)]:[])].map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function notes(packet,kind) {
    const d=packet.draft;
    if(kind==='capital'&&(d.projects||[]).length) return d.projects.map(p=>`<p><b>${esc(p.project)}</b> · ${esc(p.scope)} · Progress: ${esc(p.progress)} · Approved / committed / spent / forecast: ${esc(p.budget)} · Original / forecast completion: ${esc(p.schedule)} · Premium / ROI / payback: ${esc(p.returns)} · Risk: ${esc(p.risk)} · Owner: ${esc(p.owner)} · Source: ${esc(p.evidence||'Required')}</p>`).join('');
    if(kind==='debt'&&d.debtTerms) return `<p>${esc(d.debtTerms)}</p><p>Source: ${esc(d.debtTermsSource||'Required')}</p>`;
    if(kind==='executive') return ['performance','driversSummary','management','investmentPlan'].map((key,i)=>`<h3>${['How is the property performing?','Why?','What is management doing?','Is the investment on plan?'][i]}</h3><p>${esc(d[key]||'Owner commentary required.')} <small>${esc(d[key+'Source']||'Source note required')}</small></p>`).join('');
    if(kind==='actions') return `<h3>Top risks and ownership decisions</h3>${(d.risks||[]).slice(0,5).map(r=>`<p><b>${esc(r.risk)}</b> · Impact: ${esc(r.impact||'Unquantified')} · Mitigation: ${esc(r.mitigation)} · ${esc(r.owner||'Unassigned')} · Due ${esc(r.due)} · ${esc(r.status)} · Decision: ${esc(r.decision)} · Source: ${esc(r.evidence||'Required')}</p>`).join('')||'<p>No risk assessment recorded.</p>'}<h3>Commitments and milestones</h3>${(d.actions||[]).map(a=>`<p>${esc(a.owner||'Unassigned')} · ${esc(a.action)} · ${esc(a.due)} · ${esc(a.status)} · ${esc(a.evidence||'Source required')}</p>`).join('')||'<p>No owner commitments recorded.</p>'}`;
    return (d.drivers||[]).filter(x=>packet.rows.find(r=>r.id===x.metric)?.group===kind).map(x=>`<p><b>${x.classification==='confirmed'&&x.evidence?'Confirmed driver':'Hypothesis to investigate'}:</b> ${esc(x.explanation)} · Segment/cohort/channel: ${esc(x.segment||'Not provided')} · Evidence: ${esc(x.evidence||'Required')} · Owner: ${esc(x.owner||'Unassigned')} · Action: ${esc(x.action)} · Due ${esc(x.due)} · Question: ${esc(x.question)}</p>`).join('')||'<p>Driver analysis pending. Correlation alone does not establish cause.</p>';
  }
  function html(packet,{appendix=true,editable=false}={}) {
    const ps=pages(packet);
    const header=`<header><b>ATLAS <span>RISE</span></b><span>${esc(packet.community)} · ${esc(packet.period)} · ${packet.partial?'Month to date / open period':'Monthly review'}</span></header>`;
    const sourceList=rows=>`<div class="sources">Bracketed metric references link to the source register in the complete export. Every comparison has its own source or missing-input explanation.</div>`;
    const content=ps.map((p,i)=>`<section class="${p.kind==='executive'?'executive':''}">${header}<h1>${esc(p.title)}</h1>${p.rows.length?table(p.rows):''}<div class="narrative" ${editable?'contenteditable="true"':''}>${notes(packet,p.kind)}</div>${sourceList(p.rows)}<footer>Investor review · ${i+1} / ${ps.length} · — = unavailable; rate differences in percentage points</footer></section>`).join('');
    const append=appendix?`<section class="appendix">${header}<h1>Metric comparisons and source register</h1>${table(packet.rows,true)}${packet.rows.map(r=>`<h3 id="source-${r.id}">[${metrics.findIndex(m=>m.id===r.id)+1}] ${esc(r.label)}</h3><p>${esc(r.definition)}</p>${Object.entries(r.cells).map(([k,c])=>`<p><b>${esc(k)}</b>: ${esc(c.source||c.reason)}</p>`).join('')}`).join('')}</section><section class="appendix">${header}<h1>Prior-review audit and owner questions</h1><p>Prior review: ${esc(packet.prior?.period||'Unavailable')}. Forecast changes require a saved prior review and a comparable forecast basis.</p>${packet.rows.filter(r=>r.material||r.definitionChanged||r.sourceChanged||r.forecastChange).map(r=>`<p>${esc(r.label)}: MoM ${esc(format(r.mom,r.unit))}; forecast revision ${esc(format(r.forecastChange,r.unit))}; ${r.definitionChanged?'definition changed; ':''}${r.sourceChanged?'source changed; ':''}sources: ${esc(r.cells.current.source)} / ${esc(r.cells.priorMonth.source)}</p>`).join('')}<h3>Anomalies since the prior review</h3>${['resolved','new','continuing'].map(k=>`<h3>${esc(k)}</h3>${(packet.audit?.[k]||[]).map(x=>`<p>${esc(x.owner)} · ${esc(x.metric)}: ${esc(x.issue)}</p>`).join('')}`).join('')}<h3>Prior commitments</h3>${(packet.prior?.actions||[]).map(a=>`<p>${esc(a.owner)} · ${esc(a.action)} · prior status: ${esc(a.status)} · current status: ${esc((packet.draft.actions||[]).find(b=>b.id===a.id)?.status||'Needs owner update')}</p>`).join('')}<h3>Prior risks</h3>${(packet.prior?.risks||[]).map(r=>`<p>${esc(r.owner)} · ${esc(r.risk)} · Prior: ${esc(r.status)} · Current: ${esc((packet.draft.risks||[]).find(x=>x.id===r.id)?.status||'Owner update required')}</p>`).join('')}<h3>Data quality and unsupported claims</h3>${packet.issues.slice().sort((a,b)=>a.owner.localeCompare(b.owner)).map(x=>`<p><b>${esc(x.owner)}</b> · ${esc(x.metric)}: ${esc(x.issue)}</p>`).join('')}<h3>Projects, covenants and market context</h3><p>${esc(packet.draft.context||'Project register, debt maturity/extension/cap dates, covenant definitions and thresholds, down-unit reasons, competitive amenities and regulatory context require owner notes with source links.')}</p></section>`:'';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(packet.community)} Investor Packet ${esc(packet.period)}</title><style>body{margin:0;background:#edf2f5;color:#123044;font:14px Arial,sans-serif}.executive table{font-size:11px}.executive td,.executive th{padding:4px 8px}.executive .narrative{font-size:11px}.executive h3{display:inline;font-size:11px}.executive p{display:inline;margin-right:14px}.executive .narrative{margin-top:14px}a{color:#166276;text-decoration:none}*{box-sizing:border-box}section{background:white;max-width:1200px;margin:24px auto;padding:36px;page-break-after:always}header{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #197184;padding-bottom:14px;font-size:12px}header b{font-size:22px}header span{color:#537383}h1{font-size:28px;margin:22px 0}h3{font-size:14px;margin:18px 0 6px}p{line-height:1.5;margin:6px 0}small,.sources,footer{font-size:10px;color:#526a77}.sources{margin-top:20px;overflow-wrap:anywhere}footer{margin-top:20px;border-top:1px solid #cad6dd;padding-top:10px}table{border-collapse:collapse;width:100%;font-size:12px}th{background:#123e52;color:white;text-align:right}td,th{padding:8px;border-bottom:1px solid #dce5ea}td{text-align:right}td:first-child,th:first-child{text-align:left}tr:nth-child(even){background:#f4f7f9}.appendix table{font-size:10px}.appendix td,.appendix th{padding:5px}.appendix{overflow-wrap:anywhere}[contenteditable]{outline:1px dashed #aebfc8;padding:8px}@media print{body{background:white}section{max-width:none;margin:0;padding:12mm;break-after:page}thead{display:table-header-group}tr,p{break-inside:avoid}.appendix{break-after:auto}@page{size:A4 landscape;margin:8mm}}</style></head><body>${content}${append}</body></html>`;
  }
  function validReviewedPacket(packet,community) {
    if(!packet||packet.schemaVersion!==1||packet.community!==community||!periodValid(packet.period)||!packet.reviewedAt||!packet.draft||!Array.isArray(packet.rows)||packet.rows.length>250||!Array.isArray(packet.issues)||packet.issues.length>1000) return false;
    const ids=new Set();
    for(const row of packet.rows){
      const metric=metrics.find(m=>m.id===row.id);
      if(!metric||ids.has(row.id)||row.unit!==metric.unit||!row.cells)return false;
      ids.add(row.id);
      for(const basis of ['current','budget','priorMonth','priorYear','underwriting','forecast','ytdActual','ytdBudget']) {
        const c=row.cells[basis];if(!c||(c.value!==null&&(typeof c.value!=='number'||!Number.isFinite(c.value))))return false;
      }
    }
    for(const key of ['drivers','actions','risks','projects']) if(packet.draft[key]!==undefined&&(!Array.isArray(packet.draft[key])||packet.draft[key].length>200)) return false;
    if(packet.prior) for(const key of ['actions','risks']) if(!Array.isArray(packet.prior[key]))return false;
    return JSON.stringify(packet).length<=1500000;
  }
  const api={metrics,groups,formulas,number,esc,shift,read,build,format,delta,pages,html,notes,periodValid,validReviewedPacket};
  root.AtlasInvestorPacket=api;
  if(typeof module!=='undefined') module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
