import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the production pure renderers without requiring the browser store.
const source=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/features/str-ltr-comparison-ui.mjs',import.meta.url),'utf8');
const context=vm.createContext({structuredClone});
vm.runInContext(source.slice(source.indexOf('const clone='),source.indexOf('export function installStrLtrComparison'))+'\nglobalThis.renderers={bars,waterfall,floorChart};',context);
const {bars,waterfall,floorChart}=context.renderers;
function elements(markup,tag){return [...markup.matchAll(new RegExp(`<${tag}\\b([^>]*)>`,'g'))].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(pair=>[pair[1],pair[2]])));}
function rects(markup){return elements(markup,'rect').map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,['x','y','width','height'].includes(key)?Number(value):value])));}
function inBounds(markup){
 const bounds=markup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);assert(bounds,'Rendered chart has dimensions');
 const width=Number(bounds[1]),height=Number(bounds[2]);
 for(const rect of rects(markup)) {for(const key of ['x','y','width','height'])assert(Number.isFinite(rect[key]),`${key} finite`);assert(rect.x>=0&&rect.y>=0&&rect.width>=0&&rect.height>=0);assert(rect.x+rect.width<=width+.001,'Bars fit horizontal viewBox');assert(rect.y+rect.height<=height+.001,'Bars fit vertical viewBox');}
 for(const text of elements(markup,'text')) assert(Number(text.x)>=0&&Number(text.x)<=width&&Number(text.y)>=0&&Number(text.y)<=height,'Labels remain in the chart');
 assert(!/NaN|Infinity/.test(markup));
}
const comparison=(ltr,str)=>({mode:'budget',monthly:[{period:'2026-10'}],totals:{ltr,str}});
const peak=comparison({income:150000,expenses:50000,noi:100000},{income:250000,expenses:150000,noi:100000});
const peakSvg=waterfall(peak);inBounds(peakSvg);
const peakBars=rects(peakSvg);assert(peakBars[1].y<peakBars[0].y,'Income step reaches the cumulative 200k endpoint');assert(peakBars[1].y>=40,'Cumulative maximum leaves readable label margin');
assert(peakSvg.includes('+$100,000'),'Positive bridge changes have explicit plus signs');assert(peakSvg.includes('-$100,000'),'Cost increases show negative NOI impact');
const negative=comparison({income:10000,expenses:160000,noi:-150000},{income:20000,expenses:120000,noi:-100000});
const negativeSvg=waterfall(negative);inBounds(negativeSvg);assert(negativeSvg.includes('-$150,000'));assert(rects(negativeSvg).every(row=>row.y+row.height<=192.001),'Negative cumulative steps fit the signed scale');
const crossing=comparison({income:40000,expenses:90000,noi:-50000},{income:200000,expenses:10000,noi:190000});inBounds(waterfall(crossing));
const zero=comparison({income:0,expenses:0,noi:0},{income:0,expenses:0,noi:0});inBounds(waterfall(zero));assert(rects(waterfall(zero)).every(row=>row.height===0),'Zero changes have no fictitious minimum-height bars');
assert(waterfall(comparison({income:0,expenses:0,noi:0},{income:1,expenses:null,noi:null})).includes('unavailable'),'Incomplete waterfall stays visibly unavailable');

const barSvg=bars({...negative,mode:'performance',totals:{...negative.totals,actual:{income:30000,expenses:35000,noi:-5000}}});inBounds(barSvg);
const zeroX=Number(elements(barSvg,'line')[0].x1),barRects=rects(barSvg);assert.equal(barRects.length,9,'Performance includes budget, LTR and actual bars');
for(const index of [0,1,2,3,4,5]) assert.equal(barRects[index].x,zeroX,'Positive income and expense amounts extend right');
for(const index of [6,7,8]){assert(barRects[index].x<zeroX,'Negative NOI extends left');assert(Math.abs(barRects[index].x+barRects[index].width-zeroX)<.001);}
assert(elements(barSvg,'text').filter(row=>row.x==='590').every(row=>row['text-anchor']==='end'),'Values occupy a fixed label column outside bars');
inBounds(bars(zero));inBounds(bars({monthly:[{period:'2026-10'}],totals:{str:{income:null,expenses:null,noi:null},ltr:{}}}));

const floorSvg=floorChart({monthly:[{period:'2026-10'}],floorPlans:[{code:'A1',units:3,difference:{noi:-20000}},{code:'B1',units:2,difference:{noi:10000}},{code:'C1',units:1,difference:{noi:null}},{code:'D1',units:1,difference:{noi:0}}]});inBounds(floorSvg);
const floorZero=Number(elements(floorSvg,'line')[0].x1),floorRects=rects(floorSvg);assert(floorRects[0].x<floorZero);assert.equal(floorRects[1].x,floorZero);assert.equal(floorRects[2].width,0);assert.equal(floorRects[3].width,0);
assert(floorSvg.includes('A1 · 3 units'));assert(floorSvg.includes('+$10,000'));assert(floorSvg.includes('-$20,000'));assert(floorSvg.includes('Unavailable'));assert(floorSvg.includes('selected quantities and dates'));
inBounds(floorChart({monthly:[{period:'2026-10'}],floorPlans:[]}));
assert(bars({monthly:[],totals:{}}).includes('No comparable recorded months'));assert(floorChart({monthly:[],floorPlans:[]}).includes('requires a comparable reporting period'));
console.log('PASS signed chart scales, cumulative waterfall extremes, negative and zero NOI, positive/negative labels, fixed value columns, quantities, missing data and performance series.');
