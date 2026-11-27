-- The requester prints their Company Trip Form from My Requests (Company
-- trip v2). Once the trip has ended the form shows the odometer readings
-- (Departure, Arrival, Total Distance), which only the Driver and Admin can
-- read in trip_completions. my_company_trips (0096) now carries them for
-- the requester's own trips: null until the trip ends, and null for a
-- vehicle without an odometer (0078). finished says the trip ended.

drop function my_company_trips(date);

create function my_company_trips(p_since date)
returns table (
  group_id uuid,
  schedule_id uuid,
  state text,
  comment text,
  legs jsonb,
  passengers jsonb,
  finished boolean,
  odometer_start integer,
  odometer_end integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    s.id,
    case
      when s.id is null or s.status <> 'ACTIVE' then 'CANCELLED'
      when latest.status = 'APPROVED' then 'APPROVED'
      when latest.status = 'RETURNED' then case when s.published_revision_id is null then 'RETURNED' else 'CHANGES_RETURNED' end
      else case when s.published_revision_id is null then 'WAITING' else 'CHANGES_WAITING' end
    end,
    case when latest.status = 'RETURNED' then latest.decision_comment else '' end,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'out', to_char(l.planned_time_out, 'HH24:MI'),
        'in', to_char(l.planned_time_in, 'HH24:MI')
      ) order by l.leg_no)
      from public.schedule_legs l
      where l.revision_id = latest.id
    ), '[]'),
    coalesce((
      select jsonb_agg(
        case when p.account_id is not null then jsonb_build_object('accountId', p.account_id)
             else jsonb_build_object('guestName', p.guest_name) end
        order by p.position)
      from public.request_group_passengers p
      where p.group_id = g.id
    ), '[]'),
    tc.id is not null,
    tc.start_odometer,
    tc.end_odometer
  from public.request_groups g
  left join lateral (
    select sc.*
    from public.schedules sc
    where sc.kind = 'COMPANY'
      and exists (
        select 1 from public.schedule_requests sr
        join public.requests r on r.id = sr.request_id
        where sr.schedule_id = sc.id and r.group_id = g.id
      )
    order by (sc.status = 'ACTIVE') desc, sc.created_at desc
    limit 1
  ) s on true
  left join lateral (
    select sr.*
    from public.schedule_revisions sr
    where sr.schedule_id = s.id and sr.status in ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')
    order by sr.version desc
    limit 1
  ) latest on true
  left join public.trip_completions tc on tc.schedule_id = s.id
  where g.owner_account_id = (select auth.uid())
    and g.form_type = 'COMPANY'
    and g.requested_date >= coalesce(p_since, '-infinity'::date);
$$;

revoke execute on function my_company_trips(date) from public, anon;
grant execute on function my_company_trips(date) to authenticated;
