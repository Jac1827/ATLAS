/* Atlas central runtime config template.
   Copy this file to atlas-central-config.js in the hosted build process or set
   window.ATLAS_CENTRAL_CONFIG before atlas-central-client.js loads.

   Browser-safe only:
   - Supabase URL is public.
   - Supabase publishable / anon key is public and protected by RLS.
   - Never use a service-role key in browser code.
*/
window.ATLAS_CENTRAL_CONFIG = {
  enabled: true,
  provider: "supabase-postgres",
  appBaseUrl: "https://jac1827.github.io/ATLAS/portfolio-operations-dashboard/index.html",
  supabaseUrl: "https://rmyhmvjcswfwaracgriy.supabase.co",
  supabaseAnonKey: "sb_publishable_2DEqeCNZFn6sNeVrSEfW8A_EI6tRb_1",
  documentKey: "atlas_dashboard_state_v1",
  realtime: false,
  autosave: false,
  autoPullOnStartup: false,
  allowMagicLinkSignup: false,
  allowedEmailDomains: ["risere.com", "riseresidential.com"]
};
