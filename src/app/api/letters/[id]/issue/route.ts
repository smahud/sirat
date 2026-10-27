import { NextRequest } from 'next/server'
import { ok, fail, handle, guardMutation } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { issueLetter, ServiceError } from '@/lib/letter-service'

/** POST /api/letters/:id/issue — header Idempotency-Key wajib (blueprint 16.1). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('letter.issue')
    if ('error' in r) return r.error

    const { id } = await params
    const idempotencyKey = req.headers.get('idempotency-key')
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return fail(400, 'VALIDATION', 'Header Idempotency-Key wajib (min 8 karakter)')
    }

    try {
      const result = await issueLetter({
        letterId: id,
        actor: r.user,
        idempotencyKey,
        correlationId: r.correlationId,
      })
      return ok(result)
    } catch (e) {
      if (e instanceof ServiceError) return fail(e.status, e.code, e.message)
      throw e
    }
  })
}
