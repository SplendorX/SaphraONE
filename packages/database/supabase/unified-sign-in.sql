-- One account per email: a Google sign-in and an emailed code for the same
-- verified address open the same wallet (NEXT_PUBLIC_UNIFIED_GOOGLE_SIGN_IN).
-- The server finds the Supabase user behind an address with this function;
-- the wallet is keyed by that user's id (sp-email-<id>). Server-only.
-- Run in the Supabase SQL editor before turning the flag on.

create or replace function public.auth_user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  order by created_at
  limit 1
$$;

revoke all on function public.auth_user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_for_email(text) to service_role;
