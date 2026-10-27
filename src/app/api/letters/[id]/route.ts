import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission, requireUser } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter, canAccessUnit, canAccessCommittee } from '@/lib/rbac'
import { syncLetterReferences, ReferenceInput } from '@/lib/references'
import { activeProfileCandidates } from '@/lib/numbering/profile-resolution'

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
        referencesFrom: {
          select: {
            id: true, refLetterId: true, refNumberText: true, isAutoLinked: true, createdAt: true,
            refLetter: {
              select: { id: true, officialNumber: true, legacyNumber: true, subject: true, status: true, letterDate: true,
                issuingUnit: { select: { code: true } } },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { referencesTo: true } },
      },
    })
    if (!letter) return fail(404, 'NOT_FOUND', 'Surat tidak ditemukan atau di luar scope akses Anda')
    // Referensi MASUK difilter scope secara independen (H: hak melihat surat ini
    // tidak otomatis membuka semua surat yang merujuk) — cukup hitung aman + ringkas
    const incomingCount = await db.letterReference.count({
      where: { refLetterId: id, letter: scope ?? undefined },
    })
    return ok({ letter: { ...letter, incomingRefCount: incomingCount } })
  })
}

const patchSchema = z.object({
  // FR-013/blueprint: metadata non-komponen boleh dikoreksi; komponen nomor (tanggal/field/jenis) hanya lewat cancel+pengganti
  recipient: z.string().trim().max(240).optional().nullable(),
  subject: z.string().trim().max(240).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  // khusus DRAFT: komponen boleh diubah sebelum terbit
  direction: z.enum(['INTERNAL', 'EXTERNAL']).optional(), // LEGACY v1
  numberingProfileId: z.string().min(1).optional().nullable(), // v1.8: ganti profil pilihan (DRAFT saja)
  fieldValues: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
    z.string().min(1).max(64),
  ).optional().nullable(), // v1.6: pilihan Dropdown (DRAFT saja)
  letterTypeId: z.string().optional(),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  committeeId: z.string().optional().nullable(),
  // Referensi (G.6): hanya boleh diubah saat DRAFT — setelah final, referensi
  // adalah fakta penerbitan; koreksi memerlukan mekanisme terotorisasi + audit.
  references: z.array(z.object({
    letterId: z.string().optional().nullable(),
    refNumberText: z.string().trim().min(1).max(240),
  })).max(20).optional(),
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
      if (body.numberingProfileId !== undefined) {
        // v1.8: ganti profil pilihan — validasi terhadap konteks EFEKTIF surat
        // (committeeId baru bila ikut diubah dalam request yang sama).
        const effectiveCommitteeId = body.committeeId !== undefined
          ? (body.committeeId || null)
          : letter.committeeId
        if (body.numberingProfileId) {
          const candidates = await activeProfileCandidates(db, letter.issuingUnitId, effectiveCommitteeId)
          if (!candidates.some(c => c.profileId === body.numberingProfileId)) {
            return fail(409, 'PROFILE_NOT_ACTIVE',
              'Profil penomoran yang dipilih tidak aktif / tidak tersedia untuk konteks surat ini — pilih ulang profil')
          }
        }
        data.numberingProfileId = body.numberingProfileId // null = kembali ke resolusi otomatis
        before.numberingProfileId = letter.numberingProfileId
      }
      if (body.fieldValues !== undefined) {
        data.fieldValues = body.fieldValues && Object.keys(body.fieldValues).length > 0
          ? JSON.stringify(body.fieldValues)
          : null
        before.fieldValues = letter.fieldValues
      }
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
      if (body.direction || body.numberingProfileId !== undefined || body.fieldValues !== undefined || body.letterTypeId || body.letterDate !== undefined || body.committeeId !== undefined) {
        return fail(409, 'IMMUTABLE_COMPONENT',
          'Komponen nomor surat terbit tidak dapat diubah. Batalkan surat dan terbitkan pengganti.')
      }
      // G.6: referensi surat final tidak boleh berubah diam-diam
      if (body.references !== undefined) {
        return fail(409, 'IMMUTABLE_REFERENCES',
          'Referensi surat yang sudah final tidak dapat diubah. Gunakan mekanisme koreksi terotorisasi (audit trail).')
      }
    }
    if (body.recipient !== undefined) { data.recipient = body.recipient; before.recipient = letter.recipient }
    if (body.subject !== undefined) { data.subject = body.subject; before.subject = letter.subject }
    if (body.notes !== undefined) { data.notes = body.notes; before.notes = letter.notes }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.letter.update({ where: { id }, data })
      if (letter.status === 'DRAFT' && body.references !== undefined) {
        await syncLetterReferences(tx, r.user, id, body.references as ReferenceInput[])
      }
      await writeAudit(tx, {
        actorId: r.user.id, action: 'letter.update', entityType: 'letter', entityId: id,
        correlationId: crypto.randomUUID(), metadata: { before, after: body, referencesReplaced: body.references !== undefined },
      })
      return u
    })
    return ok({ letter: updated })
  })
}
