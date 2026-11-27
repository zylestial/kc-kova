-- Type to add (2026-11-27): a requester typing a destination or purpose that
-- isn't on the list adds it to the list for everyone, in place of the old
-- one-off "Other…". Department / Project Site and the other lists stay
-- Admin-only. Settings shows who added each one.

-- Who added each name. A table of its own: booking_options keeps its columns,
-- since older functions test a whole row with "is not null", which is false
-- once any column is null.
create table public.booking_option_additions (
  option_group text not null,
  option_id text not null,
  account_id uuid references public.accounts (id) on delete set null,
  account_name text not null,
  added_at timestamptz not null default now(),
  primary key (option_group, option_id),
  foreign key (option_group, option_id) references public.booking_options ("group", id) on delete cascade
);
create index booking_option_additions_account on public.booking_option_additions (account_id, added_at);
alter table public.booking_option_additions enable row level security;
create policy booking_option_additions_select on public.booking_option_additions
  for select using ((select auth.role()) = 'authenticated');

create or replace function public.add_booking_option(p_group text, p_name text)
returns public.booking_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_found public.booking_options;
  v_row public.booking_options;
  v_today integer;
begin
  select * into v_actor from public.accounts where id = auth.uid() and status = 'Active';
  if v_actor.id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_group not in ('destinations', 'purposes') then
    raise exception 'Only the Admin can add to this list' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Enter a name of 2 to 100 characters' using errcode = '22023';
  end if;

  -- Two people adding the same name at once get the same row; the same lock
  -- and matching as a typed name on a Daily request (0049).
  perform pg_advisory_xact_lock(hashtext('option:' || p_group || ':' || public.option_name_key(v_name)));

  select * into v_found from public.booking_options
  where "group" = p_group and public.option_name_key(name) = public.option_name_key(v_name)
  order by status = 'Active' desc
  limit 1;
  if v_found.id is not null then
    if v_found.status <> 'Active' then
      raise exception '"%" has been turned off by the Admin. Please contact the Admin', v_found.name using errcode = '22023';
    end if;
    return v_found;
  end if;

  select count(*) into v_today from public.booking_option_additions
  where account_id = v_actor.id and added_at > now() - interval '1 day';
  if v_today >= 20 and v_actor.role <> 'Admin' then
    raise exception 'You have reached the limit of 20 new names a day. Please contact the Admin' using errcode = '22023';
  end if;

  insert into public.booking_options ("group", id, name, status, is_other_stop)
  values (p_group, gen_random_uuid()::text, v_name, 'Active', false)
  returning * into v_row;
  insert into public.booking_option_additions (option_group, option_id, account_id, account_name)
  values (p_group, v_row.id, v_actor.id, v_actor.name);
  return v_row;
end;
$$;

revoke all on function public.add_booking_option(text, text) from public, anon;
grant execute on function public.add_booking_option(text, text) to authenticated;
