-- Run AFTER schema.sql and AFTER deploying the send-notifications Edge Function.
-- Replace the two placeholders first:
--   <PROJECT_REF>  from your project URL https://<PROJECT_REF>.supabase.co
--   <CRON_SECRET>  the same random value you set with `supabase secrets set CRON_SECRET=...`

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets live in Vault, not in the cron job text.
select vault.create_secret('<CRON_SECRET>', 'cron_secret');
select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/send-notifications', 'notifications_url');

-- Every minute: send due reminders and pending help alerts.
select cron.schedule(
  'send-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000)
  $$
);

-- Daily housekeeping at 03:17 UTC.
select cron.schedule('family-tasks-cleanup', '17 3 * * *', 'select private.cleanup()');

-- Live updates in the app.
alter publication supabase_realtime add table public.task_results, public.tasks, public.task_assignees;

-- To check it is running:  select * from cron.job_run_details order by start_time desc limit 5;
-- To stop it:              select cron.unschedule('send-notifications');
