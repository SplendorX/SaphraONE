-- Per-minute driver for Checkout API webhook retries (ONLINE-CHECKOUT-PLAN.md,
-- Phase 2). Vercel crons here are daily, so Supabase calls
-- POST /api/cron/merchant-webhooks every minute through pg_net.
--
-- Run once per Supabase project (testnet, then production) after
-- merchant-api.sql. Needs the pg_cron and pg_net extensions (Database →
-- Extensions). Before running, replace the two placeholders below:
--   <APP_ORIGIN>   https://testnet.saphra.one on testnet, https://app.saphra.one on production
--   <CRON_SECRET>  that deployment's CRON_SECRET (Vercel env)
-- Both are kept in Supabase Vault, not in the job's text. Re-running updates
-- them and replaces the job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'merchant_webhooks_cron_url';
  if existing is null then
    perform vault.create_secret('<APP_ORIGIN>/api/cron/merchant-webhooks', 'merchant_webhooks_cron_url');
  else
    perform vault.update_secret(existing, '<APP_ORIGIN>/api/cron/merchant-webhooks');
  end if;

  select id into existing from vault.secrets where name = 'merchant_webhooks_cron_secret';
  if existing is null then
    perform vault.create_secret('<CRON_SECRET>', 'merchant_webhooks_cron_secret');
  else
    perform vault.update_secret(existing, '<CRON_SECRET>');
  end if;
end $$;

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
