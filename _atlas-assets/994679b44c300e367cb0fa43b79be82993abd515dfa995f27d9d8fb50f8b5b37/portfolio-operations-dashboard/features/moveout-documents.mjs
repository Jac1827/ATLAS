// Shared document model: no inferred dates, fees, instructions or financial amounts.
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fields = {
 residentName:['Resident name','text'],propertyName:['Community','text'],unit:['Unit','text'],communityAddress:['Community / unit address','text'],forwardingAddress:['Forwarding address','text'],phone:['Phone','tel'],email:['Email','email'],leaseStart:['Lease-start date','date'],leaseExpiration:['Lease-end date','date'],scheduledMoveOutDate:['Expected move-out date','date'],ntvReceivedDate:['Notice received','date'],actualPossessionReturnedDate:['Actual possession-returned date','date'],possessionTime:['Actual possession-returned time','time'],keysReturned:['Keys / access devices returned','text'],communityContact:['Community contact information','text'],documentingEmployee:['Employee documenting receipt','text'],etf:['Early Termination Fee (ETF)','select'],etfAmount:['ETF amount','number'],instructions:['Approved move-out instructions','textarea']
};
const common=['residentName','propertyName','unit','communityAddress'];
export const documentKinds={ntv:'Notice to Vacate Confirmation',possession:'Possession Confirmation',mog:'MOG Record'};
export function defaultTemplates(){
 return Object.fromEntries(Object.entries({ntv:[...common,'ntvReceivedDate','leaseExpiration','scheduledMoveOutDate','instructions','communityContact'],possession:[...common,'actualPossessionReturnedDate','possessionTime','keysReturned','forwardingAddress','phone','email','documentingEmployee'],mog:[...common,'forwardingAddress','phone','email','leaseStart','leaseExpiration','scheduledMoveOutDate','etf','etfAmount']}).map(([kind,keys])=>[kind,{kind,title:documentKinds[kind],version:0,instructions:'',instructionsApproved:false,fields:keys.map(key=>({key,label:fields[key][0],source:key,required:!['phone','email','etfAmount'].includes(key)})),sections:[{heading:kind==='ntv'?'Notice received':kind==='possession'?'Possession received':'Move-out information',body:kind==='ntv'?'We confirm receipt of the notice to vacate for {{residentName}} at {{propertyName}}, unit {{unit}}. The expected move-out date is {{scheduledMoveOutDate}}.':kind==='possession'?'Possession was documented as returned on {{actualPossessionReturnedDate}} at {{possessionTime}}. This is separate from the expected move-out date.':'Please review the move-out information below and contact your community team with corrections.'}]}]));
}
export function validateTemplate(template){
 if(!template||!documentKinds[template.kind]||typeof template.title!=='string'||template.title.length>150)throw Error('Choose a supported form and a title of up to 150 characters.');
 if(!Array.isArray(template.fields)||!template.fields.length||template.fields.length>40)throw Error('The template needs mapped fields.');
 const seen=new Set();for(const field of template.fields){if(!fields[field.key]||!fields[field.source]||seen.has(field.key)||typeof field.required!=='boolean'||typeof field.label!=='string'||field.label.length>120)throw Error('Invalid, duplicated or unmapped template field.');seen.add(field.key);}
 // Statutory/policy defaults are never invented; administrators supply approved instructions.
 for(const key of defaultTemplates()[template.kind].fields.map(f=>f.key))if(!seen.has(key))throw Error(`Template must retain ${fields[key][0]}. Mark it optional when appropriate.`);
 if(!Array.isArray(template.sections)||template.sections.length>20)throw Error('A template supports up to 20 layout sections.');
 for(const section of template.sections){if(typeof section.body!=='string'||section.body.length>15000||typeof section.heading!=='string'||section.heading.length>200)throw Error('Invalid template section.');for(const [,token] of section.body.matchAll(/\{\{([^}]+)\}\}/g))if(!fields[token])throw Error(`Unknown template field: ${token}`);}
 if(typeof template.instructionsApproved!=='boolean')throw Error('Instruction approval must be explicitly true or false.');
 if(typeof template.instructions!=='string'||template.instructions.length>15000)throw Error('Invalid instructions.');
 return structuredClone(template);
}
export function prepopulate(template,record,renewal={},community={},employee=''){
 const source={...renewal,...Object.fromEntries(Object.entries(record).filter(([,v])=>v!==null&&v!==undefined&&v!==''))};
 source.leaseStart=record.leaseStart || record.leaseStartDate || record.moveInDate || renewal.leaseStart || '';
 source.communityAddress=record.communityAddress || community.address || community.communityAddress || '';
 source.communityContact=record.communityContact || [community.phone,community.email||record.communityEmail].filter(Boolean).join(' · ');
 source.documentingEmployee=record.documentingEmployee||employee;
 source.instructions=template.instructionsApproved ? template.instructions : '';
 const values={};for(const f of template.fields)values[f.key]=source[f.source] ?? '';
 return values;
}
export function missingFields(template,values){
 const missing=template.fields.filter(f=>f.required&&!String(values[f.key]??'').trim()).map(f=>f.label);
 if(template.kind==='ntv'&&(!template.instructionsApproved||!template.instructions.trim()))missing.push('Administrator-approved move-out instructions');
 if(template.kind==='mog'){
  if(!['Yes','No'].includes(values.etf))missing.push('ETF: select Yes or No');
  if(values.etf==='Yes'&&(!String(values.etfAmount??'').trim()||!Number.isFinite(Number(values.etfAmount))||Number(values.etfAmount)<0))missing.push('ETF amount (required when Yes)');
 }
 for(const f of template.fields){const v=String(values[f.key]??'');if(v&&fields[f.key]?.[1]==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))missing.push(`${f.label}: valid email required`);if(v&&fields[f.key]?.[1]==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))missing.push(`${f.label}: valid date required`);}
 return [...new Set(missing)];
}
export const mergeTokens=(text,values)=>String(text||'').replace(/\{\{([^}]+)\}\}/g,(_,key)=>String(values[key]??''));
export function documentSections(template,values){return [...template.sections.map(s=>({heading:s.heading,lines:[mergeTokens(s.body,values)]})),{heading:'Resident and move-out details',lines:template.fields.filter(f=>f.key!=='etfAmount'||values.etf==='Yes').map(f=>`${f.label}: ${String(values[f.key]??'').trim()||'Not recorded'}`)}];}
export const brandCss=`@page{size:letter;margin:0.6in}*{box-sizing:border-box}body{font:14px/1.55 Gotham,Arial,sans-serif;color:#003146;max-width:900px;padding:28px;margin:auto}header{display:flex;align-items:center;gap:28px;border-bottom:5px solid #559CB4;padding-bottom:20px}header img{width:135px}h1,h2{font-family:'Gotham Bold',Gotham,Arial,sans-serif}h1{font-size:25px}h2{font-size:17px;border-left:5px solid #CCBF32;padding-left:10px;margin-top:24px}p{white-space:pre-wrap;overflow-wrap:anywhere}.status{border-left:5px solid #FCB53B;background:#faf8ed;padding:12px}footer{border-top:1px solid #559CB4;margin-top:30px;padding-top:10px;font-size:11px}.photos{display:flex;flex-wrap:wrap;gap:12px}.photos img{width:45%;object-fit:contain;max-height:300px}@media print{body{padding:0;font-size:11px}header,h2,p{break-inside:avoid}h2{break-after:avoid}}`;
export function reportHtml(title,sections,{logo='',draft=false}={}){return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(title)}</title><style>${brandCss}</style><body><header>${logo?`<img src="${escape(logo)}" alt="RISE">`:'<strong>RISE</strong>'}<h1>${escape(title)}</h1></header>${draft?'<p class="status">DRAFT — required fields or approved instructions are incomplete. Not ready to send.</p>':''}${sections.map(s=>`<section><h2>${escape(s.heading)}</h2>${s.lines.map(line=>`<p>${escape(line)}</p>`).join('')}</section>`).join('')}<footer>RISE · Resident services</footer></body></html>`;}
export function caseSections(record,inspections,regional){return [
 {heading:'Resident and community',lines:[`Resident: ${record.residentName||'Not recorded'}`,`Community: ${record.propertyName||'Not recorded'} · Unit: ${record.unit||'Not recorded'}`,`Address: ${record.communityAddress||'Not recorded'}`,`Phone: ${record.phone||'Not recorded'} · Email: ${record.email||'Not recorded'}`]},
 {heading:'Ownership and lifecycle',lines:[`Regional: ${regional||'Assignment missing'}`,`CS owner: ${record.owner||'Unassigned'}`,`Status: ${record.workflowStatus||'On Notice'}`]},
 {heading:'Dates and forwarding address',lines:['ntvReceivedDate','leaseExpiration','scheduledMoveOutDate','actualPossessionReturnedDate','possessionTime','forwardingAddress'].map(k=>`${fields[k][0]}: ${record[k]||'Not recorded'}`)},
 {heading:'Case notes',lines:[record.notes||'None recorded']},
 {heading:'Associated inspections',lines:inspections.map(i=>`${i.inspectionKind==='field'?'Field Inspection':'Move-Out Inspection'} · ${i.inspectionDate||'Unscheduled'} · ${i.inspectorName||'Unassigned'} · ${i.status||'Draft'}`)},
 {heading:'Activity history',lines:(record.activity||[]).map(a=>`${a.at||''} · ${a.user||''} · ${a.label||a.memo||''}`)}
];}
export function inspectionSections(inspection){return [{heading:'Inspection details',lines:[`Type: ${inspection.inspectionKind==='field'?'Field Inspection':inspection.templateName||'Inspection'}`,`Purpose: ${inspection.purpose||'Required move-out inspection'}`,`Community: ${inspection.propertyName||'Not recorded'} · Unit: ${inspection.unit||'Not recorded'}`,`Resident: ${inspection.residentName||'Not recorded'}`,`Inspector: ${inspection.inspectorName||'Unassigned'}`,`Inspection date: ${inspection.inspectionDate||'Not recorded'} · Status: ${inspection.status||'Draft'}`]},...(inspection.findings||[]).map(f=>({heading:[f.room,f.component].filter(Boolean).join(' / '),lines:[`Condition: ${f.condition||'Not recorded'}`,f.notes||'',`Resident responsibility: ${f.residentResponsibility||'Needs review'}`,...(String(f.inspectorRecommendedAmount??'').trim()!==''&&Number.isFinite(Number(f.inspectorRecommendedAmount))?[`Recorded recommended charge (not final): $${f.inspectorRecommendedAmount}`]:[])],photos:f.photos||[]}))];}
export async function reportPdf(title,sections,{logoBytes,draft=false}={}){
 const {PDFDocument,StandardFonts,rgb}=await import('../vendor/pdf-lib-1.17.1.mjs?v=72c052d97b4d5d9f');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),logo=logoBytes?await pdf.embedPng(logoBytes):null;
 const chartreuse=rgb(204/255,191/255,50/255),navy=rgb(0,49/255,70/255),blue=rgb(85/255,156/255,180/255),gold=rgb(252/255,181/255,59/255);let page,y;
 const safe=t=>[...String(t??'').replace(/[\u2010-\u2015]/g,'-')].map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 const wrap=(text,size,width=516)=>{const lines=[];for(const paragraph of safe(text).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){const candidate=line?line+' '+word:word;if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue;}if(line){lines.push(line);line='';}for(const char of word){if(font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}}lines.push(line);}return lines;};
 const addPage=()=>{page=pdf.addPage([612,792]);y=744;if(logo)page.drawImage(logo,{x:48,y:y-27,width:100,height:35});else page.drawText('RISE',{x:48,y,size:24,font:bold,color:navy});y-=55;for(const line of wrap(title,20)){page.drawText(line,{x:48,y,size:20,font:bold,color:navy});y-=24;}page.drawLine({start:{x:48,y:y+8},end:{x:564,y:y+8},thickness:3,color:blue});y-=12;};
 const text=(value,size=10,strong=false)=>{for(const line of wrap(value,size)){if(y<58)addPage();page.drawText(line,{x:48,y,size,font:strong?bold:font,color:navy});y-=size+5;}y-=5;};
 addPage();if(draft){page.drawRectangle({x:45,y:y-20,width:522,height:30,color:gold});text('DRAFT - incomplete required information. Not ready to send.',10,true);}
 for(const section of sections){if(y<110)addPage();page.drawRectangle({x:41,y:y-3,width:3,height:15,color:chartreuse});text(section.heading,14,true);for(const line of section.lines)text(line);for(const photo of section.photos||[]){if(!photo.dataUrl)throw Error('A supporting photo is unavailable. Reopen in the browser where it was saved.');let image;try{image=/^data:image\/png/i.test(photo.dataUrl)?await pdf.embedPng(photo.dataUrl):await pdf.embedJpg(photo.dataUrl);}catch{throw Error('A supporting photo must be converted to PNG or JPEG before PDF export.');}const scale=Math.min(516/image.width,260/image.height);const h=image.height*scale;if(y-h<58)addPage();page.drawImage(image,{x:48,y:y-h,width:image.width*scale,height:h});y-=h+18;}}
 for(const [index,p] of pdf.getPages().entries())p.drawText(`RISE | ${index+1} / ${pdf.getPageCount()}`,{x:48,y:30,size:9,font,color:navy});return pdf.save();
}
