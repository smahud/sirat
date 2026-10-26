import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { dslSchema } from '@/lib/numbering/dsl'
import { canManageUnit, canManageCommittee } from '@/lib/rbac'

/**
 * GET /api/numbering-profiles — daftar profil penomoran.
 * v1.5: diperketat dari letter.view → profile.manage (kebijakan pusat).
 * Profil penomoran adalah konfigurasi organisasi, bukan konten surat —
 * admin unit ke bawah tidak memiliki akses (menu pun tidak dimunculkan).
 */
export async function GET() {
  return handle(async () => {
    const r = await requirePermission('profile.manage')
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
    const allowed = committeeId
      ? canManageCommittee(r.user, { id: committeeId, unitId: ownerId })
      : canManageUnit(r.user, ownerId)
    if (!allowed) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang membuat profil untuk konteks ini')
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

const saveVersionSchema = z.object({
  profileId: z.string().min(1),
  dsl: dslSchema,
  mode: z.enum(['draft', 'new']).default('draft'),
})

/**
 * PUT /api/numbering-profiles — simpan DSL profil.
 * - mode 'draft' (default): perbarui DSL pada versi DRAFT TERAKHIR.
 *   Versi ACTIVE/RETIRED immutable — 409 bila tidak ada draft terbuka.
 * - mode 'new': buat versi draft baru (versi terbit immutable, perubahan = versi baru).
 *   Menolak bila sudah ada draft terbuka (edit draft itu dulu) agar tidak ada
 *   dua draft paralel yang membingungkan.
 */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const parsed = saveVersionSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })
    const { profileId, dsl, mode } = parsed.data

    const profile = await db.numberingProfile.findUnique({
      where: { id: profileId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 }, owner: { select: { code: true } } },
    })
    if (!profile) return fail(404, 'NOT_FOUND', 'Profil tidak ditemukan')
    const canManage = profile.committeeId
      ? canManageCommittee(r.user, { id: profile.committeeId, unitId: profile.ownerId })
      : canManageUnit(r.user, profile.ownerId)
    if (!canManage) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang mengelola profil ini')
    }

    const last = profile.versions[0]
    const result = await db.$transaction(async (tx) => {
      if (mode === 'draft') {
        if (!last || last.status !== 'DRAFT') {
          return { error: 'NO_OPEN_DRAFT' as const }
        }
        const updated = await tx.numberingProfileVersion.update({
          where: { id: last.id },
          data: { dsl: JSON.stringify(dsl) },
        })
        await writeAudit(tx, {
          actorId: r.user.id, action: 'profile.version.edit', entityType: 'numberingProfileVersion', entityId: last.id,
          correlationId: r.correlationId, metadata: { profileId, version: last.version },
        })
        return { version: updated }
      }
      // mode 'new'
      if (last?.status === 'DRAFT') {
        return { error: 'DRAFT_EXISTS' as const }
      }
      const version = await tx.numberingProfileVersion.create({
        data: {
          profileId,
          version: (last?.version ?? 0) + 1,
          status: 'DRAFT',
          dsl: JSON.stringify(dsl),
        },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'profile.version.create', entityType: 'numberingProfileVersion', entityId: version.id,
        correlationId: r.correlationId, metadata: { profileId, version: version.version },
      })
      return { version }
    })

    if ('error' in result) {
      if (result.error === 'NO_OPEN_DRAFT') {
        return fail(409, 'NO_OPEN_DRAFT',
          'Tidak ada versi DRAFT terbuka pada profil ini — gunakan "Buat Versi Baru" (versi terbit immutable)')
      }
      return fail(409, 'DRAFT_EXISTS',
        'Sudah ada versi DRAFT terbuka — edit draft tersebut, atau aktivasi dulu sebelum membuat versi baru')
    }
    // mode 'draft' = pembaruan sumber daya yang sama → 200; mode 'new' = versi baru → 201
    return ok({ version: result.version }, mode === 'new' ? 201 : 200)
  })
}

const renameSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

/**
 * PATCH /api/numbering-profiles?id= — ubah NAMA profil (v1.5: profil editable).
 * Hanya nama yang bisa diubah; pemilik (unit/kepanitiaan) tidak bisa dipindahkan
 * karena histori versi dan namespace terikat pada konteks tersebut.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return fail(400, 'VALIDATION', 'Parameter id wajib')

    const parsed = renameSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Nama profil tidak valid', { issues: parsed.error.issues })

    const profile = await db.numberingProfile.findUnique({ where: { id } })
    if (!profile) return fail(404, 'NOT_FOUND', 'Profil tidak ditemukan')
    const canManage = profile.committeeId
      ? canManageCommittee(r.user, { id: profile.committeeId, unitId: profile.ownerId })
      : canManageUnit(r.user, profile.ownerId)
    if (!canManage) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang mengubah profil ini')
    }
    if (profile.name === parsed.data.name) return ok({ profile })

    const updated = await db.$transaction(async (tx) => {
      const p = await tx.numberingProfile.update({ where: { id }, data: { name: parsed.data.name } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'profile.rename', entityType: 'numberingProfile', entityId: id,
        correlationId: r.correlationId, metadata: { before: profile.name, after: parsed.data.name },
      })
      return p
    })
    return ok({ profile: updated })
  })
}

const deleteSchema = z.object({ id: z.string().min(1) })

/**
 * DELETE /api/numbering-profiles?id= — hapus profil (v1.5, guarded).
 * - Versi ACTIVE ada → 409: profil sedang dipakai penomoran surat baru
 *   (menghapusnya membuat unit/panitia tidak bisa menerbitkan surat).
 * - Ada surat pada namespace versi manapun → 409 HAS_HISTORY:
 *   histori penomoran tidak boleh putus.
 * - Profil DRAFT murni (belum pernah diaktivasi) → boleh dihapus beserta versinya.
 */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const body = await readJson<z.infer<typeof deleteSchema>>(req).catch(() => null)
    const parsed = deleteSchema.safeParse(body ?? { id: url.searchParams.get('id') ?? '' })
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter id wajib')
    const { id } = parsed.data

    const profile = await db.numberingProfile.findUnique({
      where: { id },
      include: {
        owner: { select: { code: true } },
        committee: { select: { code: true } },
        versions: { select: { id: true, status: true, namespaceId: true } },
      },
    })
    if (!profile) return fail(404, 'NOT_FOUND', 'Profil tidak ditemukan')
    const canManage = profile.committeeId
      ? canManageCommittee(r.user, { id: profile.committeeId, unitId: profile.ownerId })
      : canManageUnit(r.user, profile.ownerId)
    if (!canManage) {
      return fail(403, 'FORBIDDEN', 'Anda tidak memiliki wewenang menghapus profil ini')
    }

    if (profile.versions.some(v => v.status === 'ACTIVE')) {
      return fail(409, 'PROFILE_ACTIVE',
        'Profil masih memiliki versi AKTIF — penerbitan surat konteks ini bergantung padanya. Aktivasi profil lain terlebih dahulu bila ingin mengganti.')
    }
    const namespaceIds = profile.versions.map(v => v.namespaceId).filter((x): x is string => !!x)
    const lettersOnNamespaces = namespaceIds.length > 0
      ? await db.letter.count({ where: { namespaceId: { in: namespaceIds } } })
      : 0
    if (lettersOnNamespaces > 0) {
      return fail(409, 'HAS_HISTORY',
        `Profil memiliki histori penomoran (${lettersOnNamespaces} surat) — hapus fisik diblokir demi kesinambungan histori.`)
    }

    await db.$transaction(async (tx) => {
      await tx.numberingProfileVersion.deleteMany({ where: { profileId: id } })
      await tx.numberingProfile.delete({ where: { id } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'profile.delete', entityType: 'numberingProfile', entityId: id,
        correlationId: r.correlationId,
        metadata: { name: profile.name, unit: profile.owner.code, committee: profile.committee?.code ?? null },
      })
    })
    return ok({ deleted: true })
  })
}
