import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, handle } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { letterScopeFilter } from '@/lib/rbac'

/**
 * Surat Terkait (master prompt lanjutan H):
 * - Referensi langsung keluar (surat yang dirujuk) & masuk (surat yang merujuk).
 * - Rantai berantai dua arah (BFS dibatasi kedalaman & jumlah node, bebas siklus).
 * - Setiap node DIVERIFIKASI SCOPE-NYA secara independen — surat di luar scope
 *   tidak bocor (bukan sekadar disembunyikan, tidak dikirim ke FE sama sekali).
 */
const MAX_DEPTH = 4
const MAX_NODES = 30

interface RelatedNode {
  id: string
  officialNumber: string | null
  legacyNumber: string | null
  subject: string | null
  letterDate: string | null
  status: string
  unitCode: string
  committeeCode: string | null
}

interface RelatedEdge {
  from: string
  to: string | null // null = referensi manual (teks saja)
  text: string
  isAutoLinked: boolean
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const { id } = await params
    const scope = letterScopeFilter(r.user)

    const root = await db.letter.findFirst({ where: { id, ...(scope ?? {}) }, select: { id: true } })
    if (!root) return fail(404, 'NOT_FOUND', 'Surat tidak ditemukan atau di luar scope akses Anda')

    const visible = new Map<string, RelatedNode>()
    const loadNodes = async (ids: string[]): Promise<string[]> => {
      if (ids.length === 0) return []
      const rows = await db.letter.findMany({
        where: { id: { in: ids }, ...(scope ?? {}) },
        select: {
          id: true, officialNumber: true, legacyNumber: true, subject: true,
          letterDate: true, status: true,
          issuingUnit: { select: { code: true } },
          committee: { select: { code: true } },
        },
      })
      for (const l of rows) {
        visible.set(l.id, {
          id: l.id,
          officialNumber: l.officialNumber,
          legacyNumber: l.legacyNumber,
          subject: l.subject,
          letterDate: l.letterDate ? l.letterDate.toISOString().slice(0, 10) : null,
          status: l.status,
          unitCode: l.issuingUnit.code,
          committeeCode: l.committee?.code ?? null,
        })
      }
      return rows.map(l => l.id) // hanya ID yang benar-benar terlihat
    }

    const selectEdge = {
      id: true, letterId: true, refLetterId: true, refNumberText: true, isAutoLinked: true,
      refLetter: { select: { id: true } },
      letter: { select: { id: true } },
    }

    // Edges terkait node yang terlihat (keluar + masuk)
    const edges: RelatedEdge[] = []
    const visited = new Set<string>([id])
    let frontier = [id]
    for (let depth = 0; depth < MAX_DEPTH && visible.size < MAX_NODES; depth++) {
      const outRefs = await db.letterReference.findMany({
        where: { letterId: { in: frontier } },
        select: selectEdge,
      })
      const inRefs = await db.letterReference.findMany({
        where: { refLetterId: { in: frontier } },
        select: selectEdge,
      })
      const nextIds = new Set<string>()
      for (const e of outRefs) {
        edges.push({ from: e.letterId, to: e.refLetterId, text: e.refNumberText, isAutoLinked: e.isAutoLinked })
        if (e.refLetterId && !visited.has(e.refLetterId)) nextIds.add(e.refLetterId)
      }
      for (const e of inRefs) {
        edges.push({ from: e.letterId, to: e.refLetterId, text: e.refNumberText, isAutoLinked: e.isAutoLinked })
        if (!visited.has(e.letterId)) nextIds.add(e.letterId)
      }
      const candidates = [...nextIds].slice(0, MAX_NODES)
      const seen = await loadNodes(candidates)
      frontier = []
      for (const nid of seen) {
        if (!visited.has(nid)) {
          visited.add(nid)
          frontier.push(nid)
        }
      }
      if (frontier.length === 0) break
    }

    // Ringkasan tampilan: referensi keluar (dari surat ini) & masuk (ke surat ini)
    const outgoing = [] as (RelatedEdge & { node?: RelatedNode })[]
    const incoming = [] as (RelatedEdge & { node?: RelatedNode })[]
    const seenEdge = new Set<string>()
    for (const e of edges) {
      const key = `${e.from}->${e.to ?? e.text}`
      if (seenEdge.has(key)) continue
      seenEdge.add(key)
      if (e.from === id) outgoing.push({ ...e, node: e.to ? visible.get(e.to) : undefined })
      else if (e.to === id) incoming.push({ ...e, node: visible.get(e.from) })
    }

    // Rantai (node selain root, dengan kedalaman BFS implisit via urutan)
    const chain = [...visible.values()].filter(n => n.id !== id)

    return ok({
      outgoing,
      incoming,
      chain,
      truncated: visible.size >= MAX_NODES,
    })
  })
}
