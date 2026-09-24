import {canonicalJson} from './financial-snapshot.mjs?v=e84268921f32df41';
// An actual downloadable document, not a second calculation or print preview.
// The complete retained snapshot and export rows are also embedded as evidence.
export async function snapshotPdf({title,subtitle='',snapshot,rows,columns}){
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
