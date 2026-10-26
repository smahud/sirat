import { describe, it, expect } from 'vitest'
import {
  hasPermission, canAccessUnit, canAccessCommittee, canManageUnit, canManageCommittee,
  letterScopeFilter, unitVisibilityFilter, committeeVisibilityFilter, profileVisibilityFilter,
  ROLE_PERMISSIONS, ResolvedUser, UserScope,
} from '@/lib/rbac'
import { csvCell } from '@/lib/constants'

function userWith(partial: Partial<UserScope>, role: ResolvedUser['role'] = 'OPERATOR'): ResolvedUser {
  const scope: UserScope = {
    all: false, unitIds: [], committeeIds: [], unitIdsWithAllCommittees: [], committeeUnitIds: [],
    ...partial,
  }
  return { id: 'u1', username: 'tester', fullName: 'Tester', role, scope }
}

const UNIT_A = 'unit-a'
const UNIT_B = 'unit-b'
const COMMITTEE_A1 = 'c-a1' // panitia di bawah unit A
const COMMITTEE_B1 = 'c-b1' // panitia di bawah unit B

describe('RBAC — permission per role (deny by default)', () => {
  it('SYSTEM_ADMIN memiliki semua permission', () => {
    expect(ROLE_PERMISSIONS.SYSTEM_ADMIN).toBe('*')
  })
  it('VIEWER tidak bisa membuat/menerbitkan surat', () => {
    const v = userWith({}, 'VIEWER')
    expect(hasPermission(v, 'letter.view')).toBe(true)
    expect(hasPermission(v, 'letter.create')).toBe(false)
    expect(hasPermission(v, 'letter.issue')).toBe(false)
  })
  it('UNIT_ADMIN/COMMITTEE_ADMIN tidak melihat audit global (tidak bisa di-scope)', () => {
    expect(ROLE_PERMISSIONS.UNIT_ADMIN).not.toContain('audit.view')
    expect(ROLE_PERMISSIONS.COMMITTEE_ADMIN).not.toContain('audit.view')
  })
  it('role global (ORG_ADMIN, AUDITOR) tetap melihat audit', () => {
    expect(ROLE_PERMISSIONS.ORG_ADMIN).toContain('audit.view')
    expect(ROLE_PERMISSIONS.AUDITOR).toContain('audit.view')
  })
  it('OPERATOR tidak punya user.manage / lettertype.manage', () => {
    const o = userWith({}, 'OPERATOR')
    expect(hasPermission(o, 'user.manage')).toBe(false)
    expect(hasPermission(o, 'lettertype.manage')).toBe(false)
  })
})

describe('E.2 — akses surat kepanitiaan (assignment ≠ otomatis)', () => {
  it('operator unit TANPA includeCommittees TIDAK boleh membuat surat kepanitiaan unitnya', () => {
    const u = userWith({ unitIds: [UNIT_A] })
    expect(canAccessCommittee(u, { id: COMMITTEE_A1, unitId: UNIT_A })).toBe(false)
  })
  it('operator unit DENGAN includeCommittees eksplisit boleh surat kepanitiaan unitnya', () => {
    const u = userWith({ unitIds: [UNIT_A], unitIdsWithAllCommittees: [UNIT_A] })
    expect(canAccessCommittee(u, { id: COMMITTEE_A1, unitId: UNIT_A })).toBe(true)
  })
  it('assignment committee langsung cukup untuk committee itu saja', () => {
    const u = userWith({ committeeIds: [COMMITTEE_A1], committeeUnitIds: [UNIT_A] })
    expect(canAccessCommittee(u, { id: COMMITTEE_A1, unitId: UNIT_A })).toBe(true)
    // Sekretaris Panitia A tidak boleh menyentuh Panitia B ataupun surat reguler unit
    expect(canAccessCommittee(u, { id: COMMITTEE_B1, unitId: UNIT_B })).toBe(false)
    expect(canAccessUnit(u, UNIT_A)).toBe(false)
  })
  it('akses unit A tidak membocorkan kepanitiaan unit B', () => {
    const u = userWith({ unitIds: [UNIT_A], unitIdsWithAllCommittees: [UNIT_A] })
    expect(canAccessCommittee(u, { id: COMMITTEE_B1, unitId: UNIT_B })).toBe(false)
    expect(canAccessUnit(u, UNIT_B)).toBe(false)
  })
  it('role global lolos semua cek konteks', () => {
    const g = userWith({ all: true }, 'SYSTEM_ADMIN')
    expect(canAccessUnit(g, UNIT_B)).toBe(true)
    expect(canAccessCommittee(g, { id: COMMITTEE_B1, unitId: UNIT_B })).toBe(true)
  })
})

describe('E.5/E.1 — wewenang manajemen terpisah dari akses surat', () => {
  it('operator panitia tidak bisa mengelola unit induknya', () => {
    const u = userWith({ committeeIds: [COMMITTEE_A1], committeeUnitIds: [UNIT_A] }, 'COMMITTEE_ADMIN')
    expect(canManageUnit(u, UNIT_A)).toBe(false)
    expect(canManageCommittee(u, { id: COMMITTEE_A1, unitId: UNIT_A })).toBe(true)
  })
  it('unit admin hanya mengelola committee di unitnya', () => {
    const u = userWith({ unitIds: [UNIT_A] }, 'UNIT_ADMIN')
    expect(canManageUnit(u, UNIT_A)).toBe(true)
    expect(canManageUnit(u, UNIT_B)).toBe(false)
    expect(canManageCommittee(u, { id: COMMITTEE_A1, unitId: UNIT_A })).toBe(true)
    expect(canManageCommittee(u, { id: COMMITTEE_B1, unitId: UNIT_B })).toBe(false)
  })
})

describe('letterScopeFilter — daftar surat tidak bocor lintas scope', () => {
  it('operator unit A hanya melihat surat unit A', () => {
    const u = userWith({ unitIds: [UNIT_A] })
    const f = letterScopeFilter(u) as { OR: Record<string, unknown>[] }
    expect(f.OR).toEqual([{ issuingUnitId: { in: [UNIT_A] } }])
  })
  it('operator panitia melihat surat panitianya, bukan surat reguler unit induk', () => {
    const u = userWith({ committeeIds: [COMMITTEE_A1] })
    const f = letterScopeFilter(u) as { OR: Record<string, unknown>[] }
    expect(f.OR).toEqual([{ committeeId: { in: [COMMITTEE_A1] } }])
  })
  it('unit + includeCommittees melihat surat reguler unit DAN semua surat panitia unit', () => {
    const u = userWith({ unitIds: [UNIT_A], unitIdsWithAllCommittees: [UNIT_A] })
    const f = letterScopeFilter(u) as { OR: Record<string, unknown>[] }
    expect(f.OR).toContainEqual({ committee: { unitId: { in: [UNIT_A] } } })
    expect(f.OR).toContainEqual({ issuingUnitId: { in: [UNIT_A] } })
  })
  it('role global tanpa filter (semua surat)', () => {
    const g = userWith({ all: true }, 'AUDITOR')
    expect(letterScopeFilter(g)).toBeUndefined()
  })
  it('user tanpa scope sama sekali tidak melihat surat apa pun (deny by default)', () => {
    const u = userWith({})
    expect(letterScopeFilter(u)).toEqual({ id: { in: [] } })
  })
})

describe('filter visibilitas master (D + info-leak)', () => {
  it('unit terlihat = unit assignment + unit induk committee', () => {
    const u = userWith({ unitIds: [UNIT_A], committeeIds: [COMMITTEE_B1], committeeUnitIds: [UNIT_B] })
    expect(unitVisibilityFilter(u)).toEqual({ id: { in: [UNIT_A, UNIT_B] } })
  })
  it('committee terlihat = di bawah unit dikelola atau di-assign langsung', () => {
    const u = userWith({ unitIds: [UNIT_A], committeeIds: [COMMITTEE_B1] })
    expect(committeeVisibilityFilter(u)).toEqual({
      OR: [{ unitId: { in: [UNIT_A] } }, { id: { in: [COMMITTEE_B1] } }],
    })
  })
  it('profil terlihat = milik unit dikelola atau panitia di-assign', () => {
    const u = userWith({ unitIds: [UNIT_A], committeeIds: [COMMITTEE_B1] })
    expect(profileVisibilityFilter(u)).toEqual({
      OR: [{ ownerId: { in: [UNIT_A] } }, { committeeId: { in: [COMMITTEE_B1] } }],
    })
  })
  it('role global melihat semua master', () => {
    const g = userWith({ all: true }, 'SYSTEM_ADMIN')
    expect(unitVisibilityFilter(g)).toBeUndefined()
    expect(committeeVisibilityFilter(g)).toBeUndefined()
    expect(profileVisibilityFilter(g)).toBeUndefined()
  })
})

describe('csvCell — sanitasi formula injection', () => {
  it('menetralkan awalan formula berbahaya', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvCell('+cmd')).toBe("'+cmd")
    expect(csvCell('-2+1')).toBe("'-2+1")
    expect(csvCell('@import')).toBe("'@import")
    expect(csvCell('\tHYPERLINK("x")')).toBe("'\tHYPERLINK(\"x\")")
  })
  it('membiarkan nilai normal dan kosong tetap utuh', () => {
    expect(csvCell('066/A/SPR/YAPSI-DS/X/2026')).toBe('066/A/SPR/YAPSI-DS/X/2026')
    expect(csvCell('Permohonan izin kegiatan')).toBe('Permohonan izin kegiatan')
    expect(csvCell('')).toBe('')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
})

describe('B.1 — permission backup terpisah & tidak otomatis (master prompt lanjutan)', () => {
  it('UNIT_ADMIN/COMMITTEE_ADMIN tidak otomatis punya backup.export maupun backup.restore', () => {
    const perms = ROLE_PERMISSIONS.UNIT_ADMIN
    expect(perms).not.toContain('backup.export')
    expect(perms).not.toContain('backup.restore')
    expect(ROLE_PERMISSIONS.COMMITTEE_ADMIN).not.toContain('backup.export')
    expect(ROLE_PERMISSIONS.COMMITTEE_ADMIN).not.toContain('backup.restore')
  })
  it('ORG_ADMIN boleh full backup tetapi TIDAK boleh restore', () => {
    const u = userWith({ all: true }, 'ORG_ADMIN')
    expect(hasPermission(u, 'backup.export')).toBe(true)
    expect(hasPermission(u, 'backup.restore')).toBe(false)
  })
  it('OPERATOR/VIEWER/AUDITOR tidak punya keduanya', () => {
    for (const role of ['OPERATOR', 'VIEWER', 'AUDITOR'] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain('backup.export')
      expect(ROLE_PERMISSIONS[role]).not.toContain('backup.restore')
    }
  })
  it('hanya SYSTEM_ADMIN yang bisa full restore', () => {
    const u = userWith({ all: true }, 'SYSTEM_ADMIN')
    expect(hasPermission(u, 'backup.restore')).toBe(true)
  })
})
