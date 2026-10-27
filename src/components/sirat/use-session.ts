'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/client'

export interface MeScope {
  all: boolean
  unitIds: string[]
  committeeIds: string[]
  unitIdsWithAllCommittees: string[]
}

export interface MeBackupScope {
  type: 'UNIT' | 'COMMITTEE'
  id: string
  code: string
  name: string
  parentCode?: string
  canExport: boolean
  canRestore: boolean
}

export interface MeBackup {
  fullExport: boolean
  fullRestore: boolean
  scopes: MeBackupScope[]
  canExportAny: boolean
  canRestoreAny: boolean
}

export interface Me {
  user: { id: string; username: string; fullName: string; email: string | null; role: string }
  permissions: string[] | '*'
  scope: MeScope
  backup?: MeBackup
}

/** Hook session: me-fetch sekali, login/logout, refresh. */
export function useSession() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<Me>('/api/auth/me')
      setMe(data)
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    await apiPost('/api/auth/login', { username, password })
    await refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try { await apiPost('/api/auth/logout') } catch { /* abaikan */ }
    setMe(null)
  }, [])

  return { me, loading, login, logout, refresh }
}

/** Hook me berbasis react-query — untuk view yang butuh data scope (D.3). */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet<Me>('/api/auth/me'),
    staleTime: 30_000,
  })
}

export function hasPerm(perms: string[] | '*' | undefined, perm: string): boolean {
  if (!perms) return false
  if (perms === '*') return true
  return perms.includes(perm)
}

/** Apakah user boleh membuat surat REGULER untuk unit ini (D.1)? */
export function canUseUnitForRegularLetter(scope: MeScope | undefined, unitId: string): boolean {
  if (!scope) return false
  return scope.all || scope.unitIds.includes(unitId)
}

/** Apakah user boleh membuat surat KEPANITIAAN untuk committee ini (E.2)? */
export function canUseCommitteeForLetter(
  scope: MeScope | undefined,
  committee: { id: string; unitId: string },
): boolean {
  if (!scope) return false
  return scope.all
    || scope.committeeIds.includes(committee.id)
    || scope.unitIdsWithAllCommittees.includes(committee.unitId)
}
