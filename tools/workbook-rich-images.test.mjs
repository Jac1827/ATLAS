import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {auditWorkbook,workbookEvidenceHash} from '../docs/portfolio-operations-dashboard/features/workbook-integrity.mjs';
import {verifiedWorkbookLocalImages} from '../docs/portfolio-operations-dashboard/features/workbook-rich-images.mjs';
import {parseReforecastWorkbook} from '../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs';
const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const fixture=()=>({SheetNames:['Input'],Sheets:{Input:{'!ref':'A1:G29',A1:{t:'n',v:100},G29:{t:'e',v:15,w:'#VALUE!'}}},files:{
 'xl/workbook.xml':'<workbook><sheets><sheet name="Input" r:id="sheet1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="29"><c r="G29" t="e" vm="1"><v>#VALUE!</v></c></row></sheetData></worksheet>',
 'xl/metadata.xml':'<metadata><metadataTypes><metadataType name="XLRICHVALUE"/></metadataTypes><futureMetadata name="XLRICHVALUE"><bk><extLst><ext><rvb i="0"/></ext></extLst></bk></futureMetadata><valueMetadata><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>',
 'xl/richData/rdrichvalue.xml':'<rvData><rv s="0"><v>0</v><v>5</v></rv></rvData>',
 'xl/richData/rdrichvaluestructure.xml':'<rvStructures><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>',
 'xl/richData/richValueRel.xml':'<richValueRels><rel r:id="image1"/></richValueRels>',
 'xl/richData/_rels/richValueRel.xml.rels':'<Relationships><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
 'xl/media/image1.png':PNG
}});
const scoped=workbook=>auditWorkbook(workbook,{authoritativeCells:['Input!A1']}),has=(audit,code)=>audit.findings.some(f=>f.code===code),cell=audit=>audit.inventory.sheets[0].cells.find(c=>c.address==='G29');
const original=fixture(),before=structuredClone(original),verified=scoped(original);
assert.equal(cell(verified).value,15,'retain original cached error');
assert.equal(cell(verified).type,'e');
assert.equal(cell(verified).mediaAuthority,'supporting_image');
assert.equal(cell(verified).mediaEvidence.mediaSha256,createHash('sha256').update(PNG).digest('hex'),'hash original media bytes, not decoded text');
assert.ok(has(verified,'embedded_image_evidence'));assert.ok(!has(verified,'cell_error'));
assert.deepEqual(original,before,'classification never mutates original workbook');
assert.equal(verified.fingerprint,scoped(fixture()).fingerprint);
assert.equal(cell(auditWorkbook(fixture())).mediaAuthority,'supporting_image','dependency-free standalone image can be evidenced without a numeric role');
assert.ok(has(auditWorkbook(fixture(),{authoritativeCells:['Input!G29']}),'cell_error'),'selecting image as numeric authority must fail');
for(const formula of ['G29','SUM(G1:G30)','ImageCell','INDIRECT("G29")']){
 const w=fixture();w.Sheets.Input.A1={t:'n',v:100,f:formula};w.Workbook={Names:[{Name:'ImageCell',Ref:'Input!$G$29'}]};
 const audit=scoped(w);assert.ok(has(audit,'cell_error'),formula);assert.notEqual(cell(audit).mediaAuthority,'supporting_image',formula);
}
const brokenCases=[
 w=>delete w.files['xl/metadata.xml'],
 w=>delete w.files['xl/media/image1.png'],
 w=>{w.files['xl/media/image1.png']=new Uint8Array([1,2,3]);},
 w=>{w.files['xl/richData/rdrichvalue.xml']='<rvData><rv s="99"><v>0</v><v>5</v></rv></rvData>';},
 w=>{w.files['xl/richData/richValueRel.xml']='<richValueRels><rel r:id="missing"/></richValueRels>';},
 w=>{w.files['xl/richData/_rels/richValueRel.xml.rels']=w.files['xl/richData/_rels/richValueRel.xml.rels'].replace('Target=','TargetMode="External" Target=');},
 w=>{w.files['xl/richData/_rels/richValueRel.xml.rels']=w.files['xl/richData/_rels/richValueRel.xml.rels'].replace('../media/image1.png','https://example.invalid/image.png');},
 w=>{w.files['xl/richData/rdrichvaluestructure.xml']=w.files['xl/richData/rdrichvaluestructure.xml'].replace('_localImage','_other');},
 w=>{w.files['xl/worksheets/sheet1.xml']=w.files['xl/worksheets/sheet1.xml'].replace('vm="1"','vm="0"');},
 w=>{w.files['xl/worksheets/sheet1.xml']=w.files['xl/worksheets/sheet1.xml'].replace('<v>','<f>1/0</f><v>');},
 w=>{w.Sheets.Input.G29.f='1/0';},
 w=>{w.Sheets.Input.G29.v=7;w.Sheets.Input.G29.w='#DIV/0!';},
 w=>{w.files['xl/worksheets/sheet1.xml']=w.files['xl/worksheets/sheet1.xml'].replace('#VALUE!','#REF!');},
 w=>{w.files['xl/worksheets/sheet1.xml']=w.files['xl/worksheets/sheet1.xml'].replace('</row>','<c r="G29" t="e" vm="1"><v>#VALUE!</v></c></row>');}
];
for(const [i,mutate] of brokenCases.entries()){const w=fixture();mutate(w);assert.equal(verifiedWorkbookLocalImages(w,workbookEvidenceHash).size,0,`malformed case ${i}`);assert.ok(has(scoped(w),'cell_error'),`malformed case ${i} preserves source error`);}
const ordinary=fixture();ordinary.Sheets.Input.A2={t:'e',v:15,w:'#VALUE!'};const ordinaryAudit=auditWorkbook(ordinary);assert.ok(ordinaryAudit.findings.some(f=>f.code==='cell_error'&&f.address==='A2'),'never blanket-ignore VALUE errors');

// Opt-in local acceptance fixture: exact user source is never substituted.
if(process.argv[2]){
 const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'),source=fs.readFileSync(process.argv[2]),sourceHash=createHash('sha256').update(source).digest('hex');
 const w=XLSX.read(source,{type:'buffer',bookFiles:true,cellFormula:true,cellNF:true,sheetStubs:true}),images=verifiedWorkbookLocalImages(w,workbookEvidenceHash);
 assert.ok(images.has('Input!G29'),'real workbook must prove image relationship');
 const selected=Object.entries(w.Sheets.Input).find(([address,c])=>/^[A-Z]+\d+$/.test(address)&&!c.f&&c.t!=='e'&&typeof c.v==='string'&&c.v.length>0);assert.ok(selected);
 const evidence=await parseReforecastWorkbook(source,{xlsx:XLSX,fileName:'rich-image-acceptance.xlsx',includeOriginalBytes:true,authoritativeCells:['Input!'+selected[0]]});
 assert.ok(evidence.integrity.findings.some(f=>f.code==='embedded_image_evidence'&&f.address==='G29'));
 assert.ok(!evidence.issues.some(f=>f.code==='excel_error'&&f.address==='G29'));
 assert.ok(Buffer.from(evidence.source.originalFile.data,'base64').equals(Buffer.from(source)));
 assert.equal(evidence.source.sha256,sourceHash);
 console.log('PASS real local image relationship, authority exclusion, intake classification and exact original-byte retention; source SHA256 '+sourceHash);
}
console.log('PASS verified rich-value images, binary hashes, selected/direct/range/named/dynamic authority dependencies, missing/malformed/external links and unchanged real Excel errors.');
