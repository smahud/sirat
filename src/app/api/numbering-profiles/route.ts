import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { dslSchema } from '@/lib/numbering/dsl'
import { validateDslForActivation } from '@/lib/numbering/validate'

export async function GET() {
  return handle(async () => {
    const r = await requirePermission('letter.view')
    if ('error' in r) return r.error
    const profiles = await db.numberingProfile.findMany({
      include: {
        owner: { select: { id: true, code: true, name: true } },
        committee: { select: { id: true, code: true, name: true } },
        versions: { orderBy: { version: 'desc' } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return ok({ profiles })
  })
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ownerId: z.string().min(1),           // unit pemilik
  committeeId: z.string().optional().nullable(), // terisi = profil khusus panitia
  dsl: dslSchema,
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Profil tidak valid', { issues: parsed.error.issues })
    const { name, ownerId, committeeId, dsl } = parsed.data

    const unit = await db.unit.findUnique({ where: { id: ownerId } })
    if (!unit) return fail(404, 'NOT_FOUND', 'Unit tidak ditemukan')
    if (committeeId) {
      const committee = await db.committee.findUnique({ where: { id: committeeId } })
      if (!committee || committee.unitId !== ownerId) return fail(409, 'COMMITTEE_MISMATCH', 'Kepanitiaan tidak berada di bawah unit pemilik profil')
    }

    const dup = await db.numberingProfile.findFirst({
      where: committeeId ? { committeeId } : { ownerId, committeeId: null },
    })
    if (dup) return fail(409, 'CONFLICT', 'Profil untuk konteks ini sudah ada — buat versi baru alih-alih profil baru')

    const profile = await db.$transaction(async (tx) => {
      const profile = await tx.numberingProfile.create({
        data: { name, ownerId, committeeId: committeeId ?? null },
      })
      await tx.numberingProfileVersion.create({
        data: { profileId: profile.id, version: 1, status: 'DRAFT', dsl: JSON.stringify(dsl) },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'profile.create', entityType: 'numberingProfile', entityId: profile.id,
        correlationId: r.correlationId, metadata: { name, unit: unit.code, committeeId },
      })
      return profile
    })
    return ok({ profile }, 201)
  })
}

const newVersionSchema = z.object({
  profileId: z.string().min(1),
  dsl: dslSchema,
})

/** PUT /api/numbering-profiles — buat versi draft baru (versi published immutable). */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const parsed = newVersionSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })

    const profile = await db.numberingProfile.findUnique({
      where: { id: parsed.data.profileId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!profile) return fail(404, 'NOT_FOUND', 'Profil tidak ditemukan')

    const lastVersion = profile.versions[0]?.version ?? 0
    const version = await db.$transaction(async (tx) => {
      const v = await tx.numberingProfileVersion.create({
        data: {
          profileId: profile.id,
          version: lastVersion + 1,
          status: 'DRAFT',
          dsl: JSON.stringify(parsed.data.dsl),
        },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'profile.version.create', entityType: 'numberingProfileVersion', entityId: v.id,
        correlationId: r.correlationId, metadata: { profileId: profile.id, version: lastVersion + 1 },
      })
      return v
    })
    return ok({ version }, 201)
  })
}
