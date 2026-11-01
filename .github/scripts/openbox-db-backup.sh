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
# The three failure modes it has to survive:
#   1. The Ubuntu postgresql-client metapackage is a major version behind
#      Supabase, and pg_dump refuses a newer server than itself. The client
#      version is therefore discovered from the server, not pinned here — and
#      the binary is chosen by its own --version output, because installing
#      postgresql-client-17 on a runner that already has a 16 /usr/bin/pg_dump
#      does not reliably repoint the command that is first on PATH.
#   2. "pg_dump --schema=<name>" on a schema that does not exist is not an
#      error: it writes header comments, exits 0, and uploads a backup of
#      nothing. The schemas are read from the live catalog, and the dump is
#      compared against the table count that catalog promised.
#   3. A backup job that cannot reach the server has to say so rather than
#      upload something smaller than the last good one.
set -euo pipefail

FILE_PREFIX="${FILE_PREFIX:-openbox-db}"
ALLOWED_SCHEMAS="${ALLOWED_SCHEMAS:-open_box public}"
[ -n "${SUPABASE_DB_URL:-}" ] || { echo "::error::SUPABASE_DB_URL is required"; exit 1; }

major_of() { # <binary> -> its PostgreSQL major, or empty
  local raw
  raw=$("$1" --version 2>/dev/null | tr -d '[:space:]')
  echo "$raw" | sed -E 's/^[^0-9]*([0-9]+).*/\1/'
}

newest_bin() { # <name> -> the newest installed copy of that client binary
  local name=$1 candidate found="" found_v=0 v extra
  extra=$(command -v "$name" 2>/dev/null || true)
  for candidate in "/usr/lib/postgresql/"*/bin/"$name" "/usr/bin/$name" "$extra"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    v=$(major_of "$candidate" || true)
    case "$v" in '' | *[!0-9]*) continue ;; esac
    if [ "$v" -gt "$found_v" ]; then found="$candidate"; found_v=$v; fi
  done
  [ -n "$found" ] && echo "$found"
}

install_client() { # <major> -> add PGDG and install that client major
  local want=${1:-17}
  case "$want" in 1[0-9] | 20) ;; *) echo "::error::implausible client major version: $want"; exit 1 ;; esac
  sudo apt-get update -qq >/dev/null
  sudo apt-get install -y -qq --no-install-recommends curl ca-certificates gnupg postgresql-common >/dev/null
  sudo install -d -m 0755 /etc/apt/keyrings
  curl -fsS https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | sudo gpg --dearmor --yes -o /etc/apt/keyrings/postgresql-pgdg.gpg
  # /etc/os-release rather than lsb_release: the codename is what PGDG names
  # its suites by, and the runner image always carries the file.
  . /etc/os-release
  echo "deb [signed-by=/etc/apt/keyrings/postgresql-pgdg.gpg] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq >/dev/null
  sudo apt-get install -y --no-install-recommends "postgresql-client-$want"
}

BOOT_PSQL=$(newest_bin psql || true)
if [ -z "$BOOT_PSQL" ]; then
  install_client
  BOOT_PSQL=$(newest_bin psql || true)
fi
[ -n "$BOOT_PSQL" ] || { echo "::error::no psql is available to ask the server its version"; exit 1; }

PSQL=("$BOOT_PSQL" -v ON_ERROR_STOP=1 -X -q "$SUPABASE_DB_URL")

server_major() {
  local num
  num=$("${PSQL[@]}" -tAc "SELECT current_setting('server_version_num')::int" | tr -d '[:space:]')
  case "$num" in '' | *[!0-9]*) echo "::error::unexpected server_version_num: $num" >&2; exit 1 ;; esac
  echo $((num / 10000))
}

want=$(server_major)
PG_DUMP=$(newest_bin pg_dump || true)
if [ -z "$PG_DUMP" ] || [ "$(major_of "$PG_DUMP")" -lt "$want" ]; then
  # The runner image ships a client already, but not necessarily the server's
  # major, and installing one does not repoint the copy that is first on PATH.
  install_client "$want"
  PG_DUMP=$(newest_bin pg_dump || true)
fi
if [ -z "$PG_DUMP" ] || [ "$(major_of "$PG_DUMP")" -lt "$want" ]; then
  echo "::error::no pg_dump at or above server major $want; candidates found:"
  ls -l /usr/lib/postgresql/*/bin/pg_dump 2>&1 || true
  echo "update-alternatives: $(update-alternatives --query pg_dump 2>&1 | tr '\n' ' ' || true)"
  exit 1
fi
echo "using $PG_DUMP ($(major_of "$PG_DUMP")) against server major $want"

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
expected=()
while IFS= read -r row; do expected+=("$row"); done < <("${PSQL[@]}" -tAc "
  SELECT table_schema || '.' || table_name FROM information_schema.tables
   WHERE table_schema IN ($schema_list)
     AND table_type = 'BASE TABLE'
     AND (table_name LIKE 'x\_%' OR table_name LIKE 'openbox\_%')
   ORDER BY 1" | tr -d '\r' | sed '/^[[:space:]]*$/d')
if [ "${#expected[@]}" -eq 0 ]; then
  echo "::error::the catalog named no Open-Box tables in ${schemas[*]}"; exit 1
fi
echo "Open-Box tables to be present: ${expected[*]}"

FILE="${FILE_PREFIX}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
schema_args=()
for s in "${schemas[@]}"; do schema_args+=("--schema=$s"); done

echo "writing $FILE"
# -b keeps large objects, which is where stored file bodies live on the
# storage-driver path; ownership and grants are restored by the operator.
# A schema dump is wider than the Open-Box table list — pg_dump has no way to
# name "the schema but not its other tables" — so the archive carries whatever
# else lives in those schemas, and the check below is that every Open-Box table
# survived, not that nothing else did.
"$PG_DUMP" "$SUPABASE_DB_URL" "${schema_args[@]}" --no-owner --no-privileges --large-objects \
  | gzip -9 > "$FILE"

test -s "$FILE"
gzip -t "$FILE"

# The check that would have caught twelve days of empty archives: every table
# the catalog put in scope has to appear in the archive.
dumped=$(gunzip -c "$FILE" | sed -n 's/^CREATE TABLE \([^ (]*\).*/\1/p' | sort -u)
missing=""
for q in "${expected[@]}"; do
  grep -qxF "$q" <<<"$dumped" && continue
  # A name that needs quoting is emitted as schema."MixedCase"; accept that form
  # too rather than reporting a table as missing when the dump has it.
  grep -qxF "${q%%.*}.\"${q#*.}\"" <<<"$dumped" || missing="$missing $q"
done
if [ -n "$missing" ]; then
  echo "::error::the dump is missing Open-Box tables:$missing (the dump holds $(grep -c . <<<"$dumped") tables)"
  exit 1
fi
dumped_total=$(grep -c . <<<"$dumped")
# A scope-correct archive without the settings table could not restore a usable
# installation, so name the one row set that must always be present.
gunzip -c "$FILE" | grep -q 'x_settings' \
  || { echo "::error::the dump does not mention x_settings; this is not an Open-Box backup"; exit 1; }
data_stmts=$(gunzip -c "$FILE" | grep -cE '^(COPY |INSERT INTO )' || true)

CHECKSUM=$(sha256sum "$FILE" | cut -d' ' -f1)
echo "verified: openbox-tables=${#expected[@]} tables-in-archive=$dumped_total data-statements=${data_stmts:-0} sha256=$CHECKSUM"
ls -lh "$FILE"

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "FILE=$FILE" >> "$GITHUB_ENV"
  echo "CHECKSUM=$CHECKSUM" >> "$GITHUB_ENV"
fi
