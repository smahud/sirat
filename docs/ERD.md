# SIRAT — Entity Relationship Diagram (ERD)

Mengacu pada `prisma/schema.prisma` (canonical, PostgreSQL) dan Blueprint §11.
Validasi: `npx prisma validate --schema prisma/schema.prisma`.

## Domain entities

```
┌──────────────────────┐         ┌──────────────────────┐
│ AppIdentity          │         │ LetterType           │
│ id="app" (singleton) │         │ code (unique)        │
│ name                 │         │ name                 │
│ ownerName            │         │ isActive             │
│ timezone             │         └──────────┬───────────┘
│ locale               │                    │ 1..*
└──────────────────────┘                    │
                                            ▼
┌──────────────────────┐     ┌──────────────────────────────┐
│ User                 │     │ Letter                       │
│ id (cuid)            │     │ id (cuid)                    │
│ username (unique)    │◀────│ issuerId?                    │
│ passwordHash         │     │ issuingUnitId ────────┐      │
│ fullName             │     │ committeeId? ─────┐    │      │
│ email?               │     │ status           │    │      │
│ role (string)        │     │ letterDate?      │    │      │
│ isActive             │     │ issuedAt?        │    │      │
└─────────┬────────────┘     │ sequence?        │    │      │
          │ 1..*              │ namespaceId? ─┐  │    │      │
          ▼                   │ periodKey?   │  │    │      │
┌──────────────────────┐     │ officialNumber?│  │    │      │
│ AccessAssignment     │     │ normalizedNumber?│ │    │      │
│ id (cuid)            │     │ profileVersionId?│ │    │      │
│ userId ────────────▶│     │ numberSnapshot?  │ │    │      │
│ unitId? ────────────┼─▶U  │ direction?      │ │    │      │
│ committeeId? ───────┼─▶C  │ letterTypeId? ◀──┼─┴────┼──────┤
│ includeCommittees    │     │ recipient?       │      │      │
│ @@unique(userId,     │     │ subject?         │      │      │
│   unitId, committeeId│     │ notes?           │      │      │
└──────────────────────┘     │ cancelReason?    │      │      │
                              │ cancelledAt?     │      │      │
                              │ cancelledBy?     │      │      │
                              │ legacyNumber?    │      │      │
                              │ isImported       │      │      │
                              │ importedAt?      │      │      │
                              │ sourceRef?       │      │      │
                              │ createdAt        │      │      │
                              │ updatedAt        │      │      │
                              │ @@unique(        │      │      │
                              │   namespaceId,   │      │      │
                              │   periodKey,     │      │      │
                              │   sequence)      │      │      │
                              │   partial null   │      │      │
                              └────────┬─────────┘      │      │
                                       │ 1..*            │      │
                                       ▼                │      │
┌──────────────────────┐     ┌─────────────────────────┐│      │
│ Unit                 │     │ ArchiveFile             ││      │
│ id (cuid)            │◀────│ letterId ───────────────┼┘      │
│ code (unique)        │     │ label (original|attach) │      │
│ name                 │     │ state (ACTIVE|TRASHED)  │      │
│ storageKey (unique,  │     │ createdAt/updatedAt     │      │
│   slug stabil)       │     └──────────┬──────────────┘      │
│ status (ACTIVE|      │                │ 1..*                │
│   INACTIVE|ARCHIVED) │                ▼                     │
│ createdAt/updatedAt  │     ┌─────────────────────────┐      │
└─────────┬────────────┘     │ ArchiveVersion          │      │
          │ 1..*              │ id (cuid)               │      │
          ▼                   │ archiveFileId           │      │
┌──────────────────────┐     │ versionNo               │      │
│ Committee            │     │ state (PENDING|READY|    │      │
│ id (cuid)            │◀────│   FAILED)               │      │
│ code                 │     │ objectKey (unique,       │      │
│ name                 │     │   path relatif root)    │      │
│ storageKey (unique)  │     │ originalName             │      │
│ unitId ─────────────┼─▶U  │ sizeBytes                │      │
│ startDate?           │     │ mimeType                 │      │
│ endDate?             │     │ sha256                   │      │
│ status (DRAFT|ACTIVE │     │ uploaderId               │      │
│   |COMPLETED|ARCHIVED│     │ isCurrent (optimistic    │      │
│   )                  │     │   lock)                  │      │
│ shareParentCounter   │     │ createdAt                │      │
│ @@unique(unitId,code)│     │ @@unique(archiveFileId,  │      │
└─────────┬────────────┘     │   versionNo)             │      │
          │ 1..*              └─────────────────────────┘      │
          ▼                                                    │
┌──────────────────────┐     ┌─────────────────────────┐      │
│ NumberingProfile     │     │ CounterNamespace         │      │
│ id (cuid)            │     │ id (cuid)                │      │
│ name                 │     │ name                     │      │
│ ownerId ────────────┼─▶U  │ unitId? ◀────────────────┼──────┤
│ committeeId? (unique)│◀───│ committeeId?             │      │
│ createdAt/updatedAt  │     │ resetPolicy (ALL|YEARLY|  │      │
└─────────┬────────────┘     │   MONTHLY)                │      │
          │ 1..*              │ dateSource (LETTER_DATE| │      │
          ▼                   │   ISSUE_DATE)            │      │
┌──────────────────────┐     │ @@unique(unitId,          │      │
│ NumberingProfile     │     │   committeeId, name)     │      │
│   Version            │     └──────────┬──────────────┘      │
│ id (cuid)            │                │ 1..*                │
│ profileId ───────────┤                ▼                     │
│ version              │     ┌─────────────────────────┐      │
│ status (DRAFT|ACTIVE │     │ Counter                  │      │
│   |RETIRED)          │     │ id (cuid)                │      │
│ dsl (JSON)           │     │ namespaceId ◀────────────┘      │
│ effectiveFrom?       │     │ periodKey (default "ALL")        │
│ activatedAt?         │     │ lastValue (default 0)            │
│ namespaceId? ────────┼─▶NS│ updatedAt                        │
│ createdAt             │     │ @@unique(namespaceId, periodKey)│
│ @@unique(profileId,   │     └─────────────────────────┘      │
│   version)            │                                       │
└──────────────────────┘                                       │
                                                                │
┌──────────────────────┐     ┌─────────────────────────┐      │
│ NumberRegistry       │     │ IdempotencyKey          │      │
│ id (cuid)            │     │ id (cuid)                │      │
│ number (unique,      │     │ actorId                  │      │
│   normalized)         │     │ operation                │      │
│ letterId ────────────┼─▶L  │ key                      │      │
│ createdAt             │     │ payloadHash (sha256)     │      │
└──────────────────────┘     │ letterId?                │      │
                              │ createdAt                 │      │
                              │ @@unique(actorId,         │      │
                              │   operation, key)         │      │
                              └──────────────────────────┘      │
                                                                │
┌──────────────────────┐     ┌─────────────────────────┐      │
│ AuditEvent           │     │ StorageBackend           │      │
│ id (cuid)            │     │ id (cuid)                │      │
│ actorId?             │     │ kind (default LOCAL)     │      │
│ action               │     │ label (unique)           │      │
│ entityType?          │     │ rootPath                 │      │
│ entityId?            │     │ isActive                 │      │
│ outcome (SUCCESS|    │     │ testStatus? (JSON)       │      │
│   FAILURE|DENIED)    │     │ createdAt/updatedAt      │      │
│ correlationId?       │     └─────────────────────────┘      │
│ metadata? (JSON,     │                                       │
│   redacted)          │     ┌─────────────────────────┐      │
│ createdAt            │     │ ImportBatch              │      │
│ (no update/delete    │     │ id (cuid)                │      │
│   path in app)       │     │ sourceHash (sha256)      │      │
└──────────────────────┘     │ fileName                 │      │
                              │ sheet                    │      │
                              │ status (DRY_RUN|COMMITTED│      │
                              │ targetUnitId?             │      │
                              │ createdBy?                │      │
                              │ committedAt?              │      │
                              │ report? (JSON)            │      │
                              └──────────┬───────────────┘      │
                                         │ 1..*                  │
                                         ▼                       │
                              ┌─────────────────────────┐      │
                              │ ImportRow                │      │
                              │ id (cuid)                │      │
                              │ batchId                  │      │
                              │ sheet                    │      │
                              │ rowIndex                 │      │
                              │ sourceHash               │      │
                              │ rawNumber?               │      │
                              │ status (CANDIDATE|        │      │
                              │   NEEDS_REVIEW|ACCEPTED| │      │
                              │   PRAISI|ERROR|IMPORTED| │      │
                              │   SKIPPED)                │      │
                              │ data (JSON raw input)     │      │
                              │ issues? (JSON warnings)   │      │
                              │ letterId?                 │      │
                              │ @@unique(sourceHash,      │      │
                              │   sheet, rowIndex)        │      │
                              └─────────────────────────┘      │
```

## Constraints penting

1. **Letter unique partial** `(namespaceId, periodKey, sequence)`:
   - Saat draft, ketiga kolom boleh NULL → tidak ada konflik.
   - Saat issued, ketiga kolom wajib isi → unik dalam namespace+period.
2. **NumberRegistry.number unique**: canonical normalized nomor resmi
   tingkat instalasi — pencegah konflik lintas namespace.
3. **IdempotencyKey @@unique(actorId, operation, key)**: satu hasil per
   key per aktor.
4. **ArchiveVersion.objectKey unique**: satu file fisik = satu object key stabil.
5. **Committee @@unique(unitId, code)**: kode kepanitiaan unik dalam unit parent.
6. **CounterNamespace @@unique(unitId, committeeId, name)**: nama namespace
   unik per scope.
7. **LetterType.code unique**: kode stabil; perubahan kode hanya untuk terbitan baru.
8. **AuditEvent**: tidak ada path update/delete di aplikasi (append-only
   operasional).

## Relasi penting

- `Letter.issuingUnitId` → `Unit` (wajib)
- `Letter.committeeId` → `Committee` (opsional; bila terisi, wajib
  `committee.unitId == letter.issuingUnitId` — divalidasi di service layer)
- `Letter.namespaceId` → `CounterNamespace` (wajib saat issued)
- `Letter.profileVersionId` → `NumberingProfileVersion` (snapshot profil aktif saat terbit)
- `NumberingProfileVersion.namespaceId` → `CounterNamespace` (binding eksplisit
  saat aktivasi)
- `ArchiveFile.letterId` → `Letter` (wajib; tidak ada arsip tanpa surat)
- `ArchiveVersion.archiveFileId` → `ArchiveFile` (versi menempel pada file)

## Lifecycle status (Blueprint §3)

- **Unit**: ACTIVE → INACTIVE → ARCHIVED (re-aktivasi dari INACTIVE ke ACTIVE
  diizinkan; dari ARCHIVED butuh audit eksplisit).
- **Committee**: DRAFT → ACTIVE → COMPLETED → ARCHIVED.
- **Letter**: DRAFT → ISSUED → CANCELLED (transisi terminal; nomor tetap,
  counter tidak turun).
- **NumberingProfileVersion**: DRAFT → ACTIVE → RETIRED (immutable setelah
  ACTIVE; edit = buat version DRAFT baru).
- **ArchiveFile**: ACTIVE → TRASHED (restore kembali ke ACTIVE).
- **ArchiveVersion**: PENDING → READY | FAILED (READY immutable; FAILED tidak
  bisa di-download).
