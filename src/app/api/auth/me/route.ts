import { ok, handle } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { ROLE_PERMISSIONS } from '@/lib/rbac'

export async function GET() {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    return ok({ user: r.user, permissions: ROLE_PERMISSIONS[r.user.role] })
  })
}
