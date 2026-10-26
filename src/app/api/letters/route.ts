import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission, requireUser } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter, canAccessUnit, canAccessCommittee } from '@/lib/rbac'
import { DIRECTIONS, LETTER_STATUSES } from '@/lib/constants'

const PAGE_SIZE = 20

export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const unitId = url.searchParams.get('unitId') ?? ''
    const committeeId = url.searchParams.get('committeeId') ?? ''
    const status = url.searchParams.get('status') ?? ''
    const direction = url.searchParams.get('direction') ?? ''
    const letterTypeId = url.searchParams.get('letterTypeId') ?? ''
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))

    const where: Record<string, unknown> = {}
    const scope = letterScopeFilter(r.user)
    if (scope) Object.assign(where, scope) // FR-020: hasil tidak membocorkan unit lain

    if (q) {
      where.OR = [
        { officialNumber: { contains: q } },
        { recipient: { contains: q } },
        { subject: { contains: q } },
        { legacyNumber: { contains: q } },
      ]
    }
    if (unitId) where.issuingUnitId = unitId
    if (committeeId) where.committeeId = committeeId
    if (status && LETTER_STATUSES.includes(status as never)) where.status = status
    if (direction && DIRECTIONS.includes(direction as never)) where.direction = direction
    if (letterTypeId) where.letterTypeId = letterTypeId

    const [total, letters] = await Promise.all([
      db.letter.count({ where }),
      db.letter.findMany({
        where,
        include: {
          issuingUnit: { select: { id: true, code: true, name: true } },
          committee: { select: { id: true, code: true, name: true } },
          letterType: { select: { id: true, code: true, name: true } },
          issuer: { select: { id: true, fullName: true } },
          _count: { select: { files: { where: { state: 'ACTIVE' } } } },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ])
    return ok({ letters, total, page, pageSize: PAGE_SIZE })
  })
}

const createSchema = z.object({
  issuingUnitId: z.string().min(1),
  committeeId: z.string().min(1).optional().nullable(),
  direction: z.enum(DIRECTIONS),
  letterTypeId: z.string().min(1),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recipient: z.string().trim().max(240).optional().nullable(),
  subject: z.string().trim().max(240).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('letter.create')
    if ('error' in r) return r.error

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data surat tidak valid', { issues: parsed.error.issues })
    const body = parsed.data

    const unit = await db.unit.findUnique({ where: { id: body.issuingUnitId } })
    if (!unit) return fail(404, 'NOT_FOUND', 'Unit tidak ditemukan')
    if (unit.status !== 'ACTIVE') return fail(409, 'UNIT_INACTIVE', 'Unit tidak aktif')

    const committee = body.committeeId ? await db.committee.findUnique({ where: { id: body.committeeId } }) : null
    if (body.committeeId) {
      if (!committee) return fail(404, 'NOT_FOUND', 'Kepanitiaan tidak ditemukan')
      if (committee.unitId !== unit.id) return fail(409, 'COMMITTEE_MISMATCH', 'Kepanitiaan tidak berada di bawah unit penerbit') // aturan bisnis 2
      if (committee.status !== 'ACTIVE') return fail(409, 'COMMITTEE_INACTIVE', 'Kepanitiaan tidak aktif')
      // Surat kepanitiaan WAJIB akses committee (assignment langsung / includeCommittees
      // eksplisit) — akses unit saja tidak cukup (master prompt E.2, konsisten dgn preview & issue).
      if (!canAccessCommittee(r.user, committee)) {
        return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke kepanitiaan ini')
      }
    } else {
      // Surat reguler unit: wajib akses unit
      if (!canAccessUnit(r.user, unit.id)) {
        return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke unit ini')
      }
    }

    const letterType = await db.letterType.findUnique({ where: { id: body.letterTypeId } })
    if (!letterType) return fail(404, 'NOT_FOUND', 'Jenis surat tidak ditemukan')
    if (!letterType.isActive) return fail(409, 'LETTER_TYPE_INACTIVE', 'Jenis surat tidak aktif')

    const letter = await db.$transaction(async (tx) => {
      const letter = await tx.letter.create({
        data: {
          issuingUnitId: unit.id,
          committeeId: committee?.id ?? null,
          direction: body.direction,
          letterTypeId: body.letterTypeId,
          letterDate: new Date(`${body.letterDate}T00:00:00.000Z`),
          recipient: body.recipient || null,
          subject: body.subject || null,
          notes: body.notes || null,
          status: 'DRAFT',
        },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'letter.draft.create', entityType: 'letter', entityId: letter.id,
        correlationId: r.correlationId,
        metadata: { unit: unit.code, committee: committee?.code, direction: body.direction, letterDate: body.letterDate },
      })
      return letter
    })
    return ok({ letter }, 201)
  })
}
