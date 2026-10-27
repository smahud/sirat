import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handle } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'

/** FR-021: audit trail — hanya terbaca (append-only), terfilter. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requirePermission('audit.view')
    if ('error' in r) return r.error

    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const action = url.searchParams.get('action') ?? ''
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
    const PAGE_SIZE = 30

    const where: Record<string, unknown> = {}
    if (q) where.OR = [
      { action: { contains: q } },
      { entityType: { contains: q } },
      { entityId: { contains: q } },
    ]
    if (action) where.action = { contains: action }

    const [total, events] = await Promise.all([
      db.auditEvent.count({ where }),
      db.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ])

    // Map actorId → nama pengguna (tanpa membocorkan data lain)
    const actorIds = [...new Set(events.map(e => e.actorId).filter((x): x is string => !!x))]
    const actors = actorIds.length > 0
      ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true, fullName: true } })
      : []
    const actorMap = Object.fromEntries(actors.map(a => [a.id, a]))

    return ok({
      events: events.map(e => ({
        ...e,
        actor: e.actorId ? (actorMap[e.actorId] ?? null) : null,
      })),
      total, page, pageSize: PAGE_SIZE,
    })
  })
}
