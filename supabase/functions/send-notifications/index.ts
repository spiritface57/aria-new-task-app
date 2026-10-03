// Supabase Edge Function. Called every minute by pg_cron (see ../../cron.sql).
// Deploy with:  supabase functions deploy send-notifications --no-verify-jwt
// (JWT check is replaced by the x-cron-secret header below.)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { run, type Message, type SendResult, type Target } from './notify.ts';

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
};

const db = createClient(env('SUPABASE_URL'),
  Deno.env.get('SERVICE_ROLE_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } });

webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

async function send(t: Target, m: Message): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
      JSON.stringify(m),
      { TTL: 60 * 60, urgency: 'high' },   // drop if the phone stays offline for an hour
    );
    return 'ok';
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'failed';
  }
}

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const summary = await run({
      claimReminders: async () => check(await db.rpc('claim_due_reminders')) ?? [],
      claimHelpAlerts: async () => check(await db.rpc('claim_parent_alerts')) ?? [],
      completeHelpAlerts: async (ids) => { check(await db.rpc('complete_parent_alerts', { p_ids: ids })); },
      removeEndpoints: async (endpoints) => {
        check(await db.from('push_subscriptions').delete().in('endpoint', endpoints));
      },
      send,
      cleanupPhotos: async () => {
        const rows = check<{ name: string }[]>(await db.rpc('expired_photos', { p_limit: 100 })) ?? [];
        if (!rows.length) return 0;
        const names = rows.map((r) => r.name);
        const { error } = await db.storage.from('proofs').remove(names);
        if (error) throw new Error(error.message);
        check(await db.rpc('forget_photos', { p_names: names }));
        return names.length;
      },
    });
    return Response.json(summary);
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
