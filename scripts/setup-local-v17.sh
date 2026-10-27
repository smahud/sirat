#!/usr/bin/env bash
# Setup instance verifikasi LOKAL v1.7 — build standalone + SQLite + seed + contoh profil.
# Menghasilkan server di http://localhost:3966 dengan admin admin / V17-Local-E2e-2026!
set -euo pipefail
cd /home/z/my-project/sirat

DB="/home/z/my-project/sirat/db/local-v17.db"
rm -f "$DB"

echo "== 1. Generate prisma client SQLITE (root + standalone hasil build sudah sqlite) =="
npx prisma generate --schema prisma/schema.sqlite.prisma 2>&1 | tail -1
DATABASE_URL="file:$DB" npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate 2>&1 | tail -2

echo "== 2. Seed (units, jenis surat, preset ACTIVE, profil contoh DRAFT v1.7) =="
SIRAT_ADMIN_USERNAME=admin SIRAT_ADMIN_PASSWORD='V17-Local-E2e-2026!' \
  DATABASE_URL="file:$DB" node scripts/seed.mjs

echo "== 3. Start server standalone :3966 =="
rm -f /tmp/sirat-v17.log
DATABASE_URL="file:$DB" SESSION_SECRET='local-v17-test-secret-0123456789abcdef012345' \
  SIRAT_ARCHIVE_ROOT=/tmp/sirat-v17-archive PORT=3966 \
  NODE_ENV=production nohup node .next/standalone/server.js > /tmp/sirat-v17.log 2>&1 &
echo $! > /tmp/sirat-v17.pid
sleep 4
curl -s -o /dev/null -w "health root: %{http_code}\n" http://localhost:3966/ || true
echo "PID: $(cat /tmp/sirat-v17.pid)"
