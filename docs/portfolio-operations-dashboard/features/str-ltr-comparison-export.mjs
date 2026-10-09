import {RISE_REPORT_LOGO} from './rise-report-brand.mjs?v=9b39c5ad8eca1edd';
import {loadXlsx} from './reforecast-intake.mjs?v=74bbd52d93a197cc';

// The export consumes one calculation snapshot. It never fetches program data,
// applies a program, or recalculates financial assumptions during rendering.
export const COMPARISON_SHEETS=Object.freeze(['Summary','Floor-plan results','Monthly comparisons','GL details','Assumptions','Allocations','Capital timing','Supporting calculations']);
const C={navy:'003146',teal:'147D92',blue:'559CB4',gold:'FCB53B',muted:'516D78',line:'D7E4E8',wash:'F1F6F8',white:'FFFFFF',red:'A84136'};
const enc=new TextEncoder(),dec=new TextDecoder();
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const amount=n=>finite(n)?n:null;
const money=n=>finite(n)?(n<0?'(':'')+'$'+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:0})+(n<0?')':''):'Unavailable';
const pct=n=>finite(n)?(n*100).toFixed(1)+'%':'N/A';
const plain=v=>v===null||v===undefined?'Unavailable':typeof v==='object'?JSON.stringify(v):String(v);
const readable=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(readable).join('; '):Object.entries(v).map(([k,x])=>k.replace(/([a-z])([A-Z])/g,'$1 $2')+': '+readable(x)).join('; '):plain(v);
const clean=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const xml=v=>clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const chunks=(rows,n)=>rows.length?Array.from({length:Math.ceil(rows.length/n)},(_,i)=>rows.slice(i*n,i*n+n)):[[]];
const splitText=(value,limit)=>{const words=plain(value).split(/\s+/),parts=[];let part='';for(const word of words){if(part&&part.length+word.length+1>limit){parts.push(part);part='';}for(let i=0;i<word.length;i+=limit){const bit=word.slice(i,i+limit);if(i||part.length+bit.length+1>limit){if(part)parts.push(part);part='';}part+=(part?' ':'')+bit;}}if(part)parts.push(part);return parts.length?parts:[''];};
const modeName=m=>({budget:'Budget vs. budget',performance:'Performance',investment:'Investment comparison'}[m]||m||'Budget vs. budget');
const metricRows=[['Effective income','income'],['Operating expenses','expenses'],['Direct contribution','directContribution'],['Allocated expenses','allocatedExpenses'],['NOI after allocations','noi'],['Capital expenditures','capex'],['Cash flow after CapEx','cashFlow']];
const difference=(a,b)=>finite(a)&&finite(b)?a-b:null;
const payback=p=>p?.reached&&finite(p.months)?p.months.toFixed(1)+' months':p?.reason||'Not reached in '+(p?.horizonMonths??'modeled')+' months';
const threshold=(t,key)=>finite(t?.[key])?(key==='adr'?money(t[key]):pct(t[key]))+(key==='occupancy'&&t[key]>1?' (infeasible)':''):t?.[key+'Feasible']===false?'Infeasible':'Unavailable';

export function retainComparisonExport(input,{exportedAt=new Date().toISOString()}={}){
 if(input?.schemaVersion!==1||!input?.metadata||!input?.totals||!Array.isArray(input.floorPlans)||!Array.isArray(input.monthly)||!Array.isArray(input.gl))throw Error('A calculated saved comparison snapshot is required for export.');
 const snapshot=structuredClone(input);
 for(const scope of [snapshot.totals,...snapshot.floorPlans,...snapshot.monthly])for(const scenario of ['str','ltr','budget','actual','difference'])for(const key of metricRows.map(r=>r[1])){
  const value=scope[scenario]?.[key];if(value!==null&&value!==undefined&&!finite(value))throw Error('Comparison exports require finite amounts or explicitly unavailable results.');
 }
 for(const row of snapshot.gl)for(const key of ['str','ltr','budget','actual','difference'])if(row[key]!==null&&row[key]!==undefined&&!finite(row[key]))throw Error('A GL export amount is invalid.');
 if(!Number.isFinite(Date.parse(exportedAt)))throw Error('A valid export timestamp is required.');
 return {schemaVersion:1,exportedAt,snapshot};
}

function evidenceRows(s){
 const m=s.metadata,a=s.actuals||{};
 const coverage=a.coverage&&typeof a.coverage==='object'&&!Array.isArray(a.coverage)?`Revenue ${a.coverage.revenueComplete?'complete':'incomplete'}; expenses ${a.coverage.expenseComplete?'complete':'incomplete'}; ${a.coverage.records??'unavailable'} records${a.coverage.missing?.length?'; missing: '+readable(a.coverage.missing):''}`:readable(a.coverage);
 return [
  ['Property',m.propertyName],['Program',m.programName],['Saved program version',m.programVersion],['Program status',m.programStatus],['Scenario',m.scenarioName],['Comparison revision',s.scenario?.revision??m.comparisonRevision],['Source fingerprint',s.sourceFingerprint],['Reporting period',m.periodLabel],['Compared inventory',m.inventoryUnits+' units / '+(m.inventoryLabel||'floor-plan estimates')],['Comparison mode',modeName(m.mode)],
  ['Actuals status',a.status||'Unavailable'],['Latest actuals month',a.latestMonth||'Unavailable'],['Actual comparison period',a.period||m.actualsPeriod||'Unavailable'],['Data loaded / updated',a.updatedAt||'Not recorded'],['Actuals coverage',coverage],['Actuals attribution',a.allocationMethod||'Unavailable'],
  ...(s.assumptions||[]).map(a=>[a.name,(/occupancy|percentage/i.test(a.name)&&finite(a.value)?pct(a.value):readable(a.value))+(a.source?' | '+readable(a.source):'')+(a.reviewedAt?' | Reviewed '+a.reviewedAt:'')]),
  ...(s.allocations||[]).map(a=>['Allocation '+(a.code||a.glCode||''),[a.scenario||a.side,a.method||a.allocationMethod,finite(a.amount)?money(a.amount):null].filter(Boolean).join(' | ')]),
  ['LTR evidence','Modeled counterfactual; never observed LTR actuals.'],['Difference convention','STR minus LTR. Positive expense differences are additional costs.'],
  ['Break-even assumptions',s.breakEven?.assumptions],['Payback horizon',(s.payback?.horizonMonths??'Unavailable')+' months; '+(s.payback?.reason||'retained modeled cash flow')],
  ...(s.limitations||[]).map(v=>['Limitation',v])
 ].filter(([,v])=>v!==undefined&&v!==null&&v!=='');
}

function metaLines(s,exportedAt){const m=s.metadata;return [
 `${m.propertyName||'Property'} | ${m.programName||'Program'} | Program version ${m.programVersion??'Unavailable'}`,
 `${m.scenarioName||'Comparison'}${s.scenario?.revision?' v'+s.scenario.revision:''} | ${m.periodLabel||'Period unavailable'} | ${modeName(m.mode)} | ${m.inventoryUnits??'Unavailable'} units / ${m.inventoryLabel||'Floor-plan estimates'}`,
 `Actuals: ${s.actuals?.period||m.actualsPeriod||'Unavailable'} (${s.actuals?.status||'unavailable'}) | Exported ${exportedAt}`
 ];}

// Shared page geometry makes charts and tables consistent in PDF and editable PPTX.
export function comparisonReportPages(retained,{includeGl=false}={}){
 const s=retained.snapshot,t=s.totals,performance=s.metadata.mode==='performance',strLabel=s.metadata.mode==='investment'?'STR actuals':'STR budget',pages=[],text=(value,x,y,w,h=0.3,size=14,color=C.navy,bold=false)=>({kind:'text',value:plain(value),x,y,w,h,size,color,bold});
 const page=(title,subtitle='')=>{const p={title,subtitle,blocks:[]};pages.push(p);return p.blocks;};
 let b=page('Decision summary',[s.metadata.propertyName,s.metadata.programName,(s.metadata.inventoryUnits??'Unavailable')+' units',s.metadata.periodLabel,modeName(s.metadata.mode)].filter(Boolean).join(' | '));
 b.push(text(s.recommendation?.action||'Review the modeled evidence',.55,1.48,12.15,.55,27,C.navy,true));
 b.push(text(s.recommendation?.text||'A recommendation is unavailable for this snapshot.',.55,2.14,12.15,.72,17));
 const cards=[[strLabel+' NOI',money(t.str?.noi)],['Modeled LTR NOI',money(t.ltr?.noi)],['Incremental NOI',money(t.difference?.noi)],['Incremental capital',money(t.difference?.capex)]];
 cards.forEach(([label,value],i)=>{const x=.55+i*3.12;b.push({kind:'rect',x,y:3.1,w:2.92,h:1.12,color:C.wash});b.push(text(label,x+.16,3.27,2.6,.25,12,C.muted),text(value,x+.16,3.62,2.6,.42,24,C.navy,true));});
 b.push(text((performance?'Recorded STR actual NOI: '+money(t.actual?.noi)+' | ':'')+'STR cash flow after CapEx: '+money(t.str?.cashFlow)+'   |   Incremental cash flow: '+money(t.difference?.cashFlow),.55,4.5,12.15,.4,performance?14:17,C.navy,true));
 b.push(text('Operating break-even ADR '+threshold(s.breakEven?.operating,'adr')+' / occupancy '+threshold(s.breakEven?.operating,'occupancy')+'   |   Conversion payback: '+payback(s.payback),.55,5.02,12.15,.55,14));
 b.push(text((s.limitations||[]).length?'Evidence limits: '+s.limitations.slice(0,2).join(' '):'Results retain the selected inventory, source assumptions and exposure period.',.55,5.77,12.15,.63,12,C.muted));
 b=page('Financial comparison','USD | LTR is a modeled alternative | Differences = STR minus LTR');
 b.push({kind:'table',x:.55,y:1.54,w:6.2,h:2.93,heads:performance?['Metric','STR budget','STR actuals','Modeled LTR','Budget - LTR']:['Metric',strLabel,'Modeled LTR','Difference'],widths:performance?[.32,.17,.17,.17,.17]:[.4,.2,.2,.2],rows:metricRows.map(([label,key])=>[label,money(t.str?.[key]),...(performance?[money(t.actual?.[key])]:[]),money(t.ltr?.[key]),money(t.difference?.[key])]),size:performance?10:11.5});
 b.push({kind:'bars',x:7.1,y:1.72,w:5.6,h:2.85,title:'Income, operating costs and NOI',labels:['Income','Expenses','NOI'],series:[{label:strLabel,color:C.teal,values:['income','expenses','noi'].map(k=>t.str?.[k])},...(performance?[{label:'STR actuals',color:C.blue,values:['income','expenses','noi'].map(k=>t.actual?.[k])}]:[]),{label:'Modeled LTR',color:C.gold,values:['income','expenses','noi'].map(k=>t.ltr?.[k])}]});
 b.push({kind:'waterfall',x:.55,y:4.82,w:12.15,h:1.36,labels:['LTR NOI','Income difference','Expense impact','STR NOI'],values:[t.ltr?.noi,t.difference?.income,finite(t.difference?.expenses)?-t.difference.expenses:null,t.str?.noi]});
 b.push(text('NOI excludes CapEx. Direct contribution precedes shared expense allocation. Positive expense differences reduce STR advantage.',.55,6.37,12.15,.28,10,C.muted));
 const floorChunks=chunks(s.floorPlans,9);
 floorChunks.forEach((rows,index)=>{
  b=page(index?'Floor-plan results (continued)':'Floor-plan results','Matched inventory and exposure dates | '+(s.metadata.inventoryLabel||'Floor-plan estimates'));
  b.push({kind:'table',x:.55,y:1.53,w:12.15,h:Math.max(1.05,(rows.length+1)*.38),heads:['Floor plan / units','LT rent','STR NOI','LTR NOI','Difference','BE ADR / occ.','Payback'],widths:[.22,.10,.13,.13,.13,.15,.14],rows:rows.map(f=>[`${f.code||f.id} ${f.name||''} / ${f.units} units`,money(f.ltRent),money(f.str?.noi),money(f.ltr?.noi),money(f.difference?.noi),threshold(f.breakEven?.operating,'adr')+' / '+threshold(f.breakEven?.operating,'occupancy'),payback(f.payback)]),size:10.5});
  b.push(text('STR required to equal LTR NOI: ADR '+threshold(s.breakEven?.ltrParity,'adr')+' / occupancy '+threshold(s.breakEven?.ltrParity,'occupancy')+'. Other program assumptions remain fixed.',.55,5.68,12.15,.45,13));
  b.push(text('Payback uses incremental cash flow after conversion capital and recurring CapEx. Horizon: '+(s.payback?.horizonMonths??'unavailable')+' months. Detailed ramp and monthly amounts are retained in Excel and the snapshot.',.55,6.16,12.15,.5,11,C.muted));
 });
 // Evidence never disappears when there are many assumptions or limitations.
 const evidence=evidenceRows(s).filter(([k])=>!['Property','Program','Scenario','Saved program version','Reporting period','Compared inventory','Comparison mode'].includes(k)).flatMap(([k,v])=>splitText(v,190).map((text,i)=>[k+(i?' (continued)':''),text]));
 chunks(evidence,10).forEach((rows,index)=>{
  b=page(index?'Assumptions and evidence (continued)':'Assumptions and evidence','Source dates, attribution and limitations are part of this retained scenario');
  b.push({kind:'table',x:.55,y:1.53,w:12.15,h:4.8,heads:['Evidence / assumption','Retained value and source'],widths:[.24,.76],rows:rows.map(([k,v])=>[k,plain(v)]),size:10.5});
 });
 if(includeGl)for(const [section,title] of [['income','Income'],['expenses','Operating Expenses'],['capex','Capital Expenditures']])chunks(s.gl.filter(r=>r.section===section),11).forEach((rows,index)=>{
  b=page(title+' - GL appendix'+(index?' (continued)':''),'USD | Positive expense and capital differences mean additional STR cost');
  b.push({kind:'table',x:.55,y:1.53,w:12.15,h:4.86,heads:['GL / account','STR','LTR','Difference','%','Source / allocation'],widths:[.26,.12,.12,.12,.08,.30],rows:rows.map(r=>[`${r.code||'Unmapped'} ${r.name||''}`,money(r.str),money(r.ltr),money(r.difference),pct(r.percent),[r.source,r.allocationMethod].filter(Boolean).map(plain).join(' / ')]),size:10.5});
  if(!rows.length)b.push(text('No retained GL lines in this section.',.75,2.3,11.7,.5,15));
 });
 return pages;
}

let pptxLoading;
async function loadPptx(provided){
 if(provided)return provided;if(globalThis.PptxGenJS||globalThis.pptxgen)return globalThis.PptxGenJS||globalThis.pptxgen;
 if(typeof document==='undefined')throw Error('Supply the vendored PptxGenJS constructor as options.PptxGenJS.');
 pptxLoading ||= new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('../vendor/pptxgen-4.0.1.js?v=4fb9eac5cfefb213',import.meta.url).href;script.onload=()=>globalThis.PptxGenJS||globalThis.pptxgen?resolve(globalThis.PptxGenJS||globalThis.pptxgen):reject(Error('PowerPoint export library did not initialize.'));script.onerror=()=>{pptxLoading=null;reject(Error('PowerPoint export library could not load. Try again.'));};document.head.appendChild(script);});
 return pptxLoading;
}

function plotGeometry(block){
 const vals=(block.series||[]).flatMap(s=>s.values).filter(finite),low=Math.min(0,...vals),high=Math.max(0,...vals),range=high-low||1;
 return {low,high,range,at:n=>block.y+block.h-.52-(n-low)/range*(block.h-.97)};
}
export function comparisonChartPrimitives(block){
 const out=[],tx=(value,x,y,w,h=.23,size=9,color=C.muted)=>out.push({kind:'text',value,x,y,w,h,size,color});
 if(block.kind==='bars'){
  const {at,high,low}=plotGeometry(block),plotY=block.y+.39,plotH=block.h-.97,step=(block.w-.58)/block.labels.length;
  tx(block.title,block.x,block.y,block.w,.27,12,C.navy);
  for(let i=0;i<4;i++){const val=low+(high-low)*i/3,y=at(val);out.push({kind:'line',x:block.x+.54,y,w:block.w-.54,h:0,color:C.line});tx(Math.abs(val)>=1000?(val/1000).toFixed(0)+'k':val.toFixed(0),block.x,y-.07,.48,.18,8);}
  block.labels.forEach((label,i)=>{const x=block.x+.6+i*step;block.series.forEach((s,j)=>{const value=s.values[i];if(!finite(value))return;out.push({kind:'rect',x:x+j*step*.84/block.series.length,y:Math.min(at(0),at(value)),w:step*.72/block.series.length,h:Math.max(.008,Math.abs(at(value)-at(0))),color:s.color});});tx(label,x,block.y+block.h-.45,step-.04,.22,9);});
  block.series.forEach((s,i)=>{const lw=block.w/block.series.length;out.push({kind:'rect',x:block.x+i*lw,y:block.y+block.h-.13,w:.12,h:.12,color:s.color});tx(s.label,block.x+.2+i*lw,block.y+block.h-.22,lw-.2,.22,9);});
 }else{
  const [start,income,cost,end]=block.values;if(!block.values.every(finite)){tx('NOI bridge unavailable: one or more retained amounts are missing.',block.x,block.y+.5,block.w,.4,12);return out;}
  const levels=[start,start+income,start+income+cost,end],lo=Math.min(0,...levels),hi=Math.max(0,...levels),span=hi-lo||1,at=n=>block.y+block.h-.3-(n-lo)/span*(block.h-.65),step=block.w/4;
  const ranges=[[0,start],[start,start+income],[start+income,start+income+cost],[0,end]];
  ranges.forEach(([a,b],i)=>{const x=block.x+i*step+.16;out.push({kind:'rect',x,y:Math.min(at(a),at(b)),w:step-.36,h:Math.max(.02,Math.abs(at(b)-at(a))),color:i===0?C.gold:i===3?C.teal:block.values[i]>=0?C.blue:C.red});tx(money(block.values[i]),x,Math.min(at(a),at(b))-.25,step-.2,.22,11,C.navy);tx(block.labels[i],x,block.y+block.h-.23,step-.2,.23,10);});
 }
 return out;
}

export async function comparisonPowerPointBytes(retained,options={}){
 const PptxGenJS=await loadPptx(options.PptxGenJS),pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='RISE | ATLAS';pptx.subject='Retained STR vs. LTR comparison';pptx.title=retained.snapshot.metadata.propertyName+' - '+retained.snapshot.metadata.programName;pptx.company='RISE';pptx.lang='en-US';pptx.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:'en-US'};
 const pages=comparisonReportPages(retained,options),meta=metaLines(retained.snapshot,retained.exportedAt);
 pages.forEach((page,index)=>{
  const slide=pptx.addSlide();slide.background={color:C.white};slide.addImage({data:RISE_REPORT_LOGO,x:.55,y:.27,w:.79,h:.38});
  const draw=block=>{if(block.kind==='text')slide.addText(clean(block.value),{x:block.x,y:block.y,w:block.w,h:block.h,fontSize:block.size,fontFace:'Arial',bold:!!block.bold,color:block.color||C.navy,margin:0,breakLine:false,fit:'shrink',valign:'mid'});
   else if(block.kind==='rect')slide.addShape(pptx.ShapeType.rect,{x:block.x,y:block.y,w:block.w,h:block.h,line:{color:block.color,transparency:100},fill:{color:block.color}});
   else if(block.kind==='line')slide.addShape(pptx.ShapeType.line,{x:block.x,y:block.y,w:block.w,h:block.h,line:{color:block.color,width:.6}});
   else if(block.kind==='table'){
    const rows=[block.heads.map(v=>({text:v,options:{bold:true,color:C.white,fill:C.navy}})),...block.rows.map((row,ri)=>row.map(v=>({text:plain(v),options:{fill:ri%2?C.wash:C.white}})))];
    slide.addTable(rows,{x:block.x,y:block.y,w:block.w,h:block.h,colW:block.widths.map(w=>w*block.w),rowH:block.rowHeights||block.h/rows.length,fontFace:'Arial',fontSize:block.size,color:C.navy,border:{type:'solid',pt:.4,color:C.line},margin:.07,autoPage:false,verbose:false,paraSpaceAfterPt:0,valign:'mid'});
   }else comparisonChartPrimitives(block).forEach(draw);};
  draw({kind:'text',value:page.title,x:1.57,y:.3,w:11.15,h:.4,size:25,bold:true});draw({kind:'text',value:page.subtitle,x:.55,y:.9,w:12.15,h:.33,size:11,color:C.muted});draw({kind:'line',x:.55,y:1.34,w:12.15,h:0,color:C.blue});
  page.blocks.forEach(draw);
  meta.forEach((line,i)=>draw({kind:'text',value:line,x:.55,y:6.79+i*.17,w:11.6,h:.17,size:7.2,color:C.muted}));draw({kind:'text',value:(index+1)+' / '+pages.length,x:12.15,y:7.14,w:.55,h:.17,size:8,color:C.muted});
  slide.addNotes([index===0?'ATLAS_COMPARISON_SNAPSHOT\n'+JSON.stringify(retained):meta.join('\n')]);
 });
 return new Uint8Array(await pptx.write({outputType:'arraybuffer',compression:true}));
}

export async function comparisonPdfBytes(retained,options={}){
 const {PDFDocument,StandardFonts,rgb}=await import('../vendor/pdf-lib-1.17.1.mjs?v=72c052d97b4d5d9f'),pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),logo=await pdf.embedPng(RISE_REPORT_LOGO),scale=72;
 const color=h=>rgb(parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4),16)/255),print=v=>[...clean(v).replace(/[\u2010-\u2015]/g,'-')].map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 const pages=comparisonReportPages(retained,options),meta=metaLines(retained.snapshot,retained.exportedAt);
 pages.forEach((spec,index)=>{
  const page=pdf.addPage([960,540]),text=(value,x,y,w,h,size,ink=C.navy,weight=font)=>{
   const max=w*scale,lines=[];for(const paragraph of print(value).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(line&&weight.widthOfTextAtSize(line+' '+word,size)>max){lines.push(line);line='';}for(const character of (line?' ':'')+word){if(line&&weight.widthOfTextAtSize(line+character,size)>max){lines.push(line);line='';}line+=character;}}lines.push(line);}
   let effective=size;while(lines.length*effective*1.18>h*scale&&effective>7)effective-=.25;
   lines.forEach((line,i)=>page.drawText(line,{x:x*scale,y:540-y*scale-effective-i*effective*1.18,size:effective,font:weight,color:color(ink)}));
  };
  const draw=b=>{if(b.kind==='text')text(b.value,b.x,b.y,b.w,b.h,b.size,b.color,b.bold?bold:font);
   else if(b.kind==='rect')page.drawRectangle({x:b.x*scale,y:540-(b.y+b.h)*scale,width:b.w*scale,height:b.h*scale,color:color(b.color)});
   else if(b.kind==='line')page.drawLine({start:{x:b.x*scale,y:540-b.y*scale},end:{x:(b.x+b.w)*scale,y:540-(b.y+b.h)*scale},thickness:.6,color:color(b.color)});
   else if(b.kind==='table'){
    const rows=[b.heads,...b.rows],rh=b.h/rows.length;rows.forEach((row,r)=>{draw({kind:'rect',x:b.x,y:b.y+r*rh,w:b.w,h:rh,color:r===0?C.navy:r%2?C.white:C.wash});let x=b.x;row.forEach((value,c)=>{text(plain(value),x+.06,b.y+r*rh+.06,b.widths[c]*b.w-.12,rh-.1,b.size,r===0?C.white:C.navy,r===0?bold:font);x+=b.widths[c]*b.w;});draw({kind:'line',x:b.x,y:b.y+(r+1)*rh,w:b.w,h:0,color:C.line});});
   }else comparisonChartPrimitives(b).forEach(draw);};
  page.drawImage(logo,{x:.55*scale,y:540-.65*scale,width:.79*scale,height:.38*scale});text(spec.title,1.57,.3,11.15,.45,25,C.navy,bold);text(spec.subtitle,.55,.9,12.15,.33,11,C.muted);draw({kind:'line',x:.55,y:1.34,w:12.15,h:0,color:C.blue});spec.blocks.forEach(draw);meta.forEach((line,i)=>text(line,.55,6.79+i*.17,11.6,.17,7.2,C.muted));text((index+1)+' / '+pages.length,12.15,7.14,.55,.17,8,C.muted);
 });
 pdf.setTitle(retained.snapshot.metadata.propertyName+' - STR vs. LTR Comparison');pdf.setAuthor('RISE | ATLAS');pdf.setSubject(retained.snapshot.metadata.scenarioName||'Retained comparison');pdf.setCreationDate(new Date(retained.exportedAt));
 await pdf.attach(enc.encode(JSON.stringify(retained)),'ATLAS-STR-LTR-comparison-snapshot.json',{mimeType:'application/json',description:'Exact retained scenario, source assumptions, results and export timestamp'});
 return new Uint8Array(await pdf.save());
}

function formula(value,f,format){return finite(value)?{t:'n',v:value,f,z:format}:{t:'s',v:'Unavailable'};}
const USD='$#,##0.00;[Red]($#,##0.00);"-"';
function safeCell(v){return v===null||v===undefined?'Unavailable':typeof v==='object'&&!v.t?readable(v):typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?{t:'s',v}:v;}
export function comparisonWorkbook(retained,XLSX){
 const s=retained.snapshot,t=s.totals,performance=s.metadata.mode==='performance',book=XLSX.utils.book_new(),meta=metaLines(s,retained.exportedAt),dataStart=8;
 const add=(name,heads,rows,widths)=>{const data=[[name],...meta.map(v=>[v]),['Retained snapshot: numeric results are exact. Formulas explain retained differences; rerun ATLAS for assumption changes.'],[],heads,...rows.map(r=>r.map(safeCell))],sheet=XLSX.utils.aoa_to_sheet(data);sheet['!cols']=heads.map((_,i)=>({wch:widths?.[i]||19}));sheet['!rows']=data.map((r,i)=>({hpt:i===0?32:i<5?24:i===6?30:Math.max(22,Math.min(120,Math.ceil(Math.max(...r.map((v,c)=>String(v?.v??v??'').length/(widths?.[c]||19))))*13))}));sheet['!merges']=[0,1,2,3,4].map(r=>({s:{r,c:0},e:{r,c:heads.length-1}}));sheet['!autofilter']={ref:`A7:${XLSX.utils.encode_col(heads.length-1)}${Math.max(7,data.length)}`};
  for(let r=7;r<data.length;r++)for(let c=0;c<heads.length;c++){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell?.t!=='n'||cell.z)continue;cell.z=/occupancy|percent/i.test(heads[c])?'0.0%':/income|expense|NOI|capital|CapEx|cash flow|rent|ADR|amount|difference|^(STR|LTR)$/i.test(heads[c])?USD:'#,##0.00;[Red](#,##0.00);"-"';}
  XLSX.utils.book_append_sheet(book,sheet,name);return sheet;};
 const summary=add('Summary',performance?['Metric','STR budget','STR actuals','Modeled LTR','STR budget minus LTR']:['Metric',s.metadata.mode==='investment'?'STR actuals':'STR budget','Modeled LTR','STR minus LTR'],metricRows.map(([label,key],i)=>[label,amount(t.str?.[key]),...(performance?[amount(t.actual?.[key])]:[]),amount(t.ltr?.[key]),formula(t.difference?.[key],`B${dataStart+i}-${performance?'D':'C'}${dataStart+i}`,USD)]),[35,25,25,25,25]);
 for(let i=0;i<metricRows.length;i++)for(const col of performance?['B','C','D']:['B','C'])if(summary[col+(dataStart+i)]?.t==='n')summary[col+(dataStart+i)].z=USD;
 add('Floor-plan results',['Floor plan','Name','Sq ft','Units','Source LT rent','Scenario LT rent','STR income','LTR income','STR expenses','LTR expenses','STR NOI','LTR NOI','NOI difference','STR capital','LTR capital','Operating BE ADR','Operating BE occupancy','LTR parity ADR','LTR parity occupancy','Payback months','Payback status','Monthly ramp'],s.floorPlans.map((f,i)=>[f.code||f.id,f.name,f.sqft,f.units,f.sourceLtRent,f.ltRent,f.str?.income,f.ltr?.income,f.str?.expenses,f.ltr?.expenses,f.str?.noi,f.ltr?.noi,formula(f.difference?.noi,`K${dataStart+i}-L${dataStart+i}`,USD),f.str?.capex,f.ltr?.capex,f.breakEven?.operating?.adr,f.breakEven?.operating?.occupancy,f.breakEven?.ltrParity?.adr,f.breakEven?.ltrParity?.occupancy,f.payback?.months,payback(f.payback),plain(f.ramp)]),[17,29,12,12,19,20,20,20,20,20,20,20,20,20,20,20,22,20,22,19,42,42]);
 add('Monthly comparisons',['Period','Units','STR income','STR expenses','STR NOI','LTR income','LTR expenses','LTR NOI','NOI difference','STR CapEx','LTR CapEx','Incremental cash flow','STR budget NOI','STR actual NOI'],s.monthly.map((m,i)=>[m.period,m.units,m.str?.income,m.str?.expenses,formula(m.str?.noi,`C${dataStart+i}-D${dataStart+i}`,USD),m.ltr?.income,m.ltr?.expenses,formula(m.ltr?.noi,`F${dataStart+i}-G${dataStart+i}`,USD),formula(m.difference?.noi,`E${dataStart+i}-H${dataStart+i}`,USD),m.str?.capex,m.ltr?.capex,formula(m.difference?.cashFlow,`I${dataStart+i}-(J${dataStart+i}-K${dataStart+i})`,USD),m.budget?.noi,m.actual?.noi]),[16,12]);
 add('GL details',['Section','GL code','Account','STR','LTR','Difference','Percent difference','Favorable impact','Source','Allocation method','STR budget','STR actual'],s.gl.map((g,i)=>[g.section,g.code,g.name,g.str,g.ltr,formula(g.difference,`D${dataStart+i}-E${dataStart+i}`,USD),finite(g.ltr)&&g.ltr!==0?formula(g.percent,`F${dataStart+i}/ABS(E${dataStart+i})`,'0.0%'):'N/A',g.favorable===null||g.favorable===undefined?'Unavailable':g.favorable?'Favorable':'Unfavorable',plain(g.source),plain(g.allocationMethod),g.budget,g.actual]),[18,15,35,20,20,20,20,20,44,36,20,20]);
 add('Assumptions',['Assumption / evidence','Retained value','Source'],[...(s.assumptions||[]).map(a=>[a.name,a.value,plain(a.source)]),...evidenceRows(s).filter(([k])=>!(s.assumptions||[]).some(a=>a.name===k)).map(([k,v])=>[k,plain(v),'Retained comparison snapshot']),['Export timestamp',retained.exportedAt,'ATLAS export']], [34,90,60]);
 add('Allocations',['GL code','Scenario','Method','Allocated amount','Retained rule'],(s.allocations||[]).map(a=>[a.code||a.glCode,a.scenario||a.side,a.method||a.allocationMethod,a.amount,readable(a)]),[17,20,30,22,100]);
 const capital=(s.capital||[]).flatMap(a=>a.monthly?.length?a.monthly.map(m=>({...a,...m,monthly:undefined})):a);
 add('Capital timing',['Period','Floor plan','GL code','Capital item','STR','LTR','Difference','Source / timing'],capital.map((a,i)=>[a.period||a.month,a.floorPlan||a.floorPlanId||'Program total',a.glCode||a.code,a.name||a.label,a.str??a.amount,a.ltr,formula(difference(a.str??a.amount,a.ltr),`E${dataStart+i}-F${dataStart+i}`,USD),readable(a.source||a.timing||a)]),[17,22,17,36,22,22,22,75]);
 const supporting=[];
 for(const f of s.floorPlans){supporting.push([f.code||f.id,'Rent source before overrides',f.sourceLtRent,'Monthly USD / unit']);supporting.push([f.code||f.id,'Matched ramp quantities',plain(f.ramp),'Program activation schedule']);}
 for(const [label,key] of metricRows)supporting.push(['Program','STR '+label,t.str?.[key],'Retained engine result'],['Program','LTR '+label,t.ltr?.[key],'Modeled counterfactual']);
 for(const type of ['operating','ltrParity'])for(const key of ['adr','occupancy','feasible'])supporting.push(['Break-even',type+' '+key,s.breakEven?.[type]?.[key],plain(s.breakEven?.assumptions)]);
 for(const [k,v] of Object.entries(s.payback||{}))supporting.push(['Payback',k,plain(v),'Incremental cash flow vs. LTR']);
 for(const row of s.sensitivity||[])supporting.push(['Sensitivity','ADR / occupancy result',plain(row),'Retained engine calculation']);
 add('Supporting calculations',['Scope','Calculation / driver','Retained value','Basis'],supporting,[23,40,55,85]);
 return book;
}

// SheetJS already provides OOXML packaging. Add the existing RISE logo and
// restrained formatting without adding a library or changing financial cells.
export function comparisonWorkbookBytes(retained,XLSX){
 const book=comparisonWorkbook(retained,XLSX),zip=XLSX.CFB.read(new Uint8Array(XLSX.write(book,{bookType:'xlsx',type:'array'})),{type:'buffer'}),get=p=>dec.decode(XLSX.CFB.find(zip,'Root Entry/'+p).content),put=(p,v)=>XLSX.CFB.utils.cfb_add(zip,'Root Entry/'+p,typeof v==='string'?enc.encode(v):v),ns='http://schemas.openxmlformats.org',office=ns+'/officeDocument/2006/relationships';
 let styles=get('xl/styles.xml');const count=tag=>Number(styles.match(new RegExp('<'+tag+' count="(\\d+)"'))?.[1]),font=count('fonts'),fill=count('fills'),xf=count('cellXfs');
 const append=(src,tag,items,n)=>src.replace(new RegExp('<'+tag+' count="(\\d+)"([^>]*)>([\\s\\S]*?)</'+tag+'>'),(_,total,attrs,body)=>`<${tag} count="${Number(total)+n}"${attrs}>${body}${items}</${tag}>`);
 styles=styles.replace(/<name val="Calibri"\/>/g,'<name val="Arial"/>');
 styles=append(styles,'fonts','<font><b/><sz val="18"/><color rgb="FF003146"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><sz val="10"/><color rgb="FF516D78"/><name val="Arial"/></font>',3);
 styles=append(styles,'fills','<fill><patternFill patternType="solid"><fgColor rgb="FF003146"/><bgColor indexed="64"/></patternFill></fill>',1);
 const style=(f,b)=>`<xf numFmtId="0" fontId="${f}" fillId="${b}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`;
 styles=append(styles,'cellXfs',style(font,0)+style(font+1,fill)+style(font+2,0),3);styles=styles.replace(/<cellXfs([^>]*)>([\s\S]*?)<\/cellXfs>/,(_,attrs,body)=>'<cellXfs'+attrs+'>'+body.replace(/<xf([^>]*?)\/>/g,'<xf$1 applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>')+'</cellXfs>');put('xl/styles.xml',styles);
 for(let i=1;i<=book.SheetNames.length;i++){
  const p=`xl/worksheets/sheet${i}.xml`;let source=get(p);source=source.replace(/(<worksheet\b[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');source=source.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,'<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane xSplit="1" ySplit="7" topLeftCell="B8" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>');
  source=source.replace(/<c\b([^>]*\br="[A-Z]+([1-7])"[^>]*)>/g,(_,attrs,r)=>`<c${attrs.replace(/ s="[^"]*"/,'')} s="${Number(r)===1?xf:Number(r)===7?xf+1:xf+2}">`);
  source=source.replace('</worksheet>','<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;LRISE | STR vs. LTR&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>'+(i===1?'<drawing r:id="rIdRiseLogo"/>':'')+'</worksheet>');put(p,source);
 }
 const rel=entries=>`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}/package/2006/relationships">${entries.map(([id,type,target])=>`<Relationship Id="${id}" Type="${office}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
 put('xl/worksheets/_rels/sheet1.xml.rels',rel([['rIdRiseLogo','drawing','../drawings/riseLogo.xml']]));
 put('xl/drawings/riseLogo.xml',`<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="${ns}/drawingml/2006/spreadsheetDrawing" xmlns:a="${ns}/drawingml/2006/main" xmlns:r="${office}"><xdr:oneCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="680000" cy="325000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="RISE logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
 put('xl/drawings/_rels/riseLogo.xml.rels',rel([['rIdImage','image','../media/riseLogo.png']]));put('xl/media/riseLogo.png',Uint8Array.from(atob(RISE_REPORT_LOGO.split(',')[1]),c=>c.charCodeAt(0)));put('xl/atlas-comparison.json',JSON.stringify(retained));
 let types=get('[Content_Types].xml');if(!/Extension="png"/.test(types))types=types.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');put('[Content_Types].xml',types.replace('</Types>','<Override PartName="/xl/drawings/riseLogo.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/atlas-comparison.json" ContentType="application/json"/></Types>'));
 return new Uint8Array(XLSX.CFB.write(zip,{type:'buffer',fileType:'zip',compression:true}));
}

export async function exportComparison(snapshot,format,options={}){
 const retained=retainComparisonExport(snapshot,options),normalized=String(format).toLowerCase().replace(/^\./,'');
 if(!['pdf','pptx','xlsx'].includes(normalized))throw Error('Select PDF, PowerPoint or Excel.');
 const data=normalized==='pdf'?await comparisonPdfBytes(retained,options):normalized==='pptx'?await comparisonPowerPointBytes(retained,options):comparisonWorkbookBytes(retained,await loadXlsx(options.XLSX||options.xlsx));
 const m=retained.snapshot.metadata,name=['RISE',m.propertyName,m.programName,m.scenarioName,m.periodLabel,'STR-LTR'].filter(Boolean).join('_').replace(/[^a-zA-Z0-9._-]+/g,'-')+'.'+normalized,type={pdf:'application/pdf',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}[normalized];
 if(options.download!==false&&typeof document!=='undefined'){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return {name,type,data,snapshot:retained};
}
