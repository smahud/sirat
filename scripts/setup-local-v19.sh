#!/usr/bin/env bash
# Setup instance verifikasi LOKAL v1.9 — SQLite + seed + skenario arsip & start counter.
# Server: http://localhost:3967 — admin / V19-Local-E2e-2026!
set -euo pipefail
cd /home/z/my-project/sirat

DB="/home/z/my-project/sirat/db/local-v19.db"
rm -f "$DB"

echo "== 1. Skema SQLITE =="
npx prisma generate --schema prisma/schema.sqlite.prisma 2>&1 | tail -1
DATABASE_URL="file:$DB" npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate 2>&1 | tail -2

echo "== 2. Seed (units, jenis surat, preset ACTIVE) =="
SIRAT_ADMIN_USERNAME=admin SIRAT_ADMIN_PASSWORD='V19-Local-E2e-2026!' \
  DATABASE_URL="file:$DB" node scripts/seed.mjs

echo "== 3. Stop server lama & start standalone :3967 =="
for pidf in /tmp/sirat-v18.pid /tmp/sirat-v19.pid; do
  [ -f "$pidf" ] && kill "$(cat "$pidf")" 2>/dev/null || true
done
fuser -k 3967/tcp 2>/dev/null || true
sleep 2
rm -f /tmp/sirat-v19.log
DATABASE_URL="file:$DB" SESSION_SECRET='local-v19-test-secret-0123456789abcdef012345' \
  SIRAT_ARCHIVE_ROOT=/tmp/sirat-v19-archive PORT=3967 \
  NODE_ENV=production nohup node .next/standalone/server.js > /tmp/sirat-v19.log 2>&1 &
echo $! > /tmp/sirat-v19.pid
sleep 4
curl -s -o /dev/null -w "health root: %{http_code}\n" http://localhost:3967/ || true
echo "PID: $(cat /tmp/sirat-v19.pid)"
