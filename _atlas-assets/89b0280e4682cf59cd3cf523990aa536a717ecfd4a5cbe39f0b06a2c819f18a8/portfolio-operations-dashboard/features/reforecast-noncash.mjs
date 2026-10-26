// Presentation reads retained values only; it never derives new totals for old reports.
export const NONCASH_METRICS=Object.freeze([
 {metric:'cashFlowBeforeNoncash',column:'Cash_flow_before_noncash',label:'Cash flow before noncash charges'},
 {metric:'nonCashDepreciationAmortization',column:'Noncash_depreciation_amortization',label:'Noncash depreciation / amortization'},
 {metric:'cashFlowAfterNoncash',column:'Cash_flow_after_noncash',label:'Cash flow after noncash charges'}
]);
export const hasNoncashMetrics=value=>NONCASH_METRICS.some(({metric})=>Object.hasOwn(value||{},metric));
export const hasNoncashReportRows=rows=>(rows||[]).some(row=>NONCASH_METRICS.some(({column})=>Object.hasOwn(row,column)));
export const noncashReportFields=metrics=>hasNoncashMetrics(metrics)?Object.fromEntries(NONCASH_METRICS.map(({metric,column})=>[column,metrics?.[metric]??null])):{};
export const forecastMetricLabel=metric=>NONCASH_METRICS.find(row=>row.metric===metric)?.label||({revenue:'Income',expenses:'OPEX',noi:'NOI',margin:'Margin',cashFlow:'Cash flow'}[metric]||metric);
export function forecastDisplayMetrics(snapshot){return ['revenue','expenses','noi','margin',...((hasNoncashMetrics(snapshot?.totals?.reforecast)||(snapshot?.monthly||[]).some(row=>hasNoncashMetrics(row.reforecast)))?NONCASH_METRICS.map(row=>row.metric):['cashFlow'])];}
export function noncashReportSections(rows){return hasNoncashReportRows(rows)?[{title:'Cash flow and noncash charges',rows,columns:[['Period','Month',70],...NONCASH_METRICS.map(({column,label})=>[column,label,225,'money'])],note:'Before noncash charges excludes only explicitly reviewed noncash depreciation and amortization. After noncash charges retains those deductions. Unavailable means the saved classification or financial values are incomplete; it is distinct from zero.'}]:[];}
export function reviewNoncashClassification(registry){
 const accounts=(registry.accounts||[]).map(account=>({...account,nonCash:account.nonCash===true}));
 const invalid=accounts.find(account=>account.nonCash&&(account.nature!=='below_noi'||account.placement!=='below_noi'));
 if(invalid)throw Error('Noncash depreciation / amortization must use below-NOI nature and placement. Review GL '+invalid.accountCode+'.');
 return {...registry,accounts,nonCashClassificationVersion:1};
}
