const assert = require('node:assert/strict');
const C = require('../docs/portfolio-operations-dashboard/lead-source-contract.js');
const B = require('../docs/portfolio-operations-dashboard/application-source-bridge.js');
const context = {sourceSystem:'Entrata',reportType:'box_score',section:'Lead Activity'};
let checks = 0;
for (const d of C.definitions) for (const alias of d.aliases) for (const value of [alias,alias.toUpperCase(),alias.replace(/[ _\-/]+/g,' / '),`  ${alias}  `]) {
  assert.equal(C.classify(value,context).field,d.field); checks++;
}
for (const label of ['New Leads','Total Guest Cards','tours','applications','approvals','leases','available_units','avg_ner','market rent','Units','Unit Type']) {
  assert.equal(C.classify(label,{...context,contactSourceComponent:true}).field,null); checks++;
}
assert.equal(C.classify('video call',{...context,contactSourceComponent:true}).field,'text_chat_other');
assert.equal(C.classify('video call',context).field,null);
assert.equal(C.classify('video call',{...context,section:'Availability',contactSourceComponent:true}).field,null);
const components = [['walk_in',2],['off_site_event',0],['telephone',3],['email',4],['online',5],['chat',6],['SMS',7],['other',8]].map(([label,value],i)=>({id:String(i),label,value}));
let result=C.aggregate(components,context,[{label:'New Leads',value:35}]);
assert.deepEqual(result.buckets,{walk_in:2,off_site_event:0,phone_calls:3,emails_online:9,text_chat_other:21});
assert.equal(result.status,'reconciled');
assert.equal(result.total,35);
result=C.aggregate([...components,{id:'combined',label:'Emails / Online',value:9}],context,[{value:35}]);
assert.equal(result.total,35);
assert.equal(result.evidence.filter(e=>e.destination==='emails_online'&&e.selected).length,1);
assert.equal(C.aggregate([...components,{id:'combined',label:'Emails / Online',value:99}],context).status,'review');
for(const value of [null,'',-1,'abc','2 contacts',false,Infinity]) {
  const changed=components.map(c=>c.label==='online'?{...c,value}:c);
  const r=C.aggregate(changed,context,[{value:35}]);
  assert.equal(r.buckets.emails_online,null);assert.equal(r.total,null);assert.notEqual(r.status,'reconciled');
}
assert.equal(C.aggregate(components,context,[{value:36}]).controls[0].variance,-1);
assert.notEqual(C.aggregate(components,context,[{value:35},{value:36}]).status,'reconciled');
assert.equal(C.aggregate(components,context,[]).status,'control_unavailable');
assert.equal(C.aggregate([...components,components[0]],context,[{value:35}]).total,35);
const rows=[['Box Score'],['Lead Activity (09/01/2026 - 09/30/2026)'],['Unit Type','New Leads','WALK-IN','Off/Site/Event','Call','Email','Online','Chat','Text','Other','Applications'],['Total:',35,2,0,3,4,5,6,7,8,500]];
const parsed=B.boxScore(rows)[0];
assert.equal(parsed.values.emails_online,9);
assert.equal(parsed.values.text_chat_other,21);
assert.equal(parsed.values.off_site_event,0);
assert.equal(parsed.leadComponents.length,8);
assert.equal(parsed.leadComponents.find(c=>c.label==='Off/Site/Event').value,0);
assert.equal(parsed.period.start,'2026-09-01');
const invalid=structuredClone(rows);invalid[3][5]='bad';
assert.equal(B.boxScore(invalid)[0].values.emails_online,null);
assert.equal(B.boxScore(invalid)[0].leadComponents.find(c=>c.label==='Email').value,'bad');
console.log(`PASS ${checks} alias/exclusion checks; residual context, combined precedence, zeros, missing/invalid inputs, duplicate evidence, controls, parser and raw lineage`);
const grouped=[['Lead Activity (09/01/2026 - 09/30/2026)'],[null,null,'Original Contact Method',null,null,null,null,null,null,null,'Activity'],['Unit Type','New Leads','Email','Call','Online','Walk In','Off Site Event','Chat','Text','Other','Emails','Calls','Chats','Texts'],['Total:',35,4,3,5,2,0,6,7,8,900,800,700,600]];
const groupedRow=B.boxScore(grouped)[0];
assert.equal(groupedRow.values.emails_online,9);assert.equal(groupedRow.values.phone_calls,3);
assert.equal(groupedRow.leadComponents.length,8,'Activity totals must not enter original contact method mix');
const unseen=structuredClone(grouped);unseen[2][9]='Video kiosk';
assert.equal(B.boxScore(unseen)[0].values.text_chat_other,21,'Unseen original contact method is a proven residual');
console.log('PASS Original Contact Method versus Activity subgroup isolation and unseen proven contact label');
