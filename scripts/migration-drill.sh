#!/usr/bin/env bash
#
# Phase 7 migration drill (CLAUDE.md §8). Proves the headline requirement:
#   greenfield instance + the ONE encrypted file + the original password
#   ⇒ all data (clients, controls, evidence incl. uploaded files) is present;
#   and a wrong password is rejected.
#
# Container A creates data → stop A (graceful checkpoint→single file) →
# copy ONLY aegis.db into a brand-new dir → fresh container B → unlock → verify.
set -euo pipefail

IMAGE="aegis-grc:latest"
PASS="MigrationDrill-2026-Secret"
WRONG="not-the-right-password"
ROOT="/tmp/aegis-migration"
A_DATA="$ROOT/dataA"; A_CERTS="$ROOT/certsA"
B_DATA="$ROOT/dataB"; B_CERTS="$ROOT/certsB"
A_URL="https://localhost:8443"
B_URL="https://localhost:8444"
JAR="$ROOT/cookies.txt"
EVIDENCE_FILE="$ROOT/evidence-upload.txt"
EVIDENCE_CONTENT="EVIDENCE-FILE-CONTENT-9f3a-inside-the-encrypted-db"

jqf() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const p=process.argv[1];console.log(eval("o"+(p[0]==="["?p:"."+p)))})' "$1"; }
hr() { printf '\n========== %s ==========\n' "$1"; }

cleanup() { docker rm -f aegisA aegisB >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
rm -rf "$ROOT"; mkdir -p "$A_DATA" "$A_CERTS" "$B_DATA" "$B_CERTS"
printf '%s' "$EVIDENCE_CONTENT" > "$EVIDENCE_FILE"

wait_healthy() { # $1=url
  for i in $(seq 1 30); do
    if curl -sk "$1/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "FAIL: server at $1 never became reachable"; exit 1
}

hr "1. Start container A (volume dataA)"
docker run -d --name aegisA -p 8443:8443 \
  -v "$A_DATA:/data" -v "$A_CERTS:/certs" "$IMAGE" >/dev/null
wait_healthy "$A_URL"
echo "A is up: $(curl -sk $A_URL/api/health)"

hr "2. Create master password + data on A"
CREATE=$(curl -sk -c "$JAR" -X POST "$A_URL/api/auth/create" \
  -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d "{\"password\":\"$PASS\"}")
CSRF=$(printf '%s' "$CREATE" | jqf csrfToken)
echo "created master password; csrf acquired"

CID=$(curl -sk -b "$JAR" -X POST "$A_URL/api/clients" \
  -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"name":"Migrated Client Co","description":"drill engagement"}' | jqf id)
echo "created client id=$CID (93 controls seeded)"

ROW=$(curl -sk -b "$JAR" "$A_URL/api/clients/$CID/controls?theme=A.8" | jqf '[0].id')
echo "first A.8 control row id=$ROW"

curl -sk -b "$JAR" -X PATCH "$A_URL/api/clients/$CID/controls/$ROW" \
  -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"status":"implemented","owner":"Jane Auditor","due_date":"2026-09-30","implementation_notes":"Cryptography policy in place."}' >/dev/null
echo "set control $ROW → implemented"

curl -sk -b "$JAR" -X POST "$A_URL/api/clients/$CID/controls/$ROW/evidence" \
  -H "Content-Type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"kind":"link","label":"Crypto policy","url":"https://example.com/crypto-policy"}' >/dev/null
echo "added link evidence"

curl -sk -b "$JAR" -X POST "$A_URL/api/clients/$CID/controls/$ROW/evidence/file" \
  -H "x-csrf-token: $CSRF" \
  -F "label=Signed approval.txt" -F "file=@$EVIDENCE_FILE" >/dev/null
echo "uploaded file evidence (stored as blob inside the encrypted DB)"

# Snapshot A's state for comparison.
A_IMPL=$(curl -sk -b "$JAR" "$A_URL/api/clients/$CID/dashboard" | jqf implemented)
A_EVID=$(curl -sk -b "$JAR" "$A_URL/api/clients/$CID/controls/$ROW/evidence" | jqf length)
echo "A snapshot → implemented=$A_IMPL, evidence_items=$A_EVID"

hr "3. Stop A gracefully (SIGTERM → checkpoint → single self-contained file)"
docker stop aegisA >/dev/null
echo "A stopped. dataA contents:"; ls -la "$A_DATA"
if [ -f "$A_DATA/aegis.db-wal" ]; then echo "FAIL: -wal still present"; exit 1; fi
echo "single-file confirmed (no -wal/-shm)"

hr "4. Copy ONLY aegis.db into a brand-new greenfield dir (dataB)"
cp "$A_DATA/aegis.db" "$B_DATA/aegis.db"
echo "copied $(ls -la "$B_DATA/aegis.db" | awk '{print $5}') bytes; dataB now:"; ls -la "$B_DATA"
echo "raw header (must NOT be 'SQLite format 3'):"; head -c 16 "$B_DATA/aegis.db" | xxd | head -1

hr "5. Start FRESH container B on dataB (different container, different port)"
docker run -d --name aegisB -p 8444:8443 \
  -v "$B_DATA:/data" -v "$B_CERTS:/certs" "$IMAGE" >/dev/null
wait_healthy "$B_URL"
STATUS=$(curl -sk "$B_URL/api/auth/status")
echo "B status: $STATUS"
echo "$STATUS" | grep -q '"needsSetup":false' || { echo "FAIL: B should see existing file"; exit 1; }

hr "6. Wrong password is REJECTED on B"
CODE=$(curl -sk -o /dev/null -w '%{http_code}' -X POST "$B_URL/api/auth/unlock" \
  -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d "{\"password\":\"$WRONG\"}")
echo "wrong-password unlock → HTTP $CODE"
[ "$CODE" = "401" ] || { echo "FAIL: wrong password should be 401"; exit 1; }

hr "7. Correct password unlocks B and ALL data is present"
rm -f "$JAR"
UNLOCK=$(curl -sk -c "$JAR" -X POST "$B_URL/api/auth/unlock" \
  -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d "{\"password\":\"$PASS\"}")
CSRFB=$(printf '%s' "$UNLOCK" | jqf csrfToken)
echo "unlocked B with the original password"

B_CLIENTS=$(curl -sk -b "$JAR" "$B_URL/api/clients")
B_CNAME=$(printf '%s' "$B_CLIENTS" | jqf '[0].name')
B_CID=$(printf '%s' "$B_CLIENTS" | jqf '[0].id')
B_CONTROLS=$(curl -sk -b "$JAR" "$B_URL/api/clients/$B_CID/controls" | jqf length)
B_IMPL=$(curl -sk -b "$JAR" "$B_URL/api/clients/$B_CID/dashboard" | jqf implemented)
B_EVID=$(curl -sk -b "$JAR" "$B_URL/api/clients/$B_CID/controls/$ROW/evidence")
B_EVID_N=$(printf '%s' "$B_EVID" | jqf length)
FILE_ID=$(printf '%s' "$B_EVID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const f=a.find(e=>e.kind==="file");console.log(f?f.id:"")})')
DL=$(curl -sk -b "$JAR" "$B_URL/api/evidence/$FILE_ID/download")

echo "B client name:        $B_CNAME"
echo "B controls count:     $B_CONTROLS (expect 93)"
echo "B implemented:        $B_IMPL (expect $A_IMPL)"
echo "B evidence items:     $B_EVID_N (expect $A_EVID)"
echo "B downloaded file:    '$DL'"
echo "expected file bytes:  '$EVIDENCE_CONTENT'"

hr "RESULT"
FAIL=0
[ "$B_CNAME" = "Migrated Client Co" ] || { echo "✗ client name mismatch"; FAIL=1; }
[ "$B_CONTROLS" = "93" ] || { echo "✗ controls != 93"; FAIL=1; }
[ "$B_IMPL" = "$A_IMPL" ] || { echo "✗ implemented mismatch"; FAIL=1; }
[ "$B_EVID_N" = "$A_EVID" ] || { echo "✗ evidence count mismatch"; FAIL=1; }
[ "$DL" = "$EVIDENCE_CONTENT" ] || { echo "✗ uploaded file bytes mismatch"; FAIL=1; }
if [ "$FAIL" = "0" ]; then
  echo "✓ MIGRATION DRILL PASSED — all clients/controls/evidence (incl. uploaded file) migrated; wrong password rejected."
else
  echo "✗ MIGRATION DRILL FAILED"; exit 1
fi
