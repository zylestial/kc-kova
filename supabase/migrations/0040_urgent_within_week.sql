-- v2.4: Urgent covers every day before Regular's 7-day notice starts.
--
-- Until now Urgent was today or tomorrow only, so dates 2-6 days ahead
-- couldn't be requested at all. Now any date from today up to 6 days ahead
-- is Urgent, and 7+ days ahead is Regular, so every future date can be
-- requested and the date decides the type.
--
-- Same as 0019 otherwise (Admin may still request a past date).
create or replace function check_request_date(p_role text, p_date date, p_type text)
returns void
language plpgsql
set search_path = ''
stable
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if p_type not in ('REGULAR', 'URGENT') then
    raise exception 'Invalid request type' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Select a date' using errcode = '22023';
  end if;
  if p_role = 'Admin' and p_date < v_today then
    return;
  end if;
  if p_type = 'REGULAR' and p_date < v_today + 7 then
    raise exception 'Regular requests need at least 7 days'' notice' using errcode = '22023';
  end if;
  if p_type = 'URGENT' and (p_date < v_today or p_date >= v_today + 7) then
    raise exception 'Urgent requests are for today up to 6 days ahead' using errcode = '22023';
  end if;
end;
$$;
