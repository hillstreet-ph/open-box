#!/usr/bin/env bash
# Produce one verified gzipped SQL dump of the Open-Box warehouse database.
#
# Input:  SUPABASE_DB_URL  (validated by the calling workflow before this runs)
#         FILE_PREFIX      (default openbox-db)
#         ALLOWED_SCHEMAS  (default "open_box public")
# Output: the archive at $PWD/$FILE, plus FILE (basename) and CHECKSUM appended
#         to $GITHUB_ENV when running under Actions, so the caller can upload,
#         hash and record the same object this step just proved.
#
# Why a script instead of two copies of the same steps: the nightly backup and
# the maintenance job both archived this database, drifted apart, and failed
# the same way every day for twelve days without either producing a restorable
# file. Both jobs call this one implementation now.
#
# The two failure modes it has to survive:
#   1. The Ubuntu postgresql-client metapackage is a major version behind
#      Supabase, and pg_dump refuses a newer server than itself. The client
#      version is discovered from the server, not pinned here.
#   2. "pg_dump --schema=<name>" on a schema that does not exist is not an
#      error: it writes header comments, exits 0, and uploads a backup of
#      nothing. The schemas are read from the live catalog, and the dump is
#      compared against the table count that catalog promised.
set -euo pipefail

FILE_PREFIX="${FILE_PREFIX:-openbox-db}"
ALLOWED_SCHEMAS="${ALLOWED_SCHEMAS:-open_box public}"
PSQL=(psql -v ON_ERROR_STOP=1 -X -q "$SUPABASE_DB_URL")

server_major() {
  local num
  num=$("${PSQL[@]}" -tAc "SELECT current_setting('server_version_num')::int" | tr -d '[:space:]')
  case "$num" in '' | *[!0-9]*) echo "::error::unexpected server_version_num: $num" >&2; exit 1 ;; esac
  echo $((num / 10000))
}

client_major() { pg_dump --version | sed -E 's/^pg_dump \([^)]*\) ([0-9]+).*/\1/' | tr -d '[:space:]'; }

install_client() {
  # PGDG publishes a client per server major; the runner's own repository only
  # carries the one that shipped with Ubuntu.
  sudo apt-get update -qq >/dev/null
  sudo apt-get install -y -qq --no-install-recommends \
    curl ca-certificates gnupg postgresql-common >/dev/null
  curl -fsS https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | sudo gpg --dearmor --yes -o /etc/apt/keyrings/postgresql-pgdg.gpg
  echo "deb [signed-by=/etc/apt/keyrings/postgresql-pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq >/dev/null
  # Probe with a recent client, then settle on the exact match for the server.
  sudo apt-get install -y -qq --no-install-recommends postgresql-client-17 >/dev/null
}

ensure_client() {
  local want have
  want=$(server_major)
  if command -v pg_dump >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
    have=$(client_major)
    if [ "${have:-0}" -ge "$want" ]; then
      echo "reusing pg_dump $have for server $want"
      return
    fi
  fi
  install_client
  have=$(client_major)
  if [ "${have:-0}" -lt "$want" ]; then
    sudo apt-get install -y -qq --no-install-recommends "postgresql-client-$want" >/dev/null
    have=$(client_major)
  fi
  [ "${have:-0}" -ge "$want" ] || { echo "::error::pg_dump $have cannot dump server $want"; exit 1; }
  echo "pg_dump $have, server major $want"
}

discover_schemas() {
  # The application tables, wherever they actually live: the engine's
  # DB_TABLE_PREFIX rows plus the platform's openbox_* tables.
  "${PSQL[@]}" -tAc "
    SELECT DISTINCT table_schema
      FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       AND table_schema NOT LIKE 'pg\_%'
       AND (table_name LIKE 'x\_%' OR table_name LIKE 'openbox\_%')
     ORDER BY table_schema" | tr -d '\r' | sed '/^[[:space:]]*$/d'
}

ensure_client

schemas=()
while IFS= read -r row; do schemas+=("$row"); done < <(discover_schemas)

if [ "${#schemas[@]}" -eq 0 ]; then
  echo "::error::the connected database holds no x_* or openbox_* tables; refusing to write an empty backup"
  exit 1
fi
echo "schemas holding Open-Box tables: ${schemas[*]}"

for s in "${schemas[@]}"; do
  case "$s" in '' | *[!a-zA-Z0-9_-]*) echo "::error::unexpected schema name: $s"; exit 1 ;; esac
  case " $ALLOWED_SCHEMAS " in
    *" $s "*) ;;
    *) echo "::error::schema '$s' holds Open-Box tables but is not in ALLOWED_SCHEMAS ('$ALLOWED_SCHEMAS'); widen it deliberately rather than archiving it silently"; exit 1 ;;
  esac
done

schema_list=$(printf "'%s'," "${schemas[@]}"); schema_list=${schema_list%,}
expected_tables=$("${PSQL[@]}" -tAc "
  SELECT count(*) FROM information_schema.tables
   WHERE table_schema IN ($schema_list)
     AND table_type = 'BASE TABLE'
     AND (table_name LIKE 'x\_%' OR table_name LIKE 'openbox\_%')" | tr -d '[:space:]')
case "$expected_tables" in '' | *[!0-9]*) echo "::error::could not count Open-Box tables"; exit 1 ;; esac
echo "expected Open-Box tables: $expected_tables"

FILE="${FILE_PREFIX}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
schema_args=()
for s in "${schemas[@]}"; do schema_args+=("--schema=$s"); done

echo "writing $FILE"
# -b keeps large objects, which is where stored file bodies live on the
# storage-driver path; ownership and grants are restored by the operator.
pg_dump "$SUPABASE_DB_URL" "${schema_args[@]}" --no-owner --no-privileges --large-objects \
  | gzip -9 > "$FILE"

test -s "$FILE"
gzip -t "$FILE"

# The check that would have caught twelve days of empty archives: the dump has
# to hold every table the catalog said the scoped schemas own.
dumped_tables=$(gunzip -c "$FILE" | grep -c '^CREATE TABLE' || true)
dumped_tables=${dumped_tables:-0}
if [ "$dumped_tables" -ne "$expected_tables" ]; then
  echo "::error::the dump holds $dumped_tables CREATE TABLE statements, the catalog holds $expected_tables — wrong scope"
  exit 1
fi
# A scope-correct archive without the settings table could not restore a usable
# installation, so name the one row set that must always be present.
gunzip -c "$FILE" | grep -q 'x_settings' \
  || { echo "::error::the dump does not mention x_settings; this is not an Open-Box backup"; exit 1; }
data_stmts=$(gunzip -c "$FILE" | grep -cE '^(COPY |INSERT INTO )' || true)

CHECKSUM=$(sha256sum "$FILE" | cut -d' ' -f1)
echo "verified: tables=$dumped_tables data-statements=${data_stmts:-0} sha256=$CHECKSUM"
ls -lh "$FILE"

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "FILE=$FILE" >> "$GITHUB_ENV"
  echo "CHECKSUM=$CHECKSUM" >> "$GITHUB_ENV"
fi
