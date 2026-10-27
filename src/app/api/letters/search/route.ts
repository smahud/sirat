import { NextRequest } from 'next/server'
import { ok, handle } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { searchReferencableLetters } from '@/lib/references'

/**
 * Autocomplete referensi surat (master prompt lanjutan G.2):
 * - min 2 karakter; debounce di FE; limit hasil.
 * - Hanya surat bernomor final (ISSUED/CANCELLED) dalam scope user —
 *   otorisasi diverifikasi backend, bukan sekadar filter FE.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const url = new URL(req.url)
    const q = url.searchParams.get('q') ?? ''
    const limit = Number(url.searchParams.get('limit') ?? 10)
    const exclude = url.searchParams.get('excludeLetterId') ?? undefined
    const results = await searchReferencableLetters(r.user, q, limit, exclude)
    return ok({ results })
  })
}
