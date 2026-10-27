import { NextRequest } from 'next/server'
import { ok, handle, guardMutation } from '@/lib/api-helpers'
import { destroySession } from '@/lib/session'

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    await destroySession()
    return ok({ success: true })
  })
}
