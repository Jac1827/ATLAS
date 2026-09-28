import {DurableObject} from 'cloudflare:workers';
import {fail,nextCollection,publicUrl,extractHtmlPage,reconcilePages,signature,manualOffer} from './property-specials-core.mjs';

async function readPage(address, at) {
  let url=address,stage='website_retrieval',httpStatus,contentType;
  try {
    url=publicUrl(address);
    for(let hop=0;hop<5;hop++) {
      const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'user-agent':'ATLAS Property Website Verification/1.0','accept':'text/html'}});
      httpStatus=response.status;contentType=response.headers.get('content-type')||'';
      if ([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location');
        if(!location)throw fail('Website redirect did not include a destination.',502,stage,'WEBSITE_REDIRECT_FAILED');
        url=publicUrl(new URL(location,url).href);continue;
      }
      if([401,403,429].includes(httpStatus))throw fail(`Website blocked collection (HTTP ${httpStatus}).`,502,'blocked_dynamic_website','WEBSITE_BLOCKED_OR_DYNAMIC');
      if(!response.ok)throw fail(`Website returned HTTP ${httpStatus}.`,502,stage,'WEBSITE_HTTP_ERROR');
      if(!/text\/html/i.test(contentType))throw fail('Website did not return an HTML page.',502,stage,'WEBSITE_CONTENT_TYPE');
      if(!response.body)throw fail('Website returned an empty response.',502,stage,'WEBSITE_EMPTY_RESPONSE');
      // Bound decompressed bytes, including streamed responses without Content-Length.
      const reader=response.body.getReader(),chunks=[];let length=0;
      try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000)throw fail('Website exceeds the collection size limit.',502,stage,'WEBSITE_SIZE_LIMIT');chunks.push(value);}}finally{await reader.cancel();}
      stage='extraction';
      const page=await extractHtmlPage(new Response(new Blob(chunks),{headers:{'content-type':'text/html'}}),url,at);
      return {...page,requestedUrl:address,httpStatus,contentType};
    }
    throw fail('Too many website redirects.',502,stage,'WEBSITE_REDIRECT_FAILED');
  } catch(e) {return {url,requestedUrl:address,at,status:'failed',stage:e.stage||stage,code:e.code||(stage==='extraction'?'OFFER_EXTRACTION_FAILED':'WEBSITE_RETRIEVAL_FAILED'),error:e.message,httpStatus,contentType,evidence:typeof httpStatus==='number'?`HTTP ${httpStatus}${contentType?' · '+contentType:''}`:e.message};}
}

const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
function urlsFrom(settings, existing={}) {
  return {
    website:publicUrl(has(settings,'communityWebsiteUrl')&&settings.communityWebsiteUrl!==undefined?settings.communityWebsiteUrl:has(settings,'website')&&settings.website!==undefined?settings.website:existing.website),
    floorplan:publicUrl(has(settings,'floorPlanRatesPageUrl')&&settings.floorPlanRatesPageUrl!==undefined?settings.floorPlanRatesPageUrl:has(settings,'floorplan')&&settings.floorplan!==undefined?settings.floorplan:existing.floorplan)
  };
}
function sourceUpdatedAt(settings) {
  const value=settings.websiteSettingsUpdatedAt||settings.sourceUpdatedAt||'';
  if(value && !Number.isFinite(Date.parse(value)))throw fail('Website settings have an invalid update time.',400,'configuration','WEBSITE_CONFIGURATION_INVALID');
  return value;
}
function expectedRevision(settings) {
  if(!has(settings,'expectedRevision'))return undefined;
  if(typeof settings.expectedRevision!=='string')throw fail('Website settings have an invalid revision.',400,'configuration','WEBSITE_CONFIGURATION_INVALID');
  return settings.expectedRevision;
}
const staleSettings=()=>fail('Website URLs changed after this edit began. Reload Community Settings and review the saved URLs before retrying.',409,'configuration','STALE_WEBSITE_SETTINGS');
function domainFailure(error,stage='configuration',code='WEBSITE_CONFIGURATION_INVALID') {
  // RPC exceptions do not retain custom Error fields. Return domain failures as
  // plain data; let unexpected storage failures cross the RPC boundary as errors.
  if(typeof error.status!=='number')throw error;
  return {ok:false,error:error.message,status:error.status,stage:error.stage||(error.status===403?'authorization':stage),code:error.code||code};
}

export class PropertySpecialsState extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))');
  }
  get(kind,id){const r=this.sql.exec('SELECT data FROM records WHERE kind=? AND id=?',kind,id).toArray()[0];return r?JSON.parse(r.data):null;}
  put(kind,id,value){this.sql.exec('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',kind,id,JSON.stringify(value));}
  list(kind){return this.sql.exec('SELECT data FROM records WHERE kind=? ORDER BY id',kind).toArray().map(r=>JSON.parse(r.data));}
  audit(action,actor,details){const at=new Date().toISOString();this.put('audit',at+crypto.randomUUID(),{at,action,actor,details});}
  async read() {return {ok:true,settings:this.get('settings','current'),nextCollectionAt:await this.ctx.storage.getAlarm(),current:this.get('current','current'),offers:this.list('offer'),observations:this.list('observation').slice(-100),audit:this.list('audit').slice(-100)};}
  checkCommunity(settings,existing) {
    if(existing.communityId && settings.communityId && existing.communityId!==settings.communityId)throw fail('Website settings belong to another community.',409,'community_mapping','COMMUNITY_MAPPING_FAILED');
  }
  async configure(settings,actor) {
    try {
    const existing=this.get('settings','current')||{};
    this.checkCommunity(settings,existing);
    const sourceTime=sourceUpdatedAt(settings);
    const expected=expectedRevision(settings);
    if(expected!==undefined && expected!==(existing.revision||''))throw staleSettings();
    const urls=urlsFrom(settings,existing);
    const {expectedRevision:ignored,...input}=settings;
    const next={...existing,...input,...urls,communityWebsiteUrl:urls.website,floorPlanRatesPageUrl:urls.floorplan,authoritativeSettings:true,sourceUpdatedAt:sourceTime||existing.sourceUpdatedAt||'',updatedAt:new Date().toISOString(),revision:crypto.randomUUID()};
    this.ctx.storage.transactionSync(()=>{this.put('settings','current',next);this.audit('Website settings saved',actor,next);});
    if(next.website||next.floorplan) await this.ctx.storage.setAlarm(nextCollection()); else await this.ctx.storage.deleteAlarm();
    return this.read();
    }catch(error){return domainFailure(error);}
  }
  async reconcileSettings(settings,actor) {
    try {
    // The authenticated Worker supplies the resolved community identity. Recovery
    // fills legacy gaps or applies a pending edit against its saved server revision.
    const existing=this.get('settings','current')||{};
    this.checkCommunity(settings,existing);
    const sourceTime=sourceUpdatedAt(settings);
    // Browser timestamps are descriptive metadata, never concurrency authority.
    const expected=expectedRevision(settings),matches=expected!==undefined&&expected===(existing.revision||'');
    const source=existing.authoritativeSettings&&expected===undefined?{website:existing.website||'',floorplan:existing.floorplan||''}:urlsFrom(settings,existing);
    const sourceDiffers=source.website!==(existing.website||'')||source.floorplan!==(existing.floorplan||'');
    // A lost response can be acknowledged without replaying its already-applied
    // write. Omitted fields inherit the current value, rather than clearing it.
    const conflict=expected!==undefined&&!matches&&sourceDiffers;
    const website=conflict?(existing.website||''):matches?source.website:existing.website||source.website;
    const floorplan=conflict?(existing.floorplan||''):matches?source.floorplan:existing.floorplan||source.floorplan;
    const hasUrls=['communityWebsiteUrl','floorPlanRatesPageUrl','website','floorplan'].some(key=>has(settings,key)&&settings[key]!==undefined);
    const authoritative=existing.authoritativeSettings||(matches&&hasUrls);
    const changed=website!==(existing.website||'')||floorplan!==(existing.floorplan||'')||(!existing.communityId&&settings.communityId&&(website||floorplan))||(!existing.authoritativeSettings&&authoritative);
    if(changed){
      const next={...existing,communityId:existing.communityId||settings.communityId,communityName:existing.communityName||settings.communityName,website,floorplan,communityWebsiteUrl:website,floorPlanRatesPageUrl:floorplan,authoritativeSettings:!!authoritative,sourceUpdatedAt:sourceTime||existing.sourceUpdatedAt||'',updatedAt:new Date().toISOString(),revision:crypto.randomUUID()};
      this.ctx.storage.transactionSync(()=>{this.put('settings','current',next);this.audit('Website settings reconciled',actor,{before:existing,after:next});});
    }
    const alarm=await this.ctx.storage.getAlarm();
    const alarmRepaired=(website||floorplan)?alarm===null:alarm!==null;
    if(alarmRepaired){if(website||floorplan)await this.ctx.storage.setAlarm(nextCollection());else await this.ctx.storage.deleteAlarm();}
    const failure=conflict?staleSettings():null;
    return {...await this.read(),reconciliation:{settingsChanged:!!changed,alarmRepaired,...(failure?{conflict:{code:failure.code,stage:failure.stage,error:failure.message}}:{})}};
    }catch(error){return domainFailure(error);}
  }
  async saveOffer(input,actor,admin) {
    try {
    if(!admin)throw fail('Only an active ATLAS admin may change offers.',403);
    const at=new Date().toISOString(),offer=manualOffer(input,at,actor),old=this.get('offer',offer.id);
    if(input.id && (!old || old.source!=='manual'))throw fail('Only manual offers can be edited. Create a manual correction for a website offer.');
    if(input.id && old?.updatedAt!==input.expectedUpdatedAt)throw fail('The offer changed. Reload before editing.',409);
    this.ctx.storage.transactionSync(()=>{
      if(offer.mode==='current' && this.get('current','current')?.offerId!==offer.id) this.closeCurrent(at);
      if(old?.closedAt)offer.closedAt=old.closedAt;
      if(offer.mode==='current')delete offer.closedAt;
      if(offer.mode!=='current'&&this.get('current','current')?.offerId===offer.id)this.put('current','current',{status:'unavailable'});
      this.put('offer',offer.id,offer);
      if(offer.mode==='current') this.put('current','current',{offerId:offer.id,status:'manual',lastCheckedAt:at});
      this.audit(old?'Manual offer updated':'Manual offer added',actor,{before:old,after:offer});
    });return this.read();
    }catch(error){return domainFailure(error,'configuration','OFFER_VALIDATION_FAILED');}
  }
  closeCurrent(at) {
    const current=this.get('current','current'),old=current?.offerId && this.get('offer',current.offerId);
    if(old && !old.closedAt){old.closedAt=at;this.put('offer',old.id,old);}
  }
  async removeOffer(id,actor,admin) {
    try {
    if(!admin)throw fail('Only an active ATLAS admin may remove offers.',403);
    const old=this.get('offer',id);if(!old || old.source!=='manual')throw fail('Only manual entries can be removed; website evidence is retained.');
    this.ctx.storage.transactionSync(()=>{this.put('offer',id,{...old,deletedAt:new Date().toISOString()});if(this.get('current','current')?.offerId===id)this.put('current','current',{status:'unavailable'});this.audit('Manual offer removed',actor,old);});return this.read();
    }catch(error){return domainFailure(error,'configuration','OFFER_VALIDATION_FAILED');}
  }
  async collect() {
    const settings=this.get('settings','current')||{},at=new Date().toISOString();
    const lease=this.get('job','lease'); if(lease && Date.parse(lease.until)>Date.now())return this.read();
    this.put('job','lease',{until:new Date(Date.now()+180000).toISOString()});
    const revision=settings.revision||settings.updatedAt;
    try {
      const urls=[...new Set([settings.website,settings.floorplan].filter(Boolean))];
      const pages=await Promise.all(urls.map(url=>readPage(url,at))),result=reconcilePages(pages);
      this.ctx.storage.transactionSync(()=>{
        const latest=this.get('settings','current');
        if((latest?.revision||latest?.updatedAt)!==revision)return; // URL changed while fetching.
        this.put('observation',at+crypto.randomUUID(),{...result,at});
        const current=this.get('current','current')||{},old=current.offerId&&this.get('offer',current.offerId);
        if(['failed','conflict'].includes(result.status)){this.put('current','current',{...current,status:result.status,stage:result.stage,code:result.code,error:result.error,lastCheckedAt:at});return;}
        const key=signature(result.text);
        if(old?.source==='website' && signature(old.text)===key && !old.deletedAt){old.lastVerifiedAt=at;this.put('offer',old.id,old);}
        else {
          this.closeCurrent(at);
          const offer={id:crypto.randomUUID(),source:'website',text:result.text,components:result.components,pages:result.pages,firstObservedAt:at,lastVerifiedAt:at,observedStart:at.slice(0,10),noSpecial:result.status==='none'};
          this.put('offer',offer.id,offer);current.offerId=offer.id;
          this.audit('Website offer changed','scheduled website collection',{previous:old?.id,offerId:offer.id});
        }
        this.put('current','current',{offerId:current.offerId,status:result.status,lastCheckedAt:at,lastVerifiedAt:at,error:result.status==='none'?'No special listed—check the website.':''});
      });
    }finally{this.put('job','lease',{until:''});}
    return this.read();
  }
  async alarm() {try{await this.collect();}finally{const s=this.get('settings','current');if(s?.website||s?.floorplan)await this.ctx.storage.setAlarm(nextCollection());}}
}
