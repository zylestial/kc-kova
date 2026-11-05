-- Realtime on the bell (0089): only notifications are published, and the row
-- policy that decides who hears them stays on.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ),
  'notifications is published to Realtime'
);

select is(
  (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
  1,
  'no other table is published'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'row level security stays on for notifications'
);

select is(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_select'),
  '(account_id = ( SELECT auth.uid() AS uid))',
  'an account reads only its own notifications'
);

select * from finish();
rollback;
