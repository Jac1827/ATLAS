import {riseWorkbookBytes} from './rise-workbook-export.mjs?v=d08dd1e8d4aadf30';

// Presentation only. Existing report sheets remain an exact retained-data API.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const friendly={adr:'Average daily rate',alos:'Average length of stay',adrMonthly:'Monthly daily rates',adrMode:'Daily rate method',occMode:'Occupancy method',ccFeePct:'Credit card fee rate',mgmtFeePct:'Management fee rate',driverMeta:'Driver source details',startedFrom:'Starting source',channelMix:'Booking channels',ffeReservePerUnit:'FF&E reserve per unit',ltOtherPerOccUnitMo:'Long-term other income per occupied unit / month',ltParkingPerOccUnitMo:'Long-term parking per occupied unit / month',ltInternetPerOccUnitMo:'Long-term internet per occupied unit / month'};
const label=key=>Object.hasOwn(friendly,key)?friendly[key]:String(key).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,s=>s.toUpperCase());
const pointer=key=>String(key).replace(/~/g,'~0').replace(/\//g,'~1');
function* leaves(value,path=[]){
 if(value!==null&&typeof value==='object'&&Object.keys(value).length){for(const key of Object.keys(value))yield*leaves(value[key],[...path,key]);}
 else yield {value,path};
}
// Each text segment fits comfortably within an ordinary wrapped row. Joining
// consecutive segments for one original cell/path restores its exact text.
function parts(value){if(typeof value!=='string')return [value];const chars=Array.from(value),result=[];for(let i=0;i<chars.length;i+=160)result.push(chars.slice(i,i+160).join(''));return result.length?result:[''];}
function detailRows(report,appliedConfig,proposedConfig){
 const rows=[];
 for(const [basis,items,config,sheet] of [['Applied',report.assumptions,appliedConfig,'Applied assumptions'],['Proposed — not applied',report.proposedAssumptions,proposedConfig,'Proposed driver edits']]){
  items.forEach((item,index)=>{
   // Only structured values from the verified configuration are expanded.
   // JSON-looking literal strings, dates, identifiers and decimals stay text.
   const source=config&&Object.hasOwn(config,item.name)?config[item.name]:item.value;
   for(const leaf of leaves(source)){
    const value=leaf.value!==null&&typeof leaf.value==='object'?JSON.stringify(leaf.value):leaf.value;
    const fields=[label(item.name),leaf.path.length?'/'+leaf.path.map(pointer).join('/'):'',value,item.source];
    const chunks=fields.map(parts),count=Math.max(...chunks.map(x=>x.length));
    for(let i=0;i<count;i++)rows.push({Basis:basis,Assumption:chunks[0][i]??'',Detail:chunks[1][i]??'',Value:chunks[2][i]??null,Type:leaf.value===null?'null':Array.isArray(leaf.value)?'array':typeof leaf.value,Source:chunks[3][i]??'','Original cell':sheet+'!B'+(index+2),Part:(i+1)+' / '+count});
   }
  });
 }
 return rows;
}
const widthsFor={
 'Monthly STR':{period:14,revenue:20,expenses:20,netOperatingIncome:24,capital:20,debt:20,belowNoi:20,netCashFlow:22},
 'STR GL detail':{sourceLineId:30,year:12,period:14,gl:12,account:58,nature:22,amount:22},
 'Calculation status':{status:38,note:110},
 'Assumptions detail':{Basis:18,Assumption:26,Detail:28,Value:32,Type:8,Source:35,'Original cell':28,Part:8},
 'Applied assumptions':{name:38,value:100,source:80},
 'Proposed driver edits':{name:38,value:100,source:80}
};
const textLines=(value,width)=>String(value??'').split(/\r\n|\r|\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(Array.from(line).reduce((sum,c)=>sum+(c.codePointAt(0)>255?2:1),0)/Math.max(1,width-3))),0);
function sheetFor(XLSX,rows,name){
 const ws=XLSX.utils.json_to_sheet(rows),headers=rows.length?Object.keys(rows[0]):[],widths=headers.map(key=>widthsFor[name][key]||24);
 ws['!cols']=widths.map(wch=>({wch}));ws['!rows']=[{hpt:36},...rows.map(row=>({hpt:Math.min(400,Math.max(22,16*Math.max(...headers.map((key,i)=>textLines(row[key],widths[i])))+8))}))];
 ws['!margins']={left:.3,right:.3,top:.4,bottom:.4,header:.2,footer:.2};
 if(rows.length)ws['!autofilter']={ref:ws['!ref']};
 if(['Monthly STR','STR GL detail'].includes(name))for(let r=1;r<=rows.length;r++)headers.forEach((key,c)=>{const cell=ws[XLSX.utils.encode_cell({r,c})];if(cell?.t==='n'&&key!=='year')cell.z='#,##0.00;[Red]-#,##0.00;0.00';});
 return ws;
}

export function strProgrammeWorkbookBytes(report,snapshot,XLSX,{appliedConfig=null,proposedConfig=null}={}){
 const workbook=XLSX.utils.book_new(),rowsBySheet={
  'Monthly STR':report.monthly,
  'STR GL detail':report.rows.map(({sourceLineId,...row})=>row),
  'Calculation status':[{status:report.status,note:report.calculationNote}],
  'Assumptions detail':detailRows(report,appliedConfig,proposedConfig),
  'Applied assumptions':report.assumptions,
  'Proposed driver edits':report.proposedAssumptions
 };
 for(const [name,rows] of Object.entries(rowsBySheet))XLSX.utils.book_append_sheet(workbook,sheetFor(XLSX,rows,name),name);
 const bytes=riseWorkbookBytes(workbook,XLSX,{title:report.title,communityName:report.communityName,version:snapshot.identity.version,status:report.status,periods:report.monthly.map(row=>row.period),snapshotFingerprint:snapshot.fingerprint});
 return formatPackage(bytes,XLSX,workbook.SheetNames);
}

function formatPackage(bytes,XLSX,sheetNames){
 const cfb=XLSX.CFB.read(bytes,{type:'buffer'}),get=name=>decoder.decode(XLSX.CFB.find(cfb,'Root Entry/'+name).content),put=(name,text)=>XLSX.CFB.utils.cfb_add(cfb,'Root Entry/'+name,encoder.encode(text));
 let styles=get('xl/styles.xml');const count=tag=>Number(styles.match(new RegExp('<'+tag+' count="(\\d+)"'))[1]),font=count('fonts')-1,start=count('cellXfs');
 const xf=(numFmtId=0,horizontal='left')=>`<xf numFmtId="${numFmtId}" fontId="${font}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${horizontal}" vertical="top" indent="1" wrapText="1"/></xf>`;
 const moneyIds=[...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="[^\"]*#,##0\.00[^\"]*"\/>/g)].map(m=>Number(m[1]));
 const formats=[xf(),xf(0,'right'),...moneyIds.map(n=>xf(n,'right'))];
 styles=styles.replace(/<cellXfs count="(\d+)"([^>]*)>([\s\S]*?)<\/cellXfs>/,(_,n,attrs,body)=>`<cellXfs count="${Number(n)+formats.length}"${attrs}>${body}${formats.join('')}</cellXfs>`);put('xl/styles.xml',styles);
 const originalXfs=[...get('xl/styles.xml').match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*?\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m=>Number(m[0].match(/numFmtId="(\d+)"/)?.[1]||0));
 for(let i=0;i<sheetNames.length;i++){
  const file=`xl/worksheets/sheet${i+1}.xml`;let xml=get(file);
  xml=xml.replace(/<c\b([^>]*\br="[A-Z]+(\d+)"[^>]*)>([\s\S]*?)<\/c>/g,(whole,attrs,row,body)=>{
   if(Number(row)===1)return whole;
   const numeric=!/\bt="(?:str|s|inlineStr|b)"/.test(attrs)&&/<v>/.test(body),old=Number(attrs.match(/\bs="(\d+)"/)?.[1]||0),money=moneyIds.indexOf(originalXfs[old]);
   const style=start+(numeric?money>=0?2+money:1:0);return `<c${attrs.replace(/ s="[^"]*"/,'')} s="${style}">${body}</c>`;
  });
  xml=xml.replace(/<sheetView\b([^>]*?)(\/>|>)/,(_,attrs,end)=>'<sheetView'+attrs+'><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'+(end==='/>'?'</sheetView>':''));
  xml=xml.replace(/(<worksheet\b[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  xml=xml.replace('</worksheet>','<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>');put(file,xml);
 }
 // The cover is appended by the common brand helper, then displayed first.
 const coverPath=`xl/worksheets/sheet${sheetNames.length+1}.xml`;let cover=get(coverPath);
 const last=Number([...cover.matchAll(/<row\b[^>]*\br="(\d+)"/g)].at(-1)[1]);
 const notes=['Assumptions detail expands saved values into readable rows. Applied and proposed values are labeled separately.','Applied assumptions and Proposed driver edits retain the exact original source cells. Long raw JSON remains available in the cell.','Detail paths identify nested values. Continuation parts are in order; concatenate matching original cell/path parts without adding separators.'];
 const extra=notes.map((note,i)=>`<row r="${last+i+2}" ht="36" customHeight="1"><c r="A${last+i+2}" s="${start}" t="str"><v>${note}</v></c></row>`).join('');
 cover=cover.replace('</sheetData>',extra+'</sheetData>').replace(/<dimension ref="([A-Z]+\d+):[A-Z]+\d+"\/>/,(_,first)=>`<dimension ref="${first}:D${last+4}"/>`);
 cover=cover.replace(/<mergeCells count="(\d+)">([\s\S]*?)<\/mergeCells>/,(_,n,body)=>`<mergeCells count="${Number(n)+notes.length}">${body}${notes.map((_,i)=>`<mergeCell ref="A${last+i+2}:D${last+i+2}"/>`).join('')}</mergeCells>`);put(coverPath,cover);
 return new Uint8Array(XLSX.CFB.write(cfb,{type:'buffer',fileType:'zip',compression:true}));
}
