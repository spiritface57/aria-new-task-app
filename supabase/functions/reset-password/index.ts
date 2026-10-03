// Supabase Edge Function: reset a forgotten password with a recovery code.
// Deploy with:  supabase functions deploy reset-password --no-verify-jwt
// (called by signed-out users, so there is no JWT to verify).
//
// Brute force is not a practical threat: codes carry 128 random bits, and a
// wrong email and a wrong code produce the same response.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resetPassword } from './reset.ts';

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
};

const db = createClient(env('SUPABASE_URL'),
  Deno.env.get('SERVICE_ROLE_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } });

// Set APP_ORIGIN to your site (e.g. https://family-tasks.pages.dev) to restrict callers.
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  try {
    const input = await req.json().catch(() => null);
    const outcome = await resetPassword(input, {
      findUser: async (email, code) =>
        check<string | null>(await db.rpc('find_recovery_user', { p_email: email, p_code: code })),
      setPassword: async (userId, password) => {
        const { error } = await db.auth.admin.updateUserById(userId, { password });
        if (error) throw new Error(error.message);
      },
      replaceCode: async (userId) =>
        check<string>(await db.rpc('replace_recovery_code', { p_user: userId })),
    });
    return Response.json(outcome.body, { status: outcome.status, headers: cors });
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'server_error' }, { status: 500, headers: cors });
  }
});
