import {retainForecast} from './financial-snapshot.mjs?v=e84268921f32df41';
import {computeReforecast,recommendReforecast} from './reforecast-engine.mjs?v=7e637bf4bfc02836';
// Published future amounts are the immutable seed. Only governed closes replace them.
export function effectiveActiveSnapshot(publication){
 if(!publication?.snapshot)throw Error('An active publication snapshot is required.');
 const vintage=publication.snapshot,source=publication.source;
 if(!source?.actuals)return retainForecast(vintage);
 const baseline={...source.baseline,lines:(vintage.lines||[]).map(line=>({period:line.period,accountCode:line.accountCode,accountName:line.accountName,amount:line.forecast,source:{publicationId:publication.publicationId,fingerprint:vintage.fingerprint}})),leasing:vintage.leasing||[]};
 const computed=computeReforecast({...source,baseline,scenario:{versionId:publication.revisionId||vintage.identity.reforecastVersion,driverVersion:'frozen-published-amounts',drivers:[],overrides:[]}});
 const projection=structuredClone(computed),original=new Map(vintage.lines.map(line=>[line.period+'|'+line.accountCode,line]));
 for(const line of projection.lines){
  const prior=original.get(line.period+'|'+line.accountCode);line.originalBudget=prior?.originalBudget??null;
  if(line.sourceKind==='forecast'&&prior){line.driverIds=prior.driverIds||[];line.driverSources=prior.driverSources||[];line.source=prior.source;}
 }
 for(const month of projection.monthly)month.originalBudget=structuredClone(vintage.monthly.find(m=>m.period===month.period)?.originalBudget||month.originalBudget);
 for(const category of projection.categories)for(const month of category.monthly){
  const values=projection.lines.filter(l=>l.period===month.period&&l.category===category.category).map(l=>l.originalBudget);
  month.originalBudget=values.every(n=>typeof n==='number'&&Number.isFinite(n))?Math.round(values.reduce((n,v)=>n+v,0)*100)/100:null;
 }
 projection.totals.originalBudget=structuredClone(vintage.totals.originalBudget);
 projection.identity={...projection.identity,publicationId:publication.publicationId,publishedFingerprint:vintage.fingerprint,projectionSourceVersion:source.sourceVersion};
 projection.fingerprint=`${vintage.fingerprint}:${source.sourceVersion}`;projection.isActiveReadProjection=true;
 projection.driverImpacts=structuredClone(vintage.driverImpacts||[]);projection.recommendations=recommendReforecast({snapshot:projection});
 return retainForecast(projection);
}
