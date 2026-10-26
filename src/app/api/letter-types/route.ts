import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'

const createSchema = z.object({
  code: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(120),
})

export async function GET() {
  return handle(async () => {
    const r = await requirePermission('letter.view')
    if ('error' in r) return r.error
    const letterTypes = await db.letterType.findMany({ orderBy: { code: 'asc' } })
    return ok({ letterTypes })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('lettertype.manage')
    if ('error' in r) return r.error

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data jenis surat tidak valid', { issues: parsed.error.issues })

    const dup = await db.letterType.findUnique({ where: { code: parsed.data.code } })
    if (dup) return fail(409, 'CONFLICT', 'Kode jenis surat sudah dipakai')

    const letterType = await db.$transaction(async (tx) => {
      const lt = await tx.letterType.create({ data: parsed.data })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'lettertype.create', entityType: 'letterType', entityId: lt.id,
        correlationId: r.correlationId, metadata: parsed.data,
      })
      return lt
    })
    return ok({ letterType }, 201)
  })
}

const patchSchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(24).optional(), // perubahan kode hanya untuk terbitan baru (FR-005)
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('lettertype.manage')
    if ('error' in r) return r.error

    const parsed = patchSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })
    const { id, ...changes } = parsed.data

    const existing = await db.letterType.findUnique({ where: { id } })
    if (!existing) return fail(404, 'NOT_FOUND', 'Jenis surat tidak ditemukan')

    if (changes.code && changes.code !== existing.code) {
      const dup = await db.letterType.findFirst({ where: { code: changes.code, id: { not: id } } })
      if (dup) return fail(409, 'CONFLICT', 'Kode sudah dipakai jenis surat lain')
    }

    const updated = await db.$transaction(async (tx) => {
      const lt = await tx.letterType.update({ where: { id }, data: changes })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'lettertype.update', entityType: 'letterType', entityId: id,
        correlationId: r.correlationId,
        metadata: { before: { code: existing.code, name: existing.name, isActive: existing.isActive }, after: changes },
      })
      return lt
    })
    return ok({ letterType: updated })
  })
}
