import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { resolveBackupCapabilities, assertBackupTargets } from '@/lib/rbac'
import { createBackupFile } from '@/lib/backup/build'
import { registerDownload } from '@/lib/backup/registry'

const createSchema = z.object({
  type: z.enum(['FULL', 'SCOPED']),
  unitIds: z.array(z.string()).default([]),
  committeeIds: z.array(z.string()).default([]),
  passphrase: z.string().min(8).max(256).optional(),
})

/**
 * Buat backup (B.2/B.5):
 * - FULL: hanya otoritas global (backup.export). Berisi passwordHash → WAJIB passphrase.
 * - SCOPED: target divalidasi terhadap BackupGrant user (deny by default);
 *   passphrase opsional (arsip tidak berisi hash).
 * File dibuat di server; unduhan via token satu kali (download endpoint).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requireUser()
    if ('error' in r) return r.error
    const caps = await resolveBackupCapabilities(r.user)

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter backup tidak valid', { issues: parsed.error.issues })
    const body = parsed.data

    if (body.type === 'FULL') {
      if (!caps.fullExport) {
        return fail(403, 'FORBIDDEN', 'Full System Backup hanya untuk otoritas global (Super Admin / Admin Organisasi)')
      }
      if (!body.passphrase) {
        return fail(400, 'VALIDATION', 'Full backup memuat data sensitif (hash password) — passphrase enkripsi wajib diisi (min 8 karakter)')
      }
    } else {
      let targets = [
        ...body.unitIds.map(id => ({ type: 'UNIT' as const, id })),
        ...body.committeeIds.map(id => ({ type: 'COMMITTEE' as const, id })),
      ]
      // B.2: satu-satunya scope → target otomatis terkunci (tidak perlu dikirim FE)
      if (targets.length === 0) {
        const single = caps.scopes.filter(s => s.canExport)
        if (single.length === 1) {
          targets = [{ type: single[0].type, id: single[0].id }]
          body.unitIds = single[0].type === 'UNIT' ? [single[0].id] : []
          body.committeeIds = single[0].type === 'COMMITTEE' ? [single[0].id] : []
        }
      }
      if (targets.length === 0) return fail(400, 'VALIDATION', 'Pilih minimal satu unit/kepanitiaan untuk backup per scope')
      if (caps.fullExport) {
        // Otoritas global boleh scoped backup scope mana pun — cukup pastikan targetnya ada
        for (const t of targets) {
          const exists = t.type === 'UNIT'
            ? await db.unit.findUnique({ where: { id: t.id }, select: { id: true } })
            : await db.committee.findUnique({ where: { id: t.id }, select: { id: true } })
          if (!exists) return fail(404, 'NOT_FOUND', `Scope ${t.type} tidak ditemukan`)
        }
      } else {
        const err = assertBackupTargets(caps, targets, 'export')
        if (err) return fail(403, 'SCOPE', err)
      }
    }

    const result = await createBackupFile({
      actor: { id: r.user.id, username: r.user.username, fullName: r.user.fullName },
      kind: body.type,
      unitIds: body.unitIds,
      committeeIds: body.committeeIds,
      passphrase: body.passphrase,
    })

    const dl = registerDownload({
      filePath: result.filePath,
      fileName: result.fileName,
      ownerId: r.user.id,
    })
    return ok({
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      encrypted: result.encrypted,
      counts: result.manifest.counts,
      downloadToken: dl.token,
    }, 201)
  })
}
