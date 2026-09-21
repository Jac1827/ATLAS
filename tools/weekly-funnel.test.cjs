const assert=require('node:assert/strict'),fs=require('node:fs');
const W=require('../docs/portfolio-operations-dashboard/weekly-leasing-report.js');
const B=require('../docs/portfolio-operations-dashboard/application-source-bridge.js');
const records=[
{applicationId:'1',property:'A',leasingAgent:'Michelle',applicationStatus:'Application: Partially Completed',partialApplication:'2026-09-12',newLeadCreatedOn:'2026-09-11'},
{applicationId:'2',property:'A',leasingAgent:'Michelle',applicationStatus:'Application: Completed',applicationCompleted:'2026-09-13'},
{applicationId:'3',property:'A',leasingAgent:'Michelle',applicationStatus:'Application: Approved',applicationApproved:'2026-09-14',lifecycleCoverage:'unavailable'},
{applicationId:'4',property:'A',leasingAgent:'Michelle',applicationStatus:'Lease: Approved',currentLeaseStart:'2026-09-16'},
{applicationId:'5',property:'A',leasingAgent:'Michelle',applicationStatus:'Application: Approved (Cancelled)'},
{applicationId:'6',property:'A',leasingAgent:'Michelle',applicationStatus:'Renewal Offer: Started'}];
const args={records,communities:['A'],period:'2026-09',end:'2026-09-17'};
const one=W.model(args),agent=one.agents[0];
assert.equal(agent.partial,1);assert.equal(agent.completedStatus,1);assert.equal(agent.approved,1);assert.equal(agent.leaseApproved,1);assert.equal(agent.approvals,1,'Available approval dates are usable without full lifecycle');assert.equal(agent.leases,null,'Lease approved and lease start cannot manufacture signing dates');assert.equal(agent.pending,1,'Renewal offers are not incomplete new applications');
assert(!W.document(one).includes('<details class="community-details">'));
assert(!W.document(W.model({...args,communities:['A','B']})).includes('<details class="community-details">'));
const multi=W.document(W.model({...args,communities:['A','B','C']}));assert.equal((multi.match(/<details class="community-details">/g)||[]).length,3);assert(!multi.includes('<details class="community-details" open'));
assert(multi.includes('Application Funnel'));assert(multi.includes('2026-09-14'));assert(multi.includes('Not supplied'));assert(W.rows(one).some(r=>r.section==='Application Funnel'&&r.value==='Lease: Approved'));
const projected=B.project([{batchId:'x',validationStatus:'valid',sourceAsOf:'2026-09-16',records:[{applicationId:'1',atlasName:'A',communityId:'A',mappingStatus:'mapped',applicationStatus:'Application: Approved',leaseId:'verified-lease',applicationApprovedOn:'2026-09-14',leaseSignedOn:'2026-09-15',moveInDate:'2026-09-25'}]}],['A']);
assert.equal(projected.records[0].applicationApproved,'2026-09-14');assert(projected.records[0].leaseSigned.startsWith('2026-09-15'));
const unjoined=B.project([{batchId:'unjoined',validationStatus:'valid',sourceAsOf:'2026-09-16',records:[{applicationId:'1',atlasName:'A',communityId:'A',mappingStatus:'mapped',applicationStatus:'Application: Approved',leaseSignedOn:'2026-09-15'}]}],['A']);assert.equal(unjoined.records[0].leaseSigned,'','Signing date without a verified lease identity is unavailable');assert.equal(projected.records[0].moveIn,'');
if(process.env.ATLAS_APPROVAL_FIXTURE){
const X=require(process.env.ATLAS_XLSX),w=X.read(fs.readFileSync(process.env.ATLAS_APPROVAL_FIXTURE),{type:'buffer',cellDates:true});const rows=X.utils.sheet_to_json(w.Sheets[w.SheetNames.find(n=>/Baymeadows/i.test(n))],{header:1,defval:''});const i=rows.findIndex(r=>r.includes('Application ID')),h=rows[i],value=(r,k)=>r[h.indexOf(k)];const actual=rows.slice(i+1).filter(r=>/Peacock/i.test(value(r,'Leasing Agent (Assigned)'))).map(r=>({applicationId:value(r,'Application ID'),property:'Baymeadows',leasingAgent:'Michelle',applicationStatus:value(r,'Application Status'),applicationCompleted:value(r,'Application Completed'),partialApplication:value(r,'Application Partially Completed'),sourceAsOf:'2026-05-08'}));const m=W.model({records:actual,communities:['Baymeadows'],end:'2026-09-17',period:'2026-09'});assert.equal(m.agents[0].leaseApproved,99);assert.equal(m.agents[0].approvals,null);assert.equal(m.agents[0].leases,null);assert.deepEqual(m.asOf,['2026-05-08']);console.log('PASS actual May Baymeadows source: Michelle 99 lease-approved records, no invented approval/signing dates.');}
console.log('PASS one/two-community expanded lists, 3+ collapsed tiles, individual dates, explicit signing provenance, and independent approval coverage.');
