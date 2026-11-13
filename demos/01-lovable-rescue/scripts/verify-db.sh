#!/usr/bin/env bash
# Verifies supabase/migrations + seed.sql against a throwaway Postgres 17 container.
# It stubs the bits of Supabase the schema relies on (auth.users, auth.uid(), anon and
# authenticated roles), then runs RLS, grant and double-booking checks.
# Usage: bash scripts/verify-db.sh      (needs Docker running)
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=slotbook-db-check
CHECKS=scripts/db-checks

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres postgres:17 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2

psql_run() { docker exec -i "$NAME" psql -U postgres -q "$@"; }

echo "== Applying stub, migrations and seed"
psql_run -v ON_ERROR_STOP=1 < "$CHECKS/00_supabase_stub.sql"
for f in supabase/migrations/*.sql; do psql_run -v ON_ERROR_STOP=1 < "$f"; done
psql_run -v ON_ERROR_STOP=1 < supabase/seed.sql
echo "   OK"

echo "== RLS and grants"
psql_run < "$CHECKS/10_rls_checks.sql" 2>&1

echo "== Double booking, sequential"
psql_run < "$CHECKS/20_double_booking.sql" 2>&1

echo "== Double booking, two concurrent transactions"
(psql_run < "$CHECKS/30_race_session_a.sql" 2>&1 | sed 's/^/[A] /') &
sleep 1
psql_run < "$CHECKS/31_race_session_b.sql" 2>&1 | sed 's/^/[B] /'
wait
