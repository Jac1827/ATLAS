// Exercise the complete established numeric parity matrix against the newest
// import-aware calculator, without changing the historical fixture's workflows.
const fs=require('node:fs'),path=require('node:path');
const fixtures=require('./reforecast-fixture.cjs'),originalFixture=fixtures.fixture;
fixtures.fixture=async(...args)=>{
 const context=await originalFixture(...args);
 const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260925012933_reforecast_atomic_create_from_import.sql'),'utf8');
 const start=migration.indexOf('create function atlas_private.reforecast_original_absence_disposition('),end=migration.indexOf('create function atlas_private.read_reforecast_import_receipt(');
 if(start<0||end<=start)throw Error('Current import calculator definitions are unavailable');
 await context.db.exec('reset role');await context.db.exec(migration.slice(start,end));await context.signIn(1);
 return context;
};
require('./reforecast-parity.test.cjs');
