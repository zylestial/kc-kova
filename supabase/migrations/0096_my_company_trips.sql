-- Company trip v2 (0094): the requester's own Company trips, for My
-- Requests and the edit form. A requester only sees a schedule once it is
-- approved (can_view_schedule), but they need to see where their request
-- is before that: waiting for the Admin, or returned with a comment. And
-- an edit starts from the times they entered, which live on the trip's
-- legs. Read only; one row per Company request of theirs.
--   state: WAITING (sent, not yet approved), RETURNED, APPROVED,
--          CHANGES_WAITING / CHANGES_RETURNED (an approved trip edited:
--          the approved version stays in force until the Admin decides),
--          CANCELLED.
--   comment: the Admin's comment when returned.
--   legs: the latest version's legs in order, [{ out, in }] as 'HH:MM'
--         (leg n ends at destination n; Time Out is the first out, Time In
--         the last in).
--   passengers: [{ accountId } | { guestName }] in order.

create function my_company_trips(p_since date)
returns table (
  group_id uuid,
  schedule_id uuid,
  state text,
  comment text,
  legs jsonb,
  passengers jsonb
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
    ), '[]')
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
  where g.owner_account_id = (select auth.uid())
    and g.form_type = 'COMPANY'
    and g.requested_date >= coalesce(p_since, '-infinity'::date);
$$;

revoke execute on function my_company_trips(date) from public, anon;
grant execute on function my_company_trips(date) to authenticated;
