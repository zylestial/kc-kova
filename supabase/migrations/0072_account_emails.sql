-- Self-service accounts: a real email per account, invites, and the one-time
-- links KOVA emails (confirm an email, reset a password).
--
-- The Auth email stays the made-up <username>@accounts.kova.internal, so
-- sign-in is unchanged; the real email only delivers links. All three
-- tables are written only by the server's service-role client (the API
-- routes), never directly by a signed-in user. Emails are stored lowercase.

-- One row per account. email is the confirmed address; pending_email is a
-- new one waiting for its link to be opened (the old one keeps working).
create table account_emails (
  account_id uuid primary key references accounts (id),
  email text check (email = lower(email)),
  pending_email text check (pending_email = lower(pending_email)),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index account_emails_email_key on account_emails (email);

alter table account_emails enable row level security;

grant select on account_emails to authenticated;

-- Your own email, or every email for an Admin; nobody else's.
create policy account_emails_select on account_emails for select
  using (account_id = (select auth.uid()) or is_admin((select auth.uid())));

-- An Admin's invite: the person opens the emailed link and sets up their
-- own name, username, position and password; the role and request
-- permissions come from here and can't be chosen by them.
create table account_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  role text not null check (role in ('Requester', 'Scheduler', 'Admin', 'Driver')),
  driver_type text check (driver_type in ('Truck', 'Company car')),
  can_request_daily boolean not null default false,
  can_request_company boolean not null default false,
  token_hash text not null unique,
  expires_at timestamptz not null,
  invited_by uuid not null references accounts (id),
  sent_at timestamptz not null default now(),
  accepted_account_id uuid references accounts (id),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one open (not accepted, not cancelled) invite per email.
create unique index account_invites_open_email_key on account_invites (email)
  where accepted_at is null and cancelled_at is null;

alter table account_invites enable row level security;

grant select on account_invites to authenticated;

create policy account_invites_select on account_invites for select
  using (is_admin((select auth.uid())));

-- One-time links for an existing account. Only the sha256 of the token is
-- kept; email is where the link was sent (for confirm_email, the address
-- that becomes confirmed). No policies: service role only, like
-- login_attempts.
create table account_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  purpose text not null check (purpose in ('confirm_email', 'reset_password')),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index account_tokens_account_id_idx on account_tokens (account_id, purpose);

alter table account_tokens enable row level security;

-- Explicit, not the project template's defaults (see 0020): anon gets
-- nothing, authenticated only reads (filtered by the policies above), and
-- tokens are out of reach of both.
revoke all on account_emails, account_invites, account_tokens from anon;
revoke insert, update, delete, truncate, references, trigger on account_emails, account_invites from authenticated;
revoke all on account_tokens from authenticated;
grant all on account_emails, account_invites, account_tokens to service_role;
