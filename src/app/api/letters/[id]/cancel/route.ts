import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter } from '@/lib/rbac'

/** POST /api/letters/:id/cancel — FR-012: alasan wajib; nomor tidak dipakai ulang. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('letter.cancel')
    if ('error' in r) return r.error

    const { id } = await params
    const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Alasan pembatalan wajib diisi (min 5 karakter)')

    const scope = letterScopeFilter(r.user)
    const letter = await db.letter.findFirst({ where: { id, ...(scope ?? {}) } })
    if (!letter) return fail(404, 'NOT_FOUND', 'Surat tidak ditemukan atau di luar scope akses Anda')
    if (letter.status !== 'ISSUED') return fail(409, 'NOT_ISSUED', 'Hanya surat terbit yang dapat dibatalkan')

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.letter.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: parsed.data.reason,
          cancelledAt: new Date(),
          cancelledBy: r.user.id,
        },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'letter.cancel', entityType: 'letter', entityId: id,
        correlationId: r.correlationId,
        metadata: { officialNumber: letter.officialNumber, reason: parsed.data.reason },
      })
      return u
    })
    return ok({ letter: updated })
  })
}
