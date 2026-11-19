#!/usr/bin/env bash
# Runs the database tests against a throwaway local PostgreSQL cluster.
# Requires PostgreSQL server binaries (initdb, pg_ctl) on PATH or in /usr/lib/postgresql/*/bin.
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")"
TMP="$(mktemp -d)"
PORT="${PGTEST_PORT:-55432}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  # PostgreSQL refuses to run as root; use the postgres system user if present.
  id postgres >/dev/null 2>&1 || { echo "run as a non-root user or create a 'postgres' user"; exit 1; }
  chown postgres "$TMP"
  RUN_AS=(runuser -u postgres --)
fi
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f tests/db/supabase_stub.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f supabase/seed.sql
"${PSQL[@]}" -f tests/db/schema.test.sql 2>&1 | sed -n -e 's/.*NOTICE:  //p' -e '/ERROR/p'
test "${PIPESTATUS[0]}" -eq 0
echo "database tests passed"
