import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { ok, fail, handle, guardMutation } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { db } from '@/lib/db'
import { resolveBackupCapabilities, assertBackupTargets } from '@/lib/rbac'
import { inspectBackupFile, RestoreError } from '@/lib/backup/restore'
import { checkSchemaFingerprint } from '@/lib/backup/format'
import { schemaFingerprint } from '@/lib/backup/collect'
import { registerUpload, dropUpload } from '@/lib/backup/registry'

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024 // 512 MiB

/**
 * Unggah + validasi arsip backup (B.8/B.9 langkah 4-7):
 * - Simpan ke staging (batas ukuran).
 * - Baca manifest (BUKAN nama file / payload FE) → tipe, scope, versi, integritas.
 * - Cek kompatibilitas skema + permission user terhadap scope backup.
 * - Kembalikan preview rencana restore. Belum ada data yang disentuh.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requireUser()
    if ('error' in r) return r.error
    const caps = await resolveBackupCapabilities(r.user)

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    const passphrase = (form?.get('passphrase') as string | null) || undefined
    if (!(file instanceof File)) return fail(400, 'VALIDATION', 'Berkas backup (ZIP) wajib diunggah')
    if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'TOO_LARGE', 'Berkas melebihi batas 512 MiB')

    const buf = Buffer.from(await file.arrayBuffer())
    const sha256 = createHash('sha256').update(buf).digest('hex')

    // Simpan ke direktori staging khusus restore (mengikuti SIRAT_STAGING_ROOT —
    // systemd ProtectSystem membatasi tulis ke path yang diizinkan)
    const stagingBase = process.env.SIRAT_STAGING_ROOT || path.join(process.cwd(), 'data', 'staging')
    const stagingDir = path.join(stagingBase, 'restore-uploads')
    await fs.mkdir(stagingDir, { recursive: true })
    const filePath = path.join(stagingDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
    await fs.writeFile(filePath, buf)

    let parsed
    try {
      parsed = await inspectBackupFile(filePath, passphrase)
    } catch (e) {
      await fs.rm(filePath, { force: true })
      if (e instanceof RestoreError) {
        return fail(422, 'BACKUP_INVALID', e.message)
      }
      throw e
    }
    const { manifest } = parsed

    // Kompatibilitas skema
    const fp = checkSchemaFingerprint(manifest, schemaFingerprint())
    if (!fp.ok) {
      await fs.rm(filePath, { force: true })
      return fail(409, 'SCHEMA_INCOMPATIBLE', fp.reason)
    }

    // Permission terhadap tipe backup:
    // - FULL/SAFETY → hanya fullRestore (Super Admin)
    // - SCOPED → target yang diizinkan BackupGrant user (assertBackupTargets)
    let allowedTargets: { type: 'FULL' | 'SCOPED'; unitIds: string[]; committeeIds: string[] }
    if (manifest.kind === 'FULL' || manifest.kind === 'SAFETY') {
      if (!caps.fullRestore) {
        await fs.rm(filePath, { force: true })
        return fail(403, 'FORBIDDEN', 'Full Restore hanya dapat dilakukan Super Admin')
      }
      allowedTargets = { type: 'FULL', unitIds: [], committeeIds: [] }
    } else {
      allowedTargets = {
        type: 'SCOPED',
        unitIds: manifest.scope.unitIds.filter(id => caps.scopes.some(s => s.type === 'UNIT' && s.id === id && s.canRestore)),
        committeeIds: manifest.scope.committeeIds.filter(id => caps.scopes.some(s => s.type === 'COMMITTEE' && s.id === id && s.canRestore)),
      }
      if (allowedTargets.unitIds.length === 0 && allowedTargets.committeeIds.length === 0) {
        await fs.rm(filePath, { force: true })
        return fail(403, 'SCOPE', 'Anda tidak memiliki izin backup.restore untuk scope manapun di dalam arsip ini')
      }
      // Verifikasi ulang via helper tunggal (konsistensi)
      const err = assertBackupTargets(caps, [
        ...allowedTargets.unitIds.map(id => ({ type: 'UNIT' as const, id })),
        ...allowedTargets.committeeIds.map(id => ({ type: 'COMMITTEE' as const, id })),
      ], 'restore')
      if (err) {
        await fs.rm(filePath, { force: true })
        return fail(403, 'SCOPE', err)
      }
    }

    const upload = registerUpload({
      filePath,
      originalName: file.name,
      uploadedById: r.user.id,
      sha256,
    })

    await writeAudit(db, {
      actorId: r.user.id, action: 'backup.validate', entityType: 'backup',
      entityId: manifest.createdAt,
      metadata: { kind: manifest.kind, scope: manifest.scope, uploadId: upload.id },
    })

    return ok({
      uploadId: upload.id,
      originalName: file.name,
      manifest: {
        kind: manifest.kind,
        createdAt: manifest.createdAt,
        createdBy: manifest.createdBy.fullName,
        appVersion: manifest.appVersion,
        scopeLabels: manifest.scopeLabels,
        counts: manifest.counts,
        encrypted: manifest.encrypted,
        includesPasswordHash: manifest.includesPasswordHash,
        filesMissing: manifest.filesMissing.length,
      },
      allowedTargets,
      warnings: parsed.warnings,
    })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const uploadId = new URL(req.url).searchParams.get('uploadId')
    if (!uploadId) return fail(400, 'VALIDATION', 'Parameter uploadId wajib')
    const { getUpload } = await import('@/lib/backup/registry')
    const rec = getUpload(uploadId, r.user.id)
    if (rec) dropUpload(uploadId)
    return ok({ dropped: !!rec })
  })
}
