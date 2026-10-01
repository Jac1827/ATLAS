// Exercise the additive export/driver migrations after both supported legacy
// and current governance installation orders. Never touch a remote database.
const fs=require('node:fs'),path=require('node:path'),originalRead=fs.readFileSync;
const read=name=>originalRead.call(fs,path.join(__dirname,'../supabase/migrations',name),'utf8');
const additions='\n'+read('20260929154018_budget_export_integrity_history.sql')+'\n'+read('20260929154033_budget_leasing_driver_authority.sql');
fs.readFileSync=function(file,...args){const contents=originalRead.call(this,file,...args);return String(file).endsWith('/supabase/migrations/20260925174317_shared_str_programme_draft_versions.sql')?contents+additions:contents;};
require('./budget-workflow-combined-db.test.cjs');
