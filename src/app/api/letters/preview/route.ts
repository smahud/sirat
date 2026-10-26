import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { canAccessUnit, canAccessCommittee } from '@/lib/rbac'
import { parseDsl } from '@/lib/numbering/dsl'
import { renderNumber, requiredInputs } from '@/lib/numbering/render'
import { periodKeyFor } from '@/lib/numbering/validate'

const querySchema = z.object({
  unitId: z.string().min(1),
  committeeId: z.string().optional(),
  direction: z.enum(['INTERNAL', 'EXTERNAL']).optional(),
  letterTypeId: z.string().optional(),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/**
 * GET /api/letters/preview — FR-009: preview BUKAN nomor resmi, tidak reservasi.
 * Menampilkan perkiraan + penjelasan komponen + validasi field yang belum lengkap.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter tidak valid', { issues: parsed.error.issues })
    const { unitId, committeeId, direction, letterTypeId, letterDate } = parsed.data

    const unit = await db.unit.findUnique({ where: { id: unitId } })
    if (!unit) return fail(404, 'NOT_FOUND', 'Unit tidak ditemukan')
    if (!canAccessUnit(r.user, unitId)) return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke unit ini')

    const committee = committeeId ? await db.committee.findUnique({ where: { id: committeeId } }) : null
    if (committeeId) {
      if (!committee || committee.unitId !== unitId) return fail(404, 'NOT_FOUND', 'Kepanitiaan tidak valid untuk unit ini')
      if (!canAccessCommittee(r.user, committee)) return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke kepanitiaan ini')
    }

    // Resolusi profil aktif (sama seperti issue)
    const activeVersion = committee
      ? (await db.numberingProfileVersion.findFirst({
            where: { status: 'ACTIVE', profile: { committeeId: committee.id } },
            orderBy: { version: 'desc' },
          }))
        ?? (await db.numberingProfileVersion.findFirst({
            where: { status: 'ACTIVE', profile: { ownerId: unitId, committeeId: null } },
            orderBy: { version: 'desc' },
          }))
      : await db.numberingProfileVersion.findFirst({
          where: { status: 'ACTIVE', profile: { ownerId: unitId, committeeId: null } },
          orderBy: { version: 'desc' },
        })
    if (!activeVersion) {
      return ok({ available: false, reason: 'Tidak ada profil penomoran aktif untuk konteks ini' })
    }
    const dsl = parseDsl(activeVersion.dsl)

    // Namespace efektif untuk estimasi counter
    const ns = committee
      ? (committee.shareParentCounter
          ? await db.counterNamespace.findFirst({ where: { unitId, committeeId: null } })
          : await db.counterNamespace.findFirst({ where: { committeeId: committee.id } }))
      : await db.counterNamespace.findFirst({ where: { unitId, committeeId: null } })

    const lt = letterTypeId ? await db.letterType.findUnique({ where: { id: letterTypeId } }) : null

    const ctx = {
      direction,
      letterTypeCode: lt?.code,
      unitCode: unit.code,
      committeeCode: committee?.code,
      letterDate: letterDate ? new Date(`${letterDate}T00:00:00.000Z`) : null,
      issueDate: new Date(),
    }

    // Estimasi sequence: lastValue+1 jika namespace ada; TIDAK dialokasikan
    let estimatedSeq: number | undefined
    if (ns) {
      const periodKey = periodKeyFor(
        ns.resetPolicy as 'ALL' | 'YEARLY' | 'MONTHLY',
        ns.dateSource as 'LETTER_DATE' | 'ISSUE_DATE',
        ctx.letterDate, ctx.issueDate,
      )
      const counter = await db.counter.findUnique({
        where: { namespaceId_periodKey: { namespaceId: ns.id, periodKey } },
      })
      estimatedSeq = (counter?.lastValue ?? 0) + 1
    }

    try {
      const rendered = renderNumber(dsl, { ...ctx, seq: estimatedSeq })
      return ok({
        available: true,
        previewNumber: rendered.text,
        isEstimate: true,
        note: 'Perkiraan nomor — bukan reservasi. Nomor resmi hanya dialokasikan saat penerbitan berhasil.',
        parts: rendered.parts,
        requiredInputs: requiredInputs(dsl),
        missingInputs: rendered.parts.filter(p => p.value.includes('#')).length > 0 ? ['sequence'] : [],
      })
    } catch (e) {
      return ok({
        available: true,
        error: (e as Error).message,
        requiredInputs: requiredInputs(dsl),
        missingInputs: requiredInputs(dsl).filter(f =>
          (f === 'direction' && !direction) ||
          (f === 'letterTypeId' && !letterTypeId) ||
          (f === 'letterDate' && !letterDate)),
      })
    }
  })
}
