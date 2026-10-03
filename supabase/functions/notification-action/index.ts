// Supabase Edge Function: the "Done ✓" and "In 10 min" buttons on a reminder.
// Deploy with "Verify JWT" OFF. The phone's service worker calls it with the
// one-time token from the notification; the token is the only authorisation.
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
};

const db = createClient(env('SUPABASE_URL'),
  Deno.env.get('SERVICE_ROLE_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const body = await req.json().catch(() => null) as { token?: unknown; action?: unknown } | null;
  const token = body?.token, action = body?.action;
  if (typeof token !== 'string' || token.length > 100 || (action !== 'done' && action !== 'snooze')) {
    return Response.json({ result: 'invalid' }, { status: 400, headers: cors });
  }
  const { data, error } = await db.rpc('use_reminder_token', { p_token: token, p_action: action });
  if (error) {
    console.error(error.message);
    // e.g. the task was deleted meanwhile: let the phone open the app instead.
    return Response.json({ result: 'open_app' }, { status: 200, headers: cors });
  }
  return Response.json({ result: data }, { status: 200, headers: cors });
});
