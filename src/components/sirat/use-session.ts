'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/client'

export interface Me {
  user: { id: string; username: string; fullName: string; role: string }
  permissions: string[] | '*'
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

export function hasPerm(perms: string[] | '*' | undefined, perm: string): boolean {
  if (!perms) return false
  if (perms === '*') return true
  return perms.includes(perm)
}
