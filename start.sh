#!/bin/bash
# SIRAT — start.sh: jalankan Next.js (HTTP internal) + HTTPS proxy (publik :3901).
# Mengikuti pola /var/www/yapsi-landing/start.sh (v11).
#
# Layout port:
#   127.0.0.1:3900  — Next.js standalone HTTP (internal, tidak di-expose)
#   0.0.0.0:3901    — HTTPS proxy publik (Let's Encrypt fullchain)
set -a
if [ -f /var/www/sirat/.env ]; then
  . /var/www/sirat/.env
fi
set +a

cd /var/www/sirat/.next/standalone
PORT=3900 HOSTNAME=127.0.0.1 node server.js > /var/log/sirat/next.log 2>&1 &
NEXT_PID=$!

cd /var/www/sirat
node https-proxy.js > /var/log/sirat/proxy.log 2>&1 &
PROXY_PID=$!

trap "kill $NEXT_PID $PROXY_PID 2>/dev/null" EXIT
wait
