import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requireUser } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { resolveBackupCapabilities, assertBackupTargets } from '@/lib/rbac'
import { inspectBackupFile, planRestore, executeRestore, cleanupParsed, RestoreError, ParsedBackup } from '@/lib/backup/restore'
import { getUpload, dropUpload } from '@/lib/backup/registry'
import { createBackupFile, pruneSafetyBackups } from '@/lib/backup/build'
import { serverSafetyPassphrase } from '@/lib/backup/crypto'

const restoreSchema = z.object({
  uploadId: z.string().min(1),
  passphrase: z.string().optional(),
  targetType: z.enum(['FULL', 'SCOPED']),
  unitIds: z.array(z.string()).default([]),
  committeeIds: z.array(z.string()).default([]),
  confirm: z.literal('RESTORE'),
  password: z.string().min(1), // re-autentikasi (B.9 langkah 8)
})

// Cache parsed per uploadId (hasil validate) — hidup selama TTL registry.
const parsedCache = new Map<string, ParsedBackup>()

/**
 * Eksekusi restore (B.6–B.9):
 * 1) Verifikasi ulang SEMUA permission dari DB (bukan dari FE).
 * 2) Re-autentikasi password + konfirmasi kuat.
 * 3) Safety backup otomatis sebelum restore.
 * 4) Plan → execute (transaksi) → laporan.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requireUser()
    if ('error' in r) return r.error
    const caps = await resolveBackupCapabilities(r.user)

    const parsed = restoreSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter restore tidak valid', { issues: parsed.error.issues })
    const body = parsed.data

    // Re-autentikasi (B.9 langkah 8: konfirmasi kuat + autentikasi ulang)
    const me = await db.user.findUnique({ where: { id: r.user.id }, select: { passwordHash: true, isActive: true } })
    if (!me || !me.isActive) return fail(403, 'FORBIDDEN', 'Akun tidak aktif')
    const okPw = await bcrypt.compare(body.password, me.passwordHash).catch(() => false)
    if (!okPw) return fail(401, 'REAUTH', 'Password salah — restore dibatalkan')

    // Verifikasi target
    let targets: { type: 'FULL' | 'SCOPED'; unitIds: string[]; committeeIds: string[] }
    if (body.targetType === 'FULL') {
      if (!caps.fullRestore) return fail(403, 'FORBIDDEN', 'Full Restore hanya dapat dilakukan Super Admin')
      targets = { type: 'FULL', unitIds: [], committeeIds: [] }
    } else {
      targets = { type: 'SCOPED', unitIds: body.unitIds, committeeIds: body.committeeIds }
      const t = [
        ...body.unitIds.map(id => ({ type: 'UNIT' as const, id })),
        ...body.committeeIds.map(id => ({ type: 'COMMITTEE' as const, id })),
      ]
      if (t.length === 0) return fail(400, 'VALIDATION', 'Pilih minimal satu target scope restore')
      const err = assertBackupTargets(caps, t, 'restore')
      if (err) return fail(403, 'SCOPE', err)
    }

    // Ambil file upload (milik actor, belum TTL)
    const upload = getUpload(body.uploadId, r.user.id)
    if (!upload) return fail(404, 'NOT_FOUND', 'Unggahan tidak ditemukan atau kedaluwarsa — unggah ulang arsip')

    let parsedBackup = parsedCache.get(body.uploadId)
    if (!parsedBackup) {
      try {
        parsedBackup = await inspectBackupFile(upload.filePath, body.passphrase)
        parsedCache.set(body.uploadId, parsedBackup)
      } catch (e) {
        if (e instanceof RestoreError) return fail(422, 'BACKUP_INVALID', e.message)
        throw e
      }
    }

    // Manifest harus cocok dengan target
    if (targets.type === 'FULL' && parsedBackup.manifest.kind === 'SCOPED') {
      return fail(409, 'MISMATCH', 'Arsip ini backup per scope — gunakan restore SCOPED')
    }
    if (targets.type === 'SCOPED' && parsedBackup.manifest.kind !== 'SCOPED') {
      return fail(409, 'MISMATCH', 'Arsip ini backup FULL — hanya Super Admin dapat Full Restore')
    }

    // Safety backup otomatis (B.9 langkah 9)
    try {
      await createBackupFile({
        actor: { id: r.user.id, username: r.user.username, fullName: r.user.fullName },
        kind: 'SAFETY',
        safetyPassphrase: serverSafetyPassphrase(process.env.SESSION_SECRET!),
      })
      await pruneSafetyBackups(5)
    } catch {
      return fail(500, 'SAFETY_FAILED', 'Gagal membuat safety backup sebelum restore — restore dibatalkan demi keamanan')
    }

    // Plan (preview server-side final) lalu eksekusi
    const plan = await planRestore(parsedBackup, targets, r.user.id)
    try {
      const report = await executeRestore(parsedBackup, targets, { id: r.user.id, username: r.user.username })
      parsedCache.delete(body.uploadId)
      dropUpload(body.uploadId)
      return ok({ report, plan })
    } catch (e) {
      if (e instanceof RestoreError) return fail(422, 'RESTORE_FAILED', e.message)
      throw e
    }
  })
}

/** Preview tanpa eksekusi (opsional, dipakai FE untuk menyegarkan rencana). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const url = new URL(req.url)
    const uploadId = url.searchParams.get('uploadId')
    if (!uploadId) return fail(400, 'VALIDATION', 'Parameter uploadId wajib')
    const upload = getUpload(uploadId, r.user.id)
    if (!upload) return fail(404, 'NOT_FOUND', 'Unggahan tidak ditemukan')
    const parsedBackup = parsedCache.get(uploadId)
    if (!parsedBackup) return fail(409, 'NEEDS_REVALIDATE', 'Arsip perlu divalidasi ulang (POST /api/backup/validate)')
    const targetType = url.searchParams.get('targetType') === 'FULL' ? 'FULL' : 'SCOPED'
    const unitIds = url.searchParams.get('unitIds')?.split(',').filter(Boolean) ?? []
    const committeeIds = url.searchParams.get('committeeIds')?.split(',').filter(Boolean) ?? []
    const plan = await planRestore(parsedBackup, { type: targetType, unitIds, committeeIds }, r.user.id)
    return ok({ plan })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const uploadId = new URL(req.url).searchParams.get('uploadId')
    if (!uploadId) return fail(400, 'VALIDATION', 'Parameter uploadId wajib')
    parsedCache.delete(uploadId)
    const rec = getUpload(uploadId, r.user.id)
    if (rec) dropUpload(uploadId)
    return ok({ dropped: !!rec })
  })
}
