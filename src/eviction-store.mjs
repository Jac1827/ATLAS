import {coversheetPdf,requiredMissing,validateDraft,FILE_LIMIT,EMAIL_LIMIT,categories} from './eviction-packet.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export const CENTRAL_SERVICES_FROM='central@risere.com';
const now=()=>new Date().toISOString();
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const locked=s=>['sending','uncertain','sent'].includes(s.draft?.status);
export class EvictionCaseState {
  constructor(state,env){this.state=state;this.env=env;}
  async fetch(request){
    try{return await this.handle(request);}catch(e){return json({ok:false,error:e.message},e.status||400);}
  }
  async handle(request){
    const payload=await request.json(),{action,caseId,actor}=payload,key='case:'+caseId;
    const load=async storage=>{const value=await storage.get(key);if(!value)return {revision:0,documents:[],history:[],row:null,draft:null};if(!value.stateChunks)return value;const parts=[];for(let i=0;i<value.stateChunks;i++)parts.push(await storage.get(key+':state:'+i));return JSON.parse(await new Blob(parts).text());};
    const read=()=>load(this.state.storage);
    const mutate=fn=>this.state.storage.transaction(async tx=>{const s=await load(tx);await fn(s,tx);s.revision++;const bytes=new TextEncoder().encode(JSON.stringify(s)),count=Math.ceil(bytes.length/64000);for(let i=0;i<count;i++)await tx.put(key+':state:'+i,bytes.slice(i*64000,(i+1)*64000));await tx.put(key,{stateChunks:count});return s;});
    const audit=(s,label,details={})=>{s.history.push({at:now(),by:actor,label,...details});};
    if(action==='community-settings')return json({ok:true,attorneys:await this.state.storage.get('attorneys')||[],securePortalUrl:await this.state.storage.get('securePortalUrl')||'',fromEmail:CENTRAL_SERVICES_FROM,updated:await this.state.storage.get('attorneysUpdated')||null});
    if(action==='get'){const s=await read();return json({ok:true,...s,attorneys:await this.state.storage.get('attorneys')||[],securePortalUrl:await this.state.storage.get('securePortalUrl')||'',fromEmail:CENTRAL_SERVICES_FROM,emailAvailable:!!this.env.EMAIL});}
    if(action==='attorneys'){
      const emails=Array.isArray(payload.emails)?[...new Set(payload.emails.map(e=>String(e).trim()))]:null;if(!emails||emails.length>10||emails.some(e=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(e)))throw error('Enter valid attorney email addresses.');
      if(payload.securePortalUrl&&!/^https:\/\//.test(payload.securePortalUrl))throw error('Use an approved HTTPS secure portal URL.');
      const updated={at:now(),by:actor};await this.state.storage.transaction(async tx=>{await tx.put('attorneys',emails);if(payload.securePortalUrl!==undefined)await tx.put('securePortalUrl',payload.securePortalUrl||'');await tx.put('attorneysUpdated',updated);});return json({ok:true,attorneys:emails,fromEmail:CENTRAL_SERVICES_FROM,updated});
    }
    if(action==='upload'){
      const file=payload.file;if(!categories.includes(file?.category)||!file.name||file.name.length>200)throw error('Choose a document category and filename.');
      if(!/\.(pdf|docx?|xlsx?|csv|txt|png|jpe?g)$/i.test(file.name))throw error('Use PDF, Word, Excel, CSV, text or image files.');
      if(typeof file.base64!=='string'||file.base64.length>Math.ceil(FILE_LIMIT*4/3)+4)throw error('Each file must be 20 MiB or smaller.');
      const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>FILE_LIMIT)throw error('The attachment is empty or exceeds 20 MiB.');
      const id=crypto.randomUUID(),chunks=Math.ceil(bytes.length/64000),at=now();
      const s=await mutate(async(s,tx)=>{if(['sending','uncertain'].includes(s.draft?.status))throw error('This packet is sending or requires reconciliation. Its documents are locked.',409);if(s.documents.length>=100)throw error('Case document limit reached. Contact an administrator.');
        const previous=s.documents.filter(d=>d.name===file.name&&d.category===file.category),version=Math.max(0,...previous.map(d=>d.version))+1;
        previous.forEach(d=>{d.active=false;});
        for(let i=0;i<chunks;i++)await tx.put('doc:'+id+':'+i,bytes.slice(i*64000,(i+1)*64000));
        s.documents.push({id,name:file.name,category:file.category,type:({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})[file.name.split('.').pop().toLowerCase()]||'application/octet-stream',size:bytes.length,chunks,version,active:true,uploadedAt:at,uploadedBy:actor});if(s.draft?.status!=='sent')s.draft=null;audit(s,'Attachment uploaded',{documentId:id,version});});return json({ok:true,...s});
    }
    if(action==='download'){
      const s=await read(),d=s.documents.find(d=>d.id===payload.documentId);if(!d)throw error('Document not found.',404);
      const parts=[];for(let i=0;i<d.chunks;i++)parts.push(await this.state.storage.get('doc:'+d.id+':'+i));
      return new Response(new Blob(parts,{type:d.type}),{headers:{'content-type':d.type,'content-disposition':'attachment; filename="'+d.name.replace(/["\r\n]/g,'_')+'"','cache-control':'no-store'}});
    }
    if(action==='draft'){
      const s=await mutate(s=>{if(locked(s))throw error('A packet is sending or has already been submitted. Review its history.',409);if(payload.revision!==s.revision)throw error('The case changed. Reopen the draft before saving.',409);
        if(payload.row.id!==caseId)throw error('Case reference mismatch.');
        s.row=payload.row;s.draft={id:crypto.randomUUID(),status:'draft',to:payload.draft.to||[],subject:String(payload.draft.subject||'').slice(0,300),body:String(payload.draft.body||'').slice(0,20000),exceptionReason:String(payload.draft.exceptionReason||'').slice(0,4000),savedAt:now(),by:actor};audit(s,'Attorney draft saved');});return json({ok:true,...s,missing:requiredMissing(s.row,s.documents)});
    }
    if(action==='cover'){
      const s=await read();if(!s.row)throw error('Save the draft to generate the latest coversheet.');const bytes=await coversheetPdf(s.row,actor);return new Response(bytes,{headers:{'content-type':'application/pdf','cache-control':'no-store'}});
    }
    if(action==='court'){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)||!Number.isFinite(Date.parse(payload.date))||new Date(payload.date).toISOString().slice(0,10)!==payload.date||payload.date>now().slice(0,10)||!String(payload.reference||'').trim())throw error('Enter a valid court filing date and confirmation reference.');
      const s=await mutate(s=>{if(!s.row?.evictionFiledAt)throw error('Save the filing questionnaire and draft first.');s.court={date:payload.date,reference:String(payload.reference).slice(0,300),recordedAt:now(),recordedBy:actor};audit(s,'Court filing confirmed',s.court);});return json({ok:true,...s});
    }
    if(action==='ready'){
      const s=await mutate(s=>{if(locked(s))throw error('This packet is already sending or submitted.',409);if(payload.revision!==s.revision)throw error('The case changed. Reopen the draft.',409);validateDraft(s.draft||{},s.row||{},s.documents);s.draft.status='ready';audit(s,'Ready for attorney');});return json({ok:true,...s});
    }
    if(action==='send'){
      if(!this.env.EMAIL)throw error('Email sending is unavailable. Connect the authorized ATLAS email service; your draft is saved.',503);
      let packet=await read();if(packet.draft?.status==='sent')return json({ok:true,...packet});
      if(packet.draft?.status!=='ready'||payload.revision!==packet.revision)throw error('Review and mark the current draft Ready for attorney before sending.',409);
      validateDraft(packet.draft,packet.row,packet.documents);
      const active=packet.documents.filter(d=>d.active),cover=await coversheetPdf(packet.row,actor);
      const estimated=Math.ceil((active.reduce((n,d)=>n+d.size,0)+cover.length)*4/3)+new TextEncoder().encode(packet.draft.body).length+32768;
      if(estimated>EMAIL_LIMIT||active.length+1>32)throw error('Packet exceeds the email attachment limit. All documents remain saved. Download the documents for your approved secure attorney portal, or use smaller files; no documents will be omitted.',413);
      const attachments=[{filename:'RISE_Eviction_Coversheet.pdf',type:'application/pdf',disposition:'attachment',content:cover}];
      for(const d of active){const parts=[];for(let i=0;i<d.chunks;i++)parts.push(await this.state.storage.get('doc:'+d.id+':'+i));attachments.push({filename:d.name,type:d.type,disposition:'attachment',content:new Uint8Array(await new Blob(parts).arrayBuffer())});}
      packet=await mutate(async(s,tx)=>{if(s.revision!==payload.revision||s.draft.status!=='ready')throw error('The packet changed or is already being sent.',409);s.draft.status='sending';s.draft.attemptedAt=now();s.draft.sentBy=actor;const coverId=crypto.randomUUID(),coverMeta={id:coverId,name:'RISE_Eviction_Coversheet.pdf',category:'cover',type:'application/pdf',size:cover.length,chunks:Math.ceil(cover.length/64000),version:s.documents.filter(d=>d.category==='cover').length+1,active:false,uploadedAt:now(),uploadedBy:actor};
        for(let i=0;i<coverMeta.chunks;i++)await tx.put('doc:'+coverId+':'+i,cover.slice(i*64000,(i+1)*64000));s.documents.push(coverMeta);
        s.draft.manifest=[coverMeta,...active].map(({id,name,version,size})=>({id,name,version,size}));audit(s,'Attorney submission started',{draftId:s.draft.id});});
      try{
        const result=await this.env.EMAIL.send({to:packet.draft.to,from:{email:CENTRAL_SERVICES_FROM,name:'RISE Central Services'},subject:packet.draft.subject,text:packet.draft.body,attachments});
        if(!result?.messageId)throw error('The provider returned no message ID; submission needs reconciliation.');
        const s=await mutate(s=>{s.draft.status='sent';s.draft.sentAt=now();s.draft.fromEmail=CENTRAL_SERVICES_FROM;s.draft.providerMessageId=result.messageId;s.draft.deliveryStatus='unconfirmed';audit(s,'Sent to attorney',{fromEmail:CENTRAL_SERVICES_FROM,providerMessageId:result.messageId,to:s.draft.to,attachments:s.draft.manifest});});return json({ok:true,...s});
      }catch(e){
        const definitive=/^E_(VALIDATION_ERROR|FIELD_MISSING|TOO_MANY_RECIPIENTS|TOO_MANY_ATTACHMENTS|SENDER_NOT_VERIFIED|RECIPIENT_NOT_ALLOWED|RECIPIENT_SUPPRESSED|SENDER_DOMAIN_NOT_AVAILABLE|CONTENT_TOO_LARGE|RATE_LIMIT_EXCEEDED|DAILY_LIMIT_EXCEEDED)$/.test(e.code||'');
        const s=await mutate(s=>{s.draft.status=definitive?'failed':'uncertain';s.draft.error=definitive?'The email provider rejected this attempt ('+e.code+'). Correct the issue and retry.':'Submission outcome is uncertain. Check provider logs before attempting another send.';audit(s,'Attorney submission '+s.draft.status,{code:e.code||'unknown'});});return json({ok:false,error:s.draft.error,...s},502);
      }
    }
    throw error('Unknown case action.');
  }
}
