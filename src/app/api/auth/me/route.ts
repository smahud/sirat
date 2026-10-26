import { ok, fail, handle } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { ROLE_PERMISSIONS } from '@/lib/rbac'
import { db } from '@/lib/db'

/**
 * GET /api/auth/me — data segar dari DB (bukan hanya klaim JWT) + scope resolusi
 * (master prompt D.3): FE memakai scope utk memfilter/auto-select unit penerbit.
 * User yang dinonaktifkan di tengah sesi langsung ditolak di sini.
 */
export async function GET() {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error

    const fresh = await db.user.findUnique({
      where: { id: r.user.id },
      select: { id: true, username: true, fullName: true, email: true, role: true, isActive: true },
    })
    if (!fresh || !fresh.isActive) {
      return fail(401, 'UNAUTHENTICATED', 'Sesi tidak valid — silakan login kembali')
    }

    return ok({
      user: {
        id: fresh.id, username: fresh.username, fullName: fresh.fullName,
        email: fresh.email, role: fresh.role,
      },
      permissions: ROLE_PERMISSIONS[r.user.role],
      scope: {
        all: r.user.scope.all,
        unitIds: r.user.scope.unitIds,
        committeeIds: r.user.scope.committeeIds,
        unitIdsWithAllCommittees: r.user.scope.unitIdsWithAllCommittees,
      },
    })
  })
}
