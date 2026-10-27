import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { canManageUnit, canManageCommittee } from '@/lib/rbac'

const unarchiveSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/numbering-profiles/unarchive — pulihkan profil dari ARSIP (v1.9).
 * Profil kembali muncul di daftar utama; bila versinya masih ACTIVE ia langsung
 * bisa dipilih lagi saat membuat surat. Histori tidak pernah berubah.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const parsed = unarchiveSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter id wajib')
    const { id } = parsed.data

    const profile = await db.numberingProfile.findUnique({
      where: { id },
      include: {
        owner: { select: { code: true } },
        committee: { select: { code: true } },
      },
    })
    if (!profile) return fail(404, 'NOT_FOUND', 'Profil tidak ditemukan')
    const canManage = profile.committeeId
      ? canManageCommittee(r.user, { id: profile.committeeId, unitId: profile.ownerId })
      : canManageUnit(r.user, profile.ownerId)
    if (!canManage) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang memulihkan profil ini')
    }
    if (!profile.archivedAt) return ok({ archived: false, alreadyActive: true })

    const updated = await db.$transaction(async (tx) => {
      const p = await tx.numberingProfile.update({ where: { id }, data: { archivedAt: null } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'profile.unarchive', entityType: 'numberingProfile', entityId: id,
        correlationId: r.correlationId,
        metadata: {
          name: profile.name, unit: profile.owner.code, committee: profile.committee?.code ?? null,
          archivedAt: profile.archivedAt,
        },
      })
      return p
    })
    return ok({ profile: updated, archived: false })
  })
}
