// Pengumpulan data backup (B.2–B.4): FULL vs SCOPED, penanganan data bersama.
import 'server-only'
import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export type TableRow = Record<string, unknown>

export interface CollectedData {
  tables: Record<string, TableRow[]>
  fileObjectKeys: string[] // objectKey ArchiveVersion yang ikut (blob di bawah files/)
  scopeLabels: string[]
  counts: Record<string, number>
  includesPasswordHash: boolean
  filesMissing: string[]
}

/** Sidik jari skema dari DMMF Prisma runtime — deteksi backup lintas versi skema. */
export function schemaFingerprint(): string {
  const canon = Prisma.dmmf.datamodel.models
    .map(m => [m.name, ...m.fields.map(f => `${f.name}:${f.type}:${f.kind}`)].join(','))
    .sort()
    .join('\n')
  return createHash('sha256').update(canon).digest('hex')
}

async function collectFull(): Promise<CollectedData> {
  const [
    appIdentity, users, units, committees, assignments, letterTypes,
    profiles, profileVersions, namespaces, counters, letters, registry,
    archiveFiles, archiveVersions, letterReferences, auditEvents,
    storageBackends, importBatches, importRows, backupGrants,
  ] = await Promise.all([
    db.appIdentity.findMany(),
    db.user.findMany(),
    db.unit.findMany(),
    db.committee.findMany(),
    db.accessAssignment.findMany(),
    db.letterType.findMany(),
    db.numberingProfile.findMany(),
    db.numberingProfileVersion.findMany(),
    db.counterNamespace.findMany(),
    db.counter.findMany(),
    db.letter.findMany(),
    db.numberRegistry.findMany(),
    db.archiveFile.findMany(),
    db.archiveVersion.findMany(),
    db.letterReference.findMany(),
    db.auditEvent.findMany(),
    db.storageBackend.findMany(),
    db.importBatch.findMany(),
    db.importRow.findMany(),
    db.backupGrant.findMany(), // B.2: role, permission, assignment termasuk hak backup
  ])
  const tables: Record<string, TableRow[]> = {
    AppIdentity: appIdentity as unknown as TableRow[],
    User: users as unknown as TableRow[],
    Unit: units as unknown as TableRow[],
    Committee: committees as unknown as TableRow[],
    AccessAssignment: assignments as unknown as TableRow[],
    LetterType: letterTypes as unknown as TableRow[],
    NumberingProfile: profiles as unknown as TableRow[],
    NumberingProfileVersion: profileVersions as unknown as TableRow[],
    CounterNamespace: namespaces as unknown as TableRow[],
    Counter: counters as unknown as TableRow[],
    Letter: letters as unknown as TableRow[],
    NumberRegistry: registry as unknown as TableRow[],
    ArchiveFile: archiveFiles as unknown as TableRow[],
    ArchiveVersion: archiveVersions as unknown as TableRow[],
    LetterReference: letterReferences as unknown as TableRow[],
    AuditEvent: auditEvents as unknown as TableRow[],
    StorageBackend: storageBackends as unknown as TableRow[],
    ImportBatch: importBatches as unknown as TableRow[],
    ImportRow: importRows as unknown as TableRow[],
    BackupGrant: backupGrants as unknown as TableRow[],
    // BackupEvent sengaja TIDAK ikut: riwayat operasi backup itu sendiri,
    // bukan data sistem yang dipulihkan (didokumentasikan di BACKUP-RESTORE.md).
  }
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(tables)) counts[k] = v.length
  return {
    tables,
    fileObjectKeys: archiveVersions.map(v => v.objectKey),
    scopeLabels: [],
    counts,
    includesPasswordHash: true,
    filesMissing: [],
  }
}

async function collectScoped(unitIds: string[], committeeIds: string[]): Promise<CollectedData> {
  // Surat dalam scope (B.3 — didokumentasikan eksplisit):
  //   scope unit    → surat reguler unit + seluruh surat kepanitiaan di bawah unit itu
  //   scope panitia → hanya surat kepanitiaan tersebut
  const letters = await db.letter.findMany({
    where: {
      OR: [
        { issuingUnitId: { in: unitIds } },
        { committeeId: { in: committeeIds } },
      ],
    },
  })
  const letterIds = letters.map(l => l.id)

  // Data bersama/referensi (B.4): akun multi-unit BUKAN milik eksklusif satu unit —
  // hanya snapshot identitas (tanpa passwordHash) yang ikut, utk pembacaan historis.
  const issuerIds = [...new Set(letters.map(l => l.issuerId).filter((x): x is string => !!x))]
  const users = issuerIds.length
    ? await db.user.findMany({ where: { id: { in: issuerIds } }, select: { id: true, username: true, fullName: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true } })
    : []

  const units = await db.unit.findMany({ where: { id: { in: unitIds } } })
  const scopedCommittees = await db.committee.findMany({
    where: { OR: [{ unitId: { in: unitIds } }, { id: { in: committeeIds } }] },
  })
  const letterTypeIds = [...new Set(letters.map(l => l.letterTypeId).filter((x): x is string => !!x))]
  const letterTypes = letterTypeIds.length
    ? await db.letterType.findMany({ where: { id: { in: letterTypeIds } } })
    : []

  const profileVersionIds = [...new Set(letters.map(l => l.profileVersionId).filter((x): x is string => !!x))]
  const profileVersions = profileVersionIds.length
    ? await db.numberingProfileVersion.findMany({ where: { id: { in: profileVersionIds } } })
    : []
  const profileIds = [...new Set(profileVersions.map(p => p.profileId))]
  const profiles = profileIds.length
    ? await db.numberingProfile.findMany({ where: { id: { in: profileIds } } })
    : []

  const namespaceIds = [...new Set(letters.map(l => l.namespaceId).filter((x): x is string => !!x))]
  const namespaces = namespaceIds.length
    ? await db.counterNamespace.findMany({ where: { id: { in: namespaceIds } } })
    : []
  const counters = namespaceIds.length
    ? await db.counter.findMany({ where: { namespaceId: { in: namespaceIds } } })
    : []

  const registry = letterIds.length
    ? await db.numberRegistry.findMany({ where: { letterId: { in: letterIds } } })
    : []

  // Referensi: hanya sisi keluar dari surat dalam scope (incoming lintas scope
  // tidak dibawa — didokumentasikan; full backup yang memuat relasi lengkap).
  const letterReferences = letterIds.length
    ? await db.letterReference.findMany({ where: { letterId: { in: letterIds } } })
    : []

  const archiveFiles = letterIds.length
    ? await db.archiveFile.findMany({ where: { letterId: { in: letterIds } } })
    : []
  const archiveFileIds = archiveFiles.map(f => f.id)
  const archiveVersions = archiveFileIds.length
    ? await db.archiveVersion.findMany({ where: { archiveFileId: { in: archiveFileIds } } })
    : []

  const tables: Record<string, TableRow[]> = {
    User: users as unknown as TableRow[], // snapshot identitas TANPA passwordHash
    Unit: units as unknown as TableRow[],
    Committee: scopedCommittees as unknown as TableRow[],
    LetterType: letterTypes as unknown as TableRow[],
    NumberingProfile: profiles as unknown as TableRow[],
    NumberingProfileVersion: profileVersions as unknown as TableRow[],
    CounterNamespace: namespaces as unknown as TableRow[],
    Counter: counters as unknown as TableRow[],
    Letter: letters as unknown as TableRow[],
    NumberRegistry: registry as unknown as TableRow[],
    LetterReference: letterReferences as unknown as TableRow[],
    ArchiveFile: archiveFiles as unknown as TableRow[],
    ArchiveVersion: archiveVersions as unknown as TableRow[],
  }
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(tables)) counts[k] = v.length
  const unitLabels = units.map(u => u.code)
  const committeeLabels = scopedCommittees
    .filter(c => committeeIds.includes(c.id))
    .map(c => c.code)
  return {
    tables,
    fileObjectKeys: archiveVersions.map(v => v.objectKey),
    scopeLabels: [...unitLabels, ...committeeLabels],
    counts,
    includesPasswordHash: false,
    filesMissing: [],
  }
}

export async function collectBackupData(
  kind: 'FULL' | 'SCOPED' | 'SAFETY',
  unitIds: string[],
  committeeIds: string[],
): Promise<CollectedData> {
  if (kind === 'FULL' || kind === 'SAFETY') {
    const data = await collectFull()
    return kind === 'SAFETY' ? data : data
  }
  return collectScoped(unitIds, committeeIds)
}
