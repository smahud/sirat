import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission, requireUser } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter, canAccessUnit, canAccessCommittee } from '@/lib/rbac'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const { id } = await params

    const scope = letterScopeFilter(r.user)
    const letter = await db.letter.findFirst({
      where: { id, ...(scope ?? {}) },
      include: {
        issuingUnit: { select: { id: true, code: true, name: true, storageKey: true } },
        committee: { select: { id: true, code: true, name: true, storageKey: true, unitId: true } },
        letterType: { select: { id: true, code: true, name: true } },
        issuer: { select: { id: true, fullName: true, username: true } },
        files: {
          where: {},
          include: { versions: { orderBy: { versionNo: 'desc' } } },
        },
        profileVersion: { include: { profile: { select: { name: true } } } },
      },
    })
    if (!letter) return fail(404, 'NOT_FOUND', 'Surat tidak ditemukan atau di luar scope akses Anda')
    return ok({ letter })
  })
}

const patchSchema = z.object({
  // FR-013/blueprint: metadata non-komponen boleh dikoreksi; komponen nomor (tanggal/arah/jenis) hanya lewat cancel+pengganti
  recipient: z.string().trim().max(240).optional().nullable(),
  subject: z.string().trim().max(240).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  // khusus DRAFT: komponen boleh diubah sebelum terbit
  direction: z.enum(['INTERNAL', 'EXTERNAL']).optional(),
  letterTypeId: z.string().optional(),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  committeeId: z.string().optional().nullable(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const { id } = await params

    // Muat surat dulu untuk menentukan izin per status (deni by default)
    const probe = await db.letter.findUnique({ where: { id } })
    if (!probe) return fail(404, 'NOT_FOUND', 'Surat tidak ditemukan')
    // DRAFT (termasuk komponen nomor) → bagian alur pembuatan: letter.create.
    // Koreksi metadata surat TERBIT → aksi lebih kuat: letter.cancel (UNIT_ADMIN+).
    const neededPerm = probe.status === 'DRAFT' ? 'letter.create' : 'letter.cancel'
    const r = await requirePermission(neededPerm)
    if ('error' in r) return r.error

    const scope = letterScopeFilter(r.user)
    const letter = await db.letter.findFirst({ where: { id, ...(scope ?? {}) } })
    if (!letter) return fail(404, 'NOT_FOUND', 'Surat tidak ditemukan atau di luar scope akses Anda')

    const parsed = patchSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })
    const body = parsed.data

    const data: Record<string, unknown> = {}
    const before: Record<string, unknown> = {}

    if (letter.status === 'DRAFT') {
      if (body.direction) { data.direction = body.direction; before.direction = letter.direction }
      if (body.letterTypeId) { data.letterTypeId = body.letterTypeId; before.letterTypeId = letter.letterTypeId }
      if (body.letterDate) { data.letterDate = new Date(`${body.letterDate}T00:00:00.000Z`); before.letterDate = letter.letterDate }
      if (body.committeeId !== undefined) {
        if (body.committeeId) {
          const committee = await db.committee.findUnique({ where: { id: body.committeeId } })
          if (!committee || committee.unitId !== letter.issuingUnitId) {
            return fail(409, 'COMMITTEE_MISMATCH', 'Kepanitiaan tidak berada di bawah unit penerbit')
          }
          if (committee.status !== 'ACTIVE') {
            return fail(409, 'COMMITTEE_INACTIVE', 'Kepanitiaan tidak aktif')
          }
          // Konsisten dgn create/issue: pindah ke konteks kepanitiaan wajib akses committee
          if (!canAccessCommittee(r.user, committee)) {
            return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke kepanitiaan ini')
          }
        } else if (!canAccessUnit(r.user, letter.issuingUnitId)) {
          // pindah ke surat reguler unit: wajib akses unit
          return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke unit penerbit ini')
        }
        data.committeeId = body.committeeId
        before.committeeId = letter.committeeId
      }
    } else {
      // Surat terbit: komponen nomor tidak boleh berubah
      if (body.direction || body.letterTypeId || body.letterDate !== undefined || body.committeeId !== undefined) {
        return fail(409, 'IMMUTABLE_COMPONENT',
          'Komponen nomor surat terbit tidak dapat diubah. Batalkan surat dan terbitkan pengganti.')
      }
    }
    if (body.recipient !== undefined) { data.recipient = body.recipient; before.recipient = letter.recipient }
    if (body.subject !== undefined) { data.subject = body.subject; before.subject = letter.subject }
    if (body.notes !== undefined) { data.notes = body.notes; before.notes = letter.notes }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.letter.update({ where: { id }, data })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'letter.update', entityType: 'letter', entityId: id,
        correlationId: crypto.randomUUID(), metadata: { before, after: body },
      })
      return u
    })
    return ok({ letter: updated })
  })
}
