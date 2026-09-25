// Rerun the complete legacy roster/rate acceptance matrix after installing the
// separate saved-programme type. No existing STR validation may be bypassed.
const fs=require('node:fs'),path=require('node:path'),originalRead=fs.readFileSync;
const read=name=>originalRead.call(fs,path.join(__dirname,'../supabase/migrations',name),'utf8');
const addon="\ndrop function atlas_private.resolve_workbook_audit(jsonb,text);\n"+read('20260924121647_immutable_workbook_audits_and_monthly_governance.sql').split('alter function atlas_private.finance_intake_validation')[0]+read('20260924235553_reforecast_active_import_close_scope.sql')+read('20260925012933_reforecast_atomic_create_from_import.sql')+read('20260925020222_reforecast_saved_json_str_programme.sql');
fs.readFileSync=function(file,...args){const data=originalRead.call(this,file,...args);return String(file).endsWith('/centralization/reforecast-str-overlay.sql')?data+addon:data;};
require('./reforecast-str-overlay-db.test.cjs');
