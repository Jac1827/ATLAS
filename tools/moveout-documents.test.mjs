import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {defaultTemplates,prepopulate,missingFields,validateTemplate,documentSections,reportHtml,reportPdf,inspectionSections} from '../docs/portfolio-operations-dashboard/features/moveout-documents.mjs';
import {resolveRegional} from '../docs/portfolio-operations-dashboard/features/moveout-workspace.mjs';
const templates=defaultTemplates(),record={residentName:'Synthetic Resident',propertyName:'Sample Community',unit:'101',communityAddress:'100 Example Way, Unit 101',forwardingAddress:'200 Example Road',phone:'555-0100',email:'resident@example.invalid',leaseStart:'2025-11-01',leaseExpiration:'2026-10-31',scheduledMoveOutDate:'2026-10-31',ntvReceivedDate:'2026-09-01',actualPossessionReturnedDate:'2026-11-01',possessionTime:'10:30',keysReturned:'2 keys',documentingEmployee:'Synthetic CS',communityContact:'555-0101',etf:'No'};
assert.ok(missingFields(templates.ntv,prepopulate(templates.ntv,record)).includes('Administrator-approved move-out instructions'));
for(const template of Object.values(templates)){template.instructions='Approved sample instructions for testing only.';template.instructionsApproved=true;validateTemplate(template);const values=prepopulate(template,record);assert.equal(missingFields(template,values).length,0);const sections=documentSections(template,values);assert.ok(sections.length>1);const pdf=await reportPdf(template.title,sections,{logoBytes:fs.readFileSync('docs/portfolio-operations-dashboard/assets/rise-wordmark-blue.png')});assert.equal(Buffer.from(pdf).subarray(0,4).toString(),'%PDF');fs.mkdirSync('output/pdf',{recursive:true});fs.writeFileSync(`output/pdf/sample-${template.kind}.pdf`,pdf);}
const values=prepopulate(templates.mog,{...record,etf:'Yes'});assert.ok(missingFields(templates.mog,values).some(x=>x.includes('ETF amount')));values.etfAmount='0';assert.equal(missingFields(templates.mog,values).length,0);values.etfAmount='abc';assert.ok(missingFields(templates.mog,values).length);
assert.equal(prepopulate(templates.possession,{...record,actualPossessionReturnedDate:''}).actualPossessionReturnedDate,'','Expected move-out never substitutes for possession');
assert.throws(()=>validateTemplate({...templates.mog,sections:[{heading:'Bad',body:'{{unknown}}'}]}),/Unknown/);
assert.ok(reportHtml('<script>',[{heading:'<img>',lines:['<script>alert(1)</script>']}]).includes('&lt;script&gt;'));
assert.equal(resolveRegional({regionalManagerEmail:'regional@example.invalid'},[{name:'Sample Regional',email:'regional@example.invalid',employeeId:'r',active:true}]).name,'Sample Regional');assert.equal(resolveRegional({regionalManagerEmail:'regional@example.invalid'},[{name:'Inactive',email:'regional@example.invalid',active:false}]).name,'');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/central-services.js','utf8');
const extract=name=>source.match(new RegExp('^  function '+name+'\\([^]*?^  \\}','m'))[0];
const context={};vm.createContext(context);vm.runInContext(extract('getMoveOutInspectionForCase')+'\n'+extract('getInspectionRelatedCase'),context);
const state={moveOutCases:[{id:'case'}],inspections:[{id:'field',relatedMoveOutId:'case',inspectionKind:'field',templateName:'Move-Out Inspection',status:'Approved'},{id:'required',relatedMoveOutId:'case',templateName:'Move-Out Inspection',status:'Draft'}]};
assert.equal(context.getMoveOutInspectionForCase(state,{id:'case'}).id,'required');assert.equal(context.getInspectionRelatedCase(state,state.inspections[0]),null);assert.equal(context.getInspectionRelatedCase(state,state.inspections[1]).id,'case');
assert.equal(inspectionSections({inspectionKind:'field',findings:[]})[0].lines[0],'Type: Field Inspection');
console.log('PASS templates, prepopulation, explicit possession separation, ETF conditional validation, safe printable PDFs, roster Regional resolution, and field/required inspection lifecycle isolation.');

assert.equal(prepopulate(templates.mog,{...record,phone:''},{phone:'555-0199'}).phone,'555-0199');assert.ok(missingFields(templates.mog,{...prepopulate(templates.mog,record),leaseStart:'2026-02-31'}).some(x=>x.includes('valid date')));

assert.throws(()=>validateTemplate({...templates.ntv,instructionsApproved:'false'}),/explicitly/);assert.ok(!inspectionSections({findings:[{inspectorRecommendedAmount:''}]})[1].lines.some(x=>x.includes('$')));assert.ok(inspectionSections({findings:[{inspectorRecommendedAmount:0}]})[1].lines.some(x=>x.includes('$0')));

assert.equal(prepopulate(templates.mog,{moveInDate:'2019-01-01'}).leaseStart,'','Move-in is not an inferred current lease start');assert.equal(prepopulate(templates.mog,{moveInDate:'2019-01-01'},{leaseStartDate:'2026-01-01'}).leaseStart,'2026-01-01');assert.equal(prepopulate(templates.mog,{}, {}, {address:{street:'Sample'}}).communityAddress,'','An address object is not printable address text');
