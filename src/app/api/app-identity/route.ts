import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission, requireUser } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'

/** FR-001: identitas aplikasi terpisah dari unit penerbit. */
export async function GET() {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const identity = await db.appIdentity.findUnique({ where: { id: 'app' } })
    return ok({ identity })
  })
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('appidentity.manage')
    if ('error' in r) return r.error

    const parsed = z.object({
      name: z.string().trim().min(1).max(120),
      ownerName: z.string().trim().max(120).optional().nullable(),
      timezone: z.string().trim().max(60).default('Asia/Jakarta'),
      locale: z.string().trim().max(10).default('id-ID'),
    }).safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })

    const identity = await db.$transaction(async (tx) => {
      const before = await tx.appIdentity.findUnique({ where: { id: 'app' } })
      const i = await tx.appIdentity.upsert({
        where: { id: 'app' },
        create: { id: 'app', ...parsed.data },
        update: parsed.data,
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'appidentity.update', entityType: 'appIdentity', entityId: 'app',
        correlationId: r.correlationId, metadata: { before: before?.name, after: parsed.data.name },
      })
      return i
    })
    return ok({ identity })
  })
}
