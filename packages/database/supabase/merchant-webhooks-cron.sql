-- Per-minute driver for Checkout API webhook retries (ONLINE-CHECKOUT-PLAN.md,
-- Phase 2). Vercel crons here are daily, so Supabase calls
-- POST /api/cron/merchant-webhooks every minute through pg_net.
--
-- Run once per Supabase project (testnet, then production) after
-- merchant-api.sql. Needs the pg_cron and pg_net extensions (Database →
-- Extensions). Before running, replace the two placeholders below:
--   <APP_ORIGIN>   the app this project belongs to: https://testnet.saphra.one for
--                  testnet, https://app.saphra.one for production
--   <CRON_SECRET>  that deployment's CRON_SECRET (Vercel env)
-- Both are kept in Supabase Vault, not in the job's text. Re-running replaces
-- them and the job; the last query shows the URL the job now calls.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replaced rather than updated, so a re-run always takes the new values.
delete from vault.secrets
where name in ('merchant_webhooks_cron_url', 'merchant_webhooks_cron_secret');

select vault.create_secret('<APP_ORIGIN>/api/cron/merchant-webhooks', 'merchant_webhooks_cron_url');
select vault.create_secret('<CRON_SECRET>', 'merchant_webhooks_cron_secret');

select cron.unschedule(jobid) from cron.job where jobname = 'merchant-webhooks';

select cron.schedule(
  'merchant-webhooks',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'merchant_webhooks_cron_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'merchant_webhooks_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Check: one active job, calling this project's app.
select
  job.jobname,
  job.schedule,
  job.active,
  (select decrypted_secret from vault.decrypted_secrets where name = 'merchant_webhooks_cron_url') as calls
from cron.job as job
where job.jobname = 'merchant-webhooks';
