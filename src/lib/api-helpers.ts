// Helper API: envelope error, guard auth/permission, origin check, parsing.
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, assertSameOrigin } from '@/lib/session'
import { hasPermission, resolveScope, ResolvedUser } from '@/lib/rbac'
import { Permission } from '@/lib/rbac'
import { writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'

export function ok<T>(data: T, init?: number): NextResponse {
  return NextResponse.json(data as object, { status: init ?? 200 })
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status })
}

export async function requireUser(): Promise<{ user: ResolvedUser } | { error: NextResponse }> {
  const user = await getSessionUser()
  if (!user) return { error: fail(401, 'UNAUTHENTICATED', 'Silakan login terlebih dahulu') }
  const scope = await resolveScope(user)
  return { user: { ...user, scope } }
}

export async function requirePermission(
  perm: Permission,
): Promise<{ user: ResolvedUser; correlationId: string } | { error: NextResponse }> {
  const r = await requireUser()
  if ('error' in r) return r
  if (!hasPermission(r.user, perm)) {
    await writeAudit(db, {
      actorId: r.user.id, action: `permission.denied:${perm}`,
      outcome: 'DENIED', entityType: 'permission', entityId: perm,
    })
    return { error: fail(403, 'FORBIDDEN', `Anda tidak memiliki izin ${perm}`) }
  }
  const correlationId = crypto.randomUUID()
  return { user: r.user, correlationId }
}

/** Guard untuk request mutasi (POST/PUT/PATCH/DELETE): cek same-origin (CSRF). */
export async function guardMutation(req: NextRequest): Promise<NextResponse | null> {
  const same = await assertSameOrigin()
  if (!same) return fail(403, 'CSRF', 'Origin tidak cocok')
  return null
}

export async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

/** Wrapper route handler dengan error envelope terpusat. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string; code?: string; clientVersion?: string }
    if (err?.name === 'ZodError') {
      return fail(400, 'VALIDATION', 'Validasi gagal', { issues: JSON.parse((e as Error).message) })
    }
    if (err?.code === 'P2002') {
      return fail(409, 'CONFLICT', 'Data sudah ada (constraint unik)')
    }
    if (err?.code === 'P2025') {
      return fail(404, 'NOT_FOUND', 'Data tidak ditemukan')
    }
    console.error('[SIRAT]', err)
    return fail(500, 'INTERNAL', 'Terjadi kesalahan internal')
  }
}
