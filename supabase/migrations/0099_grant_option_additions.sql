-- 0098 made booking_option_additions without a grant, so on production
-- (no default privileges for the CLI's role) the bootstrap's embedded
-- read of it was refused and KOVA couldn't load. Same grant as every
-- other read-only table (e.g. 0088 stop_tasks).
grant select on public.booking_option_additions to authenticated;
