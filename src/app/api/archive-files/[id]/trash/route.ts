import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter } from '@/lib/rbac'

/** POST /api/archive-files/:id/trash — soft delete, objek fisik tetap (FR-017). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('archive.trash')
    if ('error' in r) return r.error
    const { id } = await params

    const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Alasan wajib diisi')

    const file = await db.archiveFile.findFirst({
      where: { id, letter: letterScopeFilter(r.user) ?? undefined },
    })
    if (!file) return fail(404, 'NOT_FOUND', 'Berkas tidak ditemukan atau di luar scope Anda')
    if (file.state === 'TRASHED') return fail(409, 'ALREADY_TRASHED', 'Berkas sudah ada di trash')

    const updated = await db.$transaction(async (tx) => {
      const f = await tx.archiveFile.update({ where: { id }, data: { state: 'TRASHED' } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'archive.trash', entityType: 'archiveFile', entityId: id,
        correlationId: r.correlationId,
        metadata: { letterId: file.letterId, reason: parsed.data.reason },
      })
      return f
    })
    return ok({ archiveFile: updated })
  })
}
