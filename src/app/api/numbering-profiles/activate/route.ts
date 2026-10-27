import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { parseDsl } from '@/lib/numbering/dsl'
import { validateDslForActivation } from '@/lib/numbering/validate'
import { RESET_POLICIES, DATE_SOURCES } from '@/lib/constants'
import { canManageUnit, canManageCommittee } from '@/lib/rbac'

const activateSchema = z.object({
  versionId: z.string().min(1),
  resetPolicy: z.enum(RESET_POLICIES),  // eksplisit saat aktivasi (keputusan terbuka no. 1 PRD)
  dateSource: z.enum(DATE_SOURCES),
  retireExisting: z.boolean().default(true),
})

/**
 * POST /api/numbering-profiles/activate
 * FR-006: profil tidak valid tidak bisa diaktifkan.
 * Namespace dipilih eksplisit: unit (atau panitia bila profil panitia).
 * Aktivasi versi baru memensiunkan versi aktif lama; versi published immutable.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const parsed = activateSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data aktivasi tidak valid', { issues: parsed.error.issues })
    const { versionId, resetPolicy, dateSource, retireExisting } = parsed.data

    const version = await db.numberingProfileVersion.findUnique({
      where: { id: versionId },
      include: { profile: { include: { owner: true, committee: true } } },
    })
    if (!version) return fail(404, 'NOT_FOUND', 'Versi profil tidak ditemukan')
    if (version.status === 'RETIRED') return fail(409, 'RETIRED', 'Versi sudah dipensiunkan dan immutable')

    // Scope validation (audit #4): aktivasi hanya oleh pengelola konteks profil
    const profile0 = version.profile
    const canManage = profile0.committeeId
      ? canManageCommittee(r.user, { id: profile0.committeeId, unitId: profile0.ownerId })
      : canManageUnit(r.user, profile0.ownerId)
    if (!canManage) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang mengaktifkan profil ini')
    }

    // Validasi DSL sebelum aktivasi
    const dsl = parseDsl(version.dsl)
    const validation = validateDslForActivation(dsl)
    if (!validation.ok) {
      return fail(409, 'INVALID_PROFILE', 'Profil tidak dapat diaktifkan', { errors: validation.errors, warnings: validation.warnings })
    }
    if (version.profile.committeeId && !dsl.components.some(c => c.type === 'committeeCode')) {
      validation.warnings.push('Profil kepanitiaan tanpa komponen committeeCode — nomor panitia mengikuti format unit')
    }

    const profile = version.profile

    const result = await db.$transaction(async (tx) => {
      // v1.8: pensiunkan versi aktif LAMA HANYA pada profil yang sama — profil lain
      // utk konteks yang sama boleh tetap aktif (multi-profil per unit/kepanitiaan;
      // satu profil tetap maksimal satu versi aktif).
      const sameProfileFilter = { profileId: version.profileId }
      if (retireExisting) {
        await tx.numberingProfileVersion.updateMany({
          where: { status: 'ACTIVE', ...sameProfileFilter },
          data: { status: 'RETIRED' },
        })
      } else {
        const activeCount = await tx.numberingProfileVersion.count({
          where: { status: 'ACTIVE', ...sameProfileFilter },
        })
        if (activeCount > 0) {
          return { ambiguous: true as const }
        }
      }

      // Namespace: milik unit (profil unit) atau panitia (profil panitia) — kecuali shareParentCounter
      let nsWhere: { unitId?: string; committeeId?: string | null }
      if (profile.committeeId) {
        const committee = profile.committee!
        nsWhere = committee.shareParentCounter
          ? { unitId: profile.ownerId, committeeId: null }
          : { committeeId: profile.committeeId }
      } else {
        nsWhere = { unitId: profile.ownerId, committeeId: null }
      }
      let ns = await tx.counterNamespace.findFirst({ where: nsWhere, orderBy: { createdAt: 'desc' } })
      if (!ns) {
        ns = await tx.counterNamespace.create({
          data: {
            name: `ns:${profile.owner.code}:${profile.committee?.code ?? 'unit'}:${Date.now().toString(36)}`,
            unitId: nsWhere.unitId ?? null,
            committeeId: nsWhere.committeeId ?? null,
            resetPolicy, dateSource,
          },
        })
      } else {
        const hasLetters = await tx.letter.count({ where: { namespaceId: ns.id } })
        if (hasLetters === 0) {
          ns = await tx.counterNamespace.update({ where: { id: ns.id }, data: { resetPolicy, dateSource } })
        } else if (ns.resetPolicy !== resetPolicy || ns.dateSource !== dateSource) {
          // Ada histori pada namespace: kebijakan baru hanya untuk namespace baru (tidak menurunkan/mengubah histori)
          ns = await tx.counterNamespace.create({
            data: {
              name: `${ns.name}:re${Date.now().toString(36)}`,
              unitId: ns.unitId, committeeId: ns.committeeId,
              resetPolicy, dateSource,
            },
          })
        }
      }

      const activated = await tx.numberingProfileVersion.update({
        where: { id: versionId },
        data: { status: 'ACTIVE', activatedAt: new Date(), effectiveFrom: new Date(), namespaceId: ns.id },
      })

      await writeAudit(tx, {
        actorId: r.user.id, action: 'profile.activate', entityType: 'numberingProfileVersion', entityId: versionId,
        correlationId: r.correlationId,
        metadata: {
          profileName: profile.name, unit: profile.owner.code, committee: profile.committee?.code ?? null,
          version: activated.version, resetPolicy, dateSource, namespaceId: ns.id,
          warnings: validation.warnings,
        },
      })
      return { ambiguous: false as const, activated, warnings: validation.warnings }
    })

    if (result.ambiguous) {
      return fail(409, 'AMBIGUOUS', 'Sudah ada versi aktif untuk konteks ini')
    }
    return ok({ version: result.activated, warnings: result.warnings })
  })
}
