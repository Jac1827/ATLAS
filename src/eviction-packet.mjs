import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export const FILE_LIMIT=20*1024*1024, EMAIL_LIMIT=5*1024*1024;
export const categories=['lease','ledger','notice','other'];
const answer=v=>typeof v==='boolean'?(v?'Yes':'No'):'Not recorded';
const money=v=>v==null?'Not recorded':Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
export async function coversheetPdf(row,actor,logo){
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const color=rgb(.07,.24,.31),accent=rgb(.15,.46,.54);let page,y,pageNumber=0;
  const image=logo?await doc.embedPng(logo):null;
  const newPage=()=>{page=doc.addPage([612,792]);pageNumber++;y=695;if(image)page.drawImage(image,{x:42,y:720,width:95,height:95*image.height/image.width});else page.drawText('RISE',{x:42,y:728,size:27,font:bold,color});page.drawText('Eviction Record Coversheet',{x:175,y:736,size:18,font:bold,color});page.drawLine({start:{x:42,y:709},end:{x:570,y:709},color:accent,thickness:2});page.drawText('From the desk of '+actor.name,{x:42,y:31,size:9,font,color});page.drawText('Page '+pageNumber,{x:522,y:31,size:9,font,color});};newPage();
  const line=(text,heading=false)=>{const f=heading?bold:font,size=heading?12:10;const paragraphs=String(text??'Not recorded').split(/\r?\n/);for(const paragraph of paragraphs){let current='';for(const char of paragraph){if(f.widthOfTextAtSize(current+char,size)>520){if(y<65)newPage();page.drawText(current,{x:44,y,size,font:f,color:heading?accent:color});y-=14;current='';}current+=char;}if(y<65)newPage();page.drawText(current||' ',{x:44,y,size,font:f,color:heading?accent:color});y-=heading?20:14;}};
  const field=(label,value)=>line(label+': '+(value??'Not recorded'));
  const f=row.filingInformation||{},debt=(row.debtHistory||[]).find(x=>x.reason==='Moved to Evictions')||row;
  line('Community and resident',true);for(const [label,key] of [['Community','propertyName'],['Resident','residentName'],['Unit','unit'],['Case reference','id'],['Account ID','residentId'],['Moved to Evictions','evictionFiledAt']])field(label,row[key]);
  field('Attorney submission',row.attorneySentAt||'Not sent');if(row.historicalAttorneySentDate?.date)field('Historical sent date (manually entered)',row.historicalAttorneySentDate.date);line('Filing questionnaire',true);
  field('Active duty military',answer(f.activeDutyMilitary));field('Cosign Program',answer(f.cosignProgram));field('Deposit arrangement',f.depositProgram==='deposit'?'Security Deposit':f.depositProgram==='alternative'?'Security Deposit Alternative Program':'Not recorded');field('Deposit on hand',f.depositProgram==='deposit'?money(f.depositAmount):'Not applicable');field('Entrata Eviction / Do not accept confirmed',answer(f.entrataConfirmed));field('Financially responsible occupants over age 18',f.adultOccupantCount);
  (f.adultOccupantNames||[]).forEach((name,i)=>field('Occupant '+(i+1),name));line('Historical debt at transition',true);
  field('Reporting period',debt.periodKey);for(const [label,key] of [['0–30 days','aging0To30'],['31–60 days','aging31To60'],['61–90 days','aging61To90'],['90+ days','aging90Plus'],['Total debt','delinquentBalance']])field(label,money(debt[key]));field('Current balance',money(row.delinquentBalance));line('Last delinquency note',true);field('Entry date',row.lastDelinquencyNoteDate);line(row.lastDelinquencyNote||'Not recorded');field('Prepared at',new Date().toISOString());
  return doc.save();
}
export function requiredMissing(row,documents){return [...(!documents.some(d=>d.active&&d.category==='lease')?['Lease']:[]),...(!documents.some(d=>d.active&&d.category==='ledger')?['Ledger']:[]),...(!row.filingInformation?.recordedAt?['Completed questionnaire']:[])];}
export function validateDraft(draft,row,documents){
  if(!row.evictionFiledAt)throw Error('Save the filing questionnaire before preparing an attorney packet.');
  if(!Array.isArray(draft.to)||!draft.to.length||draft.to.length>10||draft.to.some(e=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(e)))throw Error('Select or enter valid attorney recipients.');
  if(!draft.subject?.trim()||!draft.body?.trim())throw Error('Enter the email subject and message.');
  const missing=requiredMissing(row,documents);if(missing.length&&!draft.exceptionReason?.trim())throw Error('Missing '+missing.join(', ')+'. Attach them or record an exception reason.');
  return missing;
}
