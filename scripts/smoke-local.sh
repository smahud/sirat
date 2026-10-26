#!/usr/bin/env bash
# Smoke test lokal alur SIRAT (dev server localhost:3000)
set -uo pipefail
BASE_URL="http://localhost:3000"
JAR="/tmp/sirat-cookies.txt"
rm -f "$JAR"

say() { echo -e "\n== $1 =="; }
fail() { echo "❌ GAGAL: $1"; exit 1; }

say "1. Login admin"
LOGIN=$(curl -s -c "$JAR" -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Sirat-Dev-2026!"}')
echo "$LOGIN" | grep -q '"role":"SYSTEM_ADMIN"' || fail "login: $LOGIN"
echo "✓ login OK"

say "2. /api/auth/me"
ME=$(curl -s -b "$JAR" "$BASE_URL/api/auth/me")
echo "$ME" | grep -q 'SYSTEM_ADMIN' || fail "me: $ME"
echo "✓ session OK"

say "3. Ambil units & letter types & profil"
UNITS=$(curl -s -b "$JAR" "$BASE_URL/api/units")
YAPSI_ID=$(echo "$UNITS" | python3 -c "import sys,json; print([u['id'] for u in json.load(sys.stdin)['units'] if u['code']=='YAPSI'][0])")
MI_ID=$(echo "$UNITS" | python3 -c "import sys,json; print([u['id'] for u in json.load(sys.stdin)['units'] if u['code']=='MI'][0])")
TYPES=$(curl -s -b "$JAR" "$BASE_URL/api/letter-types")
SPR_ID=$(echo "$TYPES" | python3 -c "import sys,json; print([t['id'] for t in json.load(sys.stdin)['letterTypes'] if t['code']=='SPR'][0])")
PROFILES=$(curl -s -b "$JAR" "$BASE_URL/api/numbering-profiles")
VERSION_ID=$(echo "$PROFILES" | python3 -c "import sys,json; print(json.load(sys.stdin)['profiles'][0]['versions'][0]['id'])")
echo "✓ YAPSI=$YAPSI_ID MI=$MI_ID SPR=$SPR_ID version=$VERSION_ID"

say "4. Aktivasi profil preset YAPSI (reset ALL, sumber tanggal surat)"
ACT=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles/activate" -H 'Content-Type: application/json' \
  -d "{\"versionId\":\"$VERSION_ID\",\"resetPolicy\":\"ALL\",\"dateSource\":\"LETTER_DATE\"}")
echo "$ACT" | grep -q 'ACTIVE' || fail "activate: $ACT"
echo "✓ profil aktif"

say "5. Preview nomor (harus estimasi 001/...)"
PREV=$(curl -s -b "$JAR" "$BASE_URL/api/letters/preview?unitId=$YAPSI_ID&direction=INTERNAL&letterTypeId=$SPR_ID&letterDate=2026-10-26")
echo "$PREV" | grep -q '001/A/SPR/YAPSI-DS/X/2026' || fail "preview: $PREV"
echo "$PREV" | grep -q 'bukan reservasi' || fail "preview note hilang"
echo "✓ preview OK (perkiraan, bukan reservasi)"

say "6. Buat draft surat"
DRAFT=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$YAPSI_ID\",\"direction\":\"INTERNAL\",\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-26\",\"recipient\":\"Kepala MI\",\"subject\":\"Uji coba penerbitan\"}")
LETTER_ID=$(echo "$DRAFT" | python3 -c "import sys,json; print(json.load(sys.stdin)['letter']['id'])")
[ -n "$LETTER_ID" ] || fail "draft: $DRAFT"
echo "✓ draft $LETTER_ID"

say "7. Terbitkan dengan Idempotency-Key"
ISSUE1=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$LETTER_ID/issue" -H "Idempotency-Key: smoke-key-0001")
echo "$ISSUE1" | grep -q '001/A/SPR/YAPSI-DS/X/2026' || fail "issue: $ISSUE1"
echo "✓ nomor resmi: $(echo "$ISSUE1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["officialNumber"])')"

say "8. Retry dengan key sama → surat sama (idempotent)"
ISSUE2=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$LETTER_ID/issue" -H "Idempotency-Key: smoke-key-0001")
[ "$(echo "$ISSUE1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["officialNumber"])')" = "$(echo "$ISSUE2" | python3 -c 'import sys,json;print(json.load(sys.stdin)["officialNumber"])')" ] || fail "idempotent: $ISSUE2"
echo "✓ idempotency OK"

say "9. Draft kedua → terbit → nomor 002"
DRAFT2=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$YAPSI_ID\",\"direction\":\"EXTERNAL\",\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-26\",\"recipient\":\"Dinas Pendidikan\",\"subject\":\"Uji eksternal\"}")
L2=$(echo "$DRAFT2" | python3 -c "import sys,json; print(json.load(sys.stdin)['letter']['id'])")
ISSUE3=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$L2/issue" -H "Idempotency-Key: smoke-key-0002")
echo "$ISSUE3" | grep -q '002/B/SPR/YAPSI-DS/X/2026' || fail "issue2: $ISSUE3"
echo "✓ counter increment OK: 002/B"

say "10. Pembatalan surat 002 + alasan"
CANCEL=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$L2/cancel" -H 'Content-Type: application/json' \
  -d '{"reason":"Uji pembatalan otomatis — surat pengganti menyusul"}')
echo "$CANCEL" | grep -q 'CANCELLED' || fail "cancel: $CANCEL"
echo "✓ cancel OK (nomor 002 tidak dipakai ulang)"

say "11. Draft ketiga → harus dapat 003 (bukan 002)"
DRAFT3=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$YAPSI_ID\",\"direction\":\"INTERNAL\",\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-26\",\"recipient\":\"X\",\"subject\":\"Setelah batal\"}")
L3=$(echo "$DRAFT3" | python3 -c "import sys,json; print(json.load(sys.stdin)['letter']['id'])")
ISSUE4=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$L3/issue" -H "Idempotency-Key: smoke-key-0003")
echo "$ISSUE4" | grep -q '003/A/SPR/YAPSI-DS/X/2026' || fail "issue3 harus 003: $ISSUE4"
echo "✓ nomor tidak dipakai ulang: 003"

say "12. Upload berkas ke surat (PDF valid + TXT)"
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF' > /tmp/test.pdf
printf 'Isi berkas teks uji SIRAT' > /tmp/test.txt
UP=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$LETTER_ID/files" \
  -H "x-file-name: surat-uji.pdf" -H "x-file-label: original" -H "Content-Type: application/pdf" \
  --data-binary @/tmp/test.pdf)
echo "$UP" | grep -q 'READY' || fail "upload pdf: $UP"
UP2=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$LETTER_ID/files" \
  -H "x-file-name: catatan.txt" -H "x-file-label: attachment" -H "Content-Type: text/plain" \
  --data-binary @/tmp/test.txt)
echo "$UP2" | grep -q 'READY' || fail "upload txt: $UP2"
echo "✓ upload valid OK"

say "13. Upload ditolak: ekstensi palsu (exe dengan nama .pdf)"
printf 'MZ\x90\x00fake-executable' > /tmp/fake.pdf
UP3=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$LETTER_ID/files" \
  -H "x-file-name: bohongan.pdf" -H "Content-Type: application/pdf" \
  --data-binary @/tmp/fake.pdf)
echo "$UP3" | grep -q 'UNSUPPORTED_TYPE\|EXTENSION_MISMATCH' || fail "upload fake harus ditolak: $UP3"
echo "✓ validasi magic bytes OK (ditolak)"

say "14. Download berkas (harus 200 + attachment)"
VER_ID=$(curl -s -b "$JAR" "$BASE_URL/api/letters/$LETTER_ID" | python3 -c "import sys,json; d=json.load(sys.stdin)['letter']; print(d['files'][0]['versions'][0]['id'])")
DL=$(curl -s -b "$JAR" -o /tmp/unduhan.pdf -w '%{http_code}' "$BASE_URL/api/archive-versions/$VER_ID/download")
[ "$DL" = "200" ] || fail "download: $DL"
cmp -s /tmp/test.pdf /tmp/unduhan.pdf || fail "isi unduhan beda"
echo "✓ download + checksum cocok"

say "15. Reupload sebagai versi baru"
UP4=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$LETTER_ID/files" \
  -H "x-file-name: surat-uji-v2.pdf" -H "x-replace-file-id: $(echo "$UP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["archiveFileId"])')" -H "Content-Type: application/pdf" \
  --data-binary @/tmp/test.pdf)
echo "$UP4" | grep -q '"versionNo":2' || fail "versi baru: $UP4"
echo "✓ versi arsip baru OK"

say "16. Akses tanpa login → 401"
ANON=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/letters")
[ "$ANON" = "401" ] || fail "anon letters: $ANON"
ANON2=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/archive-versions/$VER_ID/download")
[ "$ANON2" = "401" ] || fail "anon download: $ANON2"
echo "✓ deny-by-default OK"

say "17. Health + integrity scan"
HEALTH=$(curl -s -b "$JAR" "$BASE_URL/api/health")
echo "$HEALTH" | grep -q '"ok":true' || fail "health: $HEALTH"
SCAN=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/health/integrity-scan")
echo "$SCAN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('scanned', d['scanned'], 'ok', d['ok'], 'missing', len(d['missing']), 'orphans', len(d['orphans']))"
echo "✓ health OK"

say "18. Audit trail terisi"
AUDIT=$(curl -s -b "$JAR" "$BASE_URL/api/audit?action=letter.")
echo "$AUDIT" | grep -q 'letter.issue' || fail "audit: $AUDIT"
echo "✓ audit OK"

say "19. Export CSV"
CSV=$(curl -s -b "$JAR" "$BASE_URL/api/export/letters.csv")
echo "$CSV" | grep -q '001/A/SPR/YAPSI-DS/X/2026' || fail "csv: $CSV"
echo "✓ export CSV OK"

echo -e "\n=============================="
echo "✅ SEMUA SMOKE TEST LOKAL LULUS"
echo "=============================="
