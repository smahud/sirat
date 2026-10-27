import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { canAccessUnit, canAccessCommittee } from '@/lib/rbac'
import { parseDsl } from '@/lib/numbering/dsl'
import { renderNumber, requiredInputs, formFields } from '@/lib/numbering/render'
import { resolveFieldValuesForPreview, unresolvedNumberFields } from '@/lib/numbering/fields'
import { periodKeyFor } from '@/lib/numbering/validate'
import { activeProfileCandidates, ActiveProfileCandidate } from '@/lib/numbering/profile-resolution'

const querySchema = z.object({
  unitId: z.string().min(1),
  committeeId: z.string().optional(),
  profileId: z.string().optional(), // v1.8: pilih profil eksplisit (konteks multi-profil)
  direction: z.enum(['INTERNAL', 'EXTERNAL']).optional(), // LEGACY v1 (draft lama)
  fields: z.string().optional(), // JSON { fieldKey: optionId } — pilihan Dropdown operator (v1.6)
  letterTypeId: z.string().optional(),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

function parseFieldsParam(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v) out[k] = v
      }
      return out
    }
  } catch { /* parameter tidak valid → perlakukan kosong */ }
  return undefined
}

/**
 * GET /api/letters/preview — FR-009: preview BUKAN nomor resmi, tidak reservasi.
 * v1.6: mengembalikan `fields` (spesifikasi formulir Dropdown dari profil aktif)
 * agar FE operator merender form dinamis; preview memakai pilihan operator.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter tidak valid', { issues: parsed.error.issues })
    const { unitId, committeeId, profileId, direction, letterTypeId, letterDate } = parsed.data
    const fieldValues = parseFieldsParam(url.searchParams.get('fields') ?? undefined)

    const unit = await db.unit.findUnique({ where: { id: unitId } })
    if (!unit) return fail(404, 'NOT_FOUND', 'Unit tidak ditemukan')
    if (!canAccessUnit(r.user, unitId)) return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke unit ini')

    const committee = committeeId ? await db.committee.findUnique({ where: { id: committeeId } }) : null
    if (committeeId) {
      if (!committee || committee.unitId !== unitId) return fail(404, 'NOT_FOUND', 'Kepanitiaan tidak valid untuk unit ini')
      if (!canAccessCommittee(r.user, committee)) return fail(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke kepanitiaan ini')
    }

    // Resolusi profil aktif (v1.8 multi-profil): kandidat = profil panitia (bila
    // ada) lalu profil unit; profileId eksplisit memilih salah satunya.
    const candidates = await activeProfileCandidates(db, unitId, committee?.id ?? null)
    let activeVersion: ActiveProfileCandidate | undefined
    if (profileId) {
      activeVersion = candidates.find(c => c.profileId === profileId)
      if (!activeVersion) {
        return fail(404, 'PROFILE_NOT_AVAILABLE',
          'Profil penomoran tidak tersedia untuk konteks ini — muat ulang formulir dan pilih ulang profil')
      }
    } else {
      activeVersion = candidates[0]
    }
    if (!activeVersion) {
      return ok({ available: false, reason: 'Tidak ada profil penomoran aktif untuk konteks ini', profiles: [] })
    }
    const profileOptions = candidates.map(c => ({
      id: c.profileId,
      name: c.name,
      scope: c.committeeProfile ? 'committee' as const : 'unit' as const,
    }))
    const dsl = parseDsl(activeVersion.dsl)

    // Spesifikasi formulir dinamis — FE merender Dropdown dari sini (B.2/C)
    const fieldsSpec = formFields(dsl)

    // Namespace efektif untuk estimasi counter (v1.8: ikut namespace yang dicap
    // aktivasi pada versi profil terpilih — deterministik; fallback resolusi lama)
    const ns = activeVersion.namespaceId
      ? await db.counterNamespace.findUnique({ where: { id: activeVersion.namespaceId } })
      : committee
        ? (committee.shareParentCounter
            ? await db.counterNamespace.findFirst({ where: { unitId, committeeId: null } })
            : await db.counterNamespace.findFirst({ where: { committeeId: committee.id } }))
        : await db.counterNamespace.findFirst({ where: { unitId, committeeId: null } })

    const lt = letterTypeId ? await db.letterType.findUnique({ where: { id: letterTypeId } }) : null

    // Resolusi nilai field (longgar — field wajib kosong dilaporkan, bukan error)
    const { values: resolvedFields, missingRequired } = resolveFieldValuesForPreview(
      dsl, fieldValues, direction ?? null,
    )

    const ctx = {
      fieldValues: Object.fromEntries(Object.entries(resolvedFields).map(([k, v]) => [k, v.optionId])),
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
        fields: fieldsSpec,
        profileId: activeVersion.profileId,
        profileName: activeVersion.name,
        profiles: profileOptions,
        requiredInputs: requiredInputs(dsl),
        missingInputs: [
          ...(letterTypeId ? [] : ['letterTypeId']),
          ...(letterDate ? [] : ['letterDate']),
          ...unresolvedNumberFields(dsl, resolvedFields).map(l => `field:${l}`),
        ],
        missingRequiredLabels: missingRequired,
      })
    } catch (e) {
      return ok({
        available: true,
        error: (e as Error).message,
        fields: fieldsSpec,
        profileId: activeVersion.profileId,
        profileName: activeVersion.name,
        profiles: profileOptions,
        requiredInputs: requiredInputs(dsl),
        missingInputs: [
          ...(letterTypeId ? [] : ['letterTypeId']),
          ...(letterDate ? [] : ['letterDate']),
          ...unresolvedNumberFields(dsl, resolvedFields).map(l => `field:${l}`),
          ...missingRequired.map(l => `field:${l}`),
        ],
        missingRequiredLabels: missingRequired,
      })
    }
  })
}
