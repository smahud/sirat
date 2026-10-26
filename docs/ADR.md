# SIRAT — Architecture Decision Records (ADR)

Dokumen ini mencatat keputusan arsitektur signifikan beserta konteks, alternatif,
konsekuensi, dan status. Mengacu pada Master Prompt §2 (ADR stack/versi) dan
Blueprint §8/§16.

---

## ADR-001 — Stack runtime: Next.js (App Router) sebagai frontend + backend tunggal

**Status:** Accepted — 26 Oktober 2026
**Konteks:** Blueprint §8 merekomendasikan Next.js + NestJS + PostgreSQL + Prisma
+ Docker Compose. Namun untuk MVP single-tenant dengan satu organisasi, pemisahan
frontend/backend menjadi dua deployable menambah operasional overhead tanpa benefit
teknis yang signifikan. Next.js 16 App Router mendukung Route Handlers yang
setara dengan endpoint API NestJS (request/response Web API, middleware, streaming).
**Keputusan:** Implementasikan frontend dan backend dalam satu aplikasi Next.js
(TypeScript). Route Handler di `src/app/api/*` berfungsi sebagai API layer.
**Alternatif yang ditolak:**
- Next.js + NestJS terpisah → dua build, dua proses, dua sumber env, network hop
  tambahan. Tidak ada kebutuhan backend-to-backend atau worker yang signifikan
  untuk MVP.
- Express/Fastify murni → kehilangan SSR/RSC dan ko-lokasi UI.
**Konsekuensi:**
- Satu deployable, satu port, satu Dockerfile.
- Logic bersama (rbac, db, audit) langsung di-import oleh UI server components.
- Bila masa depan membutuhkan worker/job antrian, tetap dapat ditambahkan sebagai
  proses Node.js terpisah yang meng-import package yang sama (Prisma + lib/*).
- Trade-off: Next.js Route Handler tidak cocok untuk WebSocket persisten atau
  streaming gRPC; jika dibutuhkan kelak, tambahkan proses terpisah.

---

## ADR-002 — Database: PostgreSQL 15+ (produksi), SQLite (dev sandbox)

**Status:** Accepted — 26 Oktober 2026
**Konteks:** Blueprint §8 menetapkan PostgreSQL sebagai DB produksi. SQLite cocok
untuk dev sandbox lokal tanpa setup. Prisma mendukung dua provider dengan schema
yang sama jika tidak memakai enum native.
**Keputusan:**
- Produksi: PostgreSQL 15+ (Debian 12 default repo).
- Dev sandbox: SQLite via `prisma/schema.sqlite.prisma` (di-generate oleh
  `scripts/make-sqlite-schema.sh` dari schema canonical PostgreSQL).
- Tidak memakai enum Prisma — nilai String divalidasi di layer aplikasi (zod).
  Hal ini menjaga compat sqlite↔postgresql tanpa migration terpisah.
**Alternatif yang ditolak:**
- MariaDB existing di VPS (port 33445) → dimiliki aplikasi lain; tidak boleh
  diganggu; dan tidak punya fitur partial unique index yang dibutuhkan
  `Letter.@@unique([namespaceId, periodKey, sequence])` dengan NULL.
- MySQL → dukungan Prisma partial unique lemah.
**Konsekuensi:**
- Constraint unik partial `(namespace_id, period_key, sequence)` hanya berlaku
  saat ketiga kolom non-null (draft boleh kosong).
- Transaksi `db.$transaction` dengan interactive mode Prisma dipakai untuk
  penerbitan (Blueprint 16.1).
- Migrasi dari dev SQLite → prod PostgreSQL tidak diperlukan (data dev sekedar
  test fixture, tidak dipindahkan).

---

## ADR-003 — Autentikasi: JWT HS256 di cookie httpOnly + SameSite=Strict

**Status:** Accepted — 26 Oktober 2026
**Konteks:** NFR-002 mensyaratkan HTTPS, session handling aman, dan CSRF
protection sesuai metode autentikasi. Next.js tidak punya primitive session
built-in; next-auth berlebihan untuk MVP single-domain.
**Keputusan:**
- JWT HS256 (jose library) di cookie `sirat_session` httpOnly, SameSite=Strict,
  secure flag otomatis dari `x-forwarded-proto: https`.
- TTL 8 jam (sesi kerja operator).
- Login rate limit: 5 percobaan / 10 menit per IP+username (in-memory Map;
  untuk multi-instance, pindah ke Redis di fase lanjutan).
- CSRF: kombinasi SameSite=Strict + origin check (`Origin` header) untuk mutasi.
- Tidak ada refresh token MVP; re-login setelah TTL.
**Alternatif yang ditolak:**
- next-auth → terlalu banyak abstraction untuk 1 jenis user, perlu adapter,
  kurang kontrol terhadap idempotency/audit.
- Session DB-backed → overhead I/O per request; JWT stateless cukup untuk MVP.
**Konsekuensi:**
- Logout client-side (cookie dihapus); token tetap valid sampai TTL bila tidak
  di-revoke. Untuk revoke instan, perlu denylist (fase lanjutan).
- `SESSION_SECRET` wajib di-set di produksi (≥32 karakter), divalidasi oleh
  `lib/session.ts`.

---

## ADR-004 — Idempotency penerbitan: key persisten + payload hash

**Status:** Accepted — 26 Oktober 2026
**Konteks:** Blueprint 16.1 / FR-026 mensyaratkan: key sama + payload sama →
satu surat; key sama + payload beda → 409; double-click draft sama tidak
membuat surat baru; concurrent key sama tidak menghasilkan dua surat.
**Keputusan:**
- Tabel `IdempotencyKey(actorId, operation, key, payloadHash, letterId)` dengan
  `@@unique([actorId, operation, key])`.
- Dalam transaksi penerbitan: cek existing → jika ada dan hash cocok, kembalikan
  surat existing; jika hash beda → 409; jika belum ada → lanjutkan issue.
- Setelah update CAS `Letter` (where status='DRAFT'), tulis idempotency key.
- Client wajib mengirim header `Idempotency-Key` saat POST `/issue`.
**Alternatif yang ditolak:**
- Idempotency in-memory → hilang saat restart; tidak survive crash.
- Unique pada official_number saja → tidak cukup; dua request concurrent bisa
  sama-sama mendapat sequence berbeda lalu salah satu dibatalkan, menyisakan gap.
**Konsekuensi:**
- Tabel IdempotencyKey tumbuh; perlu retensi/cleanup policy (fase lanjutan).
- CAS via `updateMany where status=DRAFT` mencegah race dua issue concurrent di
  draft yang sama (returned count=0 → cek ulang apakah sudah ISSUED).

---

## ADR-005 — Storage arsip: Local Disk, object key stabil, manifest rebuildable

**Status:** Accepted — 26 Oktober 2026
**Konteks:** Blueprint 16.3 mensyaratkan storage backend abstrak, layout
deterministik, manifest derived yang dapat dibangun ulang, dan PENDING→READY
dengan atomic rename.
**Keputusan:**
- Backend MVP: Local Disk. Abstraksi `lib/storage/local-disk.ts` menyediakan
  operasi simpan/baca/stat/test. Penambahan SFTP/SMB/FTPS fase lanjutan via
  interface yang sama.
- Object key layout:
  - Surat reguler: `{unitStorageKey}/letters/{YYYY}/{MM}/{letterId}/{fileId}/{versionId}/blob`
  - Surat panitia: `{unitStorageKey}/committees/{committeeStorageKey}/letters/{YYYY}/{MM}/{letterId}/{fileId}/{versionId}/blob`
- `unitStorageKey` / `committeeStorageKey` adalah slug stabil yang TIDAK berubah
  ketika code tampil berubah (Blueprint: "Profile changing printed unit code
  does not rename physical storage folders").
- Staging di path terpisah; atomic rename ke object key setelah SHA-256 dan
  validasi magic bytes.
- `manifest.json` per folder letter; temp+rename; rebuildable dari DB.
- Traversal guard: `safeJoin` memvalidasi resolved path di bawah root.
**Alternatif yang ditolak:**
- S3/MinIO → menambah dependensi operasional untuk MVP.
- Path = official_number → melanggar Blueprint ("Nomor surat tidak boleh menjadi
  satu-satunya identitas berkas").
**Konsekuensi:**
- File di luar web root (`SIRAT_ARCHIVE_ROOT`).
- Upload melalui `streamToStaging` (chunked) → RAM konstan untuk file besar.
- Disk penuh → exception sebelum PENDING; tidak ada status READY palsu.
- Reconciler (`/api/health/integrity-scan`) melaporkan orphan/missing tetapi
  tidak menghapus otomatis (Blueprint 16.3).

---

## ADR-006 — Numbering DSL: JSON schema tervalidasi, tanpa eval

**Status:** Accepted — 26 Oktober 2026
**Konteks:** Blueprint 16.2 melarang JavaScript/eval, shell, SQL, regex sembarang
dari pengguna, dan template executable. Profile published immutable.
**Keputusan:**
- DSL disimpan sebagai JSON di `NumberingProfileVersion.dsl`.
- `zod` discriminatedUnion memvalidasi komponen: literal, sequence, direction,
  letterTypeCode, unitCode, committeeCode, letterDate, issueDate.
- Separator whitelist: `/`, `-`, `.`, ` `.
- Rule engine (fase lanjutan) terbatas pada `equals|in|all|any` — saat ini
  hanya static template + value mapping; tidak ada conditional rule yang
  mengeksekusi kode.
- `validateDslForActivation` menolak profil tanpa sequence, mapping arah
  tidak lengkap, atau render contoh gagal.
- Aktivasi profile version: status DRAFT→ACTIVE; tidak ada mutasi dsl setelah
  ACTIVE; edit membuat version DRAFT baru.
**Alternatif yang ditolak:**
- DSL berbasis string template + eval → terlarang oleh Blueprint.
- DSL TypeScript codegen → tidak deterministik, tidak aman.
**Konsekuensi:**
- Tambah komponen baru = migrasi schema + code change.
- Mapping arah, jenis, kode unit/panitia adalah satu-satunya sumber dinamis.

---

## ADR-007 — RBAC scoped, deny-by-default, tanpa inheritance implisit

**Status:** Accepted — 26 Oktober 2026
**Konteks:** Blueprint 16.5 melarang eskalasi global otomatis dari admin unit;
assignment unit tidak otomatis mencakup panitia kecuali flag eksplisit
`includeCommittees`; admin unit hanya subset permission yang dimilikinya.
**Keputusan:**
- `Role` (global): SYSTEM_ADMIN, ORG_ADMIN, UNIT_ADMIN, COMMITTEE_ADMIN,
  OPERATOR, VIEWER, AUDITOR.
- `AccessAssignment(userId, unitId?, committeeId?, includeCommittees)`.
- Permission dihitung dari `ROLE_PERMISSIONS[role]` + scope assignment.
- GLOBAL_ROLES (SYSTEM_ADMIN, ORG_ADMIN, AUDITOR) punya `scope.all=true`.
- `canAccessUnit(user, unitId)`: scope.all OR unitId di scope.unitIds.
- `canAccessCommittee(user, {id, unitId})`: scope.all OR committee.id di
  scope.committeeIds OR unit.parent di scope.unitIdsWithAllCommittees.
- `letterScopeFilter(user)` menghasilkan Prisma WHERE clause untuk surat yang
  boleh dilihat; dipakai di search, export, list.
- `archiveScopeFilter(user)` meneruskan filter via relasi `letter`.
**Alternatif yang ditolak:**
- ACL per-resource → overhead admin untuk MVP.
- Role global saja → melanggar Blueprint §9 (RBAC dengan scope).
**Konsekuensi:**
- Admin unit TIDAK bisa menjadi SYSTEM_ADMIN otomatis.
- Committee admin tidak bisa akses surat reguler parent atau panitia lain.
- Penambahan unit/committee baru tidak membuka akses otomatis ke user lain.

---

## ADR-008 — Audit: append-only secara operasional, no update/delete path

**Status:** Accepted — 26 Oktober 2026
**Konteks:** NFR-002 / Blueprint §10 mensyaratkan audit append-only logis untuk
aktivitas kritis; role aplikasi PostgreSQL tidak boleh update/delete tabel audit.
**Keputusan:**
- Tabel `AuditEvent` hanya diakses via `writeAudit(tx, input)` di `lib/audit.ts`.
- Tidak ada endpoint API untuk update/delete audit.
- `safeJson` menyaring key bernama `password|secret|token|hash|authorization`
  menjadi `[REDACTED]`.
- Role DB aplikasi: SELECT/INSERT/UPDATE/DELETE sesuai kebutuhan tabel bisnis,
  tetapi tidak ada DDL; audit hanya INSERT.
**Alternatif yang ditolak:**
- Audit log terpisah (file/syslog) → tidak atomic dengan transaksi bisnis;
  hilang bila DB rollback.
- Trigger DB untuk audit → tidak fleksibel untuk konteks app (correlationId,
  actorId dari session).
**Konsekuensi:**
- Audit ditulis dalam transaksi yang sama dengan aksi bisnis (atomic).
- Tabel audit tumbuh; retensi: tanpa purge default (Blueprint: "tidak ada
  penghapusan permanen otomatis pada rilis awal").

---

## ADR-009 — Deployment: bare-metal Node.js + systemd + LiteSpeed reverse proxy

**Status:** Accepted — 26 Oktober 2026
**Konteks:** VPS target sudah menjalankan LiteSpeed di port 80/443 dan 5 app
Next.js lain di port 4001-4005. Docker belum terpasang. PostgreSQL belum
terpasang. Master prompt §10 mensyaratkan: tidak mengganggu layanan existing,
Compose isolated project, DB tidak expose publik, TLS via reverse proxy.
**Keputusan:**
- Jalankan SIRAT sebagai proses Node.js standalone (output `next build
  --output standalone`) di port 3901 via systemd unit `sirat.service`.
- PostgreSQL 15 di-install via apt; listen 127.0.0.1:5432 only (no public).
- LiteSpeed vhost `sirat.yapsidarussalam.or.id` proxy → 127.0.0.1:3901.
- File arsip di `/var/lib/sirat/archive`, owned by `sirat:sirat`, di luar
  web root.
- Backup: pg_dump + tar archive ke lokasi off-host (fase lanjutan).
**Alternatif yang ditolak:**
- Docker Compose → Docker belum terpasang; menambah dependensi operasional
  dan konflik jaringan dengan LiteSpeed di port 80/443. Dockerfile disertakan
  untuk deployment alternatif bila dibutuhkan.
- Ganti LiteSpeed dengan Caddy/Nginx → mengganggu 5 app existing; dilarang
  Master Prompt §1.
**Konsekuensi:**
- Build standalone menghasilkan `.next/standalone/server.js` + static assets.
- Systemd menjaga auto-restart; log via journald.
- Bila LiteSpeed tidak bisa proxy (langka), alternatif: akses langsung via
  `sirat.yapsidarussalam.or.id:3901` (DNS harus resolve ke VPS).

---

## ADR-010 — Deviasi dari stack Blueprint & MVP scope lock

**Status:** Accepted — 26 Oktober 2026
**Konteks:** Blueprint §8 merekomendasikan stack Next.js + NestJS + PostgreSQL +
Prisma + Docker Compose + Nginx/Caddy. Master prompt §1 melarang mengganggu
layanan existing; §2 mengizinkan reversibility dan menyatakan stack dasar
tidak harus persis bila prinsip invariant dipenuhi.
**Deviasi yang dicatat:**
1. **NestJS tidak dipakai** — Next.js Route Handler memenuhi kebutuhan API
   layer MVP. Lihat ADR-001.
2. **Docker Compose tidak dipakai di VPS target** — Docker belum terpasang,
   LiteSpeed sudah memakai port 80/443. Deploy bare-metal Node.js + systemd.
   Dockerfile + docker-compose.yml disertakan untuk deployment alternatif
   (mis. di host lain). Lihat ADR-009.
3. **Import Excel saat ini adalah parser + classifier**, belum bisa commit ke
   Letter secara penuh (Blueprint 16.4): dry-run + classification + issues
   sudah berfungsi; endpoint `/api/import/[batchId]/commit` selektif belum
   memproses semua kasus review (NEEDS_REVIEW → user decision). Status:
   MVP-ready untuk klasifikasi dan dry-run; commit selektif tuntas sebelum
   go-live numbering produksi (lihat RUNBOOK §Cutover).
4. **Backup terjadwal otomatis belum diimplementasikan** — saat ini backup
   dilakukan manual via runbook. Timer systemd/cron + write barrier fase
   lanjutan (lihat RUNBOOK §Backup).
**Dampak terhadap invariant produk:** Tidak ada. Semua invariant Master
Prompt §3 (satu instalasi/satu organisasi, identitas ≠ penerbit, namespace
≠ kode, preview ≠ nomor, nomor terbit immutable, cancel tidak memakai ulang,
deny-by-default, file di luar web root, setiap versi punya checksum, hindari
SaaS multitenant/ERP/TTE/OCR/QR) tetap dipenuhi.
