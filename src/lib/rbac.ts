// Scoped RBAC — deny by default (Blueprint 16.5).
// Permission dihitung dari role global + assignment unit/kepanitiaan.
// Konsep (master prompt E): user + role + scope_type + scope_id + permission.
// - Assignment ≠ otomatis boleh semua aksi: tiap akses surat diperiksa per konteks
//   (surat kepanitiaan WAJIB akses committee; akses unit saja tidak cukup).
// - Intervensi user unit atas surat kepanitiaan = authorization eksplisit
//   (assignment committee langsung ATAU flag includeCommittees per unit);
//   mencabut assignment/flag langsung berlaku (scope di-resolve per request).
import { db } from '@/lib/db'
import { Role } from '@/lib/constants'

export const PERMISSIONS = [
  'appidentity.manage', 'unit.manage', 'committee.manage', 'user.manage',
  'lettertype.manage', 'profile.manage', 'letter.view', 'letter.create',
  'letter.issue', 'letter.cancel', 'archive.upload', 'archive.download',
  'archive.trash', 'archive.restore', 'audit.view', 'storage.manage',
  'import.manage', 'export.run', 'health.view',
  'backup.export', 'backup.restore',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const OPERATOR_PERMS: Permission[] = [
  'letter.view', 'letter.create', 'letter.issue', 'archive.upload', 'archive.download',
]

// audit.view dicabut dari UNIT_ADMIN/COMMITTEE_ADMIN: AuditEvent tidak punya kolom scope,
// sehingga menampilkan trail global ke admin unit = kebocoran informasi lintas scope
// (least privilege / deny by default). Audit hanya untuk role global.
//
// profile.manage juga dicabut dari UNIT_ADMIN/COMMITTEE_ADMIN (kebijakan pusat v1.5):
// profil penomoran adalah kebijakan organisasi yang dikelola pusat (SYSTEM_ADMIN/ORG_ADMIN).
// Admin unit ke bawah tidak memiliki akses — bahkan menu "Profil Nomor" tidak dimunculkan,
// dan GET /api/numbering-profiles menolak dengan 403 (deny by default).
const UNIT_ADMIN_PERMS: Permission[] = [
  'committee.manage', 'user.manage', 'lettertype.manage',
  ...OPERATOR_PERMS, 'letter.cancel', 'archive.trash', 'archive.restore',
  'import.manage', 'export.run', 'health.view',
]

export const ROLE_PERMISSIONS: Record<Role, Permission[] | '*'> = {
  SYSTEM_ADMIN: '*',
  ORG_ADMIN: [
    'appidentity.manage', 'unit.manage', 'committee.manage', 'user.manage',
    'lettertype.manage', 'profile.manage', 'letter.view', 'audit.view',
    'storage.manage', 'import.manage', 'export.run', 'health.view',
    'backup.export',
  ],
  UNIT_ADMIN: UNIT_ADMIN_PERMS,
  COMMITTEE_ADMIN: UNIT_ADMIN_PERMS,
  OPERATOR: OPERATOR_PERMS,
  VIEWER: ['letter.view', 'archive.download'],
  AUDITOR: ['letter.view', 'audit.view'],
}

// Master prompt lanjutan B.1: backup & restore adalah DUA permission terpisah
// dan TIDAK otomatis diberikan ke Admin Unit/Committee — harus eksplisit lewat
// BackupGrant per scope (unit/kepanitiaan) atau role global.
// - backup.export (global): SYSTEM_ADMIN ('*') + ORG_ADMIN → Full System Backup.
// - backup.restore (global): SYSTEM_ADMIN saja → Full System Restore.
// - Scoped backup/restore: lewat tabel BackupGrant (lihat resolveBackupCapabilities).

export const GLOBAL_ROLES: Role[] = ['SYSTEM_ADMIN', 'ORG_ADMIN', 'AUDITOR']

export interface SessionUser {
  id: string
  username: string
  fullName: string
  role: Role
}

export interface UserScope {
  all: boolean                        // akses seluruh unit (role global)
  unitIds: string[]                   // unit yang di-assign langsung
  committeeIds: string[]              // panitia yang di-assign langsung
  unitIdsWithAllCommittees: string[]  // unit dengan includeCommittees=true (izin eksplisit surat panitia)
  committeeUnitIds: string[]          // unit parent dari committee assignment (konteks penerbitan surat panitia)
}

export interface ResolvedUser extends SessionUser {
  scope: UserScope
}

export async function resolveScope(user: SessionUser): Promise<UserScope> {
  if (GLOBAL_ROLES.includes(user.role)) {
    return { all: true, unitIds: [], committeeIds: [], unitIdsWithAllCommittees: [], committeeUnitIds: [] }
  }
  const assignments = await db.accessAssignment.findMany({
    where: { userId: user.id },
    include: { committee: { select: { unitId: true } } },
  })
  const unitIds: string[] = []
  const committeeIds: string[] = []
  const unitIdsWithAllCommittees: string[] = []
  const committeeUnitIds: string[] = []
  for (const a of assignments) {
    if (a.unitId) {
      unitIds.push(a.unitId)
      if (a.includeCommittees) unitIdsWithAllCommittees.push(a.unitId)
    }
    if (a.committeeId) {
      committeeIds.push(a.committeeId)
      if (a.committee?.unitId && !committeeUnitIds.includes(a.committee.unitId)) {
        committeeUnitIds.push(a.committee.unitId)
      }
    }
  }
  return { all: false, unitIds, committeeIds, unitIdsWithAllCommittees, committeeUnitIds }
}

export function hasPermission(user: SessionUser, perm: Permission): boolean {
  const p = ROLE_PERMISSIONS[user.role]
  return p === '*' || p.includes(perm)
}

/** Apakah user berhak mengakses konteks unit (untuk surat reguler unit, dsb.) */
export function canAccessUnit(user: ResolvedUser, unitId: string): boolean {
  if (user.scope.all) return true
  return user.scope.unitIds.includes(unitId)
}

/**
 * Apakah user berhak mengakses konteks kepanitiaan (untuk surat kepanitiaan).
 * Hanya dua jalan eksplisit (master prompt E): assignment committee langsung,
 * atau flag includeCommittees pada assignment unit. Akses unit biasa TIDAK cukup.
 */
export function canAccessCommittee(user: ResolvedUser, committee: { id: string; unitId: string }): boolean {
  if (user.scope.all) return true
  if (user.scope.committeeIds.includes(committee.id)) return true
  return user.scope.unitIdsWithAllCommittees.includes(committee.unitId)
}

/** Apakah user boleh MENGELOLA unit (buat committee/profil, kelola user di unit itu). */
export function canManageUnit(user: ResolvedUser, unitId: string): boolean {
  if (user.scope.all) return true
  return user.scope.unitIds.includes(unitId)
}

/** Apakah user boleh mengelola kepanitiaan (admin unit induk, atau admin committee itu). */
export function canManageCommittee(user: ResolvedUser, committee: { id: string; unitId: string }): boolean {
  if (user.scope.all) return true
  return user.scope.committeeIds.includes(committee.id) || user.scope.unitIds.includes(committee.unitId)
}

/** Filter prisma WHERE untuk surat yang boleh dilihat user. */
export function letterScopeFilter(user: ResolvedUser) {
  if (user.scope.all) return undefined
  const committeeUnits = user.scope.unitIdsWithAllCommittees
  const OR: Record<string, unknown>[] = []
  if (user.scope.unitIds.length > 0) OR.push({ issuingUnitId: { in: user.scope.unitIds } })
  if (user.scope.committeeIds.length > 0) OR.push({ committeeId: { in: user.scope.committeeIds } })
  if (committeeUnits.length > 0) {
    // unit dengan includeCommittees juga mencakup seluruh surat panitia unit tsb
    OR.push({ committee: { unitId: { in: committeeUnits } } })
    // ... serta surat reguler unit tsb
    OR.push({ issuingUnitId: { in: committeeUnits } })
  }
  if (OR.length === 0) return { id: { in: [] } } // tanpa scope apa pun → tidak melihat apa pun
  return { OR }
}

/** Filter untuk berkas arsip (via relasi letter). */
export function archiveScopeFilter(user: ResolvedUser) {
  const f = letterScopeFilter(user)
  return f ? { letter: f } : undefined
}

/**
 * Unit yang boleh DILIHAT user pada dropdown/master (bukan berarti boleh menerbitkan
 * surat reguler): unit assignment + unit parent dari committee assignment.
 * Unit parent diperlukan sebagai konteks penerbitan surat kepanitiaan.
 */
export function unitVisibilityFilter(user: ResolvedUser) {
  if (user.scope.all) return undefined
  const ids = [...new Set([...user.scope.unitIds, ...user.scope.committeeUnitIds])]
  return { id: { in: ids } }
}

/** Kepanitiaan yang terlihat user: di bawah unit yang dikelola, atau di-assign langsung. */
export function committeeVisibilityFilter(user: ResolvedUser) {
  if (user.scope.all) return undefined
  return {
    OR: [
      { unitId: { in: user.scope.unitIds } },
      { id: { in: user.scope.committeeIds } },
    ],
  }
}

/** Profil penomoran yang terlihat user: milik unit yang dikelola, atau panitia yang di-assign. */
export function profileVisibilityFilter(user: ResolvedUser) {
  if (user.scope.all) return undefined
  return {
    OR: [
      { ownerId: { in: user.scope.unitIds } },
      { committeeId: { in: user.scope.committeeIds } },
    ],
  }
}

// ==== Hak akses backup (master prompt lanjutan B) ====

export interface BackupScopeCap {
  type: 'UNIT' | 'COMMITTEE'
  id: string
  code: string
  name: string
  parentCode?: string
  canExport: boolean
  canRestore: boolean
}

export interface BackupCapabilities {
  fullExport: boolean   // Full System Backup (otoritas global)
  fullRestore: boolean  // Full System Restore (hanya Super Admin)
  scopes: BackupScopeCap[]
}

/**
 * Kapabilitas backup efektif user (B.1–B.6):
 * - Full export  = permission global backup.export (SYSTEM_ADMIN/ORG_ADMIN).
 * - Full restore = permission global backup.restore (hanya SYSTEM_ADMIN).
 * - Scoped       = gabungan BackupGrant per unit/kepanitiaan.
 * Grant adalah izin administratif EKSPLISIT — unit/kepanitiaan tanpa grant
 * tidak muncul sama sekali (deny by default).
 */
export async function resolveBackupCapabilities(user: ResolvedUser): Promise<BackupCapabilities> {
  const fullExport = hasPermission(user, 'backup.export')
  const fullRestore = hasPermission(user, 'backup.restore')
  const grants = await db.backupGrant.findMany({
    where: { userId: user.id },
    include: {
      unit: { select: { id: true, code: true, name: true } },
      committee: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } },
    },
  })
  const scopes: BackupScopeCap[] = []
  for (const g of grants) {
    if (g.unit) {
      scopes.push({
        type: 'UNIT', id: g.unit.id, code: g.unit.code, name: g.unit.name,
        canExport: g.canExport, canRestore: g.canRestore,
      })
    } else if (g.committee) {
      scopes.push({
        type: 'COMMITTEE', id: g.committee.id, code: g.committee.code, name: g.committee.name,
        parentCode: g.committee.unit.code,
        canExport: g.canExport, canRestore: g.canRestore,
      })
    }
  }
  return { fullExport, fullRestore, scopes }
}

/**
 * Validasi target backup/restore terhadap kapabilitas user (B.8: jangan percaya
 * payload FE). Unit scope mencakup seluruh kepanitiaan di bawahnya (izin
 * administratif eksplisit, didokumentasikan — bukan pewarisan diam-diam).
 */
export function assertBackupTargets(
  caps: BackupCapabilities,
  targets: { type: 'UNIT' | 'COMMITTEE'; id: string }[],
  action: 'export' | 'restore',
): string | null {
  for (const t of targets) {
    const cap = caps.scopes.find(s => s.type === t.type && s.id === t.id)
    if (!cap) return `Scope ${t.type} tidak ada dalam hak akses backup Anda`
    if (action === 'export' && !cap.canExport) return `Anda tidak memiliki izin backup.export untuk ${cap.code}`
    if (action === 'restore' && !cap.canRestore) return `Anda tidak memiliki izin backup.restore untuk ${cap.code}`
  }
  return null
}
