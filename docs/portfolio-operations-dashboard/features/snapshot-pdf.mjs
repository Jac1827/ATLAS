import {canonicalJson} from './financial-snapshot.mjs?v=848d058bdec07b4e';
// An actual downloadable document, not a second calculation or print preview.
// The complete retained snapshot and export rows are also embedded as evidence.
export async function snapshotPdf({title,subtitle='',snapshot,rows,columns,sections}){
 if(sections)return sectionedSnapshotPdf({title,subtitle,snapshot,rows,sections});
 const {PDFDocument,StandardFonts,rgb}=await import('../vendor/pdf-lib-1.17.1.mjs?v=72c052d97b4d5d9f');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),blue=rgb(.07,.23,.31),grey=rgb(.32,.38,.42);
 pdf.setTitle(title);pdf.setSubject(snapshot.fingerprint);pdf.setProducer('ATLAS retained financial snapshot');
 const printable=value=>{const raw=value===null||value===undefined?'Unavailable':typeof value==='object'?canonicalJson(value):String(value);return [...raw].map(c=>{try{font.encodeText(c);return c;}catch{return [...c].map(x=>'\\u{'+x.codePointAt(0).toString(16)+'}').join('');}}).join('').replace(/[\r\n\t]/g,' ');};
 const wrap=(text,width,size)=>{const out=[];let line='';for(const c of printable(text)){if(line&&font.widthOfTextAtSize(line+c,size)>width){out.push(line);line=c;}else line+=c;}out.push(line);return out;};
 let page,y,pageNo=0;const width=842,height=595,margin=34;
 const text=(value,x,at,size=9,weight=font,color=grey)=>page.drawText(printable(value),{x,y:at,size,font:weight,color});
 const newPage=()=>{page=pdf.addPage([width,height]);pageNo++;y=height-margin;text(title,margin,y,15,bold,blue);y-=19;text(subtitle,margin,y,9);y-=19;for(const line of wrap('Snapshot '+snapshot.fingerprint,width-margin*2,8)){text(line,margin,y,8);y-=11;}y-=8;text('Page '+pageNo,width-margin-45,18,8);};
 const ensure=heightNeeded=>{if(y-heightNeeded<35)newPage();};
 const paragraph=(value,size=8)=>{for(const line of wrap(value,width-margin*2,size)){ensure(size+5);text(line,margin,y,size);y-=size+4;}};
 newPage();paragraph('Values and source versions are retained together. Unavailable means missing; numeric zero is populated. Full precision and source evidence are preserved in the embedded JSON attachment.');y-=6;
 const header=()=>{let x=margin;for(const [,label,w] of columns){text(label,x,y,8,bold,blue);x+=w;}y-=15;};header();
 for(const row of rows){const cells=columns.map(([key,,w])=>wrap(row[key],w-9,8)),heightNeeded=Math.max(...cells.map(c=>c.length))*11+9;if(y-heightNeeded<35){newPage();header();}let x=margin;cells.forEach((lines,index)=>{lines.forEach((line,i)=>text(line,x,y-i*11,8));x+=columns[index][2];});y-=heightNeeded;page.drawLine({start:{x:margin,y:y+11},end:{x:width-margin,y:y+11},thickness:.3,color:rgb(.8,.84,.87)});}
 newPage();paragraph('SOURCE VERSIONS AND OUTPUT EVIDENCE',11);paragraph(canonicalJson(snapshot.identity));y-=8;
 // All fields from CSV/XLSX are reproduced, so a PDF consumer can inspect exact
 // source coordinates, missing values and hashes rather than rounded totals only.
 const common=Object.keys(rows[0]||{}).filter(key=>rows.every(row=>canonicalJson(row[key])===canonicalJson(rows[0][key])));
 paragraph('Common to every output row',9);for(const key of common)paragraph(key+': '+printable(rows[0][key]));y-=8;
 for(let index=0;index<rows.length;index++){ensure(30);paragraph('Row '+(index+1),9);for(const [key,value] of Object.entries(rows[index]))if(!common.includes(key))paragraph(key+': '+printable(value));y-=8;}
 const attachment=new TextEncoder().encode(canonicalJson({snapshot,rows}));
 await pdf.attach(attachment,'ATLAS-snapshot.json',{mimeType:'application/json',description:'Exact retained source versions and export values'});
 return pdf.save();
}

// Official reports have purpose-built visible sections. Every rendered value also travels in the retained attachment.
async function sectionedSnapshotPdf({title,subtitle,snapshot,rows,sections}){
 const {PDFDocument,StandardFonts,rgb}=await import('../vendor/pdf-lib-1.17.1.mjs?v=72c052d97b4d5d9f');
 const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const colors={ink:rgb(.08,.18,.22),muted:rgb(.31,.39,.42),teal:rgb(.04,.32,.37),orange:rgb(.93,.44,.21),line:rgb(.82,.88,.89),wash:rgb(.95,.97,.97),white:rgb(1,1,1)};
 const width=842,height=595,margin=34,bodyWidth=width-margin*2,bottom=45,pages=[];
 let page,y;
 const printable=value=>{const raw=value===null||value===undefined||typeof value==='string'&&!value.trim()?'Unavailable':typeof value==='object'?canonicalJson(value):String(value);return [...raw.replace(/[\u2010-\u2015]/g,'-').replace(/[\r\n\t]/g,' ')].map(char=>{try{regular.encodeText(char);return char;}catch{return '?';}}).join('');};
 const wrap=(value,w,size=8.5,font=regular)=>{
  const result=[],words=printable(value).split(/\s+/);let line='';
  for(const word of words){
   if(font.widthOfTextAtSize(line?(line+' '+word):word,size)<=w){line=line?line+' '+word:word;continue;}
   if(line){result.push(line);line='';}
   for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>w){result.push(line);line=char;}else line+=char;}
  }
  if(line||!result.length)result.push(line);return result;
 };
 const draw=(value,x,at,size=8.5,font=regular,color=colors.ink)=>page.drawText(printable(value),{x,y:at,size,font,color});
 const newPage=()=>{
  page=pdf.addPage([width,height]);pages.push(page);y=height-margin;
  page.drawRectangle({x:margin,y:y-3,width:25,height:4,color:colors.orange});draw('RISE  /  PORTFOLIO OPERATIONS',margin+35,y-3,9,bold,colors.teal);y-=31;
  for(const line of wrap(title,bodyWidth,20,bold)){draw(line,margin,y,20,bold,colors.teal);y-=24;}
  for(const line of wrap(subtitle,bodyWidth,9)){draw(line,margin,y,9,regular,colors.muted);y-=13;}
  y-=5;page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:1,color:colors.line});y-=21;
 };
 const paragraph=(value,size=9,gap=6)=>{for(const line of wrap(value,bodyWidth,size)){if(y-size-5<bottom)newPage();draw(line,margin,y,size,regular,colors.muted);y-=size+5;}y-=gap;};
 const format=(value,type)=>{
  if(value===null||value===undefined)return 'Unavailable';
  if(typeof value==='number'){
   if(!Number.isFinite(value))return 'Unavailable';
   if(type==='percent')return value.toLocaleString('en-US',{maximumFractionDigits:2})+'%';
   if(type==='money')return value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
   return value.toLocaleString('en-US',{maximumFractionDigits:2});
  }
  return value;
 };
 const table=section=>{
  const columns=section.columns,scale=bodyWidth/columns.reduce((total,column)=>total+column[2],0),widths=columns.map(column=>column[2]*scale),fontSize=section.fontSize||8.2,lineHeight=fontSize+3;
  const headerCells=columns.map((column,index)=>wrap(column[1],widths[index]-14,8,bold)),headerHeight=Math.max(...headerCells.map(lines=>lines.length))*10+14;
  const begin=continued=>{
   if(y-headerHeight-55<bottom)newPage();
   draw(section.title+(continued?' (continued)':''),margin,y,12,bold,colors.teal);y-=20;
   if(!continued&&section.note)paragraph(section.note,8.5);
   if(y-headerHeight-30<bottom){newPage();draw(section.title+' (continued)',margin,y,12,bold,colors.teal);y-=20;}
   page.drawRectangle({x:margin,y:y-headerHeight,width:bodyWidth,height:headerHeight,color:colors.teal});let x=margin;
   headerCells.forEach((lines,index)=>{lines.forEach((line,i)=>draw(line,x+7,y-12-i*10,8,bold,colors.white));x+=widths[index];});y-=headerHeight;
  };
  begin(false);
  if(!section.rows.length){draw(section.emptyMessage||'No applicable items in this publication.',margin+7,y-16,8.5,regular,colors.muted);y-=35;return;}
  for(const [rowIndex,row] of section.rows.entries()){
   const cells=columns.map((column,index)=>wrap(format(row[column[0]],column[3]),widths[index]-14,fontSize));
   let offset=0,maxLines=Math.max(...cells.map(lines=>lines.length));
   while(offset<maxLines){
    let room=Math.floor((y-bottom-12)/lineHeight);
    if(room<1){newPage();begin(true);room=Math.floor((y-bottom-12)/lineHeight);}
    if(offset===0&&maxLines>room&&maxLines*lineHeight+12<height-180){newPage();begin(true);room=Math.floor((y-bottom-12)/lineHeight);}
    const count=Math.min(room,maxLines-offset),rowHeight=count*lineHeight+12;
    if(rowIndex%2===0)page.drawRectangle({x:margin,y:y-rowHeight,width:bodyWidth,height:rowHeight,color:colors.wash});
    let x=margin;cells.forEach((lines,index)=>{lines.slice(offset,offset+count).forEach((line,i)=>{
     const isNumeric=['money','percent','number'].includes(columns[index][3])&&typeof row[columns[index][0]]==='number',at=isNumeric?x+widths[index]-7-regular.widthOfTextAtSize(line,fontSize):x+7;
     draw(line,at,y-13-i*lineHeight,fontSize);
    });x+=widths[index];});
    y-=rowHeight;page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.35,color:colors.line});offset+=count;
    if(offset<maxLines){newPage();begin(true);}
   }
  }
  y-=24;
 };
 pdf.setTitle(title);pdf.setSubject(snapshot.fingerprint);pdf.setProducer('ATLAS immutable forecast report');
 newPage();paragraph('Report values and source versions are frozen together. Amounts use their original signs. Unavailable means missing; zero is a populated value.');
 for(const section of sections){if(section.pageBreak&&y<height-160)newPage();if(section.columns)table(section);else{if(y<bottom+60)newPage();draw(section.title,margin,y,12,bold,colors.teal);y-=20;for(const paragraphText of section.paragraphs||[])paragraph(paragraphText,section.fontSize||9,section.paragraphGap??6);}}
 for(const [index,output] of pages.entries()){
  output.drawLine({start:{x:margin,y:32},end:{x:width-margin,y:32},thickness:.5,color:colors.line});
  output.drawText('ATLAS | Immutable source snapshot '+String(snapshot.fingerprint).slice(0,32),{x:margin,y:19,size:7,font:regular,color:colors.muted});
  const label=`${index+1} / ${pages.length}`;output.drawText(label,{x:width-margin-regular.widthOfTextAtSize(label,8),y:18,size:8,font:regular,color:colors.muted});
 }
 await pdf.attach(new TextEncoder().encode(canonicalJson({snapshot,rows,sections})),'ATLAS-snapshot.json',{mimeType:'application/json',description:'Exact retained public report values and source versions'});
 return pdf.save();
}
