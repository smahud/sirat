// Scoped RBAC — deny by default (Blueprint 16.5).
// Permission dihitung dari role global + assignment unit/kepanitiaan.
import { db } from '@/lib/db'
import { Role } from '@/lib/constants'

export const PERMISSIONS = [
  'appidentity.manage', 'unit.manage', 'committee.manage', 'user.manage',
  'lettertype.manage', 'profile.manage', 'letter.view', 'letter.create',
  'letter.issue', 'letter.cancel', 'archive.upload', 'archive.download',
  'archive.trash', 'archive.restore', 'audit.view', 'storage.manage',
  'import.manage', 'export.run', 'health.view',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const OPERATOR_PERMS: Permission[] = [
  'letter.view', 'letter.create', 'letter.issue', 'archive.upload', 'archive.download',
]

const UNIT_ADMIN_PERMS: Permission[] = [
  'committee.manage', 'user.manage', 'profile.manage', 'lettertype.manage',
  ...OPERATOR_PERMS, 'letter.cancel', 'archive.trash', 'archive.restore',
  'audit.view', 'import.manage', 'export.run', 'health.view',
]

export const ROLE_PERMISSIONS: Record<Role, Permission[] | '*'> = {
  SYSTEM_ADMIN: '*',
  ORG_ADMIN: [
    'appidentity.manage', 'unit.manage', 'committee.manage', 'user.manage',
    'lettertype.manage', 'profile.manage', 'letter.view', 'audit.view',
    'storage.manage', 'import.manage', 'export.run', 'health.view',
  ],
  UNIT_ADMIN: UNIT_ADMIN_PERMS,
  COMMITTEE_ADMIN: UNIT_ADMIN_PERMS,
  OPERATOR: OPERATOR_PERMS,
  VIEWER: ['letter.view', 'archive.download'],
  AUDITOR: ['letter.view', 'audit.view'],
}

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
  unitIdsWithAllCommittees: string[]  // unit dengan includeCommittees=true
}

export interface ResolvedUser extends SessionUser {
  scope: UserScope
}

export async function resolveScope(user: SessionUser): Promise<UserScope> {
  if (GLOBAL_ROLES.includes(user.role)) return { all: true, unitIds: [], committeeIds: [], unitIdsWithAllCommittees: [] }
  const assignments = await db.accessAssignment.findMany({
    where: { userId: user.id },
  })
  const unitIds: string[] = []
  const committeeIds: string[] = []
  const unitIdsWithAllCommittees: string[] = []
  for (const a of assignments) {
    if (a.unitId) {
      unitIds.push(a.unitId)
      if (a.includeCommittees) unitIdsWithAllCommittees.push(a.unitId)
    }
    if (a.committeeId) committeeIds.push(a.committeeId)
  }
  return { all: false, unitIds, committeeIds, unitIdsWithAllCommittees }
}

export function hasPermission(user: SessionUser, perm: Permission): boolean {
  const p = ROLE_PERMISSIONS[user.role]
  return p === '*' || p.includes(perm)
}

/** Apakah user berhak mengakses konteks unit (untuk create/issue surat, dsb.) */
export function canAccessUnit(user: ResolvedUser, unitId: string): boolean {
  if (user.scope.all) return true
  return user.scope.unitIds.includes(unitId)
}

/** Apakah user berhak mengakses konteks kepanitiaan. */
export function canAccessCommittee(user: ResolvedUser, committee: { id: string; unitId: string }): boolean {
  if (user.scope.all) return true
  if (user.scope.committeeIds.includes(committee.id)) return true
  // assignment unit + includeCommittees → semua panitia di bawah unit itu
  return user.scope.unitIdsWithAllCommittees.includes(committee.unitId)
}

/** Filter prisma WHERE untuk surat yang boleh dilihat user. */
export function letterScopeFilter(user: ResolvedUser) {
  if (user.scope.all) return undefined
  const committeeUnits = user.scope.unitIdsWithAllCommittees
  return {
    OR: [
      { issuingUnitId: { in: user.scope.unitIds } },
      { committeeId: { in: user.scope.committeeIds } },
      ...(committeeUnits.length > 0 ? [{ committee: { unitId: { in: committeeUnits } } }] : []),
      // unit dengan includeCommittees juga mencakup surat reguler unit tsb
      { issuingUnitId: { in: committeeUnits } },
    ],
  }
}

/** Filter untuk berkas arsip (via relasi letter). */
export function archiveScopeFilter(user: ResolvedUser) {
  const f = letterScopeFilter(user)
  return f ? { letter: f } : undefined
}
