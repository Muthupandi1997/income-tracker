// ─────────────────────────────────────────────────────────────
//  Supabase connection settings
//  Supabase Dashboard → Project Settings → API
//    • Project URL  → SUPABASE_URL
//    • anon public  → SUPABASE_ANON_KEY
//  The anon key is safe to publish: Row Level Security (see
//  supabase/schema.sql) ensures each user only sees their own rows.
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  SUPABASE_URL: "https://hmcvbkhkmwbvopabvymn.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtY3Zia2hrbXdidm9wYWJ2eW1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MTYwNjcsImV4cCI6MjEwNTk5MjA2N30.RuCGaD2k4UMk-g1CyooP4LX0X4jMUsY3IlOmnQTEpjE",
};
