#!/usr/bin/env bash
# Setup instance verifikasi LOKAL v1.8 — SQLite + seed + SKENARIO MULTI-PROFIL:
# unit MI memiliki DUA profil aktif (contoh + profil kedua) utk menguji selector.
# Server: http://localhost:3966 — admin / V18-Local-E2e-2026!
set -euo pipefail
cd /home/z/my-project/sirat

DB="/home/z/my-project/sirat/db/local-v18.db"
rm -f "$DB"

echo "== 1. Skema SQLITE =="
npx prisma generate --schema prisma/schema.sqlite.prisma 2>&1 | tail -1
DATABASE_URL="file:$DB" npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate 2>&1 | tail -2

echo "== 2. Seed (units, jenis surat, preset ACTIVE, contoh profil DRAFT) =="
SIRAT_ADMIN_USERNAME=admin SIRAT_ADMIN_PASSWORD='V18-Local-E2e-2026!' \
  DATABASE_URL="file:$DB" node scripts/seed.mjs

echo "== 3. Stop server lama (bila ada) & start standalone :3966 =="
for pidf in /tmp/sirat-v17.pid /tmp/sirat-v18.pid; do
  [ -f "$pidf" ] && kill "$(cat "$pidf")" 2>/dev/null || true
done
# Bunuh proses yang masih memegang port 3966 (server lama + child next-server)
fuser -k 3966/tcp 2>/dev/null || true
sleep 2
rm -f /tmp/sirat-v18.log
DATABASE_URL="file:$DB" SESSION_SECRET='local-v18-test-secret-0123456789abcdef012345' \
  SIRAT_ARCHIVE_ROOT=/tmp/sirat-v18-archive PORT=3966 \
  NODE_ENV=production nohup node .next/standalone/server.js > /tmp/sirat-v18.log 2>&1 &
echo $! > /tmp/sirat-v18.pid
sleep 4
curl -s -o /dev/null -w "health root: %{http_code}\n" http://localhost:3966/ || true
echo "PID: $(cat /tmp/sirat-v18.pid)"

echo "== 4. Skenario multi-profil unit MI (via API sbg admin) =="
LOGIN=$(curl -s -c /tmp/v18-cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"V18-Local-E2e-2026!"}' \
  http://localhost:3966/api/auth/login)
MI_ID=$(DATABASE_URL="file:$DB" node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.unit.findUnique({where:{code:'MI'}}).then(u=>{console.log(u.id);return p.\$disconnect()})")
echo "MI unit: $MI_ID"

# a) Aktivasi profil contoh MI (v1 DRAFT -> ACTIVE)
EXAMPLE_VER=$(DATABASE_URL="file:$DB" node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.numberingProfileVersion.findFirst({where:{status:'DRAFT',profile:{ownerId:'$MI_ID'}},orderBy:{version:'desc'}}).then(v=>{console.log(v.id);return p.\$disconnect()})")
curl -s -b /tmp/v18-cookies.txt -H 'Content-Type: application/json' \
  -d "{\"versionId\":\"$EXAMPLE_VER\",\"resetPolicy\":\"YEARLY\",\"dateSource\":\"LETTER_DATE\"}" \
  http://localhost:3966/api/numbering-profiles/activate | head -c 200; echo

# b) Buat + aktivasi profil KEDUA utk MI (format ringkas tanpa dropdown arah)
DSL2='{"version":2,"separator":"/","fields":[],"components":[{"type":"sequence","padding":3},{"type":"letterTypeCode"},{"type":"unitCode"},{"type":"letterDate","format":"MONTH_ROMAN"},{"type":"letterDate","format":"YEAR_4"}],"policy":{"resetPolicy":"ALL","dateSource":"LETTER_DATE"}}'
P2=$(curl -s -b /tmp/v18-cookies.txt -H 'Content-Type: application/json' \
  -d "{\"name\":\"Profil Kedua MI (Ringkas)\",\"ownerId\":\"$MI_ID\",\"dsl\":$DSL2}" \
  http://localhost:3966/api/numbering-profiles)
P2_VER=$(echo "$P2" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).version.id))")
curl -s -b /tmp/v18-cookies.txt -H 'Content-Type: application/json' \
  -d "{\"versionId\":\"$P2_VER\",\"resetPolicy\":\"ALL\",\"dateSource\":\"LETTER_DATE\"}" \
  http://localhost:3966/api/numbering-profiles/activate | head -c 200; echo

echo "== Selesai — MI kini punya 2 profil aktif (contoh + ringkas) =="
