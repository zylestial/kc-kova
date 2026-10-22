-- "Can drive company trips" on invites (follow-up to 0079): the Admin can
-- switch it on when inviting, and accepting the invite carries it onto the
-- new account, like the request switches. A Driver's comes from the Driver
-- type, so the API sends it off for Drivers.

alter table account_invites add column can_drive_company boolean not null default false;
