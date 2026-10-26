# SIRAT — Sistem Informasi Registrasi & Arsip Surat

> **YAPSI Darussalam** · Sistem arsip & penomoran surat resmi yayasan
> Versi produksi: **v1.0.0** · Dideploy: 26 Oktober 2026

[![Status](https://img.shields.io/badge/status-production-success)](https://sirat.yapsidarussalam.or.id)
[![Node](https://img.shields.io/badge/node-20.x-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/next.js-16-black)](https://nextjs.org)
[![DB](https://img.shields.io/badge/postgresql-15-blue)](https://www.postgresql.org)

SIRAT (Sistem Informasi Registrasi & Arsip Surat) adalah sistem internal YAPSI
Darussalam untuk mengelola seluruh siklus hidup surat menyurat resmi yayasan:
**draft → numbering → publish → arsip → audit**. Setiap surat mendapat nomor
otomatis yang deterministik, idempotent, dan terdokumentasi penuh dalam audit
log append-only.

---

## Daftar Isi

1. [Fitur Utama](#1-fitur-utama)
2. [Arsitektur](#2-arsitektur)
3. [Repository Layout](#3-repository-layout)
4. [Instalasi & Setup Developer](#4-instalasi--setup-developer)
5. [Variabel Lingkungan](#5-variabel-lingkungan)
6. [Database](#6-database)
7. [API Endpoints](#7-api-endpoints)
8. [Role & Permission Matrix](#8-role--permission-matrix)
9. [Numbering DSL](#9-numbering-dsl)
10. [Testing](#10-testing)
11. [Build & Deployment](#11-build--deployment)
12. [Operasional Sehari-hari](#12-operasional-sehari-hari)
13. [Backup & Restore](#13-backup--restore)
14. [Keamanan](#14-keamanan)
15. [Troubleshooting](#15-troubleshooting)
16. [Dokumentasi Tambahan](#16-dokumentasi-tambahan)

---

## 1. Fitur Utama

### Manajemen Surat End-to-End
- **Draft surat** dengan tipe surat (8 jenis: SR, SE, SK-PENGESAHAN, SPB, SPR, SPT, UND, BA)
- **Publish surat** dengan numbering otomatis berbasis DSL (idempotent, CAS lock)
- **Arsip file** lampiran (PDF/DOCX/XLSX) — magic bytes verification + SHA-256 hash
- **Audit log** append-only untuk semua aksi sensitif (login, publish, archive, delete)

### RBAC Multi-Level
- **SYSTEM_ADMIN** — akses penuh, semua unit, semua committee
- **UNIT_ADMIN** — administrasi 1 unit, semua committee di unit tersebut
- **COMMITTEE_ADMIN** — administrasi 1 committee spesifik
- **COMMITTEE_STAFF** — read + write draft, tidak bisa publish

### Numbering DSL (Domain-Specific Language)
Sistem penomoran fleksibel berbasis JSON config, **tanpa eval()**, parser aman
penuh. Contoh konfigurasi YAPSI-DS:

```
001/A/SR/YAPSI-DS/X/2026
│   │ │  │       │  └─ tahun surat
│   │ │  │       └──── bulan romawi
│   │ │  └──────────── kode yayasan/unit (literal)
│   │ └─────────────── kode jenis surat
│   └───────────────── arah (A=INTERNAL, B=EXTERNAL)
└───────────────────── nomor urut (padding 3)
```

### Excel Import/Export
- **Import** unit/letter-type/committee dengan mode dry-run (preview sebelum commit)
- **Export** daftar surat, audit log, dan master data ke `.xlsx`

---

## 2. Arsitektur

```
                Internet (HTTPS, port 443)
                       │
                       ▼
              Cloudflare Tunnel (cloudflared)
              ─────────────────────────────────
              Dikelola admin YAPSI secara terpisah.
              Tunnel mengarahkan traffic ke
              https://127.0.0.1:3901 di VPS.
                       │
                       ▼
       ┌──────────────────────────────────────────┐
       │  0.0.0.0:3901  HTTPS proxy              │  ← Node.js https-proxy.js
       │  SSL: Let's Encrypt wildcard             │     (Let's Encrypt cert)
       │  /etc/letsencrypt/live/                  │
       │  yapsidarussalam.or.id/                  │
       └──────────────────┬───────────────────────┘
                          │ HTTP (loopback)
                          ▼
       ┌──────────────────────────────────────────┐
       │  127.0.0.1:3900  Next.js standalone      │  ← Node.js HTTP internal
       │  (tidak diekspos ke publik)              │     (Next.js 16 build)
       └──────────────────┬───────────────────────┘
                          │ Prisma Client
                          ▼
       ┌──────────────────────────────────────────┐
       │  127.0.0.1:5432  PostgreSQL 15            │
       │  DB: sirat  User: sirat                  │
       └──────────────────────────────────────────┘

  Storage arsip:
       /var/lib/sirat/archive/   ← file final (SHA-256 named)
       /var/lib/sirat/staging/   ← upload sementara sebelum validasi
```

**Pola deployment** identik dengan `yapsi-main.service` (landing YAPSI):
- Tidak ada nginx, tidak ada OpenLiteSpeed
- SSL di-serve langsung oleh Node.js proxy dengan Let's Encrypt cert
- Next.js HANYA mendengar di `127.0.0.1:3900` (internal only)
- systemd `sirat.service` menjalankan `start.sh` yang spawn kedua proses

---

## 3. Repository Layout

```
sirat/
├── README.md                      ← dokumen ini
├── package.json                   ← dependencies & scripts
├── package-lock.json              ← lockfile (npm ci)
├── next.config.ts                 ← Next.js 16 config (output: standalone)
├── tsconfig.json                  ← TypeScript strict
├── tailwind.config.ts             ← Tailwind CSS 4
├── postcss.config.mjs
├── eslint.config.mjs
├── vitest.config.ts               ← unit test runner
│
├── prisma/
│   ├── schema.prisma              ← PostgreSQL schema (production)
│   └── schema.sqlite.prisma       ← SQLite schema (development/testing)
│
├── src/
│   ├── app/                       ← Next.js App Router
│   │   ├── (auth)/                ← login, logout, session
│   │   ├── (dashboard)/           ← UI admin (RBAC-scoped)
│   │   ├── api/                   ← 26 REST API routes
│   │   │   ├── auth/
│   │   │   ├── units/
│   │   │   ├── committees/
│   │   │   ├── letter-types/
│   │   │   ├── numbering-profiles/
│   │   │   ├── letters/
│   │   │   ├── archive-files/
│   │   │   ├── audit/
│   │   │   ├── health/
│   │   │   ├── import/
│   │   │   └── export/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/                ← React components (shadcn/ui based)
│   ├── hooks/                     ← React hooks
│   └── lib/
│       ├── prisma.ts              ← Prisma client singleton
│       ├── auth.ts                ← JWT/session, password hash
│       ├── rbac.ts                ← permission matrix
│       ├── numbering-dsl.ts       ← DSL parser (no eval, safe)
│       ├── local-disk.ts          ← file storage adapter
│       ├── audit.ts               ← audit log append-only
│       └── excel.ts               ← import/export helpers
│
├── tests/                         ← vitest unit tests (23 cases)
├── docs/                          ← dokumentasi teknis
│   ├── ADR.md                     ← 10 Architecture Decision Records
│   ├── ERD.md                     ← Entity Relationship Diagram
│   ├── RUNBOOK.md                 ← install/upgrade/backup/restore/runbook
│   ├── PERMISSION-MATRIX.md       ← RBAC detail matrix
│   ├── OPENAPI.yaml               ← OpenAPI 3.1 spec
│   └── AUDIT-REPORT.md            ← security audit report
│
├── public/                        ← static assets
│
├── https-proxy.js                 ← HTTPS proxy (Let's Encrypt cert)
├── start.sh                       ← systemd entry point (Next.js + proxy)
├── Dockerfile                     ← container build (opsional)
├── docker-compose.yml             ← container stack (opsional)
├── .env.example                   ← template env
└── .gitignore
```

---

## 4. Instalasi & Setup Developer

### Prasyarat
- Node.js 20.x LTS
- PostgreSQL 15 (atau SQLite untuk development cepat)
- npm 10+

### Clone & Install
```bash
# Clone dari upstream lokal
git clone /root/project/sirat.git sirat
cd sirat

# Install dependencies
npm ci

# Salin env template
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET, SIRAT_ARCHIVE_ROOT, dll.

# Generate Prisma client
npx prisma generate

# Apply schema ke database
npx prisma db push           # development
# atau
npx prisma migrate deploy    # production (dengan migrations)

# Seed data awal (units, letter types, admin user)
npm run seed
```

### Menjalankan Development Server
```bash
npm run dev
# Buka http://localhost:3000
# Login: admin / <password yang dicetak saat seed>
```

### Menjalankan Production Build (lokal)
```bash
npm run build
npm run start
# atau dengan standalone output:
cd .next/standalone && PORT=3900 HOSTNAME=127.0.0.1 node server.js
```

---

## 5. Variabel Lingkungan

Lihat `.env.example` untuk template lengkap. Variabel kritis:

| Variabel | Wajib | Contoh | Keterangan |
|----------|:-----:|--------|------------|
| `DATABASE_URL` | ✅ | `postgresql://sirat:****@127.0.0.1:5432/sirat?schema=public` | URL koneksi PostgreSQL |
| `JWT_SECRET` | ✅ | `<32+ char random>` | Secret untuk sign JWT (min 32 karakter) |
| `NODE_ENV` | ✅ | `production` | environment mode |
| `PORT` | ✅ | `3900` | port Next.js (internal HTTP) |
| `HOSTNAME` | ✅ | `127.0.0.1` | bind address Next.js |
| `SIRAT_ARCHIVE_ROOT` | ✅ | `/var/lib/sirat/archive` | root penyimpanan arsip final |
| `SIRAT_STAGING_ROOT` | ✅ | `/var/lib/sirat/staging` | root staging upload |
| `SIRAT_MAX_FILE_BYTES` | ⚪ | `26214400` | max upload 25 MiB |
| `SIRAT_ADMIN_USERNAME` | ⚪ | `admin` | username bootstrap admin (sekali pakai) |

**Penting:** file `.env` **TIDAK boleh** di-commit ke git (sudah di `.gitignore`).
Mode file: `0600`, owner: `sirat:sirat` (atau `root:root` jika service run as root).

---

## 6. Database

### Schema Utama (PostgreSQL)
Lihat `prisma/schema.prisma` untuk definisi lengkap. Entity utama:

- **User** — akun pengguna (username, passwordHash, role, isActive)
- **UserAssignment** — relasi user ↔ unit/committee (RBAC scope)
- **Unit** — unit yayasan (YAPSI, KB, RA, MI, MTs, PP, RT)
- **Committee** — organ/lembaga dalam unit (mis. TPQ, Humas)
- **LetterType** — jenis surat (8 jenis)
- **NumberingProfile** + **NumberingProfileVersion** — konfigurasi numbering DSL
- **Letter** — surat (draft/published/archived)
- **ArchiveFile** — file arsip (SHA-256, magic bytes verified)
- **AuditEvent** — log audit append-only

### Migration
```bash
# Development: push schema langsung (reset data jika ada perubahan)
npx prisma db push

# Production: apply migrations (safe, data-preserving)
npx prisma migrate deploy

# Buat migration baru dari perubahan schema
npx prisma migrate dev --name <deskripsi-perubahan>
```

### Seed Data Awal
File seed membuat:
- 7 Unit: YAPSI, KB, RA, MI, MTs, PP, RT
- 8 LetterType: SR, SE, SK-PENGESAHAN, SPB, SPR, SPT, UND, BA
- 1 NumberingProfile DRAFT (Preset Workbook 2026 YAPSI-DS)
- 1 admin user (password dicetak ke stdout sekali)

---

## 7. API Endpoints

Total **26 REST API routes**. Lihat `docs/OPENAPI.yaml` untuk spec lengkap.

### Authentication
| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/auth/login` | Login, set HTTP-only cookie |
| POST | `/api/auth/logout` | Logout, clear cookie |
| GET | `/api/auth/me` | Profil user + permission |
| POST | `/api/auth/change-password` | Ganti password sendiri |

### Master Data
| Method | Path | Deskripsi |
|--------|------|-----------|
| GET/POST | `/api/units` | List / create unit |
| GET/PUT/DELETE | `/api/units/:id` | CRUD unit |
| GET/POST | `/api/committees` | List / create committee |
| GET/PUT/DELETE | `/api/committees/:id` | CRUD committee |
| GET/POST | `/api/letter-types` | List / create letter type |
| GET/POST | `/api/numbering-profiles` | List / create numbering profile |
| POST | `/api/numbering-profiles/:id/activate` | Aktivasi profile (publish) |

### Letters
| Method | Path | Deskripsi |
|--------|------|-----------|
| GET/POST | `/api/letters` | List (paginated) / create draft |
| GET/PUT/DELETE | `/api/letters/:id` | CRUD letter |
| POST | `/api/letters/:id/publish` | Publish + assign number (idempotent CAS) |
| POST | `/api/letters/:id/archive` | Pindah ke arsip |

### Archive Files
| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/archive-files` | Upload file (magic bytes + SHA-256) |
| GET | `/api/archive-files/:id/download` | Download |
| GET | `/api/archive-files/:id` | Metadata |

### Audit
| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/audit` | Query audit log (filter, paginate) |

### Utility
| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/health` | Health check (no auth, simple) |
| POST | `/api/import` | Excel import (dry-run support) |
| GET | `/api/export` | Excel export |

---

## 8. Role & Permission Matrix

Lihat `docs/PERMISSION-MATRIX.md` untuk detail lengkap. Ringkasan:

| Resource | SYSTEM_ADMIN | UNIT_ADMIN | COMMITTEE_ADMIN | COMMITTEE_STAFF |
|----------|:------------:|:----------:|:---------------:|:---------------:|
| **Users** | CRUD all | read own unit | read own committee | read self |
| **Units** | CRUD all | read assigned | read assigned | read assigned |
| **Committees** | CRUD all | CRUD in unit | CRUD own | read own |
| **LetterTypes** | CRUD all | read | read | read |
| **NumberingProfiles** | CRUD + activate | read | read | — |
| **Letters** | CRUD all + publish | CRUD + publish in unit | CRUD + publish in committee | create draft only |
| **ArchiveFiles** | CRUD all | CRUD in unit | CRUD in committee | upload to own draft |
| **AuditLog** | read all | read own unit | read own committee | read own actions |

---

## 9. Numbering DSL

Numbering DSL adalah parser JSON yang **aman** (tanpa `eval`, tanpa `new Function`).
Setiap profile memiliki satu atau lebih **version** dengan status `DRAFT`/`ACTIVE`/`DEPRECATED`.

### Format Komponen
```json
{
  "version": 1,
  "separator": "/",
  "components": [
    { "type": "sequence", "padding": 3 },
    { "type": "direction", "mapping": { "INTERNAL": "A", "EXTERNAL": "B" } },
    { "type": "letterTypeCode" },
    { "type": "literal", "value": "YAPSI-DS" },
    { "type": "letterDate", "format": "MONTH_ROMAN" },
    { "type": "letterDate", "format": "YEAR_4" }
  ]
}
```

### Tipe Komponen yang Didukung
- `sequence` — nomor urut dengan padding (1 → "001")
- `direction` — arah surat (INTERNAL/EXTERNAL → kode)
- `letterTypeCode` — kode jenis surat
- `literal` — string literal
- `letterDate` — tanggal surat dengan format (`MONTH_ROMAN`, `YEAR_4`, `YEAR_2`, `MONTH_2`, `DAY_2`)
- `committeeCode` — kode committee
- `unitCode` — kode unit

### Idempotency & Concurrency
Saat publish surat, sistem menggunakan **CAS (Compare-And-Swap) lock** di level
database (PostgreSQL `SELECT ... FOR UPDATE`) untuk menjamin:
- Setiap surat dapat di-publish hanya **sekali** (idempotent)
- Sequence number tidak ada gap atau collision meski ada concurrent request
- Retry aman: jika request gagal setelah sequence di-allocate, transaksi di-rollback

---

## 10. Testing

### Unit Tests (vitest)
```bash
npm test
# 23 test cases meliputi:
# - numbering DSL parser (parse, render, validation)
# - RBAC permission matrix
# - audit log append
# - magic bytes detection
# - SHA-256 hashing
# - Excel import dry-run
```

### Smoke Test E2E
```bash
# Manual 19-step smoke test (lihat docs/RUNBOOK.md section "Smoke Test")
# Mencakup: login → create unit → create committee → create letter →
#           activate numbering profile → publish letter → upload archive →
#           query audit log → export excel
```

### Test Coverage
```bash
npm run test:coverage
# Output: coverage/index.html
```

---

## 11. Build & Deployment

### Production Architecture
- **VPS:** `host.zerotier.my.id:2226` (root@YAPSIDarussalam)
- **Domain:** `https://sirat.yapsidarussalam.or.id`
- **Port publik:** 3901 (HTTPS langsung oleh Node.js proxy)
- **Port internal:** 3900 (Next.js HTTP, hanya 127.0.0.1)
- **DB:** PostgreSQL 15 di socket 127.0.0.1:5432

### Repository Layout di VPS

| Path | Role |
|------|------|
| `/root/project/sirat/` | **Source upstream** — canonical git repo, berisi README + semua source |
| `/var/www/sirat/` | **Production deployment** — working checkout dari upstream + build artifacts |
| `/var/lib/sirat/{archive,staging}/` | Penyimpanan file arsip (data, bukan kode) |
| `/var/log/sirat/` | Log aplikasi (next.log, proxy.log) |
| `/etc/systemd/system/sirat.service` | systemd unit |
| `/etc/letsencrypt/live/yapsidarussalam.or.id/` | SSL cert (Let's Encrypt wildcard) |

### Workflow Git di VPS

```bash
# === 1. Development: edit di /root/project/sirat ===
cd /root/project/sirat
# ... edit source, commit ...
git commit -am "fix: jelaskan perubahan"

# === 2. Deploy ke production ===
cd /var/www/sirat
git pull origin main
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy   # jika ada migration baru
npm run build                # → .next/standalone/
systemctl restart sirat

# === 3. Smoke test ===
curl -sk https://127.0.0.1:3901/api/auth/me   # → 401
journalctl -u sirat -n 20 --no-pager
```

### Build Steps (Production)
```bash
cd /var/www/sirat
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
npm run build            # → .next/standalone/
# standalone output sudah include node_modules yang dibutuhkan
```

### systemd Service
File: `/etc/systemd/system/sirat.service`

```ini
[Unit]
Description=SIRAT - Sistem Informasi Registrasi & Arsip Surat (HTTPS :3901)
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/var/www/sirat
EnvironmentFile=/var/www/sirat/.env
Environment=NODE_ENV=production
ExecStart=/var/www/sirat/start.sh
Restart=on-failure
RestartSec=5s
# ... systemd hardening (ProtectSystem=strict, ProtectHome, PrivateTmp, dll.)

[Install]
WantedBy=multi-user.target
```

**Catatan:** `User=root` dipakai agar proxy bisa membaca
`/etc/letsencrypt/live/yapsidarussalam.or.id/privkey.pem` (mode 0600 root:root).
Pola ini identik dengan `yapsi-main.service`. Next.js sendiri hanya dengar di
`127.0.0.1:3900`, jadi tidak ada eksposur langsung ke publik.

---

## 12. Operasional Sehari-hari

### Restart Service
```bash
systemctl restart sirat
systemctl status sirat --no-pager
journalctl -u sirat -n 50 --no-pager
```

### Lihat Log
```bash
tail -f /var/log/sirat/next.log      # Next.js stdout/stderr
tail -f /var/log/sirat/proxy.log    # HTTPS proxy
journalctl -u sirat -f              # systemd journal
```

### Verifikasi SSL
```bash
echo | openssl s_client -connect 127.0.0.1:3901 \
  -servername sirat.yapsidarussalam.or.id 2>&1 \
  | grep -E 'subject=|issuer=|Verify return code'
# Expected:
#   subject=CN = *.yapsidarussalam.or.id
#   issuer=C = US, O = Let's Encrypt, CN = ...
#   Verify return code: 0 (ok)
```

### Cek Port Listening
```bash
ss -tlnp | grep -E ':3900|:3901|:5432'
# Expected:
#   127.0.0.1:3900  next-server (HTTP internal)
#   0.0.0.0:3901    node https-proxy.js (HTTPS publik)
#   127.0.0.1:5432  postgres
```

### Smoke Test Lengkap
```bash
# 1. Health check (no auth) → 401
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:3901/api/auth/me

# 2. Login admin
curl -sk -c /tmp/sirat.cookie \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<PASSWORD>"}' \
  https://127.0.0.1:3901/api/auth/login

# 3. Profil + permission
curl -sk -b /tmp/sirat.cookie https://127.0.0.1:3901/api/auth/me

# 4. Daftar unit (expect 7 unit)
curl -sk -b /tmp/sirat.cookie https://127.0.0.1:3901/api/units

# 5. Public via Cloudflare Tunnel
curl https://sirat.yapsidarussalam.or.id/api/auth/me   # → 401
```

---

## 13. Backup & Restore

### Backup
```bash
# Database (logical backup, compressed)
pg_dump -U sirat -d sirat -F c -f /root/backup/sirat-db-$(date +%Y%m%d).dump

# Archive files
tar -czf /root/backup/sirat-archive-$(date +%Y%m%d).tar.gz /var/lib/sirat/archive

# Konfigurasi & kode (gitignored files)
tar -czf /root/backup/sirat-config-$(date +%Y%m%d).tar.gz \
  /var/www/sirat/.env \
  /etc/systemd/system/sirat.service
```

### Restore
```bash
# Stop service dulu
systemctl stop sirat

# Restore DB
dropdb -U postgres sirat
createdb -U postgres sirat
pg_restore -U sirat -d sirat /root/backup/sirat-db-YYYYMMDD.dump

# Restore archive
tar -xzf /root/backup/sirat-archive-YYYYMMDD.tar.gz -C /

# Restart
systemctl start sirat
```

### Schedule Cron (daily 2 AM)
```bash
crontab -e
# Tambahkan:
0 2 * * * /root/scripts/sirat-backup.sh >> /var/log/sirat/backup.log 2>&1
```

---

## 14. Keamanan

### Yang Sudah Diterapkan
- **Password hashing:** bcrypt (cost 10) untuk semua password user
- **Session:** JWT dalam HTTP-only cookie, signed dengan `JWT_SECRET`
- **RBAC:** permission check di setiap API route, scope per unit/committee
- **File upload:** magic bytes verification + SHA-256 hash + size limit (25 MiB)
- **Audit log:** append-only, semua aksi sensitif tercatat
- **Idempotent publish:** CAS lock mencegah double-numbering
- **systemd hardening:** `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, dll.
- **Next.js internal only:** listen di `127.0.0.1:3900`, tidak bisa diakses langsung
- **SSL:** Let's Encrypt wildcard `*.yapsidarussalam.or.id` (TLS 1.2+)
- **Security headers:** HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy

### Yang Perlu Diperhatikan
- 🔴 **WAJIB ganti password admin** setelah deploy pertama
- 🔴 `JWT_SECRET` di `.env` harus 32+ karakter random, JANGAN pakai default
- 🔴 File `.env` JANGAN di-commit (sudah di `.gitignore`)
- 🟡 Pertimbangkan rotasi `JWT_SECRET` periodik (will invalidate all sessions)
- 🟡 Rate-limiting belum diimplementasi — pertimbangkan cloudflared rate-limit
- 🟡 Backup encryption: pertimbangkan `gpg` encrypt sebelum tarball disimpan

### Vulnerability Disclosure
Laporkan kerentanan keamanan ke `sirat@yapsidarussalam.or.id` (private).
JANGAN open public issue untuk kerentanan keamanan.

---

## 15. Troubleshooting

### Service tidak mau start
```bash
systemctl status sirat --no-pager
journalctl -u sirat -n 50 --no-pager
# Cek error umum:
# - Permission denied: cek owner /var/www/sirat/ dan /var/log/sirat/
# - Cannot read privkey.pem: pastikan service run as root, atau chmod privkey
# - EADDRINUSE: port 3900/3901 sudah dipakai proses lain (ss -tlnp | grep 39)
# - Prisma connection: cek DATABASE_URL di .env, postgres running?
```

### SSL certificate error
```bash
# Cek expiry
openssl x509 -in /etc/letsencrypt/live/yapsidarussalam.or.id/fullchain.pem \
  -noout -dates

# Restart proxy setelah renewal
systemctl restart sirat
```

### Database connection refused
```bash
systemctl status postgresql
ss -tlnp | grep 5432
sudo -u postgres psql -c "SELECT 1;"   # test admin connection
psql -U sirat -d sirat -h 127.0.0.1 -c "SELECT 1;"  # test app connection
```

### Numbering conflict / duplicate
```bash
# Cek audit log untuk publish attempts
curl -sk -b /tmp/sirat.cookie \
  'https://127.0.0.1:3901/api/audit?action=PUBLISH_LETTER&outcome=FAILURE' \
  | python3 -m json.tool
# Jika ada conflict, kemungkinan sequence namespace kotor — konsultasi RUNBOOK.md
```

### File upload gagal
```bash
# Cek magic bytes di log
grep 'magic_bytes_mismatch' /var/log/sirat/next.log
# Cek disk space
df -h /var/lib/sirat
# Cek permission staging dir
ls -la /var/lib/sirat/staging
```

---

## 16. Dokumentasi Tambahan

| Dokumen | Path | Deskripsi |
|---------|------|-----------|
| Architecture Decision Records | `docs/ADR.md` | 10 ADR: pilihan teknologi, trade-off |
| Entity Relationship Diagram | `docs/ERD.md` | Skema DB visual + deskripsi |
| Runbook Operasional | `docs/RUNBOOK.md` | Install, upgrade, backup, restore, failover |
| Permission Matrix | `docs/PERMISSION-MATRIX.md` | Detail RBAC per role × resource × action |
| OpenAPI Spec | `docs/OPENAPI.yaml` | OpenAPI 3.1 untuk semua 26 endpoints |
| Security Audit Report | `docs/AUDIT-REPORT.md` | Hasil audit keamanan internal |
| Status Deploy Produksi | `DEPLOYED.md` | Snapshot terakhir konfigurasi produksi |

---

## Lisensi

**Proprietary** — © 2026 YAPSI Darussalam. All rights reserved.
Penggunaan terbatas pada internal YAPSI Darussalam. Distribusi ke pihak ketiga
tanpa izin tertulis dilarang.

## Kontak

- **Maintainer:** Tim IT YAPSI Darussalam
- **Email:** `sirat@yapsidarussalam.or.id`
- **Production URL:** https://sirat.yapsidarussalam.or.id
- **Internal VPS:** `host.zerotier.my.id:2226` (root@YAPSIDarussalam)
