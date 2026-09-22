import assert from 'node:assert/strict';
import {publishPackage} from '../docs/portfolio-operations-dashboard/features/financial-package-batch.mjs';
const item={communityId:'community',certificate:{technicalReconciled:true,exceptions:[],metadata:{period:'2026-08',basis:'accrual'},sourceHash:'abc'}};
let writes=0;const central={fetchJson:async path=>path.includes('heads')?[{version_id:'v'}]:[{source_hash:'other'}],rpc:()=>{writes++;}};
await assert.rejects(publishPackage(central,item,{reason:'Approved package',accountingApproved:true}),/different closed source/);
assert.equal(writes,0);
await assert.rejects(publishPackage(central,{...item,certificate:{...item.certificate,exceptions:[{code:'reconciliation'}]}},{}),/Resolve extraction/);
assert.equal(writes,0);
console.log('Batch publication preserves existing closes and rejects unresolved sources.');
