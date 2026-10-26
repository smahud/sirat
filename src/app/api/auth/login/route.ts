import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { createSession, loginRateLimit, recordLoginFailure, clearLoginFailures, clientIp } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { Role } from '@/lib/constants'

interface LoginBody { username?: string; password?: string }

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard

    const body = await readJson<LoginBody>(req)
    const username = (body?.username ?? '').trim()
    const password = body?.password ?? ''
    if (!username || !password) return fail(400, 'VALIDATION', 'Username dan password wajib diisi')

    const ip = await clientIp()
    const rlKey = `${ip}:${username}`
    const rl = loginRateLimit(rlKey)
    if (!rl.allowed) {
      return fail(429, 'RATE_LIMITED', `Terlalu banyak percobaan gagal. Coba lagi dalam ${rl.retryAfterSec} detik`)
    }

    const user = await db.user.findUnique({ where: { username } })
    const valid = user?.isActive === true && user.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false

    if (!valid || !user) {
      recordLoginFailure(rlKey)
      await writeAudit(db, {
        actorId: user?.id ?? null,
        action: 'auth.login',
        outcome: 'FAILURE',
        metadata: { username, reason: !user ? 'unknown-user' : user.isActive ? 'wrong-password' : 'inactive' },
      })
      return fail(401, 'INVALID_CREDENTIALS', 'Username atau password salah')
    }

    clearLoginFailures(rlKey)
    const sessionUser = {
      id: user.id, username: user.username, fullName: user.fullName, role: user.role as Role,
    }
    await createSession(sessionUser)
    await writeAudit(db, {
      actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id,
      metadata: { username: user.username },
    })
    return ok({ user: sessionUser })
  })
}
