-- The Company trip v2 request (owner's calls 2026-11-26/27). One request
-- is one trip, so what used to be asked per stop or per trip now sits on
-- the request group:
--   * one free-text Purpose for the whole request;
--   * the Fleet Card No. / last 4 digits, always required;
--   * Regular or Urgent, with the reason from the Admin's list;
--   * the passengers: KOVA accounts and typed guests.
-- Site Officer / Supplier, Company / Site, Immediate Supervisor and
-- PM / CM / Dept. Head are no longer asked; their old columns stay for
-- history and are left blank.

alter table request_groups
  add column purpose_text text not null default '' check (char_length(purpose_text) <= 300),
  add column fleet_card_last4 text not null default '' check (fleet_card_last4 ~ '^([0-9]{4})?$'),
  add column priority text not null default 'REGULAR' check (priority in ('REGULAR', 'URGENT')),
  add column urgent_reason_id text,
  add column urgent_reason_name text not null default '';

create table request_group_passengers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references request_groups (id) on delete cascade,
  position integer not null,
  account_id uuid references accounts (id),
  guest_name text not null default '' check (char_length(guest_name) <= 100),
  created_at timestamptz not null default now(),
  -- A passenger is either a KOVA account or a typed guest.
  check ((account_id is null) <> (guest_name = '')),
  unique (group_id, position)
);

create index request_group_passengers_group_id_idx on request_group_passengers (group_id);
create index request_group_passengers_account_id_idx on request_group_passengers (account_id);
create unique index request_group_passengers_one_account
  on request_group_passengers (group_id, account_id) where account_id is not null;

alter table request_group_passengers enable row level security;
grant select on request_group_passengers to authenticated;

-- Seen by whoever can see the request; written only by request_company_trip.
create policy request_group_passengers_select on request_group_passengers for select
  to authenticated
  using (public.can_view_request_group(group_id));

create trigger request_group_passengers_audit
  after insert or update or delete on request_group_passengers
  for each row execute function write_audit_event();
