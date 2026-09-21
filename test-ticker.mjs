import fs from "node:fs";
// ---- shims for the bits of worker.mjs the block leans on ----
const ATLAS_DLR_ALLOWED_ROLES = new Set(["admin","centra","executive","regional","community_manager","finance","viewer"]);
const ATLAS_DLR_MANUAL_RUN_ROLES = new Set(["admin","centra","executive","regional","finance"]);
const apiResponse = (data, init={}) => new Response(JSON.stringify(data), { status: init.status ?? 200, headers: { "content-type":"application/json", ...(init.headers||{}) } });
const noContent = () => new Response(null,{status:204});
const readJsonBody = async r => { try { return await r.json(); } catch { return null; } };
const jsonSafeError = e => String(e?.message || e);
const worker = fs.readFileSync("src/worker.mjs","utf8");
const src = worker.slice(worker.indexOf("/* ============================================================================\n   ATLAS ticker services"), worker.indexOf("\nexport default {"));
const mod = new Function("ATLAS_DLR_ALLOWED_ROLES","ATLAS_DLR_MANUAL_RUN_ROLES","apiResponse","noContent","readJsonBody","jsonSafeError",
  src + "\nreturn { parseFeed, decodeXmlText, announcementsDurableHandler, buildNewsPayload, sanitizeAnnouncementText, resolveAnnouncementExpiry, isAnnouncementActive };")
  (ATLAS_DLR_ALLOWED_ROLES, ATLAS_DLR_MANUAL_RUN_ROLES, apiResponse, noContent, readJsonBody, jsonSafeError);

let pass=0, fail=0;
const ok = (cond, label) => { cond ? pass++ : fail++; console.log((cond?"  ok   ":"  FAIL ")+label); };

// ---- 1. RSS 2.0 ----
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Multi-Housing News</title>
<item><title><![CDATA[Absorption posts 3rd straight gain &amp; rents hold]]></title><link>https://www.multihousingnews.com/a/</link><pubDate>Mon, 21 Sep 2026 13:00:00 GMT</pubDate></item>
<item><title>Second &#8217;story&#8217; with <b>markup</b></title><link>https://www.multihousingnews.com/b/?utm=x</link><pubDate>Sun, 20 Sep 2026 09:00:00 GMT</pubDate></item>
<item><title>No link item</title><pubDate>Sat, 19 Sep 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;
const r = mod.parseFeed(rss, "https://www.multihousingnews.com/feed/");
console.log("RSS 2.0");
ok(r.length===2, `2 items parsed (3rd dropped for missing link) → ${r.length}`);
ok(r[0].title==="Absorption posts 3rd straight gain & rents hold", `CDATA + &amp; decoded → "${r[0].title}"`);
ok(r[1].title==="Second ’story’ with markup", `numeric entity + tag strip → "${r[1].title}"`);
ok(r[0].source==="Multi-Housing News", `source from channel title → ${r[0].source}`);
ok(r[0].publishedAt==="2026-09-21T13:00:00.000Z", `pubDate → ISO ${r[0].publishedAt}`);

// ---- 2. Atom ----
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Multifamily Dive</title>
<entry><title>Southeast rent growth flat</title><link rel="self" href="https://x/self"/><link rel="alternate" href="https://www.multifamilydive.com/news/se-rent/"/><updated>2026-09-21T10:00:00Z</updated></entry>
<entry><title type="html">Concessions &lt;em&gt;widen&lt;/em&gt; in Jax</title><link href="https://www.multifamilydive.com/news/jax/"/><published>2026-09-20T10:00:00Z</published></entry>
</feed>`;
const a = mod.parseFeed(atom, "https://www.multifamilydive.com/feeds/news/");
console.log("Atom");
ok(a.length===2, `2 entries → ${a.length}`);
ok(a[0].link==="https://www.multifamilydive.com/news/se-rent/", `rel=alternate preferred over rel=self → ${a[0].link}`);
ok(a[1].title==="Concessions widen in Jax", `escaped html title cleaned → "${a[1].title}"`);
ok(a[1].link==="https://www.multifamilydive.com/news/jax/", `bare <link href> fallback → ${a[1].link}`);

// ---- 3. payload builder: dedupe + sort + failure isolation ----
globalThis.fetch = async (url) => {
  if (String(url).includes("multihousingnews")) return new Response(rss,{status:200});
  if (String(url).includes("multifamilydive")) return new Response(atom,{status:200});
  return new Response("nope",{status:503});
};
const payload = await mod.buildNewsPayload({ ATLAS_NEWS_FEEDS: "https://www.multihousingnews.com/feed/, https://www.multifamilydive.com/feeds/news/, https://dead.example/feed" });
console.log("buildNewsPayload");
ok(payload.ok===true, `ok despite one dead feed → ${payload.ok}`);
ok(payload.items.length===4, `4 unique items across 2 live feeds → ${payload.items.length}`);
ok(payload.failures.length===1 && payload.failures[0].feed.includes("dead.example"), `dead feed reported, not fatal → ${payload.failures[0]?.feed}`);
ok(payload.items[0].publishedAt >= payload.items[1].publishedAt, `sorted newest first → ${payload.items[0].publishedAt} ≥ ${payload.items[1].publishedAt}`);

// ---- 4. announcements DO: post, race, retract permissions ----
const store = new Map();
let chain = Promise.resolve();
const storage = {
  get: async k => store.get(k), put: async (k,v) => { store.set(k,v); },
  // models Durable Object storage.transaction(): closures run one at a time
  transaction(fn){ const run = chain.then(() => fn(storage)); chain = run.catch(()=>{}); return run; }
};
const call = (method, body, actor={email:"jac@risere.com",name:"Jac Heflin",role:"admin"}) =>
  mod.announcementsDurableHandler(new Request("https://w/api/announcements",{ method, headers:{ "content-type":"application/json","x-atlas-actor-email":actor.email,"x-atlas-actor-name":actor.name,"x-atlas-actor-role":actor.role }, body: method==="GET"?undefined:JSON.stringify(body) }), storage).then(r=>r.json());
console.log("announcements DO");
let res = await call("POST",{action:"post",text:"  Q4 budget worksheets due Friday  ", scope:"All communities"});
ok(res.ok && res.item.text==="Q4 budget worksheets due Friday", `post trims + stores → "${res.item?.text}"`);
ok(res.item.postedBy==="Jac Heflin" && res.item.postedByRole==="admin", `actor captured from headers → ${res.item?.postedBy} (${res.item?.postedByRole})`);
// two posters "at the same time" — sequential inside the single-threaded DO
const ashley={email:"ashley@risere.com",name:"Ashley Browne",role:"regional"};
await Promise.all([ call("POST",{action:"post",text:"A"},ashley), call("POST",{action:"post",text:"B"}) ]);
res = await call("GET");
ok(res.count===3, `concurrent posts both kept (no overwrite) → ${res.count} items`);
res = await call("POST",{action:"post",text:"   "});
ok(res.ok===false, `empty text rejected → ${res.error}`);
const long = await call("POST",{action:"post",text:"x".repeat(500)});
ok(long.item.text.length===280, `text capped at 280 → ${long.item.text.length}`);
const ashleyPost = (await call("GET")).items.find(i=>i.postedByEmail==="ashley@risere.com");
res = await call("POST",{action:"retract",id:ashleyPost.id},{email:"brianne@risere.com",name:"Brianne",role:"regional"});
ok(res.ok===false && /author or an ATLAS Admin/.test(res.error), `non-author regional cannot retract → 403`);
res = await call("POST",{action:"retract",id:ashleyPost.id},ashley);
ok(res.ok===true, `author can retract own post → removed`);
const jacPost = (await call("GET")).items.find(i=>i.postedByEmail==="jac@risere.com");
res = await call("POST",{action:"retract",id:jacPost.id},{email:"someone@risere.com",name:"S",role:"admin"});
ok(res.ok===true, `admin can retract anyone's post`);
res = await call("POST",{action:"retract",id:"nope"});
ok(res.ok===false && /not found/i.test(res.error), `unknown id → 404`);
res = await call("POST",{action:"explode"});
ok(res.ok===false && /Unknown action/.test(res.error), `unknown action rejected`);


// ---- 5. lifecycle: TTL, expiry, prune, edit ----
console.log("lifecycle");
const H = 3600*1000, T0 = Date.parse("2026-09-21T12:00:00Z");
ok(mod.resolveAnnouncementExpiry({}, T0) === new Date(T0+72*H).toISOString(), `no duration → default 72h`);
ok(mod.resolveAnnouncementExpiry({durationHours:24}, T0) === new Date(T0+24*H).toISOString(), `durationHours 24 honoured`);
ok(mod.resolveAnnouncementExpiry({durationHours:0}, T0) === null, `durationHours 0 → until retracted (null)`);
ok(mod.resolveAnnouncementExpiry({durationHours:999}, T0) === new Date(T0+72*H).toISOString(), `disallowed duration snaps to default`);
ok(mod.resolveAnnouncementExpiry({expiresAt:"2026-10-01T00:00:00Z"}, T0) === "2026-10-01T00:00:00.000Z", `explicit future expiresAt wins`);
ok(mod.resolveAnnouncementExpiry({expiresAt:"2020-01-01T00:00:00Z"}, T0) === new Date(T0+72*H).toISOString(), `explicit PAST expiresAt ignored → default`);

// seed: one expired, one live, one until-retracted
store.clear();
store.set("announcements", [
  { id:"old",  text:"Expired last week", postedByEmail:"jac@risere.com", createdAt:"2026-09-10T00:00:00Z", expiresAt:"2026-09-13T00:00:00Z" },
  { id:"live", text:"Runs another day",  postedByEmail:"ashley@risere.com", createdAt:"2026-09-20T00:00:00Z", expiresAt:new Date(Date.now()+24*H).toISOString() },
  { id:"pin",  text:"Until retracted",   postedByEmail:"jac@risere.com", createdAt:"2026-09-01T00:00:00Z", expiresAt:null },
]);
res = await call("GET");
ok(res.count===2 && !res.items.find(i=>i.id==="old"), `GET hides expired → ${res.items.map(i=>i.id).join(",")}`);
ok(res.items.every(i=>i.active===true), `active flag true on all returned`);
ok(res.defaultTtlHours===72 && res.allowedTtlHours.includes(336), `GET advertises defaults for the compose UI`);
const hist = await mod.announcementsDurableHandler(new Request("https://w/api/announcements?includeExpired=1",{headers:{"x-atlas-actor-role":"admin"}}), storage).then(r=>r.json());
ok(hist.count===3 && hist.items.find(i=>i.id==="old").active===false, `?includeExpired=1 returns history with active:false`);
ok(store.get("announcements").length===3, `read does NOT prune (storage still 3)`);
res = await call("POST",{action:"post",text:"Fresh post",durationHours:168});
ok(store.get("announcements").length===3 && !store.get("announcements").find(i=>i.id==="old"), `write prunes the expired one, adds the new → still 3`);
ok(res.item.expiresAt && Math.round((Date.parse(res.item.expiresAt)-Date.now())/H)===168, `posted with 1-week TTL`);

// edit
res = await call("POST",{action:"edit",id:"live",text:"Runs another day — updated"},{email:"brianne@risere.com",name:"Brianne",role:"regional"});
ok(res.ok===false && res.error.includes("author or an ATLAS Admin"), `non-author regional cannot edit → 403`);
res = await call("POST",{action:"edit",id:"live",text:"  Runs another day — updated  "},ashley);
ok(res.ok && res.item.text==="Runs another day — updated" && res.item.editedBy==="Ashley Browne", `author edits text, stamped editedBy`);
ok(Math.round((Date.parse(res.item.expiresAt)-Date.now())/H)===24, `edit without duration keeps original expiry`);
res = await call("POST",{action:"edit",id:"live",durationHours:336});
ok(res.ok && Math.round((Date.parse(res.item.expiresAt)-Date.now())/H)===336, `admin re-times to 2 weeks from now`);
res = await call("POST",{action:"edit",id:"pin",durationHours:0,scope:"Jacksonville region"});
ok(res.ok && res.item.expiresAt===null && res.item.scope==="Jacksonville region", `edit scope + keep until-retracted`);
res = await call("POST",{action:"edit",id:"live",text:"   "});
ok(res.ok===false, `edit to empty text rejected`);
res = await call("POST",{action:"edit",id:"old",text:"resurrect"});
ok(res.ok===false && /expired/.test(res.error), `cannot edit an expired post → 404`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
