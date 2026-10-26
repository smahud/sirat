#!/usr/bin/env bash
# Generate prisma/schema.sqlite.prisma dari schema.prisma untuk dev sandbox.
set -euo pipefail
cd "$(dirname "$0")/.."
sed 's/provider = "postgresql"/provider = "sqlite"/' prisma/schema.prisma > prisma/schema.sqlite.prisma
echo "OK: prisma/schema.sqlite.prisma dibuat"
