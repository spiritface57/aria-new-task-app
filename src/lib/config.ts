// Values come from Vite env vars at build time (see .env.example).
// All of them are public by design: never put a secret or service-role key here.
const env = import.meta.env;

export const config = {
  supabaseUrl: env.VITE_SUPABASE_URL ?? '',
  // Supabase now calls this the "publishable" key; accept either name.
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  vapidPublicKey: env.VITE_VAPID_PUBLIC_KEY ?? '',
  turnstileSiteKey: env.VITE_TURNSTILE_SITE_KEY ?? '',
};

/** Variable names exactly as they must be set in .env or the host's build settings. */
const REQUIRED = {
  VITE_SUPABASE_URL: config.supabaseUrl,
  VITE_SUPABASE_ANON_KEY: config.supabaseAnonKey,
  VITE_VAPID_PUBLIC_KEY: config.vapidPublicKey,
};

export const missingConfig = Object.entries(REQUIRED).filter(([, v]) => !v).map(([k]) => k);
