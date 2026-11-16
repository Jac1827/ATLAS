import {canonicalJson,sha256} from './financial-snapshot.mjs?v=848d058bdec07b4e';

// Cell history is descriptive audit data, never calculation or save authority.
// Only a NEW event may use this representation. Stored/retained events are not
// migrated; exact prior revisions supply the unchanged rows for reconstruction.
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const hash=value=>sha256(canonicalJson(value));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=/^[0-9a-f]{64}$/;
const kind='revision_bound_cell_delta';
const state=payload=>({overrides:clone(payload.overrides||[]),drivers:clone(payload.drivers||[])});
const key=(row,field)=>field==='overrides'?JSON.stringify([row.period,row.accountCode]):row.id;
function requireThat(condition,message){if(!condition)throw Error('Cell history reconstruction: '+message);}
function anchor(record){
 const row=record?.revision?.payload?record.revision:record;
 if(!row?.payload||!['community_id','scenario_id','revision_id','request_id'].every(field=>uuid.test(row[field]||''))||!Number.isInteger(row.revision)||row.revision<1||!digest.test(row.snapshot?.fingerprint||record?.snapshot?.fingerprint||'')||!Array.isArray(row.payload.history||[]))return null;
 if(record?.head&&['community_id','scenario_id','revision_id','revision'].some(field=>record.head[field]!==row[field]))return null;
 return {communityId:row.community_id,scenarioId:row.scenario_id,revisionId:row.revision_id,revision:row.revision,requestId:row.request_id,snapshotFingerprint:row.snapshot?.fingerprint||record.snapshot.fingerprint,payloadSha256:hash(row.payload),historyLength:(row.payload.history||[]).length};
}
function fieldDelta(before,after,field){
 requireThat(Array.isArray(before)&&Array.isArray(after),'array state required');
 const beforeKeys=before.map(row=>key(row,field)),afterKeys=after.map(row=>key(row,field));
 requireThat(beforeKeys.every(v=>typeof v==='string'&&v)&&afterKeys.every(v=>typeof v==='string'&&v)&&new Set(beforeKeys).size===before.length&&new Set(afterKeys).size===after.length,'unique cell/driver identities required');
 const old=new Map(before.map((row,index)=>[beforeKeys[index],row])),next=new Map(after.map((row,index)=>[afterKeys[index],row]));
 const changed=new Set([...old.keys(),...next.keys()].filter(id=>!old.has(id)||!next.has(id)||!same(old.get(id),next.get(id))));
 const retainedBefore=before.filter((_,i)=>!changed.has(beforeKeys[i])),retainedAfter=after.filter((_,i)=>!changed.has(afterKeys[i]));
 requireThat(same(retainedBefore,retainedAfter),'unchanged row order differs');
 const entries=rows=>rows.flatMap((row,index)=>changed.has(key(row,field))?[{index,value:clone(row)}]:[]);
 return {before:entries(before),after:entries(after),beforeCount:before.length,afterCount:after.length};
}
function applyField(current,delta,direction){
 const from=direction==='forward'?'before':'after',to=direction==='forward'?'after':'before';
 requireThat(Array.isArray(current)&&current.length===delta[from+'Count'],'array length differs');
 const removed=delta[from],inserted=delta[to];
 requireThat(Array.isArray(removed)&&Array.isArray(inserted),'delta entries missing');
 for(const [entries,count]of [[removed,delta[from+'Count']],[inserted,delta[to+'Count']]]){
  requireThat(Number.isInteger(count)&&count>=0,'invalid array count');
  requireThat(entries.every((entry,i)=>entry&&Number.isInteger(entry.index)&&entry.index>=0&&entry.index<count&&(i===0||entry.index>entries[i-1].index)&&Object.hasOwn(entry,'value')),'invalid ordered delta indices');
 }
 for(const entry of removed)requireThat(same(current[entry.index],entry.value),'changed object differs');
 const result=clone(current);for(const entry of [...removed].reverse())result.splice(entry.index,1);
 for(const entry of inserted){requireThat(entry.index<=result.length,'insertion index differs');result.splice(entry.index,0,clone(entry.value));}
 requireThat(result.length===delta[to+'Count'],'reconstructed length differs');return result;
}
function eventDelta(event){
 const meta=event.cellHistory;requireThat(meta?.schemaVersion===1&&meta.kind===kind,'unsupported delta');
 requireThat(['cell_edit','clear_reviewed_forecast_blank'].includes(event.action),'unsupported cell action');
 requireThat(digest.test(meta.beforeStateSha256||'')&&digest.test(meta.afterStateSha256||'')&&digest.test(meta.eventSha256||''),'state/event hashes missing');
 for(const side of ['before','after']){
  const changed={};for(const field of ['overrides','drivers']){requireThat(Array.isArray(meta[field]?.[side]),'delta entries missing');changed[field]=meta[field][side].map(entry=>entry.value);}
  requireThat(same(event.action==='cell_edit'?event[side]:event[side==='before'?'workingBefore':'workingAfter'],event.action==='cell_edit'?changed.overrides:changed),'compact event objects differ');
 }
 return meta;
}

export function reconstructForecastCellHistoryEvent(event,{baseRevision,currentState,direction='forward'}={}){
 return reconstructBoundEvent(event,{currentState,direction},anchor(baseRevision));
}
function reconstructBoundEvent(event,{currentState,direction='forward'},bound){
 requireThat(['forward','backward'].includes(direction),'invalid direction');
 const meta=eventDelta(event);requireThat(bound&&same(bound,meta.base),'immutable revision binding differs');
 const from=direction==='forward'?'before':'after',to=direction==='forward'?'after':'before';
 requireThat(hash(currentState)===meta[from+'StateSha256'],'working state hash differs');
 const next={};for(const field of ['overrides','drivers'])next[field]=applyField(currentState[field],meta[field],direction);
 requireThat(hash(next)===meta[to+'StateSha256'],'reconstructed state hash differs');
 const before=direction==='forward'?clone(currentState):next,after=direction==='forward'?next:clone(currentState),expanded=clone(event);
 if(event.action==='cell_edit'){expanded.before=clone(before.overrides);expanded.after=clone(after.overrides);}
 else{expanded.workingBefore=clone(before);expanded.workingAfter=clone(after);}
 const {cellHistory:ignored,...original}=expanded;requireThat(hash(original)===meta.eventSha256,'retained event metadata differs');
 return {before,after,event:expanded};
}

// Replay only established legacy shapes. A missing/unsupported intermediate
// state cannot produce a matching next hash, so creation falls back to the
// existing complete event and reconstruction reports unavailable explicitly.
function advanceLegacy(current,event){
 const next=clone(current);
 if(event.action==='cell_edit'&&Array.isArray(event.before)&&Array.isArray(event.after)){
  requireThat(same(current.overrides,event.before),'legacy cell before-state differs');next.overrides=clone(event.after);
 }else if(event.action==='clear_reviewed_forecast_blank'&&event.workingBefore&&event.workingAfter){
  requireThat(same(current,event.workingBefore),'legacy clear before-state differs');return clone(event.workingAfter);
 }else if(['accept','reject','undo'].includes(event.action)&&Array.isArray(event.before)&&Array.isArray(event.after)){
  requireThat(same(current.drivers,event.before),'legacy recommendation before-state differs');next.drivers=clone(event.after);
 }else if(event.after&&typeof event.after==='object'&&!Array.isArray(event.after)){
  for(const field of ['overrides','drivers'])if(Array.isArray(event.after[field])){
   requireThat(Array.isArray(event.before?.[field])&&same(current[field],event.before[field]),'legacy collection before-state differs');next[field]=clone(event.after[field]);
  }
 }
 return next;
}
function replayTo(history,index,baseRevision,bound=anchor(baseRevision)){
 const row=baseRevision?.revision?.payload?baseRevision.revision:baseRevision;
 requireThat(bound&&index>=bound.historyLength,'base revision unavailable');
 requireThat(same(history.slice(0,bound.historyLength),row.payload.history||[]),'immutable history prefix differs');
 let current=state(row.payload);
 for(let i=bound.historyLength;i<index;i++)current=history[i].cellHistory?reconstructBoundEvent(history[i],{currentState:current},bound).after:advanceLegacy(current,history[i]);
 return current;
}

export function compactNewForecastCellHistoryEvent(event,{record,history=[],before,after}={}){
 const bound=anchor(record);if(!bound)return clone(event);
 try{
  requireThat(['cell_edit','clear_reviewed_forecast_blank'].includes(event.action)&&!event.cellHistory,'new cell event required');
  requireThat(same(replayTo(history,history.length,record,bound),before),'working state cannot be bound to saved history');
  const overrides=fieldDelta(before.overrides,after.overrides,'overrides'),drivers=fieldDelta(before.drivers,after.drivers,'drivers');
  const target=JSON.stringify([event.period,event.accountCode]);
  requireThat([...overrides.before,...overrides.after].every(entry=>key(entry.value,'overrides')===target),'unrelated cell changed');
  requireThat(event.action!=='cell_edit'||same(before.drivers,after.drivers),'cell edit changed drivers');
  const compact=clone(event);
  compact.cellHistory={schemaVersion:1,kind,base:bound,beforeStateSha256:hash(before),afterStateSha256:hash(after),eventSha256:hash(event),overrides,drivers};
  if(event.action==='cell_edit'){compact.before=overrides.before.map(entry=>clone(entry.value));compact.after=overrides.after.map(entry=>clone(entry.value));}
  else{compact.workingBefore={overrides:overrides.before.map(entry=>clone(entry.value)),drivers:drivers.before.map(entry=>clone(entry.value))};compact.workingAfter={overrides:overrides.after.map(entry=>clone(entry.value)),drivers:drivers.after.map(entry=>clone(entry.value))};}
  // Verify exact reversibility before retaining the new representation.
  requireThat(same(reconstructBoundEvent(compact,{currentState:before},bound).after,after),'forward reconstruction differs');
  requireThat(same(reconstructBoundEvent(compact,{currentState:after,direction:'backward'},bound).before,before),'reverse reconstruction differs');
  return canonicalJson(compact).length<canonicalJson(event).length?compact:clone(event);
 }catch{return clone(event);}
}

export function expandedForecastCellHistory(revision,revisions=[]){
 const history=revision.payload?.history||[],byId=new Map(revisions.map(row=>[row.revision_id,row])),anchors=new Map();
 requireThat(byId.size===revisions.length,'duplicate immutable revision identities');
 return history.map((event,index)=>{
  if(!event.cellHistory)return clone(event);
  const baseRevision=byId.get(event.cellHistory.base?.revisionId);
  requireThat(baseRevision&&baseRevision.community_id===revision.community_id&&baseRevision.scenario_id===revision.scenario_id&&Number.isInteger(revision.revision)&&baseRevision.revision<revision.revision,'ancestor revision scope differs');
  if(!anchors.has(baseRevision.revision_id))anchors.set(baseRevision.revision_id,anchor(baseRevision));
  const bound=anchors.get(baseRevision.revision_id);
  return reconstructBoundEvent(event,{currentState:replayTo(history,index,baseRevision,bound)},bound).event;
 });
}
