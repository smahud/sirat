import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { UNIT_STATUSES } from '@/lib/constants'
import { sanitizeSegment } from '@/lib/constants'

const createSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
})

export async function GET() {
  return handle(async () => {
    const r = await requirePermission('letter.view')
    if ('error' in r) return r.error
    const units = await db.unit.findMany({ orderBy: { code: 'asc' } })
    return ok({ units })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('unit.manage')
    if ('error' in r) return r.error

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data unit tidak valid', { issues: parsed.error.issues })
    const { code, name } = parsed.data

    const dup = await db.unit.findFirst({ where: { OR: [{ code }, { storageKey: sanitizeSegment(code) }] } })
    if (dup) return fail(409, 'CONFLICT', 'Kode unit sudah dipakai')

    // Namespace default per unit (counter terpisah antar unit — prinsip inti)
    const unit = await db.$transaction(async (tx) => {
      const unit = await tx.unit.create({
        data: { code, name, storageKey: sanitizeSegment(`${code}-${Date.now().toString(36)}`) },
      })
      await tx.counterNamespace.create({
        data: { name: `default:${unit.code}`, unitId: unit.id, resetPolicy: 'ALL', dateSource: 'LETTER_DATE' },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'unit.create', entityType: 'unit', entityId: unit.id,
        correlationId: r.correlationId, metadata: { code, name },
      })
      return unit
    })
    return ok({ unit }, 201)
  })
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(32).optional(),
  status: z.enum(UNIT_STATUSES).optional(),
})

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('unit.manage')
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return fail(400, 'VALIDATION', 'Parameter id wajib')

    const parsed = patchSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })

    const unit = await db.unit.findUnique({ where: { id }, include: { _count: { select: { letters: true } } } })
    if (!unit) return fail(404, 'NOT_FOUND', 'Unit tidak ditemukan')

    // FR-002: hapus fisik unit dengan histori diblokir (di sini: tidak menyediakan DELETE sama sekali)
    const data: Record<string, string> = {}
    if (parsed.data.name) data.name = parsed.data.name
    if (parsed.data.code) {
      const dup = await db.unit.findFirst({ where: { code: parsed.data.code, id: { not: id } } })
      if (dup) return fail(409, 'CONFLICT', 'Kode unit sudah dipakai unit lain')
      data.code = parsed.data.code // perubahan kode tidak mengubah storageKey (identitas teknis stabil)
    }
    if (parsed.data.status) data.status = parsed.data.status

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.unit.update({ where: { id }, data })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'unit.update', entityType: 'unit', entityId: id,
        correlationId: r.correlationId, metadata: { before: { code: unit.code, name: unit.name, status: unit.status }, after: parsed.data },
      })
      return u
    })
    return ok({ unit: updated })
  })
}
