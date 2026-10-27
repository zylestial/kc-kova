-- Rate limits counted in one step (0082): add_login_attempts adds to a key's
-- count and returns the new one, starts a run-out window again, gives
-- attempts back without going below 0, and only the service role may call it.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select is(add_login_attempts('test82:a', 1, 900), 1, 'a new key starts at the attempts added');
select is(add_login_attempts('test82:a', 1, 900), 2, 'each call adds to the count and returns it');
select is(add_login_attempts('test82:a', 3, 900), 5, 'several at once');
select is(add_login_attempts('test82:a', -2, 900), 3, 'a negative amount gives attempts back');
select is(add_login_attempts('test82:a', -10, 900), 0, 'never below 0');
select is(add_login_attempts('test82:b', -1, 900), 0, 'a new key given back starts at 0');

update login_attempts set count = 99, window_start = now() - interval '16 minutes' where key = 'test82:a';
select is(add_login_attempts('test82:a', 1, 900), 1, 'a window that ran out starts again');
select is((select window_start from login_attempts where key = 'test82:a'), now(), 'from now');

select ok(
  not has_function_privilege('authenticated', 'add_login_attempts(text, integer, integer)', 'execute')
    and not has_function_privilege('anon', 'add_login_attempts(text, integer, integer)', 'execute')
    and has_function_privilege('service_role', 'add_login_attempts(text, integer, integer)', 'execute'),
  'only the service role may call it'
);

select * from finish();
rollback;
