import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'

/** Ganti password sendiri — verifikasi password lama + konfirmasi (master prompt A.2). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requireUser()
    if ('error' in r) return r.error

    const parsed = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(10).max(128),
      confirmPassword: z.string().optional(), // validasi ganda; nilai tidak disimpan
    }).refine(d => !d.confirmPassword || d.confirmPassword === d.newPassword, {
      message: 'Konfirmasi password baru tidak cocok',
      path: ['confirmPassword'],
    }).safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })

    const user = await db.user.findUnique({ where: { id: r.user.id } })
    if (!user) return fail(404, 'NOT_FOUND', 'Pengguna tidak ditemukan')
    if (!await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)) {
      return fail(401, 'INVALID_CREDENTIALS', 'Password saat ini salah')
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return fail(400, 'SAME_PASSWORD', 'Password baru tidak boleh sama dengan password saat ini')
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
      })
      await writeAudit(tx, {
        actorId: user.id, action: 'user.password.change', entityType: 'user', entityId: user.id,
        metadata: {},
      })
    })
    return ok({ success: true })
  })
}
