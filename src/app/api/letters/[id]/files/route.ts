import { NextRequest } from 'next/server'
import * as fsp from 'fs/promises'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { letterScopeFilter } from '@/lib/rbac'
import { MAX_FILE_BYTES } from '@/lib/constants'
import { objectKeyFor, streamToStaging, promoteStaging, writeManifest, letterFolderOf, safeJoin, ARCHIVE_ROOT } from '@/lib/storage/local-disk'
import { sniffFile, extensionMatchesFamily, sanitizeOriginalName } from '@/lib/storage/magic'
import path from 'path'

/**
 * POST /api/letters/:id/files — upload streaming (staging→validasi/hash→atomic rename→READY).
 * Header: x-file-name (wajib), x-file-label (original|attachment, default original),
 *         x-replace-file-id (opsional: versi baru dari ArchiveFile tertentu).
 * Blueprint 16.3: stream ke staging pada filesystem sama, hitung SHA-256, validasi allowlist
 * signature, object key unik, atomic rename, transaksi READY + audit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('archive.upload')
    if ('error' in r) return r.error

    const rawName = req.headers.get('x-file-name') || ''
    const label = req.headers.get('x-file-label') === 'attachment' ? 'attachment' : 'original'
    const replaceFileId = req.headers.get('x-replace-file-id') || undefined

    const originalName = sanitizeOriginalName(decodeURIComponent(rawName))
    if (!originalName) return fail(400, 'VALIDATION', 'Header x-file-name wajib diisi')

    if (!req.body) return fail(400, 'VALIDATION', 'Body kosong')
    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > MAX_FILE_BYTES) {
      return fail(413, 'TOO_LARGE', `Ukuran berkas melebihi batas ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MiB`)
    }

    const scope = letterScopeFilter(r.user)
    const letter = await db.letter.findFirst({
      where: { id, ...(scope ?? {}) },
      include: {
        issuingUnit: { select: { id: true, code: true, name: true, storageKey: true } },
        committee: true,
      },
    })
    if (!letter) return fail(404, 'NOT_FOUND', 'Surat tidak ditemukan atau di luar scope akses Anda')
    if (letter.status === 'CANCELLED') return fail(409, 'CANCELLED', 'Surat batal tidak dapat menerima arsip baru')

    const replaceFile = replaceFileId
      ? await db.archiveFile.findFirst({ where: { id: replaceFileId, letterId: id, state: 'ACTIVE' } })
      : null
    if (replaceFileId && !replaceFile) {
      return fail(404, 'NOT_FOUND', 'Berkas yang akan diganti tidak ditemukan pada surat ini')
    }

    // 1) Stream ke staging + hash
    const stagingName = `${Date.now().toString(36)}-${crypto.randomUUID()}`
    const staged = await streamToStaging(req.body, stagingName, MAX_FILE_BYTES)
    if (staged.size === 0) {
      return fail(400, 'VALIDATION', 'Berkas kosong ditolak')
    }

    try {
      // 2) Validasi signature MIME + ekstensi
      const sniff = await sniffFile(staged.stagingPath)
      if (!sniff.ok) {
        return fail(415, 'UNSUPPORTED_TYPE',
          `Tipe berkas tidak dikenali/diizinkan (terdeteksi: ${sniff.family}). Allowlist: PDF/JPEG/PNG/DOCX/XLSX/TXT`)
      }
      if (!extensionMatchesFamily(originalName, sniff.family)) {
        return fail(415, 'EXTENSION_MISMATCH', `Ekstensi berkas tidak cocok dengan isi terdeteksi (${sniff.family})`)
      }

      // 3) Buat metadata + object key
      const existingFile = replaceFile
      let versionNo = 1
      if (replaceFile) {
        const last = await db.archiveVersion.findFirst({
          where: { archiveFileId: replaceFile.id }, orderBy: { versionNo: 'desc' },
        })
        versionNo = (last?.versionNo ?? 0) + 1
      }

      const version = await db.$transaction(async (tx) => {
        const archiveFileId = existingFile ? existingFile.id : (await tx.archiveFile.create({ data: { letterId: id, label } })).id
        const versionId = crypto.randomUUID() // id di-generate dulu agar objectKey final bisa dihitung sebelum insert
        const objectKey = objectKeyFor(letter, archiveFileId, versionId, letter.issuingUnit.storageKey)
        const v = await tx.archiveVersion.create({
          data: {
            id: versionId,
            archiveFileId: archiveFileId,
            versionNo,
            state: 'PENDING',
            objectKey,
            originalName,
            sizeBytes: staged.size,
            mimeType: sniff.mime,
            sha256: staged.sha256,
            uploaderId: r.user.id,
            isCurrent: true,
          },
        })
        return { version: v, objectKey, archiveFileId }
      })

      // 4) Atomic rename staging → final
      await promoteStaging(staged.stagingPath, version.objectKey)

      // 5) READY + audit (transaksi)
      await db.$transaction(async (tx) => {
        await tx.archiveVersion.update({ where: { id: version.version.id }, data: { state: 'READY' } })
        if (existingFile) {
          await tx.archiveVersion.updateMany({
            where: { archiveFileId: existingFile.id, id: { not: version.version.id } },
            data: { isCurrent: false },
          })
        }
        await writeAudit(tx, {
          actorId: r.user.id,
          action: replaceFile ? 'archive.version.create' : 'archive.upload',
          entityType: 'archiveVersion',
          entityId: version.version.id,
          correlationId: r.correlationId,
          metadata: {
            letterId: id, archiveFileId: version.archiveFileId, versionNo,
            originalName, sizeBytes: staged.size, mimeType: sniff.mime, sha256: staged.sha256,
          },
        })
      })

      // 6) Manifest (best-effort, rebuildable dari DB — kegagalan tidak fatal)
      try {
        const files = await db.archiveFile.findMany({
          where: { letterId: id },
          include: { versions: true },
        })
        await writeManifest(letterFolderOf(version.objectKey), {
          letterId: id,
          officialNumber: letter.officialNumber,
          unit: { code: letter.issuingUnit.code, name: letter.issuingUnit.name },
          committee: letter.committee ? { code: letter.committee.code, name: letter.committee.name } : null,
          files: files.map(f => ({
            archiveFileId: f.id, label: f.label, state: f.state,
            versions: f.versions.map(v => ({
              versionId: v.id, versionNo: v.versionNo, state: v.state, isCurrent: v.isCurrent,
              objectKey: v.objectKey, originalName: v.originalName, sizeBytes: v.sizeBytes,
              mimeType: v.mimeType, sha256: v.sha256, createdAt: v.createdAt,
            })),
          })),
          generatedAt: new Date().toISOString(),
        })
      } catch (e) {
        console.warn('[SIRAT] manifest write gagal (non-fatal):', (e as Error).message)
      }

      return ok({ archiveFileId: version.archiveFileId, version: { ...version.version, objectKey: version.objectKey, state: 'READY' } }, 201)

    } catch (e) {
      // Bersihkan staging bila gagal — jangan tinggalkan sampah
      await fsp.rm(staged.stagingPath, { force: true })
      throw e
    }
  })
}
