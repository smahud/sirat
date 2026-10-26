# SIRAT — RUNBOOK Operasional

Dokumen ini menjelaskan instalasi, upgrade, rollback, backup, restore, dan
cutover SIRAT di VPS Debian 12. Mengacu pada Master Prompt §10 dan Blueprint §16.5.

## Prasyarat host

- Debian 12 (bookworm) atau lebih baru.
- Node.js 20 LTS (sudah ada di VPS target: v20.20.2).
- PostgreSQL 15+ (di-install pada §Install).
- Akses root (atau sudo) untuk apt/systemd.
- Port 3901 bebas (cek: `ss -tln | grep 3901`).
- Reverse proxy (LiteSpeed pada VPS target) yang bisa proxy ke 127.0.0.1:3901,
  ATAU akses langsung via `sirat.yapsidarussalam.or.id:3901` jika DNS resolve
  ke VPS.

---

## 1. Install awal

### 1a. Install PostgreSQL

```bash
apt-get update
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql
# Pastikan listen hanya 127.0.0.1
ss -tln | grep 5432   # harus 127.0.0.1:5432
```

### 1b. Buat database + role

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE sirat WITH LOGIN PASSWORD 'GANTI_PASSWORD_KUAT_DI_SINI';
CREATE DATABASE sirat OWNER sirat ENCODING 'UTF8' LC_COLLATE 'id_ID.UTF-8' LC_CTYPE 'id_ID.UTF-8' TEMPLATE template0;
GRANT ALL PRIVILEGES ON DATABASE sirat TO sirat;
\c sirat
GRANT ALL ON SCHEMA public TO sirat;
SQL
```

Catatan: gunakan password yang di-generate via `openssl rand -base64 24`.
Simpan di kanal secret (bukan di repo).

### 1c. Buat user sistem + direktori

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin sirat
mkdir -p /var/www/sirat /var/lib/sirat/archive /var/lib/sirat/staging /var/log/sirat
chown -R sirat:sirat /var/lib/sirat /var/log/sirat
```

### 1d. Sync source code

Salin seluruh repo (kecuali `node_modules`, `.next`, `db/`, `data/`) ke
`/var/www/sirat/`. Contoh via rsync dari lokal:

```bash
rsync -av --delete \
  --exclude node_modules --exclude .next --exclude db --exclude data \
  --exclude dev.log --exclude server.log \
  --exclude .env --exclude tsconfig.tsbuildinfo \
  /path/lokal/sirat/ root@vps:/var/www/sirat/
```

Atau gunakan `scp -r` atau `tar | ssh ... tar`.

### 1e. Install dependencies + build

```bash
cd /var/www/sirat
npm ci --omit=dev=false   # atau: npm ci && npm run build
npm run build             # hasilnya .next/standalone/server.js
# Salin static + public ke standalone (lihat package.json "build" script)
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
```

### 1f. Konfigurasi .env

```bash
cp .env.example .env
chmod 0600 .env
# Edit DATABASE_URL, SESSION_SECRET, SIRAT_ADMIN_PASSWORD (sementara)
$EDITOR .env
```

Generate secret: `openssl rand -base64 48`.

### 1g. Migrasi + seed + bootstrap admin

```bash
cd /var/www/sirat
export $(grep -v '^#' .env | xargs)
npx prisma migrate deploy --schema prisma/schema.prisma
# Atau, bila belum ada migration history, pakai db push:
# npx prisma db push --schema prisma/schema.prisma --accept-data-loss

npm run seed               # 7 unit + 8 jenis surat + profil YAPSI DRAFT
node scripts/bootstrap-admin.mjs
# CATAT password yang dicetak — tidak akan ditampilkan lagi.
# Hapus env SIRAT_ADMIN_PASSWORD dari .env setelah ini.
```

### 1h. Systemd unit

```bash
cat > /etc/systemd/system/sirat.service <<'EOF'
[Unit]
Description=SIRAT — Sistem Informasi Registrasi & Arsip Surat
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=sirat
Group=sirat
WorkingDirectory=/var/www/sirat/.next/standalone
EnvironmentFile=/var/www/sirat/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sirat
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/sirat /var/log/sirat /var/www/sirat/.next/standalone
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now sirat
systemctl status sirat
journalctl -u sirat -n 50 --no-pager
```

### 1i. Smoke test produksi

```bash
BASE_URL="http://127.0.0.1:3901"
curl -s $BASE_URL/api/auth/me   # harus 401
# Lalu jalankan scripts/smoke-local.sh dengan BASE_URL diubah
```

### 1j. Reverse proxy (LiteSpeed)

Tambahkan vhost untuk `sirat.yapsidarussalam.or.id` yang melakukan proxy
ke `127.0.0.1:3901`. Pastikan:
- `X-Forwarded-Proto: https` diteruskan (agar session cookie Secure).
- `X-Forwarded-For` diteruskan (untuk rate limit login).
- Body size limit ≥ `SIRAT_MAX_FILE_BYTES` (25 MiB default).

Bila LiteSpeed tidak bisa dikonfigurasi, akses langsung via
`http://sirat.yapsidarussalam.or.id:3901/` juga berfungsi (sans TLS — gunakan
HTTPS via LiteSpeed jika ada).

---

## 2. Upgrade

```bash
# 1. Backup (lihat §3)
# 2. Stop app
systemctl stop sirat

# 3. Sync source baru
rsync -av --delete \
  --exclude node_modules --exclude .next --exclude db --exclude data \
  --exclude dev.log --exclude .env \
  /path/lokal/sirat/ root@vps:/var/www/sirat/

# 4. Install deps + build
cd /var/www/sirat
npm ci
npm run build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

# 5. Migrasi (kompatibel, tidak destruktif)
npx prisma migrate deploy --schema prisma/schema.prisma
# Bila schema berubah kompatibel, aman. Bila breaking, lihat §Rollback.

# 6. Start
systemctl start sirat
journalctl -u sirat -n 50 --no-pager

# 7. Smoke test
curl -s http://127.0.0.1:3901/api/health -b cookie.txt
```

---

## 3. Backup

### 3a. Manual (write barrier)

```bash
# 1. Hentikan mutasi (mode maintenance opsional; atau lakukan saat traffic rendah)
systemctl stop sirat

# 2. Dump PostgreSQL
sudo -u postgres pg_dump --format=custom --file=/var/backups/sirat/db-$(date +%F).dump sirat

# 3. Snapshot arsip (tar)
tar -czf /var/backups/sirat/archive-$(date +%F).tar.gz -C /var/lib/sirat archive staging

# 4. Snapshot config
tar -czf /var/backups/sirat/config-$(date +%F).tar.gz \
  -C /var/www/sirat .env prisma
tar -czf /var/backups/sirat/systemd-$(date +%F).tar.gz \
  /etc/systemd/system/sirat.service

# 5. Enkripsi (gpg) + transfer off-host
gpg --batch --symmetric --cipher-algo AES256 \
  --passphrase-file /etc/sirat-backup-key \
  /var/backups/sirat/db-$(date +%F).dump
# rsync/scp ke server backup terpisah

# 6. Restore service
systemctl start sirat
```

### 3b. Terjadwal (fase lanjutan)

- Cron/systemd timer harian pada jam sepi (mis. 02:00 Asia/Jakarta).
- Write barrier: `systemctl stop sirat && pg_dump && tar && systemctl start`.
- Retensi: 7 harian + 4 mingguan (sesuai rekomendasi Blueprint).
- Off-host wajib (DB+arsip di disk VPS yang sama BUKAN backup memadai).

---

## 4. Restore

### 4a. Restore ke instance terisolasi (DRILL — wajib sebelum go-live)

```bash
# 1. Siapkan instance terisolasi (VM terpisah atau VPS staging).
# 2. Install SIRAT sesuai §1, dengan DB kosong.
# 3. Stop service
systemctl stop sirat

# 4. Restore DB
sudo -u postgres pg_restore --clean --if-exists --dbname=sirat \
  /path/backup/db-YYYY-MM-DD.dump

# 5. Restore arsip
tar -xzf /path/backup/archive-YYYY-MM-DD.tar.gz -C /var/lib/sirat/

# 6. Set ownership
chown -R sirat:sirat /var/lib/sirat /var/log/sirat

# 7. Verifikasi
systemctl start sirat
curl -s http://127.0.0.1:3901/api/health   # ok:true
# Login + lihat surat + download file
# Bandingkan count: SELECT count(*) FROM letters; vs jumlah file di /var/lib/sirat/archive

# 8. Integrity scan
curl -b cookie.txt -X POST http://127.0.0.1:3901/api/health/integrity-scan
# scanned=N, ok=N, missing=[], orphans=[]
```

### 4b. Restore ke produksi (incident response)

- Sama dengan §4a tetapi pada instance produksi.
- Pastikan backup yang dipilih valid (lakukan §4a drill terlebih dahulu).
- Komunikasikan downtime ke operator.
- Roll forward hanya bila ada transaksi pasca-backup yang harus dipertahankan.

---

## 5. Rollback aplikasi

### 5a. Rollback binary (schema compatible)

```bash
systemctl stop sirat
# Restore source versi sebelumnya
git -C /var/www/sirat checkout <prev-commit>   # bila repo
# atau rsync dari backup source
npm ci
npm run build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
systemctl start sirat
```

### 5b. Rollback + schema incompatible

Bila migration tidak kompatibel dengan binary lama:
1. Restore dari backup (§4) ke instance terisolasi.
2. Verifikasi di isolasi.
3. Promosikan instance isolasi menjadi produksi (swap DNS/proxy).
4. JANGAN `compose down -v` / `DROP DATABASE` di produksi lama sampai
   instance baru dikonfirmasi stabil minimal 24 jam.

---

## 6. Cutover (dari Excel manual ke SIRAT)

Mengacu pada Blueprint §16.4 + Master Prompt §7 + FR-032.

### 6a. Pra-cutover (T-1 minggu)

1. Pastikan SIRAT ter-install di VPS staging dengan data dummy.
2. Operator uji alur: login → pilih unit → preview → issue → upload →
   download → cancel → audit → health.
3. Latih operator untuk menggunakan SIRAT, bukan Excel.
4. Siapkan keputusan: reset policy (YEARLY vs ALL), date source, high-water
   counter, anomali Excel (H21=2025).

### 6b. Dry-run import Excel

1. `POST /api/import/excel` dengan file `Nomor Surat 2026.xlsx`.
2. Lihat report: 66 kandidat, 33 praisi, 1 NEEDS_REVIEW (H21), 1 baris 2
   tanpa penerima/perihal, duplikat (jika ada).
3. Untuk setiap baris NEEDS_REVIEW → keputusan pemilik: skip, import sebagai
   legacy, atau cancel+reissue di SIRAT.
4. Tetapkan high-water counter (default: 66; pastikan tidak ada nomor sesudah
   066 di luar workbook).

### 6c. Cutover (D-day)

1. **Bekukan Excel**: operator berhenti mencatat di Excel. Ambil checksum
   snapshot Excel (`sha256sum Nomor\ Surat\ 2026.xlsx`).
2. Stop service (write barrier):
   ```bash
   systemctl stop sirat
   ```
3. Commit import selektif:
   ```bash
   curl -b admin-cookie -X POST \
     http://127.0.0.1:3901/api/import/<batchId>/commit \
     -H 'Content-Type: application/json' \
     -d '{"rows":[{"rowIndex":3,"decision":"IMPORTED","legacyNumber":"001/..."}]}'
   ```
4. Set counter high-water:
   ```sql
   -- Pastikan counter untuk namespace YAPSI ≥ 66
   UPDATE counters SET last_value = GREATEST(last_value, 66)
   WHERE namespace_id IN (SELECT id FROM counter_namespaces WHERE unit_id = (
     SELECT id FROM units WHERE code = 'YAPSI'
   ));
   ```
5. Backup post-commit (§3).
6. Start service:
   ```bash
   systemctl start sirat
   ```
7. **Aktifkan issuance produksi**: konfirmasi profil YAPSI sudah ACTIVE;
   rekonsiliasi jumlah surat di DB vs file Excel.
8. Smoke test full (lihat `scripts/smoke-local.sh` dengan BASE_URL produksi).
9. Umumkan ke operator: SIRAT menjadi sumber resmi. Excel dibekukan.

### 6d. Pasca-cutover

- Pantau audit log 1 minggu pertama.
- Bila ditemukan nomor sesudah 066 yang tidak tercatat di Excel → tambahkan
  sebagai legacy, naikkan high-water counter, audit.
- Bila Excel masih ditulis paralel → go-live numbering TIDAK aman; rollback
  SIRAT ke status staging dan ulangi cutover.

---

## 7. Operasional harian

### 7a. Health check

```bash
# Via API (butuh cookie admin)
curl -b cookie.txt http://127.0.0.1:3901/api/health
# Output: { ok: true, db: ok, storage: { ... }, lastBackup: ... }
```

### 7b. Integrity scan

```bash
curl -b cookie.txt -X POST http://127.0.0.1:3901/api/health/integrity-scan
# Output: { scanned: N, ok: N, missing: [...], orphans: [...] }
```

- `missing`: file yang ada di DB tapi tidak di disk → laporkan, jangan hapus
  record (Blueprint: tidak auto-delete).
- `orphans`: file di disk tapi tidak di DB → laporkan; tidak auto-purge MVP.

### 7c. Lihat audit

```bash
curl -b cookie.txt "http://127.0.0.1:3901/api/audit?action=letter."
curl -b cookie.txt "http://127.0.0.1:3901/api/audit?action=archive."
```

### 7d. Log aplikasi

```bash
journalctl -u sirat -f --since today
```

---

## 8. Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `503 Service Unavailable` | sirat.service mati | `systemctl status sirat`, `journalctl -u sirat -n 100` |
| `401` terus-menerus | Cookie expired / clock skew | Re-login; cek `date` di VPS |
| `409 NUMBER_CONFLICT` saat issue | Konfigurasi namespace/format tabrakan | Cek `number_registries`; audit profil aktif |
| Upload `413 Payload Too Large` | Body melebihi SIRAT_MAX_FILE_BYTES atau limit proxy | Naikkan limit di .env dan reverse proxy |
| Upload `UNSUPPORTED_TYPE` | Magic byte tidak cocok allowlist | Cek file sebenarnya; jangan pakai ekstensi palsu |
| `P2024` Prisma timeout | DB lambat / koneksi terlalu banyak | Restart sirat; cek `pg_stat_activity` |
| Login gagal terus | Rate limit aktif (5/10min) | Tunggu 10 menit atau restart sirat (reset in-memory) |

---

## 9. Pemeliharaan rutin

- **Mingguan**: integrity scan + cek disk space `df -h /var/lib/sirat`.
- **Bulanan**: backup restore drill ke instance isolasi.
- **Per release**: update ADR, RUNBOOK, smoke test evidence.
- **Saat counter approaching max**: tambah digit padding profil baru (DRAFT →
  ACTIVE; surat lama tetap pakai profil lama immutable).

---

## 10. Non-goals MVP (fase lanjutan)

- SMB/CIFS, SFTP, FTPS storage backend.
- Export XLSX/PDF (CSV sudah ada).
- QR verification publik.
- OCR / full-text search isi arsip.
- Background queue (BullMQ + Redis).
- Malware scanning.
- Email notifikasi.
- Multi-instance horizontal scale.
