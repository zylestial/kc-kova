-- Self-service accounts (0072): emails are private to their owner and
-- Admins, invites are Admin-only, one-time tokens are server-only, and an
-- email or open invite can't be used twice.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'emailadmin@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'emailuser@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'emailother@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'emailadmin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-0000000000e2', 'emailuser', 'Uma User', 'Requester'),
  ('00000000-0000-0000-0000-0000000000e3', 'emailother', 'Otto Other', 'Requester');
insert into account_emails (account_id, email, confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'ada@test.local', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'uma@test.local', now()),
  ('00000000-0000-0000-0000-0000000000e3', 'otto@test.local', now());
insert into account_invites (email, role, token_hash, expires_at, invited_by) values
  ('new@test.local', 'Requester', 'hash-invite-1', now() + interval '7 days', '00000000-0000-0000-0000-0000000000e1');
insert into account_tokens (account_id, purpose, email, token_hash, expires_at) values
  ('00000000-0000-0000-0000-0000000000e2', 'reset_password', 'uma@test.local', 'hash-token-1', now() + interval '1 hour');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select is((select count(*)::int from account_emails), 1, 'a user sees only their own email');
select is((select count(*)::int from account_invites), 0, 'a user sees no invites');
select throws_ok(
  $$ update account_emails set email = 'hijack@test.local' $$,
  '42501', null, 'a user can''t change an email directly'
);
select throws_ok($$ select * from account_tokens $$, '42501', null, 'a user can''t read tokens');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select is((select count(*)::int from account_emails where email like '%@test.local'), 3, 'an Admin sees every email');
select is((select count(*)::int from account_invites where email = 'new@test.local'), 1, 'an Admin sees invites');
reset role;

select throws_ok(
  $$ update account_emails set email = 'uma@test.local' where account_id = '00000000-0000-0000-0000-0000000000e3' $$,
  '23505', null, 'two accounts can''t share an email'
);
select throws_ok(
  $$ insert into account_invites (email, role, token_hash, expires_at, invited_by)
     values ('new@test.local', 'Driver', 'hash-invite-2', now() + interval '7 days', '00000000-0000-0000-0000-0000000000e1') $$,
  '23505', null, 'one open invite per email'
);
update account_invites set cancelled_at = now() where email = 'new@test.local';
select lives_ok(
  $$ insert into account_invites (email, role, token_hash, expires_at, invited_by)
     values ('new@test.local', 'Driver', 'hash-invite-3', now() + interval '7 days', '00000000-0000-0000-0000-0000000000e1') $$,
  'a cancelled invite can be sent again'
);

select * from finish();
rollback;
