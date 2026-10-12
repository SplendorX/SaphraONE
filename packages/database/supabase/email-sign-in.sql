-- Email sign-in (NEXT_PUBLIC_CIRCLE_EMAIL_SIGN_IN): new email accounts use
-- Circle's own email login; accounts already on the older PIN wallet
-- (sp-email-<Supabase user id>) keep signing in the old way. The server finds
-- whether an address has such an account with this function. Server-only.
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
