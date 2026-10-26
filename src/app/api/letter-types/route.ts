import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'

// Jenis surat = master terpisah dari profil penomoran: kode jenis masuk sebagai
// komponen nomor (snapshot saat terbit), format susunan nomor diatur NumberingProfile.
// (master prompt lanjutan D.3/D.4: jenis ≠ klasifikasi ≠ pola penomoran ≠ unit penerbit)

const createSchema = z.object({
  code: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  purpose: z.string().trim().max(500).optional().nullable(),
  usageExamples: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
})

export async function GET() {
  return handle(async () => {
    const r = await requirePermission('letter.view')
    if ('error' in r) return r.error
    const letterTypes = await db.letterType.findMany({
      include: { _count: { select: { letters: true } } },
      orderBy: { code: 'asc' },
    })
    return ok({ letterTypes })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('lettertype.manage')
    if ('error' in r) return r.error

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data jenis surat tidak valid', { issues: parsed.error.issues })

    const dup = await db.letterType.findUnique({ where: { code: parsed.data.code } })
    if (dup) return fail(409, 'CONFLICT', 'Kode jenis surat sudah dipakai')

    const letterType = await db.$transaction(async (tx) => {
      const lt = await tx.letterType.create({
        data: { ...parsed.data, description: parsed.data.description ?? null },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'lettertype.create', entityType: 'letterType', entityId: lt.id,
        correlationId: r.correlationId, metadata: parsed.data,
      })
      return lt
    })
    return ok({ letterType }, 201)
  })
}

const patchSchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(24).optional(), // perubahan kode hanya untuk terbitan baru (FR-005); snapshot surat lama tidak berubah
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  purpose: z.string().trim().max(500).optional().nullable(),
  usageExamples: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('lettertype.manage')
    if ('error' in r) return r.error

    const parsed = patchSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })
    const { id, ...changes } = parsed.data

    const existing = await db.letterType.findUnique({
      where: { id },
      include: { _count: { select: { letters: true } } },
    })
    if (!existing) return fail(404, 'NOT_FOUND', 'Jenis surat tidak ditemukan')

    if (changes.code && changes.code !== existing.code) {
      const dup = await db.letterType.findFirst({ where: { code: changes.code, id: { not: id } } })
      if (dup) return fail(409, 'CONFLICT', 'Kode sudah dipakai jenis surat lain')
      // Kode dipakai N surat terbit: perubahan hanya berlaku utk terbitan baru;
      // snapshot pada surat lama tetap sah (nomor historis tidak berubah) —
      // jumlah surat terdampak dicatat di audit metadata.
    }

    const data: Record<string, unknown> = {}
    for (const k of ['code', 'name', 'description', 'purpose', 'usageExamples', 'notes', 'isActive'] as const) {
      if (changes[k] !== undefined) data[k] = changes[k]
    }

    const updated = await db.$transaction(async (tx) => {
      const lt = await tx.letterType.update({ where: { id }, data })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'lettertype.update', entityType: 'letterType', entityId: id,
        correlationId: r.correlationId,
        metadata: {
          before: {
            code: existing.code, name: existing.name, description: existing.description,
            purpose: existing.purpose, usageExamples: existing.usageExamples, notes: existing.notes,
            isActive: existing.isActive,
          },
          after: changes,
          lettersUsing: existing._count.letters,
        },
      })
      return lt
    })
    return ok({ letterType: updated })
  })
}

const deleteSchema = z.object({ id: z.string().min(1) })

/**
 * Hapus jenis surat (master prompt lanjutan D.1/C.4):
 * - Fisik HANYA jika belum pernah dipakai surat/manapun (0 dependensi).
 * - Sudah dipakai histori → 409 HAS_HISTORY: gunakan nonaktifkan (arsip)
 *   agar referensi historis & snapshot nomor tetap sah.
 */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('lettertype.manage')
    if ('error' in r) return r.error

    const parsed = deleteSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter id wajib')
    const { id } = parsed.data

    const existing = await db.letterType.findUnique({
      where: { id },
      include: { _count: { select: { letters: true } } },
    })
    if (!existing) return fail(404, 'NOT_FOUND', 'Jenis surat tidak ditemukan')

    if (existing._count.letters > 0) {
      return fail(409, 'HAS_HISTORY',
        `Jenis surat sudah dipakai ${existing._count.letters} surat — tidak dihapus fisik. Nonaktifkan (arsipkan) agar surat lama tetap bisa ditelusuri.`)
    }

    await db.$transaction(async (tx) => {
      await tx.letterType.delete({ where: { id } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'lettertype.delete', entityType: 'letterType', entityId: id,
        correlationId: r.correlationId, metadata: { code: existing.code, name: existing.name },
      })
    })
    return ok({ deleted: true })
  })
}
