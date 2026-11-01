#!/usr/bin/env bash
# Store one Open-Box archive, and its checksum manifest, in Supabase Storage.
#
# Input:  REF         Supabase project reference (validated by the caller)
#         KEY         service-role key for the Storage REST API
#         FILE        archive basename, already present in $PWD
#         CHECKSUM    sha256 hex of that archive, as recorded by the dump step
#         BUCKET      target bucket (default open-box-backups)
#         KIND        manifest kind (default postgresql)
# Output: two objects in the bucket — $FILE and $FILE.manifest.json — and the
#         manifest written next to the archive locally, so the run artifact and
#         the stored copy describe the same bytes.
#
# Why a script instead of two copies of the same steps: the nightly backup and
# the maintenance job both uploaded this database, drifted apart, and only the
# nightly one recorded a manifest. The maintenance job's archives therefore had
# no checksum to verify a restore against — the exact gap that let twelve days
# of empty archives pass as success.
#
# The failure modes it has to survive:
#   1. "Bucket already exists" is success, but Storage reports it as HTTP 400
#      whose body carries statusCode 409 / code "BucketAlreadyExists". Judging
#      the transport code alone turned a healthy bucket into a red run; the
#      body has to say which error it was.
#   2. Uploading with --fail-with-body hides the response body in the exit
#      status, so a rejected object used to fail with no reason recorded here.
#      Every request now captures the body and prints it on the error path.
#   3. The manifest lives in Storage beside the archive. It used to be written
#      to a table named openbox_backup_manifest, which exists only in
#      supabase/migrations — the deployed database has no such table and no Go
#      code reads that name, so the record could never have been written.
set -euo pipefail

BUCKET="${BUCKET:-open-box-backups}"
KIND="${KIND:-postgresql}"

missing=0
require() { # <variable name> <what it is>
  if [ "$(eval "printf '%s' \"\${$1:-}\"")" = "" ]; then
    echo "::error::$1 is required ($2)"
    missing=1
  fi
}
require REF "SUPABASE_PROJECT_REF"
require KEY "SUPABASE_SERVICE_ROLE_KEY"
require FILE "archive basename, exported by openbox-db-backup.sh"
require CHECKSUM "sha256 hex of the archive, exported by openbox-db-backup.sh"
[ "$missing" = 0 ] || exit 1

# REF and BUCKET are interpolated into a URL; a value containing a slash or a
# quote would silently retarget the upload somewhere else.
case "$REF" in
  *[!a-zA-Z0-9-]*) echo "::error::REF is not a bare project reference"; exit 1 ;;
esac
case "$BUCKET" in
  *[!a-zA-Z0-9._-]*) echo "::error::BUCKET is not a bare bucket name"; exit 1 ;;
esac
[ -f "$FILE" ] || { echo "::error::archive $FILE is not in $(pwd)"; exit 1; }

actual=$(sha256sum "$FILE" | cut -d' ' -f1)
if [ "$actual" != "$CHECKSUM" ]; then
  echo "::error::$FILE does not hash to the recorded checksum (expected $CHECKSUM, got $actual)"
  exit 1
fi

BASE="https://${REF}.supabase.co/storage/v1"
AUTH=(-H "Authorization: Bearer ${KEY}" -H "apikey: ${KEY}")
# Response bodies land here rather than in a fixed /tmp name, so a re-run in the
# same job can never read a stale body and call a failed request a good bucket.
BODIES=$(mktemp -d)
trap 'rm -rf "$BODIES"' EXIT

post() { # <url> <output-file> <content-type> <body-source(@file|inline-json)>
  local url="$1" out="$2" type="$3" body="$4"
  if [ "${body:0:1}" = "@" ]; then
    curl -sS -o "$out" -w "%{http_code}" -X POST "$url" "${AUTH[@]}" \
      -H "Content-Type: ${type}" --data-binary "${body}"
  else
    curl -sS -o "$out" -w "%{http_code}" -X POST "$url" "${AUTH[@]}" \
      -H "Content-Type: ${type}" -d "${body}"
  fi
}

# --- bucket: create it, or accept that it is already there -------------------
code=$(post "$BASE/bucket" "$BODIES"/bucket.json application/json \
  "{\"id\":\"${BUCKET}\",\"name\":\"${BUCKET}\",\"public\":false}") \
  || { echo "::error::could not reach ${BASE}/bucket"; exit 1; }
if grep -q 'BucketAlreadyExists' "$BODIES"/bucket.json 2>/dev/null; then
  echo "bucket already exists (HTTP $code)"
elif [ "${code#2}" != "$code" ]; then
  echo "bucket ready (HTTP $code)"
else
  echo "::error::bucket step returned $code: $(cat "$BODIES"/bucket.json)"
  exit 1
fi

# --- archive ----------------------------------------------------------------
code=$(post "$BASE/object/${BUCKET}/${FILE}" "$BODIES"/upload.json \
  application/gzip "@${FILE}") \
  || { echo "::error::could not upload $FILE"; exit 1; }
case "$code" in
  2??) echo "archive stored: $(cat "$BODIES"/upload.json)" ;;
  *) echo "::error::archive upload returned $code: $(cat "$BODIES"/upload.json)"; exit 1 ;;
esac

# --- manifest, beside the archive rather than in a table that does not exist --
jq -n \
  --arg backup_id "$FILE" \
  --arg location "supabase://${BUCKET}/$FILE" \
  --arg checksum "sha256:$CHECKSUM" \
  --arg kind "$KIND" \
  --arg created_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '[{backup_id:$backup_id,kind:$kind,location:$location,checksum:$checksum,created_at:$created_at,verification_status:"verified"}]' \
  > "${FILE}.manifest.json"

code=$(post "$BASE/object/${BUCKET}/${FILE}.manifest.json" "$BODIES"/manifest.json \
  application/json "@${FILE}.manifest.json") \
  || { echo "::error::could not upload ${FILE}.manifest.json"; exit 1; }
case "$code" in
  2??) echo "manifest stored alongside the archive" ;;
  *) echo "::error::manifest upload returned $code: $(cat "$BODIES"/manifest.json)"; exit 1 ;;
esac
cat "${FILE}.manifest.json"
