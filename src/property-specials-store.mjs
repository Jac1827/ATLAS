import {DurableObject} from 'cloudflare:workers';
import {fail,nextCollection,publicUrl,extractPage,reconcilePages,signature,manualOffer} from './property-specials-core.mjs';

async function readPage(address, at) {
  let url=publicUrl(address);
  try {
    for(let hop=0;hop<5;hop++) {
      const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'user-agent':'ATLAS Property Website Verification/1.0','accept':'text/html'}});
      if ([301,302,303,307,308].includes(response.status)) {url=publicUrl(new URL(response.headers.get('location'),url).href);continue;}
      if(!response.ok || !/text\/html/i.test(response.headers.get('content-type')||'')) throw fail('Website did not return an HTML page.');
      // Bound decompressed bytes, including streamed responses without Content-Length.
      const reader=response.body.getReader(),chunks=[];let length=0;
      try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000)throw fail('Website exceeds the collection size limit.');chunks.push(value);}}finally{await reader.cancel();}
      let text='';
      const rewritten=new HTMLRewriter().on('script,style,noscript,svg', {element(e){e.remove();}})
        .on('body',{text(t){text+=t.text;}}).on('p,div,li,h1,h2,h3,br',{element(){text+='\n';}})
        .on('img',{element(e){const alt=e.getAttribute('alt');if(alt)text+='\n'+alt+'\n';}})
        .transform(new Response(new Blob(chunks),{headers:{'content-type':'text/html'}}));
      await rewritten.text();
      return extractPage(text,url,at);
    }
    throw fail('Too many website redirects.');
  } catch(e) {return {url,at,status:'failed',error:e.message};}
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
  async read() {return {ok:true,settings:this.get('settings','current'),current:this.get('current','current'),offers:this.list('offer'),observations:this.list('observation').slice(-100),audit:this.list('audit').slice(-100)};}
  async configure(settings,actor) {
    const existing=this.get('settings','current')||{};
    const next={...existing,...settings,website:publicUrl(settings.website),floorplan:publicUrl(settings.floorplan),updatedAt:new Date().toISOString()};
    this.ctx.storage.transactionSync(()=>{this.put('settings','current',next);this.audit('Website settings saved',actor,next);});
    if(next.website||next.floorplan) await this.ctx.storage.setAlarm(nextCollection()); else await this.ctx.storage.deleteAlarm();
    return this.read();
  }
  async saveOffer(input,actor,admin) {
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
  }
  closeCurrent(at) {
    const current=this.get('current','current'),old=current?.offerId && this.get('offer',current.offerId);
    if(old && !old.closedAt){old.closedAt=at;this.put('offer',old.id,old);}
  }
  async removeOffer(id,actor,admin) {
    if(!admin)throw fail('Only an active ATLAS admin may remove offers.',403);
    const old=this.get('offer',id);if(!old || old.source!=='manual')throw fail('Only manual entries can be removed; website evidence is retained.');
    this.ctx.storage.transactionSync(()=>{this.put('offer',id,{...old,deletedAt:new Date().toISOString()});if(this.get('current','current')?.offerId===id)this.put('current','current',{status:'unavailable'});this.audit('Manual offer removed',actor,old);});return this.read();
  }
  async collect() {
    const settings=this.get('settings','current')||{},at=new Date().toISOString();
    const lease=this.get('job','lease'); if(lease && Date.parse(lease.until)>Date.now())return this.read();
    this.put('job','lease',{until:new Date(Date.now()+180000).toISOString()});
    const revision=settings.updatedAt;
    try {
      const urls=[...new Set([settings.website,settings.floorplan].filter(Boolean))];
      const pages=await Promise.all(urls.map(url=>readPage(url,at))),result=reconcilePages(pages);
      this.ctx.storage.transactionSync(()=>{
        if(this.get('settings','current')?.updatedAt!==revision)return; // URL changed while fetching.
        this.put('observation',at,{...result,at});
        const current=this.get('current','current')||{},old=current.offerId&&this.get('offer',current.offerId);
        if(['failed','conflict'].includes(result.status)){this.put('current','current',{...current,status:result.status,error:result.error,lastCheckedAt:at});return;}
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
