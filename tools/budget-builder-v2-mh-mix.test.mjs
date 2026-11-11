// Budget Builder v2: manufactured housing rate mix (pad only vs home + pad). Synthetic data only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const F = '../docs/portfolio-operations-dashboard/features/budget-v2/';
const E = await import(F + 'engine.mjs'), SC = await import(F + 'scratch.mjs'), X = await import(F + 'export.mjs');
const XLSX = require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const periods = E.fiscalPeriods(2027, 1);
const rateMix = [{key: 'pad', label: 'Pad only (lot rent)', units: 150, rent: 600}, {key: 'home', label: 'Home + pad rental', units: 40, rent: 1300}];
const m = SC.suggestStart({name: 'Test Pines', assetClass: 'manufactured', rateMix, address: {state: 'FL'}, fiscalYear: 2027, periods, status: 'operating'});
assert.equal(m.property.units, 190);
const r = E.calculate(m);
assert.equal(Math.round(r.rows['5120'].annual), (150 * 600 + 40 * 1300) * 12, 'GPR is each type × its rent');
assert.equal(r.context.mix.length, 2); assert.equal(r.context.mix[1].gprM, 40 * 1300);
assert(m.lines.find(l => l.gl === '5120').suggestion.includes('40 home + pad rental × $1,300'));
for (const l of m.lines) { const x = r.rows[l.gl]; if (x.type !== 'payroll') assert(Math.abs(x.annual - l.proposal.total) <= 1, l.gl + ' starts at its suggestion'); }
// Rental homes add interior upkeep and turns compared with an all-pad community.
const allPad = SC.suggestStart({name: 'Test Pines', assetClass: 'manufactured', rateMix: [{...rateMix[0], units: 190}, {...rateMix[1], units: 0}], address: {state: 'FL'}, fiscalYear: 2027, periods, status: 'operating'});
assert(m.lines.find(l => l.gl === '6560').proposal.total > allPad.lines.find(l => l.gl === '6560').proposal.total);
assert(m.schedule.moveOuts.reduce((a, b) => a + b, 0) > allPad.schedule.moveOuts.reduce((a, b) => a + b, 0));
// Changing one rate moves GPR, vacancy and the management fee.
const raised = structuredClone(m); raised.rateMix[1].rent = 1400;
const r2 = E.calculate(raised);
assert.equal(Math.round(r2.rows['5120'].annual - r.rows['5120'].annual), 40 * 100 * 12);
assert(r2.rows['6320'].annual > r.rows['6320'].annual);
// Rent growth applies to both rates.
const grown = E.calculate({...m, assumptions: {...m.assumptions, rentGrowth: 10}});
assert.equal(Math.round(grown.rows['5120'].annual), Math.round((150 * 600 + 40 * 1300) * 1.1 * 12));
// Not manufactured: the mix is ignored.
assert.equal(E.rateMixOf({...m, property: {...m.property, assetClass: 'conventional'}}), null);
// A draft frozen before the mix existed still moves when the mix is added.
const old = {...structuredClone(m), rateMix: null}; old.base = E.freezeBase(old); old.rateMix = rateMix.map(x => ({...x}));
old.rateMix[1].rent = 1500;
assert(E.calculate(old).rows['5120'].annual > E.calculate({...old, rateMix: null}).rows['5120'].annual);
// Export carries the mix.
const wb = XLSX.read(X.reportWorkbook(X.propertyReport({model: m, result: r, draft: {name: 'Test Pines FY2027', status: 'gm_draft'}}), XLSX), {type: 'array'});
assert(wb.SheetNames.includes('Rate mix'));
console.log('PASS Budget Builder v2 manufactured housing rate mix: pad-only and home + pad rates, drivers, starting point and export');
