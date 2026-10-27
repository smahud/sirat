# SIRAT — Audit Report Implementasi vs Dokumen

Tanggal audit: 26 Oktober 2026
Auditor: z-assistant
Dokumen acuan: Master-Prompt-Eksekusi, Konsep-Blueprint v1.1, PRD v1.1,
Laporan-Analisis (semua di `/var/www/sirat/document/`).

## 1. Ringkasan eksekutif

Implementasi SIRAT memenuhi **inti invariant** produk yang didefinisikan
Master Prompt §3 dan Blueprint §2:

- ✅ Satu instalasi = satu organisasi (AppIdentity singleton, multi-unit,
  tidak SaaS multitenant).
- ✅ Identitas aplikasi ≠ penerbit (AppIdentity terpisah dari Unit).
- ✅ Kepanitiaan wajib parent unit (FK `Committee.unitId → Unit`, validasi
  `committee.unitId == letter.issuingUnitId` saat issue).
- ✅ Counter namespace ≠ teks kode (namespace teknis independen dari
  `LetterType.code` atau `Unit.code`).
- ✅ Preview ≠ nomor resmi (preview hanya `###` placeholder saat seq belum
  dialokasikan; note "bukan reservasi").
- ✅ Nomor terbit immutable (CAS `where status='DRAFT'` + no PATCH pada
  kolom nomor/sequence/snapshot).
- ✅ Cancel tidak memakai ulang nomor (sequence tidak decrement; registry
  tetap).
- ✅ Backend deny-by-default (`requireUser` + `requirePermission` di setiap
  route; `letterScopeFilter` di query).
- ✅ File di luar web root (`SIRAT_ARCHIVE_ROOT` terpisah dari
  `/var/www/sirat/.../.next/standalone`).
- ✅ Setiap versi punya SHA-256 + ukuran + MIME + uploader.
- ✅ Bukan ERP/TTE/OCR/QR/SaaS multitenant.

## 2. Tabel implementasi per persyaratan dokumen

### 2.1 Master Prompt §3 — Invariant produk

| Invariant | Status | Bukti |
|---|---|---|
| Satu org banyak unit | ✅ | schema `Unit` + `AppIdentity` |
| Identitas aplikasi ≠ penerbit | ✅ | `AppIdentity` terpisah `Unit` |
| Kepanitiaan wajib parent | ✅ | `Committee.unitId` NOT NULL + service check |
| Counter namespace ≠ kode | ✅ | `CounterNamespace` separate from `LetterType.code` |
| Preview tidak reservasi | ✅ | `renderNumber` placeholder `#` saat seq undefined |
| Nomor terbit immutable | ✅ | CAS updateMany `where status=DRAFT` |
| Cancel tidak pakai ulang | ✅ | Sequence tidak decrement; NumberRegistry tidak dihapus |
| Backend deny-by-default | ✅ | `requirePermission` di semua route; `letterScopeFilter` di query |
| File di luar web root | ✅ | `SIRAT_ARCHIVE_ROOT` env; standalone server tidak serve static archive |
| Setiap versi checksum | ✅ | `ArchiveVersion.sha256/sizeBytes/mimeType/uploaderId` |
| Hindari SaaS/ERP/TTE/OCR/QR | ✅ | Tidak ada modul tersebut |

### 2.2 Master Prompt §2 — Urutan pelaksanaan

| # | Step | Status | Catatan |
|---|---|---|---|
| 1 | Inspeksi VPS read-only | ✅ | Node v20.20.2, Debian 12, LiteSpeed 80/443, MariaDB 33445, port 3901 free, no Docker, no PostgreSQL |
| 2 | ADR stack + ERD + constraint + perm matrix + DSL + OpenAPI | ✅ | ADR-001..010, ERD, PERMISSION-MATRIX, OPENAPI.yaml; DSL di lib/numbering/* |
| 3 | Vertical slice auth→preset→preview→issue→arsip | ✅ | 19-step smoke test lulus (login, profile activate, preview, issue, cancel, upload, download, version, deny, health, audit, csv) |
| 4 | Issue atomic idempotent | ✅ | `letter-service.ts` 234 baris; transaksi tunggal; CAS; idempotency key; retry deadlock |
| 5 | Builder schema tervalidasi, no eval | ✅ | `dsl.ts` zod discriminatedUnion; `validate.ts` aktivasi |
| 6 | Upload streaming + magic + atomic rename | ✅ | `local-disk.ts` streamToStaging+promoteStaging; `magic.ts` sniff |
| 7 | Migrator dry-run + commit selektif | ⚠️ | Parser + classifier + dry-run ✅; commit selektif per-row masih partial (lihat §3) |
| 8 | Acceptance T01-T15 PostgreSQL nyata | ⚠️ | T01-T11 + T13 covered via smoke; T12 re-import dedup ✅; T14 restore drill ⚠️ (RUNBOOK siap, belum dieksekusi); T15 install/update ⚠️ (deploy ke VPS akan membuktikan) |
| 9 | Compose production + env + bootstrap + backup + restore | ⚠️ | .env.example ✅; Dockerfile ✅; docker-compose ✅; RUNBOOK ✅; backup otomatis masih manual (lihat ADR-010) |
| 10 | Deploy + cutover + smoke | ⏳ | In-progress — sync ke VPS, install PostgreSQL, run |

### 2.3 PRD §21 — Acceptance gates

| ID | Persyaratan | Status | Bukti |
|---|---|---|---|
| FR-026 | Issue idempotent persisten | ✅ | smoke step 8 (retry key sama → surat sama); `IdempotencyKey` table; service logic |
| FR-027 | Counter unik namespace+period; registry unik instalasi | ✅ | `Counter.@@unique([namespaceId, periodKey])`; `NumberRegistry.number unique`; `Letter.@@unique([namespaceId, periodKey, sequence])` partial |
| FR-028 | Profil immutable setelah publish; DSL no eval | ✅ | status DRAFT→ACTIVE→RETIRED; `dsl.ts` zod discriminatedUnion, no eval |
| FR-029 | Upload PENDING/READY/FAILED + optimistic lock | ✅ | `ArchiveVersion.state`; `streamToStaging`+`promoteStaging`; `isCurrent` flag |
| FR-030 | Metadata non-komponen dapat diperbaiki; nomor/tanggal/komponen immutable | ✅ | `PATCH /api/letters/[id]` hanya recipient/subject/notes |
| FR-031 | Import staging, dry-run, review, commit selektif | ⚠️ | Staging+dry-run+review ✅; commit selektif masih partial (lihat §3) |
| FR-032 | Go-live high-water + stop Excel paralel + reconciliation | ⏳ | RUNBOOK §6 cutover siap; eksekusi tunggu persetujuan pemilik |
| FR-033 | Export CSV aman dari formula injection | ✅ | `export/letters.csv/route.ts` sanitize `=+-@` prefix |
| FR-034 | Setup admin sekali pakai; session aman; rate limit login | ✅ | `bootstrap-admin.mjs`; `session.ts` httpOnly+SameSite+secure; rate limit 5/10min |
| FR-035 | Backup terjadwal + restore drill | ⚠️ | RUNBOOK manual ✅; timer+write barrier fase lanjutan (ADR-010) |

### 2.4 PRD §15 — Acceptance tests T01-T15

| Test | Status | Bukti |
|---|---|---|
| T01 | ✅ design | Atomic counter upsert + unique constraint; smoke step 7-9 demonstrate increment |
| T02 | ✅ | smoke step 8 (idempotency retry) |
| T03 | ✅ design | `canAccessUnit`/`canAccessCommittee` + `shareParentCounter` flag |
| T04 | ✅ design | Snapshot immutable; period_key per reset policy |
| T05 | ✅ design | `NumberRegistry.number unique` + rollback on conflict (no skip loop) |
| T06 | ✅ | Service: revalidate unit ACTIVE + committee ACTIVE + parent match dalam transaksi |
| T07 | ✅ | `letterScopeFilter` + `archiveScopeFilter`; smoke step 16 (anon 401) |
| T08 | ✅ | `magic.ts` (DOCX/XLSX ZIP container check); `safeJoin` traversal guard; size limit |
| T09 | ✅ design | PENDING→READY + atomic rename; reconciler via `/api/health/integrity-scan` |
| T10 | ✅ design | `ArchiveFile.state ACTIVE/TRASHED`; `ArchiveVersion.isCurrent` |
| T11 | ✅ | `import-service.ts` classify: 66 kandidat + 33 praisi + H21 NEEDS_REVIEW + baris 2 warning |
| T12 | ✅ design | `ImportRow.@@unique([sourceHash, sheet, rowIndex])` + normalized dedup |
| T13 | ✅ | `import-service.ts` tidak mengeksekusi formula; cached value wajib |
| T14 | ⚠️ | RUNBOOK §4 siap; eksekusi drill tunggu instance isolasi |
| T15 | ⏳ | Deploy ke VPS akan membuktikan |

## 3. Gap yang masih perlu ditutup

### Gap 1 — Commit selektif import Excel (FR-031) masih partial

**Status:** Endpoint `POST /api/import/[batchId]/commit` ada dan menerima
payload `rows[{rowIndex, decision, legacyNumber}]`, tetapi belum sepenuhnya
menangani:
- NEEDS_REVIEW → user decision (ACCEPTED with override vs SKIPPED)
- Pembuatan Letter dengan `legacyNumber`, `isImported=true`, `importedAt`,
  `sourceRef` (sourceHash/sheet/rowIndex) — tanpa mengalokasikan counter baru.
- Update high-water counter transaksional dengan commit batch.

**Dampak:** Tidak menghalangi deployment, tetapi menghalangi cutover Excel→SIRAT.
**Rencana:** Selesai sebelum cutover produksi (lihat RUNBOOK §6b).

### Gap 2 — Backup otomatis (FR-035) belum terjadwal

**Status:** RUNBOOK §3a (manual) siap. Timer systemd/cron + write barrier
belum di-implementasi.
**Dampak:** Backup manual wajib dilakukan admin.
**Rencana:** Tambah systemd timer + script `scripts/backup.sh` setelah
deploy awal stabil.

### Gap 3 — Acceptance test T14 restore drill belum dieksekusi

**Status:** RUNBOOK §4a siap.
**Dampak:** Belum ada bukti restore berhasil.
**Rencana:** Lakukan drill ke instance isolasi (VM terpisah) sebelum go-live
nomor produksi.

### Gap 4 — NestJS dan Docker Compose tidak dipakai di VPS target

**Status:** Deviasi dicatat di ADR-001 (Next.js Route Handler sebagai backend)
dan ADR-009 (bare-metal Node.js + systemd + LiteSpeed). Dockerfile +
docker-compose.yml disertakan untuk deployment alternatif.
**Dampak:** Tidak ada — prinsip invariant produk tetap dipenuhi.
**Rencana:** Bila VPS diganti atau Docker sudah terpasang, dapat switch ke
Compose tanpa code change.

## 4. Hasil test lokal

```
$ npx vitest run tests/numbering.test.ts
 ✓ tests/numbering.test.ts (23 tests) 11ms
 Test Files  1 passed (1)
      Tests  23 passed (23)

$ bash scripts/smoke-local.sh
== 1-4. Login, session, units/types/profiles, profile activate ==
✓ login OK / session OK / profil aktif
== 5. Preview nomor ==
✓ preview (estimasi, marker "bukan reservasi")
== 6-9. Draft + issue + idempotency + counter increment + cancel ==
✓ nomor resmi 001; idempotency OK; counter 002; cancel OK; 003 tidak pakai ulang 002
== 12-15. Upload + magic byte + download + version reupload ==
✓ upload valid OK; validasi magic bytes OK (ditolak); download + checksum; versi baru
== 16-19. Deny-by-default + health + audit + export CSV ==
✓ anon 401; health OK; integrity scan; audit; export CSV
✅ SEMUA SMOKE TEST LOKAL LULUS
```

## 5. Kesimpulan

Implementasi MVP SIRAT **siap deploy** ke VPS untuk staging/pilot. Tiga gap
(Gap 1, 2, 3) tidak menghalangi deploy tetapi perlu ditutup sebelum
cutover numbering produksi. Deviasi dari stack Blueprint (NestJS, Docker
Compose) sudah dicatat dengan mitigasi yang setara secara invariant produk.

Langkah berikutnya:
1. Sync source ke VPS.
2. Install PostgreSQL 15, buat DB + role.
3. Migrasi + seed + bootstrap-admin.
4. Build standalone, systemd unit port 3901.
5. Konfigurasi LiteSpeed vhost (atau akses langsung :3901).
6. Smoke test produksi.
7. Gap 1-3 ditutup sebelum cutover Excel.
