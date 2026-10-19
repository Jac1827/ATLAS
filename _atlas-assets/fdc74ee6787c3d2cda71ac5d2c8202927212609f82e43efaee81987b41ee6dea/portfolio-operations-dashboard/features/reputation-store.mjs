import {financeAccessKey} from './canonical-finance.mjs?v=210b482c6f40c656';

export function score(value,max) {
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const number=Number(value);
 if(!Number.isFinite(number)||number<0||number>max)throw Error(`Enter a score from 0 to ${max}, or leave it blank.`);
 return number;
}
export function reputationAverage(values) {
 const available=values.filter(value=>typeof value==='number'&&Number.isFinite(value));
 return available.length?available.reduce((sum,value)=>sum+value,0)/available.length:null;
}
export function createReputationStore(central,{uuid=()=>crypto.randomUUID()}={}) {
 const records=new Map(),loaded=new Set(),aliases=new Map(),editable=new Set(),drafts=new Map();
 let epoch=0,revision=0,identity=financeAccessKey(central),pending=null;
 const key=(cid,period)=>`${cid}|${period}`;
 function clear(){epoch++;revision++;records.clear();loaded.clear();aliases.clear();editable.clear();drafts.clear();pending=null;identity=financeAccessKey(central);}
 function guard(){if(identity!==financeAccessKey(central))clear();}
 function bind(entries){for(const entry of entries)for(const alias of [entry.name,entry.recordId,entry.communityId].filter(Boolean))aliases.set(alias,entry.communityId);}
 function periods(entries){return [...new Set(entries.flatMap(entry=>Array.from({length:12},(_,month)=>`${entry.year}-${String(month+1).padStart(2,'0')}`)))];}
 function cidFor(record){return aliases.get(typeof record==='string'?record:record?.atlasCommunityId||record?.sourceIds?.atlasCommunityId||record?.communityId||record?.propertyName||record?.communityName);}
 async function hydrate(entries,{force=false}={}) {
  guard();bind(entries);
  const needed=entries.filter(entry=>entry.communityId&&(force||!loaded.has(key(entry.communityId,entry.year))));
  if(!needed.length)return;
  if(pending){await pending;return hydrate(entries,{force});}
  const token=epoch,auth=identity,ids=[...new Set(needed.map(entry=>entry.communityId))],scope=periods(needed);
  const task=(async()=>{
   const result=await central.rpc('atlas_read_reputation_months',{p_community_ids:ids,p_periods:scope});
   if(token!==epoch||auth!==financeAccessKey(central))throw Error('The signed-in account changed. Reopen Reputation.');
   if(!Array.isArray(result?.records)||!Array.isArray(result?.editableCommunityIds))throw Error('Monthly reputation readback is unavailable.');
   const verified=[];
   for(const row of result.records){
    if(!ids.includes(row.community_id)||!scope.includes(row.period_key)||!Number.isInteger(row.version)||row.version<1)throw Error('Monthly reputation readback has the wrong scope.');
    score(row.google_review_score,5);score(row.ora_score,100);verified.push(Object.freeze({...row}));
   }
   for(const cid of ids){for(const period of scope)records.delete(key(cid,period));editable.delete(cid);}
   for(const row of verified)records.set(key(row.community_id,row.period_key),row);
   for(const cid of result.editableCommunityIds)if(ids.includes(cid))editable.add(cid);
   for(const entry of needed)loaded.add(key(entry.communityId,entry.year));revision++;
  })();
  pending=task;try{await task;}finally{if(pending===task)pending=null;}
 }
 function get(record,period){
  guard();const cid=cidFor(record),row=cid?records.get(key(cid,period)):null;
  return {communityId:cid||null,period,version:row?.version||0,googleReviewScore:row?.google_review_score??null,oraScore:row?.ora_score??null,
   inputMethod:row?.input_method||null,googleAvailability:row?.google_availability||'unavailable',oraAvailability:row?.ora_availability||'unavailable',enteredAt:row?.entered_at||null,enteredBy:row?.entered_by||null,
   updatedAt:row?.updated_at||null,updatedBy:row?.updated_by||null,status:!cid?'unmapped':!loaded.has(key(cid,period.slice(0,4)))?'loading':row?'saved':'absent',canEdit:!!cid&&editable.has(cid)};
 }
 function draft(record,period){guard();const current=get(record,period);return drafts.get(key(current.communityId,period))||current;}
 function edit(record,period,field,value,{badInput=false}={}){
  const current=get(record,period);if(!current.canEdit||!['saved','absent'].includes(current.status))throw Error('Monthly reputation is not ready for editing.');
  if(!['oraScore','googleReviewScore'].includes(field))throw Error('Unknown monthly reputation field.');
  const id=key(current.communityId,period),existing=drafts.get(id);
  if(existing?.requestId)throw Error('Retry the pending save or reload its saved values before making another edit.');
  const next={...(existing||current),errors:{...existing?.errors},inputs:{...existing?.inputs,[field]:value},dirty:true};
  try{if(badInput)throw Error('Enter a complete valid number, or clear the field.');next[field]=score(value,field==='oraScore'?100:5);delete next.errors[field];}
  catch(error){next.errors[field]=error.message;drafts.set(id,next);throw error;}
  drafts.set(id,next);return next;
 }
 async function save(record,period){
  guard();const current=get(record,period),id=key(current.communityId,period),value=drafts.get(id);
  if(!value?.dirty)return current;
  if(Object.keys(value.errors||{}).length)throw Error('Correct the invalid monthly score before saving.');
  if(value.saving)throw Error('This month is already saving.');
  const token=epoch,auth=identity;value.requestId ||= uuid();value.saving=true;
  try{
   const row=await central.rpc('atlas_save_reputation_month',{p_community_id:current.communityId,p_period:period,p_expected_version:value.version,p_request_id:value.requestId,p_google_review_score:value.googleReviewScore,p_ora_score:value.oraScore});
   if(token!==epoch||auth!==financeAccessKey(central))throw Error('The signed-in account changed. Reopen Reputation.');
   if(row?.community_id!==current.communityId||row?.period_key!==period||row?.version!==value.version+1||row.google_review_score!==value.googleReviewScore||row.ora_score!==value.oraScore)throw Error('Monthly reputation save receipt did not match the requested month and scores.');
   await hydrate([{communityId:current.communityId,year:Number(period.slice(0,4))}],{force:true});
   if(token!==epoch||auth!==financeAccessKey(central))throw Error('The signed-in account changed. Reopen Reputation.');
   const readback=get(record,period);
   if(readback.version!==row.version||readback.googleReviewScore!==value.googleReviewScore||readback.oraScore!==value.oraScore)throw Error('The saved month changed before readback. Reload its saved values.');
   if(drafts.get(id)===value)drafts.delete(id);return readback;
  }catch(error){value.error=error.message;throw error;}
  finally{value.saving=false;}
 }
 async function reload(record,period){
  const current=get(record,period),id=key(current.communityId,period),before=drafts.get(id);
  if(before?.saving)throw Error('Wait for this save to finish before reloading.');
  if(!current.communityId)throw Error('Community mapping is unavailable.');
  await hydrate([{communityId:current.communityId,year:Number(period.slice(0,4))}],{force:true});
  if(drafts.get(id)===before)drafts.delete(id);return get(record,period);
 }
 return {hydrate,get,draft,edit,save,reload,clear,ready(entries){guard();return entries.every(entry=>!entry.communityId||loaded.has(key(entry.communityId,entry.year)));},
  average(record,periods,field='oraScore'){return reputationAverage(periods.map(period=>get(record,period)[field]));},get revision(){guard();return `${identity}:${revision}`;}};
}
