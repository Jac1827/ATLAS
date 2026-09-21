const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create schema atlas_private;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,atlas_private to authenticated;grant execute on function auth.uid() to authenticated;
 create table atlas_user_profiles(user_id uuid,role text,status text,locked_tab_ids text[],locked_page_keys text[],allowed_community_ids uuid[]);
 create table atlas_communities(community_id uuid primary key,display_name text,canonical_name text,deleted_at timestamptz);
 create table atlas_community_aliases(community_id uuid,alias text,active boolean,source_module text);
 create function atlas_can_access_community(id uuid) returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from atlas_user_profiles where user_id=auth.uid() and status='active' and (role='admin' or id=any(allowed_community_ids))) $$;
 insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
 insert into atlas_user_profiles values('00000000-0000-0000-0000-000000000001','admin','active','{}','{}','{}'),('00000000-0000-0000-0000-000000000002','community_manager','active','{}','{}','{10000000-0000-0000-0000-000000000002}');
 insert into atlas_communities values('10000000-0000-0000-0000-000000000001','The Preserve at Tech','the preserve at tech',null),('10000000-0000-0000-0000-000000000002','Other','other',null);`);
 await db.exec(fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/centralization/financial-package-review.sql','utf8'));
 const signIn=async n=>db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-0000-0000-${String(n).padStart(12,'0')}';set role authenticated;`);
 const cid='10000000-0000-0000-0000-000000000001';
 const certificate={schemaVersion:1,sourceFile:'approved.pdf',sourceHash:'a'.repeat(64),metadata:{sourceProperty:'Ruston',period:'2026-08',basis:'accrual'},status:'Published',publicationStatus:'Published',rows:[{kind:'posting',glCode:'5120',accountName:'GPR',values:{actual:0,budget:null,ytdActual:0,ytdBudget:null,annualBudget:null},source:{page:3}}]};
 const save=async(c=certificate,community=cid)=>(await db.query('select * from atlas_save_financial_package_review($1,$2::jsonb)',[community,JSON.stringify(c)])).rows[0];
 await signIn(1);const record=await save();assert.equal(record.status,'Import Review');assert.equal(record.certificate.publicationStatus,'Not published');assert.equal(record.certificate.serverCloseValidated,false);assert.equal(record.certificate.rows[0].values.actual,0);assert.equal(record.certificate.rows[0].values.budget,null);
 assert.equal((await save()).review_id,record.review_id);
 await assert.rejects(()=>db.query('delete from atlas_financial_package_reviews'),/permission denied/);
 await assert.rejects(()=>save({...certificate,metadata:{...certificate.metadata,sourceProperty:'Other'}}),/approved alias/);
 await assert.rejects(()=>save({...certificate,rows:[...certificate.rows,...certificate.rows]}),/duplicate/);
 await db.exec('reset role');await db.exec(fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/centralization/financial-comparisons.sql','utf8'));await signIn(1);
 const values=n=>({actual:n,budget:n,ytdActual:n,ytdBudget:n,annualBudget:n});
 const line=(kind,glCode,accountName,n)=>({kind,glCode,accountName,values:values(n),source:{page:3}});
 const reconciled={...certificate,sourceHash:'b'.repeat(64),exceptions:[],rows:[line('posting','5120','GPR',100),line('control',null,'Total Income',100),line('posting','6461','Expenses',40),line('control',null,'Net Operating Income',60)]};
 const good=await save(reconciled);
 const apply=async(id,expected=null,reason=null)=>(await db.query('select * from atlas_apply_financial_comparison($1,$2,$3)',[id,expected,reason])).rows[0];
 const applied=await apply(good.review_id);assert.equal(applied.row_count,2);assert.equal(applied.status,'Reviewed — not closed');
 assert.equal((await apply(good.review_id)).version_id,applied.version_id);
 const duplicate=await save({...reconciled,sourceHash:'c'.repeat(64),sourceFile:'same.xlsx'});assert.equal((await apply(duplicate.review_id)).version_id,applied.version_id,'PDF/XLSX same rows must not duplicate actuals');
 const malformed=structuredClone(reconciled);malformed.sourceHash='d'.repeat(64);malformed.rows[0].values.actual=101;const bad=await save(malformed);await assert.rejects(()=>apply(bad.review_id,applied.version_id,'test replacement'),/reconciliation/);
 const changed=structuredClone(reconciled);changed.sourceHash='e'.repeat(64);changed.rows[0].values=values(110);changed.rows[1].values=values(110);changed.rows[3].values=values(70);const newer=await save(changed);
 await assert.rejects(()=>apply(newer.review_id),/another session/);await assert.rejects(()=>apply(newer.review_id,applied.version_id),/reason/);
 const replaced=await apply(newer.review_id,applied.version_id,'Corrected reviewed source');assert.equal(replaced.previous_version_id,applied.version_id);
 assert.equal((await db.query('select count(*)::int n from atlas_financial_comparison_rows where version_id=$1',[applied.version_id])).rows[0].n,2);
 await assert.rejects(()=>db.query('delete from atlas_financial_comparison_versions'),/permission denied/);
 if(process.env.ATLAS_FINANCIAL_EVIDENCE){
  const fixtures=JSON.parse(fs.readFileSync(process.env.ATLAS_FINANCIAL_EVIDENCE,'utf8')).results, communities=new Map();
  for(const fixture of fixtures){
   const name=fixture.metadata.sourceProperty;
   if(!communities.has(name)){await db.exec('reset role');const c=(await db.query('insert into atlas_communities(community_id,display_name,canonical_name) values(gen_random_uuid(),$1,$2) returning community_id',[name,name.toLowerCase()])).rows[0];communities.set(name,c.community_id);await signIn(1);}
   const r=await save({...fixture,sourceFile:fixture.file,sourceHash:fixture.sha256},communities.get(name));const a=await apply(r.review_id);
   assert.equal(a.row_count,fixture.rows.filter(r=>r.kind==='posting').length);
   const count=(await db.query('select count(*)::int n from atlas_financial_comparison_rows where version_id=$1',[a.version_id])).rows[0].n;assert.equal(count,a.row_count);
  }
  console.log('PASS all supplied package rows independently reconciled and read back in PostgreSQL');
 }

 await db.exec('reset role');await db.exec(fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/centralization/financial-close.sql','utf8'));await signIn(1);
 const close=async(id,expected=null,approved=true)=>(await db.query('select * from atlas_close_financial_review($1,$2,$3,$4)',[id,expected,'Source package reviewed and reconciled',approved])).rows[0];
 const closeCertificate=structuredClone(changed);closeCertificate.sourceHash='f'.repeat(64);closeCertificate.rows.splice(1,0,line('control',null,'Net Rental Income',110));closeCertificate.rows.push(line('control',null,'Net Cash Flow',70));closeCertificate.rows[0].source={page:7};
 const closeReview=await save(closeCertificate);
 await assert.rejects(()=>close(closeReview.review_id,null,false),/approval confirmation/);
 const closed=await close(closeReview.review_id);assert.equal(closed.metrics.grossPotentialRent,110);assert.equal(closed.metrics.netRentalIncome,110);assert.equal(closed.status,'closed');assert.equal((await db.query(`select source_location from atlas_financial_close_rows where version_id=$1 and gl_code='5120'`,[closed.version_id])).rows[0].source_location.page,7,'Close lineage follows selected source, not an equivalent prior comparison file');
 assert.equal((await close(closeReview.review_id)).version_id,closed.version_id);
 const correction=structuredClone(closeCertificate);correction.sourceHash='1'.repeat(64);correction.rows[0].values=values(120);correction.rows[1].values=values(120);correction.rows[2].values=values(120);correction.rows[4].values=values(80);correction.rows[5].values=values(80);
 const correctionReview=await save(correction);await assert.rejects(()=>close(correctionReview.review_id),/another session/);
 const corrected=await close(correctionReview.review_id,closed.version_id);assert.equal(corrected.revision,2);assert.equal(corrected.previous_version_id,closed.version_id);
 assert.equal((await db.query(`select actual from atlas_financial_close_rows where version_id=$1 and gl_code='5120'`,[closed.version_id])).rows[0].actual,'110');
 const invalidCash=structuredClone(correction);invalidCash.sourceHash='2'.repeat(64);invalidCash.rows[5].values.actual=999;const invalidCashReview=await save(invalidCash);await assert.rejects(()=>close(invalidCashReview.review_id,corrected.version_id),/Cash flow reconciliation/);
 const zeroClose=structuredClone(closeCertificate);zeroClose.sourceHash='3'.repeat(64);zeroClose.metadata.period='2026-07';zeroClose.rows.forEach(r=>r.values=values(0));const zeroReview=await save(zeroClose);const closedZero=await close(zeroReview.review_id);assert.equal(closedZero.metrics.netRentalIncome,0);assert.equal(closedZero.metrics.grossPotentialRent,0);
 await assert.rejects(()=>db.query('delete from atlas_financial_close_versions'),/permission denied/);
 await signIn(2);assert.equal((await db.query('select * from atlas_financial_close_versions')).rows.length,0);await assert.rejects(()=>close(closeReview.review_id),/Only an active Admin/);await signIn(1);
 console.log('PASS Admin close, independent reconciliation, explicit confirmation, idempotency, correction history and authorization');
 await signIn(2);assert.equal((await db.query('select * from atlas_financial_comparison_rows')).rows.length,0);await assert.rejects(()=>apply(good.review_id),/access denied/);await signIn(1);
 await signIn(2);assert.equal((await db.query('select * from atlas_financial_package_reviews')).rows.length,0);await assert.rejects(()=>save(),/access denied/);
 await db.exec("reset role;update atlas_user_profiles set locked_page_keys='{budget}' where role='admin'");await signIn(1);assert.equal((await db.query('select * from atlas_financial_package_reviews')).rows.length,0);await assert.rejects(()=>save(),/access denied/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select * from atlas_financial_package_reviews'),/permission denied/);
 await db.close();console.log('PASS immutable scoped intake, idempotency, source aliases, missing/zero and no client-side financial promotion');
})().catch(e=>{console.error(e);process.exitCode=1;});
