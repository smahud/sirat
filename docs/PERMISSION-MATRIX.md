# SIRAT — Permission Matrix

RBAC scoped (Blueprint §9 + §16.5, NFR-002). Permission dihitung dari
**role global** + **AccessAssignment** (unitId/committeeId/includeCommittees).

## Permission bawaan (lib/rbac.ts)

| Permission            | SYSTEM_ADMIN | ORG_ADMIN | UNIT_ADMIN | COMMITTEE_ADMIN | OPERATOR | VIEWER | AUDITOR |
|-----------------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| appidentity.manage    | ✅ | ✅ | — | — | — | — | — |
| unit.manage           | ✅ | ✅ | — | — | — | — | — |
| committee.manage      | ✅ | ✅ | ✅* | ✅* | — | — | — |
| user.manage           | ✅ | ✅ | ✅* | ✅* | — | — | — |
| lettertype.manage     | ✅ | ✅ | ✅* | ✅* | — | — | — |
| profile.manage        | ✅ | ✅ | ✅* | ✅* | — | — | — |
| storage.manage        | ✅ | ✅ | — | — | — | — | — |
| letter.view           | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| letter.create         | ✅ | — | ✅ | ✅ | ✅ | — | — |
| letter.issue          | ✅ | — | ✅ | ✅ | ✅ | — | — |
| letter.cancel         | ✅ | — | ✅ | ✅ | — | — | — |
| archive.upload        | ✅ | — | ✅ | ✅ | ✅ | — | — |
| archive.download      | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| archive.trash         | ✅ | — | ✅ | ✅ | — | — | — |
| archive.restore       | ✅ | — | ✅ | ✅ | — | — | — |
| audit.view            | ✅ | ✅ | ✅ | ✅ | — | — | ✅ |
| import.manage         | ✅ | ✅ | ✅* | ✅* | — | — | — |
| export.run            | ✅ | ✅ | ✅ | ✅ | — | — | — |
| health.view           | ✅ | ✅ | ✅ | ✅ | — | — | — |

\* = terbatas scope unit/committee yang di-assign. SYSTEM_ADMIN punya `*`
(wildcard semua permission).

## Scope inheritance (Blueprint §16.5)

- **GLOBAL_ROLES** (SYSTEM_ADMIN, ORG_ADMIN, AUDITOR): `scope.all = true` →
  akses seluruh unit/committee.
- **Role non-global**: wajib punya minimal satu `AccessAssignment`.
- **Assignment unitId**: akses surat reguler unit tersebut.
- **Assignment unitId + includeCommittees=true**: akses semua committee di
  bawah unit tersebut (termasuk committee yang akan dibuat kemudian).
- **Assignment committeeId** saja: akses hanya committee itu (tidak termasuk
  surat reguler parent unit atau committee lain di parent yang sama).
- **Admin unit TIDAK otomatis admin sistem**: tidak bisa upgrade role sendiri
  atau membuat SYSTEM_ADMIN baru.

## Filter prisma (lib/rbac.ts)

- `letterScopeFilter(user)`: WHERE clause untuk `db.letter.findMany()`.
  - scope.all: undefined (no filter)
  - else: `OR [issuingUnitId IN unitIds, committeeId IN committeeIds,
    committee.unitId IN unitIdsWithAllCommittees, issuingUnitId IN
    unitIdsWithAllCommittees]`
- `archiveScopeFilter(user)`: `{ letter: letterScopeFilter(user) }` — filter
  berkas arsip via relasi letter.

## Verifikasi (T07 — URL/ID tampering)

Test negatif wajib lulus:
1. Operator dengan akses unit MI tidak bisa `GET /api/letters/<id_yapsi>`.
2. Operator tanpa akses committee tidak bisa `POST /api/letters` dengan
   `committeeId` milik unit lain.
3. Viewer tidak bisa `POST /api/letters/<id>/issue` (403).
4. URL download dengan `archiveVersionId` milik surat di unit lain → 403
   atau 404 (Blueprint: "404 untuk menyamarkan objek di luar scope secara
   konsisten").

## Audit deny

Setiap permintaan yang ditolak karena permission dicatat ke `AuditEvent`
dengan `action = 'permission.denied:<perm>'`, `outcome = 'DENIED'`.
Lihat `lib/api-helpers.ts: requirePermission()`.

## Bootstrap admin

- Satu kali via `scripts/bootstrap-admin.mjs` (membuat user SYSTEM_ADMIN).
- Password auto-generate (`crypto.randomBytes(12).toString('base64url')`)
  bila env `SIRAT_ADMIN_PASSWORD` kosong; dicetak SEKALI ke stdout.
- Setelah admin dibuat, hapus env password dari `.env` (one-shot).
- Tidak ada wizard publik yang terus terbuka.
