import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { createSession } from '@/lib/session'
import { Role } from '@/lib/constants'

/**
 * PATCH /api/users/me/profile — edit profil MANDIRI (master prompt A.3):
 * hanya nama lengkap + email. Username (identitas login) dan role TIDAK bisa
 * diubah dari sini. Sesi di-refresh agar nama di JWT/UI langsung diperbarui.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requireUser()
    if ('error' in r) return r.error

    const parsed = z.object({
      fullName: z.string().trim().min(1).max(120),
      email: z.string().trim().email().optional().nullable(),
    }).safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data profil tidak valid', { issues: parsed.error.issues })
    const { fullName, email } = parsed.data

    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: r.user.id },
        data: { fullName, email: email ?? null },
        select: { id: true, username: true, fullName: true, email: true, role: true },
      })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'user.profile.update', entityType: 'user', entityId: r.user.id,
        metadata: { before: { fullName: r.user.fullName }, after: { fullName } },
      })
      return u
    })

    // Refresh JWT (payload membawa fullName untuk tampilan)
    await createSession({ ...user, role: user.role as Role })

    return ok({ user })
  })
}
