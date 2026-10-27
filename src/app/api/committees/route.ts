import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { COMMITTEE_STATUSES } from '@/lib/constants'
import { sanitizeSegment } from '@/lib/constants'
import { committeeVisibilityFilter, canManageUnit, canManageCommittee } from '@/lib/rbac'

const createSchema = z.object({
  unitId: z.string().min(1),
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(), // keterangan (C.2)
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  shareParentCounter: z.boolean().default(false),
})

export async function GET() {
  return handle(async () => {
    const r = await requirePermission('letter.view')
    if ('error' in r) return r.error
    // Scope-filtered: committee di bawah unit yang dikelola, atau yang di-assign langsung
    const committees = await db.committee.findMany({
      where: committeeVisibilityFilter(r.user),
      include: { unit: { select: { id: true, code: true, name: true } } },
      orderBy: [{ unitId: 'asc' }, { code: 'asc' }],
    })
    return ok({ committees })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('committee.manage')
    if ('error' in r) return r.error

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data kepanitiaan tidak valid', { issues: parsed.error.issues })

    const { unitId, code, name, startDate, endDate, shareParentCounter } = parsed.data
    const unit = await db.unit.findUnique({ where: { id: unitId } })
    if (!unit) return fail(404, 'NOT_FOUND', 'Unit parent tidak ditemukan')
    if (unit.status !== 'ACTIVE') return fail(409, 'UNIT_INACTIVE', 'Kepanitiaan hanya bisa dibuat di bawah unit aktif')
    // Scope validation (audit #4): unit admin hanya boleh membuat kepanitiaan di unitnya
    if (!canManageUnit(r.user, unitId)) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang mengelola kepanitiaan di unit ini')
    }

    const dup = await db.committee.findFirst({ where: { unitId, code } })
    if (dup) return fail(409, 'CONFLICT', 'Kode kepanitiaan sudah dipakai di unit ini')

    const committee = await db.$transaction(async (tx) => {
      const committee = await tx.committee.create({
        data: {
          unitId, code, name,
          storageKey: sanitizeSegment(`${unit.code}-${code}-${Date.now().toString(36)}`),
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          status: 'DRAFT',
          shareParentCounter,
        },
      })
      // FR-003/11: kepanitiaan default namespace sendiri; share parent hanya eksplisit
      if (!shareParentCounter) {
        await tx.counterNamespace.create({
          data: { name: `default:${unit.code}:${code}`, committeeId: committee.id, resetPolicy: 'ALL', dateSource: 'LETTER_DATE' },
        })
      }
      await writeAudit(tx, {
        actorId: r.user.id, action: 'committee.create', entityType: 'committee', entityId: committee.id,
        correlationId: r.correlationId, metadata: { unitId, code, name, shareParentCounter },
      })
      return committee
    })
    return ok({ committee }, 201)
  })
}

const patchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(32).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(COMMITTEE_STATUSES).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  shareParentCounter: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('committee.manage')
    if ('error' in r) return r.error

    const parsed = patchSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })
    const { id, ...changes } = parsed.data

    const committee = await db.committee.findUnique({ where: { id }, include: { _count: { select: { letters: true } } } })
    if (!committee) return fail(404, 'NOT_FOUND', 'Kepanitiaan tidak ditemukan')
    // Scope validation (audit #4): hanya admin unit induk / admin committee itu
    if (!canManageCommittee(r.user, committee)) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang mengelola kepanitiaan ini')
    }

    if (changes.shareParentCounter !== undefined && changes.shareParentCounter !== committee.shareParentCounter) {
      if (committee._count.letters > 0) {
        return fail(409, 'HAS_HISTORY', 'Kepanitiaan yang sudah memiliki surat tidak boleh mengubah kebijakan counter')
      }
      if (changes.shareParentCounter && !committee.shareParentCounter) {
        // pindah ke counter parent: namespace sendiri dibiarkan (tidak dipakai lagi)
      } else if (!changes.shareParentCounter && committee.shareParentCounter) {
        const exists = await db.counterNamespace.findFirst({ where: { committeeId: id } })
        if (!exists) {
          await db.counterNamespace.create({
            data: { name: `default:${committee.code}`, committeeId: id, resetPolicy: 'ALL', dateSource: 'LETTER_DATE' },
          })
        }
      }
    }

    const data: Record<string, unknown> = {}
    if (changes.name !== undefined) data.name = changes.name
    if (changes.code !== undefined) {
      if (changes.code !== committee.code) {
        const dup = await db.committee.findFirst({ where: { unitId: committee.unitId, code: changes.code, id: { not: id } } })
        if (dup) return fail(409, 'CONFLICT', 'Kode sudah dipakai kepanitiaan lain di unit ini')
      }
      data.code = changes.code
    }
    if (changes.description !== undefined) data.description = changes.description
    if (changes.status !== undefined) data.status = changes.status
    if (changes.startDate !== undefined) data.startDate = changes.startDate ? new Date(changes.startDate) : null
    if (changes.endDate !== undefined) data.endDate = changes.endDate ? new Date(changes.endDate) : null
    if (changes.shareParentCounter !== undefined) data.shareParentCounter = changes.shareParentCounter

    const updated = await db.$transaction(async (tx) => {
      const c = await tx.committee.update({ where: { id }, data })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'committee.update', entityType: 'committee', entityId: id,
        correlationId: r.correlationId,
        metadata: { before: { name: committee.name, code: committee.code, status: committee.status, description: committee.description }, after: changes },
      })
      return c
    })
    return ok({ committee: updated })
  })
}

const deleteSchema = z.object({ id: z.string().min(1) })

/**
 * Hapus kepanitiaan (master prompt lanjutan C.4):
 * - Fisik HANYA jika tanpa dependensi (surat/assignment/profil/grant).
 * - Ada histori → 409 HAS_HISTORY: gunakan status ARCHIVED (soft delete).
 */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('committee.manage')
    if ('error' in r) return r.error

    const parsed = deleteSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter id wajib')
    const { id } = parsed.data

    const committee = await db.committee.findUnique({
      where: { id },
      include: {
        _count: { select: { letters: true, assignments: true, profiles: true, backupGrants: true } },
      },
    })
    if (!committee) return fail(404, 'NOT_FOUND', 'Kepanitiaan tidak ditemukan')
    if (!canManageCommittee(r.user, committee)) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang mengelola kepanitiaan ini')
    }
    const deps = committee._count
    const depCount = deps.letters + deps.assignments + deps.profiles + deps.backupGrants
    if (depCount > 0) {
      return fail(409, 'HAS_HISTORY',
        `Kepanitiaan memiliki dependensi (${deps.letters} surat, ${deps.assignments} penugasan, ${deps.profiles} profil) — gunakan status Arsip agar histori tetap tersambung.`)
    }
    // Namespace counter kepanitiaan ikut dibersihkan (tidak dipakai mana pun)
    await db.$transaction(async (tx) => {
      await tx.counterNamespace.deleteMany({ where: { committeeId: id } })
      await tx.committee.delete({ where: { id } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'committee.delete', entityType: 'committee', entityId: id,
        correlationId: r.correlationId, metadata: { code: committee.code, name: committee.name },
      })
    })
    return ok({ deleted: true })
  })
}
