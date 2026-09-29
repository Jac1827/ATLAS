import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {patchEconomicOccupancyBoundary,ECONOMIC_FUNCTIONS} from './economic-occupancy-compat.mjs';
const old=execFileSync('git',['show','origin/atlas-asset-releases:_atlas-assets/774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df/portfolio-operations-dashboard/index.html'],{encoding:'utf8',maxBuffer:10*1024*1024});
const current=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
const fn=(source,name)=>source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
test('retained host executes the shared close reader and exact governed presentation without replacing startup or source imports',()=>{
 const patched=patchEconomicOccupancyBoundary(old,current);
 for(const name of ECONOMIC_FUNCTIONS)assert.equal(fn(patched,name),fn(current,name),name+' forwards exact reviewed function');
 for(const name of ['queueAtlasFinancialScope','shiftAccountingPeriod','priorAccountingPeriods','resolveCommunityCommandCloseScope','communityCommandEconomicOccupancyLabel'])assert.equal(fn(patched,name),fn(current,name));
 for(const name of ['initializeAtlasDashboard','renderTab','getAtlasAccessProfile','atlasAccessDecision','queueAtlasStateWrite'])assert.equal(fn(patched,name),fn(old,name),'retains '+name);
 assert(fn(patched,'renderPortfolioScopedCommunityCommandTab').includes('data-closed-economic-state='));
 assert(!fn(patched,'renderPortfolioScopedCommunityCommandTab').includes('includeRecommendations:false'),'unrelated roster optimization remains unactivated');
 assert(!fn(patched,'dataImportApplyGroupedSnapshot').includes('month.economicOccupancyPct ='));
 assert.throws(()=>patchEconomicOccupancyBoundary(patched,current),/boundary changed|already composed/);
 assert.throws(()=>patchEconomicOccupancyBoundary(old.replace('function getAtlasClosedFinancialVersion(record, period) {','function changedReadBoundary(record, period) {'),current),/boundary changed/);
});
