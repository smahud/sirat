import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter } from '@/lib/rbac'

/** POST /api/archive-files/:id/restore — pulihkan dari trash. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('archive.restore')
    if ('error' in r) return r.error
    const { id } = await params

    const file = await db.archiveFile.findFirst({
      where: { id, letter: letterScopeFilter(r.user) ?? undefined },
    })
    if (!file) return fail(404, 'NOT_FOUND', 'Berkas tidak ditemukan atau di luar scope Anda')
    if (file.state !== 'TRASHED') return fail(409, 'NOT_TRASHED', 'Berkas tidak ada di trash')

    const updated = await db.$transaction(async (tx) => {
      const f = await tx.archiveFile.update({ where: { id }, data: { state: 'ACTIVE' } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'archive.restore', entityType: 'archiveFile', entityId: id,
        correlationId: r.correlationId, metadata: { letterId: file.letterId },
      })
      return f
    })
    return ok({ archiveFile: updated })
  })
}
