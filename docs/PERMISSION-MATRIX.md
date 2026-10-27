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
| profile.manage        | ✅ | ✅ | — | — | — | — | — |
| storage.manage        | ✅ | ✅ | — | — | — | — | — |
| letter.view           | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| letter.create         | ✅ | — | ✅ | ✅ | ✅ | — | — |
| letter.issue          | ✅ | — | ✅ | ✅ | ✅ | — | — |
| letter.cancel         | ✅ | — | ✅ | ✅ | — | — | — |
| archive.upload        | ✅ | — | ✅ | ✅ | ✅ | — | — |
| archive.download      | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| archive.trash         | ✅ | — | ✅ | ✅ | — | — | — |
| archive.restore       | ✅ | — | ✅ | ✅ | — | — | — |
| audit.view            | ✅ | ✅ | — | — | — | — | ✅ |
| import.manage         | ✅ | ✅ | ✅* | ✅* | — | — | — |
| export.run            | ✅ | ✅ | ✅ | ✅ | — | — | — |
| health.view           | ✅ | ✅ | ✅ | ✅ | — | — | — |
| backup.export (full)  | ✅ | ✅ | — | — | — | — | — |
| backup.restore (full) | ✅ | — | — | — | — | — | — |

\* = terbatas scope unit/committee yang di-assign. SYSTEM_ADMIN punya `*`

> **Perubahan v1.5 — profil penomoran dikelola pusat:** `profile.manage`
> dicabut dari UNIT_ADMIN dan COMMITTEE_ADMIN. Menu **Profil Nomor** hanya
> muncul bagi SYSTEM_ADMIN/ORG_ADMIN; `GET /api/numbering-profiles` menolak
> 403 untuk role lain (deny by default). Alasan: profil penomoran adalah
> kebijakan organisasi (bentuk nomor resmi) — konsisten dengan jenis surat
> yang juga dikelola pusat.

## Backup per scope (master prompt lanjutan B.1)

`backup.export` / `backup.restore` **tidak otomatis** untuk Admin Unit/Committee —
dua permission terpisah yang diberikan eksplisit per scope melalui tabel `BackupGrant`
(menu Backup & Restore → Hak Akses Backup, hanya otoritas global):

| Sumber izin | backup.export | backup.restore |
|---|---|---|
| Role SYSTEM_ADMIN (`*`) | semua scope (Full) | semua scope (Full) |
| Role ORG_ADMIN | semua scope (Full) | — |
| BackupGrant unit/kepanitiaan `canExport` | scope grant itu | — |
| BackupGrant unit/kepanitiaan `canRestore` | — | scope grant itu |

Pencabutan grant langsung efektif (kapabilitas di-resolve per request dari DB).
(wildcard semua permission).

> **Perubahan v1.5 — visibilitas menu = fungsi menu:** menu yang tidak
> diiringi permission tidak dimunculkan sama sekali (bukan sekadar disabled):
> - *Unit & Panitia* → `committee.manage` (OPERATOR/VIEWER/AUDITOR tidak melihat).
> - *Profil Nomor* → `profile.manage` (admin unit ke bawah tidak melihat).
> - *Import Data* → `import.manage`.
> Dashboard menyesuaikan: tanpa `health.view`, statistik menampilkan surat
> dalam scope user (bukan memanggil /api/health yang pasti 403).

> **Perubahan v1.5 — scope target import:** `POST /api/import/:batchId/commit`
> memvalidasi `canManageUnit(user, targetUnitId)` di backend. Role global boleh
> ke unit mana pun; UNIT_ADMIN hanya unit assignment-nya. Filtering frontend
> bukan batas keamanan — backend selalu memvalidasi ulang.

> **Perubahan audit trail (v1.2):** `audit.view` dicabut dari UNIT_ADMIN dan
> COMMITTEE_ADMIN. `AuditEvent` tidak memiliki kolom scope sehingga trail bersifat
global — menampilkannya ke admin unit berarti kebocoran informasi lintas scope.
Audit hanya dapat dilihat role global (SYSTEM_ADMIN, ORG_ADMIN, AUDITOR).

## Aturan akses surat (E — kepanitiaan)

Permission `letter.create`/`letter.issue` saja TIDAK cukup; tiap request
validasi ulang konteks penerbitan:

- Surat **reguler unit**: wajib `canAccessUnit` (assignment unitId / scope.all).
- Surat **kepanitiaan**: wajib `canAccessCommittee` — hanya dua jalan eksplisit:
  assignment `committeeId` langsung, ATAU assignment unit dengan
  `includeCommittees=true`. **Akses unit biasa tidak cukup** untuk membuat,
  mengubah draft menjadi surat panitia, maupun menerbitkan surat panitia.
- Mencabut assignment / flag includeCommittees langsung berlaku pada request
  berikutnya (scope di-resolve per request, tidak di-cache di sesi).
- `PATCH /api/letters/:id`: DRAFT butuh `letter.create`; koreksi metadata surat
  TERBIT butuh `letter.cancel` (UNIT_ADMIN+). VIEWER tidak bisa mengubah apa pun.

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
  atau membuat SYSTEM_ADMIN baru, dan tidak bisa menyentuh user dengan role di
  atas wewenangnya (PATCH /api/users).
- **Delegasi terikat scope pengelolaan**: admin unit hanya bisa membuat/mengubah
  user dengan assignment pada unit/committee yang dikelolanya
  (`assertAssignmentsInScope`) dan membuat committee di unitnya
  (`canManageUnit`). Profil penomoran sejak v1.5 dikelola pusat — admin unit
  tidak lagi bisa membuat/mengaktivasi profil (lihat catatan di atas).

## Filter prisma (lib/rbac.ts)

- `letterScopeFilter(user)`: WHERE clause untuk `db.letter.findMany()`.
  - scope.all: undefined (no filter)
  - else: `OR [issuingUnitId IN unitIds, committeeId IN committeeIds,
    committee.unitId IN unitIdsWithAllCommittees, issuingUnitId IN
    unitIdsWithAllCommittees]` (klausa kosong dilewati; tanpa scope → tidak
    melihat apa pun)
- `archiveScopeFilter(user)`: `{ letter: letterScopeFilter(user) }` — filter
  berkas arsip via relasi letter.
- `unitVisibilityFilter(user)`: unit yang terlihat di master = unit assignment
  ∪ unit induk dari committee assignment (konteks penerbitan surat panitia).
- `committeeVisibilityFilter(user)`: committee di bawah unit yang dikelola ∪
  committee yang di-assign langsung.
- `profileVisibilityFilter(user)`: profil milik unit yang dikelola ∪ profil
  committee yang di-assign.

## Verifikasi (T07 — URL/ID tampering)

Test negatif wajib lulus (unit test `tests/rbac.test.ts` + verifikasi manual):
1. Operator dengan akses unit MI tidak bisa `GET /api/letters/<id_yapsi>`.
2. Operator tanpa akses committee tidak bisa `POST /api/letters` dengan
   `committeeId` milik unit lain — termasuk operator unit induk TANPA flag
   includeCommittees (E.2).
3. Viewer tidak bisa `POST /api/letters/<id>/issue` (403) dan tidak bisa
   `PATCH /api/letters/<id>` (403).
4. URL download dengan `archiveVersionId` milik surat di unit lain → 403
   atau 404 (Blueprint: "404 untuk menyamarkan objek di luar scope secara
   konsisten").
5. Unit admin tidak bisa membuat committee/profil/user di unit lain (403 SCOPE).
6. GET /api/users tidak pernah mengembalikan passwordHash.

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
