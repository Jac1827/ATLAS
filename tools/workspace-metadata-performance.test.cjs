const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const extract=name=>core.match(new RegExp('^function '+name+'\\([^]*?^\\}','m'))[0];
const c=vm.createContext({console});
vm.runInContext(`
let atlasHomeRenderDetails=null,summaryCalls=0,recommendationCalls=0;
const savedData={Allowed:{region:'East'},Denied:{region:'West'},Empty:null};
const getProp=()=>({name:'Selected'}),getCommunityNamesByStatusScope=()=>['Allowed','Denied','Empty','Unsaved','Selected'];
const atlasDashboardUserCanSeeCommunityName=name=>name!=='Denied';
const getAtlasSharedPropertyByName=()=>null;
function atlasHomePortfolioDetails(){throw Error('Metadata selector calculated operating summaries');}
function normalizeSavedCommunityRecord(name,record){return record;}
const getPropertyByName=name=>({name,units:100}),getResolvedTotalUnitsForRecord=()=>100,getCorporateLeaseUnitsForRecord=()=>2;
const getRecordMonthlyDataForYear=record=>record.monthlyData;
const getRecordComparableSnapshotUnits=(record,total,month,key)=>record.monthlyData[month][key]??0;
function getCommunitySummary(name,record){summaryCalls++;return {name,occupied:record.currentOccupied,leased:record.currentLeased};}
function buildRecommendationsForRecord(){recommendationCalls++;return ['same advice'];}
${extract('getAtlasDashboardAuthorizedCommunityOptions')}
${extract('buildCommunityDetailForMonth')}
`,c);
const run=code=>vm.runInContext(code,c),plain=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(run('getAtlasDashboardAuthorizedCommunityOptions().map(row=>row.name)')),['Allowed','Selected'],'Saved and current authorized communities are retained; denied, empty and unrelated roster entries are excluded without calculations');
run(`const record={reportYear:2026,monthlyData:[{occupiedSnapshot:0,leasedSnapshot:null},{occupiedSnapshot:80,leasedSnapshot:90}]};
const full=buildCommunityDetailForMonth('Allowed',record,1,2026);
const metadata=buildCommunityDetailForMonth('Allowed',record,1,2026,{includeSummary:false,includeRecommendations:false});`);
assert.deepEqual(plain(run('metadata.record')),plain(run('full.record')),'Command receives the identical period-scoped normalized source record');
assert.equal(run('summaryCalls'),1,'Metadata preparation does not duplicate Command summary calculations');
assert.equal(run('recommendationCalls'),1,'Metadata preparation omits unused recommendations');
assert.deepEqual(plain(run('metadata.record.monthlyData[0]')),{occupiedSnapshot:0,leasedSnapshot:null});
assert.deepEqual(plain(run('full.summary')),{name:'Allowed',occupied:82,leased:92});
assert.deepEqual(plain(run('full.recommendations')),['same advice']);
assert.equal(run('metadata.summary'),null);
console.log('PASS authorized community metadata performs no portfolio calculations; Command retains identical scoped records and default consumers retain their summaries/advice');
