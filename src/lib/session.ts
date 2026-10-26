// Session: JWT (jose) di cookie httpOnly + rate limit login + CSRF origin check.
import { SignJWT, jwtVerify } from 'jose'
import { cookies, headers } from 'next/headers'
import { Role } from '@/lib/constants'
import { SessionUser } from '@/lib/rbac'

const COOKIE_NAME = 'sirat_session'
const SESSION_HOURS = 8

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    // Development fallback — produksi wajib SESSION_SECRET di .env
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET wajib diisi (min 32 karakter) pada produksi')
    }
    return new TextEncoder().encode('dev-only-insecure-secret-0000000000000')
  }
  return new TextEncoder().encode(s)
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ username: user.username, fullName: user.fullName, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret())
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: await isSecureRequest(),
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  })
}

async function isSecureRequest(): Promise<boolean> {
  const h = await headers()
  return (h.get('x-forwarded-proto') || '').toLowerCase() === 'https'
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    if (!payload.sub || typeof payload.role !== 'string') return null
    return {
      id: payload.sub,
      username: String(payload.username ?? ''),
      fullName: String(payload.fullName ?? ''),
      role: payload.role as Role,
    }
  } catch {
    return null
  }
}

/** CSRF ringan: mutasi wajib same-origin (dikombinasi SameSite=Strict). */
export async function assertSameOrigin(): Promise<boolean> {
  const h = await headers()
  const origin = h.get('origin')
  if (!origin) return true // non-browser client (curl) — auth tetap diverifikasi
  const host = h.get('host')
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

// ---- Rate limit login (NFR-002) ----
interface Attempt { count: number; windowStart: number }
const attempts = new Map<string, Attempt>()
const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

export function loginRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  const a = attempts.get(key)
  if (!a || now - a.windowStart > WINDOW_MS) return { allowed: true, retryAfterSec: 0 }
  if (a.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((a.windowStart + WINDOW_MS - now) / 1000) }
  }
  return { allowed: true, retryAfterSec: 0 }
}

export function recordLoginFailure(key: string): void {
  const now = Date.now()
  const a = attempts.get(key)
  if (!a || now - a.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now })
  } else {
    a.count++
  }
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key)
}

export async function clientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local'
}
