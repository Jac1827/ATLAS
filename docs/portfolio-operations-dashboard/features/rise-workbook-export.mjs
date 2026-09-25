import {RISE_REPORT_LOGO} from './rise-report-brand.mjs?v=9b39c5ad8eca1edd';
// Add presentation to a fresh OOXML package. Financial worksheets and retained
// snapshots are never recomputed, rounded, or mutated by the branding step.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const ns='http://schemas.openxmlformats.org';
export function riseWorkbookBytes(workbook,XLSX,options={}){
 if(!XLSX?.write||!XLSX?.CFB?.utils?.cfb_add)throw Error('The established Excel export runtime is unavailable.');
 const copy=structuredClone(workbook),coverName=uniqueCover(copy.SheetNames),fields=[['Community',options.communityName],['Report version',options.version],['Approval status',options.status],['Investor status',options.investorStatus],['Investor approval date',options.investorApprovalDate],['Fiscal periods',options.periods?.join(' · ')],['Actual cutoff',options.actualCutoff],['Retained snapshot',options.snapshotFingerprint]].filter(([,v])=>v!==null&&v!==undefined&&v!=='');
 const matrix=[[],[],[],['RISE | BUDGET & FORECAST'],[options.title||'Budget and Forecast Review'],[],...fields.map(([k,v])=>[k,String(v)]),[],['The financial detail in this workbook is the same retained version shown in ATLAS.'],['Blank and unavailable amounts remain distinct from numeric zero.']];
 const cover=XLSX.utils.aoa_to_sheet(matrix);cover['!cols']=[{wch:24},{wch:30},{wch:30},{wch:30}];cover['!rows']=matrix.map((_,i)=>({hpt:i===4?38:i<3?22:i>=6&&i<6+fields.length?32:25}));
 cover['!merges']=[3,4,matrix.length-2,matrix.length-1].map(r=>({s:{r,c:0},e:{r,c:3}})).concat(fields.map((_,i)=>({s:{r:i+6,c:1},e:{r:i+6,c:3}})));
 cover['!margins']={left:.5,right:.5,top:.5,bottom:.5,header:.2,footer:.2};XLSX.utils.book_append_sheet(copy,cover,coverName);
 const cfb=XLSX.CFB.read(new Uint8Array(XLSX.write(copy,{type:'array',bookType:'xlsx'})),{type:'buffer'});
 const get=path=>{const entry=XLSX.CFB.find(cfb,'Root Entry/'+path);if(!entry)throw Error('Excel package component missing: '+path);return decoder.decode(entry.content);};
 const put=(path,value)=>XLSX.CFB.utils.cfb_add(cfb,'Root Entry/'+path,typeof value==='string'?encoder.encode(value):value);
 const styles=get('xl/styles.xml'),count=tag=>Number(styles.match(new RegExp('<'+tag+' count="(\\d+)"'))?.[1]);
 const font=count('fonts'),fill=count('fills'),style=count('cellXfs');if(![font,fill,style].every(Number.isInteger))throw Error('Unexpected Excel style package.');
 const append=(source,tag,items,n)=>source.replace(new RegExp('<'+tag+' count="(\\d+)"([^>]*)>([\\s\\S]*?)</'+tag+'>'),(_,total,attrs,body)=>`<${tag} count="${Number(total)+n}"${attrs}>${body}${items}</${tag}>`);
 let styled=append(styles,'fonts','<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="24"/><color rgb="FF173B45"/><name val="Aptos Display"/></font><font><b/><sz val="11"/><color rgb="FF173B45"/><name val="Aptos"/></font><font><sz val="11"/><color rgb="FF173B45"/><name val="Aptos"/></font>',4);
 styled=append(styled,'fills','<fill><patternFill patternType="solid"><fgColor rgb="FF173B45"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF126F8A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F4"/><bgColor indexed="64"/></patternFill></fill>',3);
 const xf=(f,b)=>`<xf numFmtId="0" fontId="${f}" fillId="${b}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`;
 styled=append(styled,'cellXfs',xf(font,fill)+xf(font+1,0)+xf(font,fill+1)+xf(font+2,fill+2)+xf(font+3,0),5);put('xl/styles.xml',styled);
 const coverIndex=copy.SheetNames.length,coverPath=`xl/worksheets/sheet${coverIndex}.xml`;
 for(let i=1;i<=copy.SheetNames.length;i++){
  const path=`xl/worksheets/sheet${i}.xml`;let sheet=get(path);
  sheet=sheet.replace(/<sheetView\b([^>]*?)(\/>|>)/,(_,attrs,end)=>`<sheetView${attrs.replace(/ showGridLines="[^"]*"/,'')} showGridLines="0"${end}`);
  if(i!==coverIndex)sheet=sheet.replace(/<row\b([^>]*\br="1"[^>]*)>([\s\S]*?)<\/row>/,(_,attrs,cells)=>`<row${attrs}>${cells.replace(/<c\b([^>]*)>/g,(_,c)=>`<c${c.replace(/ s="[^"]*"/,'')} s="${style}">`)}</row>`);
  else{
   sheet=sheet.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>/g,(_,attrs,col,row)=>{const n=Number(row),s=n===4?style+2:n===5?style+1:col==='A'&&n>=7&&n<7+fields.length?style+3:style+4;return `<c${attrs.replace(/ s="[^"]*"/,'')} s="${s}">`;});
   sheet=sheet.replace(/(<worksheet\b[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');sheet=sheet.replace('</worksheet>','<pageSetup paperSize="1" orientation="portrait" fitToWidth="1" fitToHeight="1"/><drawing r:id="rIdRiseLogo"/></worksheet>');
  }put(path,sheet);
 }
 // Sheet relationships remain intact when the new cover is moved to the front.
 let book=get('xl/workbook.xml');book=book.replace(/<sheets>([\s\S]*?)<\/sheets>/,(_,body)=>{const sheets=body.match(/<sheet\b[^>]*\/>/g);if(!sheets||sheets.length!==coverIndex)throw Error('Unexpected workbook sheet registry.');return '<sheets>'+[sheets.at(-1),...sheets.slice(0,-1)].join('')+'</sheets>';});
 book=book.replace(/localSheetId="(\d+)"/g,(_,n)=>`localSheetId="${Number(n)+1}"`);put('xl/workbook.xml',book);
 const relationship=`${ns}/package/2006/relationships`,office=`${ns}/officeDocument/2006/relationships`;
 put(`xl/worksheets/_rels/sheet${coverIndex}.xml.rels`,`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${relationship}"><Relationship Id="rIdRiseLogo" Type="${office}/drawing" Target="../drawings/riseLogo.xml"/></Relationships>`);
 put('xl/drawings/riseLogo.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${ns}/drawingml/2006/spreadsheetDrawing" xmlns:a="${ns}/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="990600" cy="472440"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="RISE logo" descr="RISE"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${office}" r:embed="rIdRiseImage"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
 put('xl/drawings/_rels/riseLogo.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${relationship}"><Relationship Id="rIdRiseImage" Type="${office}/image" Target="../media/riseLogo.png"/></Relationships>`);
 const logo=RISE_REPORT_LOGO.split(',')[1];put('xl/media/riseLogo.png',Uint8Array.from(atob(logo),c=>c.charCodeAt(0)));
 let types=get('[Content_Types].xml');if(!/Extension="png"/.test(types))types=types.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');types=types.replace('</Types>','<Override PartName="/xl/drawings/riseLogo.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');put('[Content_Types].xml',types);
 return new Uint8Array(XLSX.CFB.write(cfb,{type:'buffer',fileType:'zip',compression:true}));
}
function uniqueCover(names){let name='RISE Report',n=2;while(names.includes(name))name='RISE Report '+n++;return name;}
export function downloadRiseWorkbook(workbook,XLSX,name,options={}){const bytes=riseWorkbookBytes(workbook,XLSX,options),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return bytes;}
