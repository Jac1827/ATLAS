const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/portfolio-operations-dashboard/workspace-core.js'), 'utf8');
const match = source.match(/^function atlasExactPresentationInputString\([^]*?^\}/m);
assert.ok(match, 'The actual presentation input serializer must exist');
const key = new Function('return (' + match[0] + ')')();

// An independent typed tree is a reference for equality, not the optimized
// serializer's delimiter/path encoding. Preserve JSON-visible property order.
function reference(value, ancestry = new Set()) {
  if (value === undefined) return ['undefined'];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (value === null || typeof value !== 'object') return [typeof value, value];
  assert.ok(!ancestry.has(value));
  const next = new Set(ancestry).add(value);
  if (Array.isArray(value)) return ['array', Array.from({length:value.length}, (_, i) => Object.hasOwn(value, i) ? reference(value[i], next) : ['hole'])];
  return ['object', Object.keys(value).map(name => [name, reference(value[name], next)])];
}
const values = [null, undefined, NaN, Infinity, -Infinity, -0, 0, 1, false, true, '', '0', 'NaN', [], {},
  {a:undefined}, {a:null}, {b:undefined}, [undefined], [null], Array(1), [NaN], [-0],
  [undefined, null], [null, undefined], [undefined, , null], [, undefined, null],
  {'':undefined}, {'0':undefined}, {'a.b':undefined}, {a:{b:undefined}},
  {'["a"]':undefined}, {'\u0000':-0}, {text:'12:[null][[["a"],"undefined"]]'},
  Object.assign(Object.create(null), {a:1, b:undefined})];
const alias = {a:undefined, nested:[NaN, , -0]};
values.push({first:alias, second:alias}, {first:{a:undefined,nested:[NaN, , -0]}, second:{a:undefined,nested:[NaN, , -0]}});
// Deterministic varied shapes expose shifted paths, escaping and frame boundaries.
for (let i = 0; i < 80; i++) values.push({['key:' + i + '\"\\']: [values[i % 15], {value:values[(i * 7) % 15]}], ordinal:i});
for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) {
  assert.equal(key(values[i]) === key(values[j]), JSON.stringify(reference(values[i])) === JSON.stringify(reference(values[j])), `Exact equality ${i}/${j}`);
}
const shared = {x:undefined};
const before = key({left:shared,right:shared});
shared.x = null;
assert.notEqual(key({left:shared,right:shared}), before, 'Aliased leaf edits invalidate the key');
assert.equal(key({a:1,b:undefined}), key(Object.assign(Object.create(null), {a:1,b:undefined})), 'Plain and null-prototype records with identical fields are equivalent');
const cycle = {}; cycle.self = cycle;
const arrayCycle = []; arrayCycle.push(arrayCycle);
class NonPlain { constructor() { this.x = 1; } }
class NonPlainArray extends Array {}
for (const value of [cycle, arrayCycle, new Date(), new Map(), new Set(), /x/, new Uint8Array(1), new Number(1), new String('x'), new Boolean(false), new NonPlain(), new NonPlainArray(1), {toJSON(){return {x:1};}}, {toJSON(){return this;}}, () => {}, Symbol('x'), 1n]) {
  assert.throws(() => key(value), undefined, 'Unsupported values must refuse cache reuse');
}
for (const value of [() => {}, Symbol('x'), 1n, new Date()]) assert.throws(() => key({nested:[value]}));
const accessor = {}; Object.defineProperty(accessor,'changing',{enumerable:true,get:()=>({x:1})});
assert.throws(() => key(accessor), /Non-plain/, 'Object-valued unstable accessors must refuse cache reuse');
console.log('PASS exact presentation keys preserve exceptional numbers, null/undefined/missing, sparse arrays, aliases, escaped paths and framing; cycles/nonplain/unsupported values fail closed.');
