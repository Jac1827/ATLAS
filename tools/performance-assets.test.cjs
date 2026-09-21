const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='docs/portfolio-operations-dashboard/';
const html=fs.readFileSync(root+'index.html','utf8');
const manifest=JSON.parse(fs.readFileSync(root+'performance/asset-manifest.json'));
for(const [asset,info] of Object.entries(manifest)){
 const bytes=fs.readFileSync(root+asset);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16),info.sha256,asset+' needs a new cache key');
 for(const [file,reference] of info.references)assert(fs.readFileSync(root+file,'utf8').includes(reference+'?v='+info.sha256),file+' needs refreshed references');
}
const eager=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
assert(!eager.some(src=>/leaflet|pdf\.min|pptxgen|jszip/.test(src)),'Feature dependencies must not reenter the shell');
// This is a no-growth guard against the verified head, not an accepted startup budget.
assert(Buffer.byteLength(html)<=3387363,'Initial HTML exceeded the verified-head ceiling');
assert(!html.includes('pptx.addSlide('), 'Slide generation must not be duplicated inline');
console.log('PASS content-derived asset keys, lazy dependency boundary and provisional no-growth ceiling');
