/* Atlas central runtime config template.
   Copy this file to atlas-central-config.js in the hosted build process or set
   window.ATLAS_CENTRAL_CONFIG before atlas-central-client.js loads.

   Browser-safe only:
   - Supabase URL is public.
   - Supabase anon key is public and protected by RLS.
   - Never use a service-role key in browser code.
*/
window.ATLAS_CENTRAL_CONFIG = {
  enabled: true,
  provider: "supabase-postgres",
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
  documentKey: "atlas_dashboard_state_v1",
  realtime: false,
  autosave: false,
  autoPullOnStartup: false,
  allowedEmailDomains: ["riseresidential.com"]
};
