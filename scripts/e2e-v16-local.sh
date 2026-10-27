#!/usr/bin/env bash
# E2E v1.6 lokal — Dynamic Numbering Profile Builder pada build PRODUKSI (standalone)
# dengan SQLite. Menguji: migrasi v1→v2, dropdown multipel, preview fieldValues,
# validasi BE, penerbitan + snapshot, metadata field, kompatibilitas legacy.
set -uo pipefail
BASE_URL="http://localhost:3966"
JAR="/tmp/sirat-v16-cookies.txt"
rm -f "$JAR"

PASS=0; FAIL=0
say() { echo -e "\n== $1 =="; }
ck() { # ck <nama> <kondisi 0/1> <detail>
  if [ "$2" = "0" ]; then echo "  [PASS] $1 ${3:+($3)}"; PASS=$((PASS+1)); else echo "  [GAGAL] $1 ${3:+($3)}"; FAIL=$((FAIL+1)); fi
}
jsonget() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

say "A. Login admin hasil seed"
LOGIN=$(curl -s -c "$JAR" -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"V16-Local-E2e-2026!"}')
echo "$LOGIN" | grep -q 'SYSTEM_ADMIN'; ck "login admin" $?
ME=$(curl -s -b "$JAR" "$BASE_URL/api/auth/me")
echo "$ME" | grep -q 'SYSTEM_ADMIN'; ck "session me" $?

UNITS=$(curl -s -b "$JAR" "$BASE_URL/api/units")
YAPSI_ID=$(echo "$UNITS" | python3 -c "import sys,json; print([u['id'] for u in json.load(sys.stdin)['units'] if u['code']=='YAPSI'][0])")
MI_ID=$(echo "$UNITS" | python3 -c "import sys,json; print([u['id'] for u in json.load(sys.stdin)['units'] if u['code']=='MI'][0])")
KB_ID=$(echo "$UNITS" | python3 -c "import sys,json; print([u['id'] for u in json.load(sys.stdin)['units'] if u['code']=='KB'][0])")
TYPES=$(curl -s -b "$JAR" "$BASE_URL/api/letter-types")
SPR_ID=$(echo "$TYPES" | python3 -c "import sys,json; print([t['id'] for t in json.load(sys.stdin)['letterTypes'] if t['code']=='SPR'][0])")

say "B. Migrasi v1→v2: profil preset lama (DSL v1 di-plant manual ke DB) terbaca ekuivalen"
# Plant profil v1 (persis format produksi lama) langsung ke DB sqlite
V1_DSL='{"version":1,"separator":"/","components":[{"type":"sequence","padding":3},{"type":"direction","mapping":{"INTERNAL":"A","EXTERNAL":"B"}},{"type":"letterTypeCode"},{"type":"literal","value":"YAPSI-DS"},{"type":"letterDate","format":"MONTH_ROMAN"},{"type":"letterDate","format":"YEAR_4"}]}'
V1_OUT=$(DATABASE_URL="file:/home/z/my-project/sirat/db/local-e2e.db" node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const unit = await p.unit.findFirst({ where: { code: 'MI' } });
  const prof = await p.numberingProfile.create({ data: { name: 'Legacy v1 (migrasi)', ownerId: unit.id } });
  const ver = await p.numberingProfileVersion.create({ data: { profileId: prof.id, version: 1, status: 'DRAFT', dsl: process.argv[1] } });
  console.log(ver.id);
  await p.\$disconnect();
})(process.argv);
" "$V1_DSL" 2>&1 | tail -1)
V1_VERSION_ID="$V1_OUT"
[ -n "$V1_VERSION_ID" ] && [ "$V1_VERSION_ID" != "undefined" ]; ck "profil v1 di-plant" $? "version=$V1_VERSION_ID"

# Aktivasi profil v1 lama → backend parse v1, upgrade transparan, harus lolos validasi
ACT_V1=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles/activate" -H 'Content-Type: application/json' \
  -d "{\"versionId\":\"$V1_VERSION_ID\",\"resetPolicy\":\"ALL\",\"dateSource\":\"LETTER_DATE\"}")
echo "$ACT_V1" | grep -q 'ACTIVE'; ck "aktivasi profil v1 (upgrade runtime)" $?

# Preview unit MI (profil v1 aktif) via fieldValues v2 — render harus pakai kode A
PREV_V1=$(curl -s -b "$JAR" "$BASE_URL/api/letters/preview?unitId=$MI_ID&letterTypeId=$SPR_ID&letterDate=2026-10-27&fields=%7B%22arah_surat%22%3A%22internal%22%7D")
echo "$PREV_V1" | grep -q '001/A/SPR/YAPSI-DS/X/2026'; ck "preview profil v1 via fieldValues v2 (kode A)" $?
FIELDS_N=$(echo "$PREV_V1" | jsonget "['fields']" | wc -w)
[ "$FIELDS_N" -gt "5" ]; ck "preview mengembalikan spec fields dinamis" $? "fields ada"

# Preview draft lama pakai param legacy direction — fallback legacyKey
PREV_LEG=$(curl -s -b "$JAR" "$BASE_URL/api/letters/preview?unitId=$MI_ID&letterTypeId=$SPR_ID&letterDate=2026-10-27&direction=EXTERNAL")
echo "$PREV_LEG" | grep -q '/B/SPR'; ck "preview legacy direction=EXTERNAL → kode B (fallback migrasi)" $?

say "C. Profil v2 dengan DUA dropdown independen + metadata (B.2/F.2)"
DSL2='{"version":2,"separator":"/","fields":[
{"type":"dropdown","key":"arah_surat","label":"Arah Surat","placeholder":"Pilih arah","helperText":null,
 "options":[{"id":"internal","label":"Internal","code":"A","active":true},{"id":"eksternal","label":"Eksternal","code":"B","active":true},{"id":"khusus","label":"Khusus","code":"K","active":false}],
 "defaultOptionId":null,"required":true,"order":0},
{"type":"dropdown","key":"klasifikasi","label":"Klasifikasi","placeholder":null,"helperText":"Tingkat klasifikasi dokumen",
 "options":[{"id":"biasa","label":"Biasa","code":"N","active":true},{"id":"rahasia","label":"Rahasia","code":"R","active":true}],
 "defaultOptionId":"biasa","required":false,"order":1},
{"type":"dropdown","key":"sifat","label":"Sifat Surat","placeholder":null,"helperText":null,
 "options":[{"id":"penting","label":"Penting","code":"P","active":true},{"id":"segera","label":"Segera","code":"S","active":true}],
 "defaultOptionId":null,"required":false,"order":2}],
"components":[{"type":"sequence","padding":3},{"type":"fieldRef","field":"arah_surat"},{"type":"fieldRef","field":"klasifikasi"},{"type":"letterTypeCode"},{"type":"literal","value":"YAPSI"},{"type":"letterDate","format":"MONTH_ROMAN"},{"type":"letterDate","format":"YEAR_4"}],
"policy":{"resetPolicy":"ALL","dateSource":"LETTER_DATE"}}'
CREATE2=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Profil Dua Dropdown (v1.6)\",\"ownerId\":\"$KB_ID\",\"dsl\":$DSL2}")
P2_ID=$(echo "$CREATE2" | jsonget "['profile']['id']")
V2_ID=$(echo "$CREATE2" | jsonget "['version']['id']")
[ -n "$P2_ID" ] && [ "$P2_ID" != "None" ]; ck "profil v2 dua dropdown dibuat (DRAFT)" $? "profile=$P2_ID"
[ -n "$V2_ID" ] && [ "$V2_ID" != "None" ]; ck "response menyertakan version (untuk aktivasi builder)" $?

# Validasi server harus lolos + contoh render
VAL=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles/validate" -H 'Content-Type: application/json' \
  -d "{\"dsl\":$DSL2,\"sample\":{\"seq\":7,\"letterTypeCode\":\"SPR\",\"unitCode\":\"YAPSI\",\"letterDate\":\"2026-10-27\",\"fieldValues\":{\"arah_surat\":\"eksternal\",\"klasifikasi\":\"rahasia\"}}}")
echo "$VAL" | grep -q '"ok":true'; ck "validasi server profil dua dropdown" $?
echo "$VAL" | grep -q '007/B/R/SPR/YAPSI/X/2026'; ck "contoh render 007/B/R/SPR/YAPSI/X/2026" $?

say "D. Validasi BE menolak input tidak valid (E.3/F.7)"
# kode mengandung karakter terlarang
BAD1=$(echo "$DSL2" | sed 's/"code":"N"/"code":"N\/X"/')
R1=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles/validate" -H 'Content-Type: application/json' -d "{\"dsl\":$BAD1}")
echo "$R1" | grep -q '"ok":false'; ck "kode terlarang '/' ditolak" $?
# kunci duplikat
BAD2=$(echo "$DSL2" | sed 's/"key":"klasifikasi"/"key":"arah_surat"/')
R2=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles" -H 'Content-Type: application/json' -d "{\"name\":\"x\",\"ownerId\":\"$KB_ID\",\"dsl\":$BAD2}")
[ "$R2" = "409" ] || [ "$R2" = "400" ]; ck "kunci duplikat ditolak BE ($R2)" $?
# fieldRef merujuk field hantu
BAD3=$(echo "$DSL2" | sed 's/"field":"klasifikasi"/"field":"hantu"/')
R3=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles/validate" -H 'Content-Type: application/json' -d "{\"dsl\":$BAD3}")
echo "$R3" | grep -q '"ok":false'; ck "fieldRef ke field tidak ada ditolak" $?

say "E. Aktivasi profil dua dropdown + alur penerbitan penuh"
ACT2=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/numbering-profiles/activate" -H 'Content-Type: application/json' \
  -d "{\"versionId\":\"$V2_ID\",\"resetPolicy\":\"ALL\",\"dateSource\":\"LETTER_DATE\"}")
echo "$ACT2" | grep -q 'ACTIVE'; ck "aktivasi profil dua dropdown" $?

# Preview dengan pilihan operator — berubah langsung (F.4)
PV1=$(curl -s -b "$JAR" "$BASE_URL/api/letters/preview?unitId=$KB_ID&letterTypeId=$SPR_ID&letterDate=2026-10-27&fields=%7B%22arah_surat%22%3A%22eksternal%22%2C%22klasifikasi%22%3A%22rahasia%22%7D")
echo "$PV1" | grep -q '001/B/R/SPR/YAPSI/X/2026'; ck "preview eksternal+rahasia → 001/B/R" $?
PV2=$(curl -s -b "$JAR" "$BASE_URL/api/letters/preview?unitId=$KB_ID&letterTypeId=$SPR_ID&letterDate=2026-10-27&fields=%7B%22arah_surat%22%3A%22internal%22%7D")
echo "$PV2" | grep -q '001/A/N/SPR/YAPSI/X/2026'; ck "preview internal (klasifikasi pakai default N)" $?

# Draft + terbit dengan fieldValues
D1=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$KB_ID\",\"fieldValues\":{\"arah_surat\":\"eksternal\",\"klasifikasi\":\"rahasia\",\"sifat\":\"penting\"},\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-27\",\"recipient\":\"Dinas\",\"subject\":\"Uji dua dropdown\"}")
L1=$(echo "$D1" | jsonget "['letter']['id']")
[ -n "$L1" ] && [ "$L1" != "None" ]; ck "draft dengan fieldValues dibuat" $?
I1=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$L1/issue" -H "Idempotency-Key: v16-e2e-001")
echo "$I1" | grep -q '001/B/R/SPR/YAPSI/X/2026'; ck "nomor resmi 001/B/R/SPR/YAPSI/X/2026 (dua kode dropdown)" $?

# Snapshot berisi label + kode (E.7) — parse JSON (bukan grep string ter-escape)
DET=$(curl -s -b "$JAR" "$BASE_URL/api/letters/$L1")
SNAP_OK=$(echo "$DET" | python3 -c "
import sys, json
d = json.load(sys.stdin)['letter']
snap = json.loads(d['numberSnapshot'])
fv = snap['inputs']['fieldValues']
ok1 = fv.get('arah_surat') == {'optionId':'eksternal','label':'Eksternal','code':'B'}
ok2 = fv.get('klasifikasi') == {'optionId':'rahasia','label':'Rahasia','code':'R'}
ok3 = fv.get('sifat') == {'optionId':'penting','label':'Penting','code':'P'}
col = json.loads(d['fieldValues'])
ok4 = col == {'arah_surat':'eksternal','klasifikasi':'rahasia','sifat':'penting'}
print('1' if ok1 and ok2 and ok3 and ok4 else '0')")
[ "$SNAP_OK" = "1" ]; ck "snapshot label+kode semua field (arah, klasifikasi, sifat metadata) + kolom fieldValues (E.7)" $?

say "F. Penolakan validasi saat draft/terbit (E.4/E.5/F.7)"
# opsi tidak dikenal
FV_BAD=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$KB_ID\",\"fieldValues\":{\"arah_surat\":\"hantu\"},\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-27\"}")
[ "$FV_BAD" = "400" ]; ck "opsi tidak dikenal ditolak 400" $?
# opsi nonaktif (khusus)
FV_INACT=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$KB_ID\",\"fieldValues\":{\"arah_surat\":\"khusus\"},\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-27\"}")
[ "$FV_INACT" = "400" ]; ck "opsi nonaktif ditolak 400" $?
# field wajib kosong (arah_surat required tanpa default)
D2=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$KB_ID\",\"fieldValues\":{},\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-27\",\"recipient\":\"X\",\"subject\":\"Kosong\"}")
L2=$(echo "$D2" | jsonget "['letter']['id']")
I2=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$L2/issue" -H "Idempotency-Key: v16-e2e-002")
echo "$I2" | grep -q 'FIELD_MISSING_REQUIRED'; ck "terbit tanpa field wajib → FIELD_MISSING_REQUIRED" $?
# klasifikasi opsional boleh kosong (pakai default)
D3=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters" -H 'Content-Type: application/json' \
  -d "{\"issuingUnitId\":\"$KB_ID\",\"fieldValues\":{\"arah_surat\":\"internal\"},\"letterTypeId\":\"$SPR_ID\",\"letterDate\":\"2026-10-27\",\"recipient\":\"Y\",\"subject\":\"Minimal\"}")
L3=$(echo "$D3" | jsonget "['letter']['id']")
I3=$(curl -s -b "$JAR" -X POST "$BASE_URL/api/letters/$L3/issue" -H "Idempotency-Key: v16-e2e-003")
echo "$I3" | grep -q '002/A/N/SPR/YAPSI/X/2026'; ck "field opsional tanpa isi → default dipakai (002/A/N)" $?

say "H. PUT draft-mode & guard (versioning) — SEBELUM versi baru dibuat"
# PUT mode draft saat tidak ada draft terbuka → 409 NO_OPEN_DRAFT
PUTD=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT "$BASE_URL/api/numbering-profiles" -H 'Content-Type: application/json' \
  -d "{\"profileId\":\"$P2_ID\",\"dsl\":$DSL2,\"mode\":\"draft\"}")
[ "$PUTD" = "409" ]; ck "PUT tanpa draft terbuka → 409 NO_OPEN_DRAFT" $?

say "G. Nomor historis tak berubah saat konfigurasi diedit (E.8) + counter aman (F.9)"
# Ubah label+kode klasifikasi lewat versi baru → nomor lama tetap
DSL2B=$(echo "$DSL2" | sed 's/"label":"Biasa","code":"N"/"label":"Umum","code":"U"/')
PUTV=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT "$BASE_URL/api/numbering-profiles" -H 'Content-Type: application/json' \
  -d "{\"profileId\":\"$P2_ID\",\"dsl\":$DSL2B,\"mode\":\"new\"}")
[ "$PUTV" = "201" ]; ck "versi baru dibuat (mode new) ($PUTV)" $?
DET1=$(curl -s -b "$JAR" "$BASE_URL/api/letters/$L1")
echo "$DET1" | grep -q '001/B/R/SPR/YAPSI/X/2026'; ck "nomor surat lama tetap 001/B/R setelah edit konfigurasi" $?
SNAP_OLD=$(echo "$DET1" | python3 -c "
import sys, json
d = json.load(sys.stdin)['letter']
fv = json.loads(d['numberSnapshot'])['inputs']['fieldValues']
print('1' if fv.get('klasifikasi') == {'optionId':'rahasia','label':'Rahasia','code':'R'} else '0')")
[ "$SNAP_OLD" = "1" ]; ck "snapshot surat lama tetap label/kode lama (E.7/E.8)" $?
# Draft terbuka kini ada → PUT draft mode harus 200
PUTD2=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT "$BASE_URL/api/numbering-profiles" -H 'Content-Type: application/json' \
  -d "{\"profileId\":\"$P2_ID\",\"dsl\":$DSL2,\"mode\":\"draft\"}")
[ "$PUTD2" = "200" ]; ck "PUT dengan draft terbuka → 200 (update draft)" $?

echo -e "\n=============================="
echo "HASIL: PASS=$PASS FAIL=$FAIL"
echo "=============================="
[ "$FAIL" = "0" ]
