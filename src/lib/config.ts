// Values come from Vite env vars at build time (see .env.example).
// All of them are public by design: never put a secret or service-role key here.
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
};

export const missingConfig = (['supabaseUrl', 'supabaseAnonKey', 'vapidPublicKey'] as const)
  .filter((k) => !config[k]);
