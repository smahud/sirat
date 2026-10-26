'use client'
// Client helper — fetch dengan error handling konsisten (tanpa absolute URL).

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) && !(options.body instanceof ReadableStream)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers ?? {}),
    },
  })
  if (res.status === 204) return undefined as T
  let data: unknown = null
  try { data = await res.json() } catch { /* body kosong */ }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } })?.error
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `HTTP ${res.status}`, data)
  }
  return data as T
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  return api<T>(path)
}

export async function apiPost<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
}

export async function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  return api<T>(path, { method: 'DELETE' })
}

/** Unduh berkas via API ter-autentikasi (cookie sesi) dan simpan sebagai file. */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json() as { error?: { message?: string } }
      if (data.error?.message) msg = data.error.message
    } catch { /* body bukan JSON */ }
    throw new ApiError(res.status, 'DOWNLOAD', msg)
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const m = cd.match(/filename="([^"]+)"/)
  const name = m?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5_000)
  }
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
