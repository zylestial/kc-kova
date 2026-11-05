-- The bell hears about a new notification straight away. Realtime tells the
-- browser only that a row was added for this account; the notifications_select
-- policy (0035) decides who hears it, so nobody hears another account's.
alter publication supabase_realtime add table notifications;
