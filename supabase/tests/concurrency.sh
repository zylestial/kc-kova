#!/usr/bin/env bash
# v2 concurrency checks: two real database sessions racing each other.
#
# pgTAP (the *.test.sql files) runs in a single transaction, so it can't
# show what happens when two users act at the same moment. Each scenario
# here starts session 1, which does its write and then holds its
# transaction open; session 2 starts while session 1 is still open and
# attempts the conflicting write. Exactly one of them may succeed.
#
# LOCAL ONLY: talks to the local Supabase Docker database (never a hosted
# project). Fixtures use a per-run suffix, so it can be re-run without a
# reset; `supabase db reset` clears them.
#
#   bash supabase/tests/concurrency.sh

set -uo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase_db_KOVA}"
RUN="$(date +%s | tail -c 7)"
TMP="$(mktemp -d)"
FAILURES=0

sql() { docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -qAt; }

# session <uid> <hold seconds> <sql>: runs <sql> as that account inside a
# transaction, then holds it open for <hold> seconds before committing.
session() {
  sql <<EOF
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$1","role":"authenticated"}';
$3;
select pg_sleep($2);
commit;
EOF
}

# race <name> <uid1> <sql1> <uid2> <sql2>: exactly one session must succeed.
race() {
  local name="$1"
  session "$2" 2 "$3" >"$TMP/a.out" 2>&1 &
  local pid_a=$!
  sleep 0.5
  session "$4" 0 "$5" >"$TMP/b.out" 2>&1
  local rc_b=$?
  wait "$pid_a"
  local rc_a=$?
  local ok=$(( (rc_a == 0) + (rc_b == 0) ))
  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name (first: $([ $rc_a -eq 0 ] && echo ok || echo rejected), second: $([ $rc_b -eq 0 ] && echo ok || echo rejected))"
    [ $rc_b -ne 0 ] && echo "      second session got: $(grep -m1 ERROR "$TMP/b.out")"
    [ $rc_a -ne 0 ] && echo "      first session got: $(grep -m1 ERROR "$TMP/a.out")"
  else
    echo "FAIL  $name: $ok sessions succeeded (expected exactly 1)"
    cat "$TMP/a.out" "$TMP/b.out"
    FAILURES=$((FAILURES + 1))
  fi
}

# Fixtures ---------------------------------------------------------------------
ADMIN1="$(sql <<<"select gen_random_uuid()")"
ADMIN2="$(sql <<<"select gen_random_uuid()")"
SCHED1="$(sql <<<"select gen_random_uuid()")"
SCHED2="$(sql <<<"select gen_random_uuid()")"
DRIVER1="$(sql <<<"select gen_random_uuid()")"
DRIVER2="$(sql <<<"select gen_random_uuid()")"
# One van (and Driver) per scenario: a vehicle takes only one schedule a day
# (0048), and every scenario books the same day.
DRIVER3="$(sql <<<"select gen_random_uuid()")"
DRIVER4="$(sql <<<"select gen_random_uuid()")"
DRIVER5="$(sql <<<"select gen_random_uuid()")"
DRIVER6="$(sql <<<"select gen_random_uuid()")"
REQ="$(sql <<<"select gen_random_uuid()")"
P1="C1-$RUN"; P2="C2-$RUN"; P3="C3-$RUN"; P4="C4-$RUN"; P5="C5-$RUN"; P6="C6-$RUN"; DEST="cd-$RUN"; PURP="cp-$RUN"

sql <<EOF >/dev/null
insert into auth.users (id, email) values
  ('$ADMIN1', 'a1-$RUN@test.local'), ('$ADMIN2', 'a2-$RUN@test.local'),
  ('$SCHED1', 's1-$RUN@test.local'), ('$SCHED2', 's2-$RUN@test.local'),
  ('$DRIVER1', 'd1-$RUN@test.local'), ('$DRIVER2', 'd2-$RUN@test.local'),
  ('$DRIVER3', 'd3-$RUN@test.local'), ('$DRIVER4', 'd4-$RUN@test.local'),
  ('$DRIVER5', 'd5-$RUN@test.local'), ('$DRIVER6', 'd6-$RUN@test.local'),
  ('$REQ', 'r-$RUN@test.local');
insert into accounts (id, username, name, role) values
  ('$ADMIN1', 'a1-$RUN', 'Admin One', 'Admin'), ('$ADMIN2', 'a2-$RUN', 'Admin Two', 'Admin'),
  ('$SCHED1', 's1-$RUN', 'Sched One', 'Scheduler'), ('$SCHED2', 's2-$RUN', 'Sched Two', 'Scheduler'),
  ('$DRIVER1', 'd1-$RUN', 'Driver One', 'Driver'), ('$DRIVER2', 'd2-$RUN', 'Driver Two', 'Driver'),
  ('$DRIVER3', 'd3-$RUN', 'Driver Three', 'Driver'), ('$DRIVER4', 'd4-$RUN', 'Driver Four', 'Driver'),
  ('$DRIVER5', 'd5-$RUN', 'Driver Five', 'Driver'), ('$DRIVER6', 'd6-$RUN', 'Driver Six', 'Driver'),
  ('$REQ', 'r-$RUN', 'Requester', 'Requester');
insert into vehicles (plate, name, assigned_driver_id) values
  ('$P1', 'Race Van 1', '$DRIVER1'), ('$P2', 'Race Van 2', '$DRIVER2'),
  ('$P3', 'Race Van 3', '$DRIVER3'), ('$P4', 'Race Van 4', '$DRIVER4'),
  ('$P5', 'Race Van 5', '$DRIVER5'), ('$P6', 'Race Van 6', '$DRIVER6');
insert into booking_options ("group", id, name) values
  ('destinations', '$DEST', 'Race Destination'), ('purposes', '$PURP', 'Race Purpose');
EOF

DATE="(now() at time zone 'Asia/Manila')::date + 10"
DESTS="[{\"destinationId\":\"$DEST\",\"purposeId\":\"$PURP\"}]"

new_request() {
  session "$REQ" 0 "select id from create_request($DATE, 'REGULAR', null, null, '$DESTS')" | head -1
}
rd_of() { sql <<<"select id from request_destinations where request_id = '$1' and active"; }
legs() { # legs <request_destination_id> <out> <in> <back_out> <back_in>
  echo "[{\"destinationId\":\"$DEST\",\"plannedTimeOut\":\"$2\",\"plannedTimeIn\":\"$3\",\"stops\":[\"$1\"]},{\"isFinal\":true,\"plannedTimeOut\":\"$4\",\"plannedTimeIn\":\"$5\"}]"
}
draft() { # draft <plate> <request_id> <legs json>
  echo "select save_schedule_draft(null, null, $DATE, '$1', array['$2']::uuid[], '$3')"
}

Q1="$(new_request)"; Q2="$(new_request)"; Q3="$(new_request)"
Q4="$(new_request)"; Q5="$(new_request)"; Q6="$(new_request)"

# Scenarios --------------------------------------------------------------------
echo "Run $RUN"

race "include/include: same request into two schedules" \
  "$SCHED1" "$(draft "$P1" "$Q1" "$(legs "$(rd_of "$Q1")" 06:00 07:00 07:10 07:40)")" \
  "$SCHED2" "$(draft "$P2" "$Q1" "$(legs "$(rd_of "$Q1")" 06:00 07:00 07:10 07:40)")"

race "one trip per vehicle per day: two schedules on the same vehicle" \
  "$SCHED1" "$(draft "$P3" "$Q2" "$(legs "$(rd_of "$Q2")" 12:00 13:00 13:10 13:40)")" \
  "$SCHED2" "$(draft "$P3" "$Q3" "$(legs "$(rd_of "$Q3")" 12:30 13:30 13:40 14:10)")"

race "edit/include: owner edits while a Scheduler includes" \
  "$REQ" "select update_request('$Q4', 1, $DATE, 'REGULAR', null, null, '$DESTS')" \
  "$SCHED1" "$(draft "$P4" "$Q4" "$(legs "$(rd_of "$Q4")" 15:00 15:30 15:40 16:00)")"

race "include/edit: Scheduler includes while the owner edits" \
  "$SCHED1" "$(draft "$P5" "$Q5" "$(legs "$(rd_of "$Q5")" 17:00 17:30 17:40 18:00)")" \
  "$REQ" "select update_request('$Q5', 1, $DATE, 'REGULAR', null, null, '$DESTS')"

# Approval race: one submitted schedule, two Admins approve at once.
session "$SCHED1" 0 "$(draft "$P6" "$Q6" "$(legs "$(rd_of "$Q6")" 19:00 19:30 19:40 20:00)")" >/dev/null
S6="$(sql <<<"select schedule_id from schedule_requests where request_id = '$Q6' and active")"
session "$SCHED1" 0 "select submit_schedule('$S6', 1)" >/dev/null
race "approve/approve: two Admins approve the same schedule" \
  "$ADMIN1" "select approve_schedule('$S6', 2)" \
  "$ADMIN2" "select approve_schedule('$S6', 2)"

# Invariants over everything this run created ----------------------------------
check() { # check <description> <sql returning 0 when fine>
  local n
  n="$(sql <<<"$2")"
  if [ "$n" = "0" ]; then echo "PASS  $1"; else echo "FAIL  $1 ($n)"; FAILURES=$((FAILURES + 1)); fi
}
check "no request is actively included twice" \
  "select count(*) from (select request_id from schedule_requests where active group by request_id having count(*) > 1) x"
check "no overlapping reservations between schedules" \
  "select count(*) from schedule_reservations a join schedule_reservations b
     on a.schedule_id <> b.schedule_id and a.period && b.period and (a.plate = b.plate or a.driver_id = b.driver_id)"
check "approved schedule has exactly one APPROVED version" \
  "select abs(count(*) - 1) from schedule_revisions where schedule_id = '$S6' and status = 'APPROVED'"
check "every active inclusion's revision still has the request's current destinations" \
  "select count(*) from schedule_requests sq
     join schedule_revisions sr on sr.schedule_id = sq.schedule_id and sr.status in ('DRAFT','SUBMITTED','RETURNED','APPROVED')
     join revision_requests rr on rr.revision_id = sr.id and rr.request_id = sq.request_id
     join request_destinations rd on rd.request_id = sq.request_id and rd.active
     where sq.active and not exists (
       select 1 from leg_stops ls where ls.revision_id = sr.id and ls.request_destination_id = rd.id)"

rm -rf "$TMP"
if [ "$FAILURES" -eq 0 ]; then echo "All concurrency checks passed"; else echo "$FAILURES check(s) failed"; exit 1; fi
