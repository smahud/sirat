// Pembuat arsip backup (B.5): ZIP + manifest + checksum; full backup WAJIB
// terenkripsi (berisi passwordHash); scoped backup boleh polos (tanpa hash).
import 'server-only'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { ZipArchive } from 'archiver'
import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { statObject, safeJoin, ARCHIVE_ROOT } from '@/lib/storage/local-disk'
import { collectBackupData, schemaFingerprint } from './collect'
import { backupFileName, BACKUP_FORMAT, BACKUP_VERSION, BackupManifest } from './format'
import { encryptBuffer } from './crypto'

export const BACKUP_ROOT = process.env.SIRAT_BACKUP_ROOT || path.join(process.cwd(), 'data', 'backups')
export const EXPORT_DIR = path.join(BACKUP_ROOT, 'exports')
export const SAFETY_DIR = path.join(BACKUP_ROOT, 'safety')
const TMP_DIR = path.join(BACKUP_ROOT, 'tmp')

export interface CreateBackupInput {
  actor: { id: string; username: string; fullName: string }
  kind: 'FULL' | 'SCOPED' | 'SAFETY'
  unitIds?: string[]
  committeeIds?: string[]
  passphrase?: string // wajib utk FULL/SAFETY (berisi passwordHash)
  safetyPassphrase?: string // internal: kunci server utk safety backup
}

export interface CreateBackupResult {
  fileName: string
  filePath: string
  sizeBytes: number
  sha256: string
  manifest: BackupManifest
  encrypted: boolean
}

async function bufferSha256(buf: Buffer): Promise<string> {
  return createHash('sha256').update(buf).digest('hex')
}

async function fileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const st = createReadStream(filePath)
    st.on('data', d => h.update(d))
    st.on('end', () => resolve(h.digest('hex')))
    st.on('error', reject)
  })
}

/**
 * Bangun arsip backup lengkap (data + blob + manifest) dan tulis ke disk.
 * Mengembalikan path file final — pemanggil bertanggung jawab mengirimkan /
 * membersihkannya (download token TTL sweep).
 */
export async function createBackupFile(input: CreateBackupInput): Promise<CreateBackupResult> {
  const unitIds = input.unitIds ?? []
  const committeeIds = input.committeeIds ?? []
  const collected = await collectBackupData(input.kind, unitIds, committeeIds)

  const encrypted = input.kind === 'FULL' || input.kind === 'SAFETY' ? true : !!input.passphrase
  if ((input.kind === 'FULL' || input.kind === 'SAFETY') && !input.passphrase && !input.safetyPassphrase) {
    throw new Error('Full/safety backup wajib terenkripsi — passphrase diperlukan')
  }

  await fs.mkdir(TMP_DIR, { recursive: true })
  if (input.kind === 'SAFETY') await fs.mkdir(SAFETY_DIR, { recursive: true })
  else await fs.mkdir(EXPORT_DIR, { recursive: true })

  const tmpZip = path.join(TMP_DIR, `build-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
  const output = createWriteStream(tmpZip)
  const archive = new ZipArchive({ zlib: { level: 6 } })
  archive.pipe(output)

  const entries: BackupManifest['entries'] = []

  // meta/app.json
  const meta = Buffer.from(JSON.stringify({
    app: 'SIRAT', appVersion: BACKUP_VERSION, generatedAt: new Date().toISOString(),
    node: process.version, engine: 'prisma-client-js',
  }, null, 2))
  archive.append(meta, { name: 'meta/app.json' })
  entries.push({ name: 'meta/app.json', sha256: await bufferSha256(meta), size: meta.length })

  // data/*.json (per tabel)
  for (const [table, rows] of Object.entries(collected.tables)) {
    const buf = Buffer.from(JSON.stringify(rows))
    const name = `data/${table}.json`
    archive.append(buf, { name })
    entries.push({ name, sha256: await bufferSha256(buf), size: buf.length })
  }

  // files/<objectKey> — blob arsip versi
  const filesMissing: string[] = []
  for (const objectKey of collected.fileObjectKeys) {
    const st = await statObject(objectKey)
    if (!st.exists) {
      filesMissing.push(objectKey)
      continue
    }
    const abs = safeJoin(ARCHIVE_ROOT, objectKey)
    const buf = await fs.readFile(abs)
    archive.append(buf, { name: `files/${objectKey}` })
    entries.push({ name: `files/${objectKey}`, sha256: await bufferSha256(buf), size: buf.length })
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind: input.kind,
    createdAt: new Date().toISOString(),
    createdBy: input.actor,
    appVersion: BACKUP_VERSION,
    schemaFingerprint: schemaFingerprint(),
    scope: { unitIds, committeeIds },
    scopeLabels: collected.scopeLabels,
    counts: collected.counts,
    entries,
    encrypted,
    includesPasswordHash: collected.includesPasswordHash,
    filesMissing,
    notes: input.kind === 'SCOPED'
      ? 'Backup per scope: data global bersama hanya sebagai snapshot referensi (tanpa passwordHash). Referensi MASUK dari surat luar scope tidak termasuk.'
      : undefined,
  }
  archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), { name: 'manifest.json' })

  await archive.finalize()
  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
  })

  // Enkripsi (full/safety, atau scoped dengan passphrase)
  let finalPath: string
  const zipStat = await fs.stat(tmpZip)
  if (encrypted) {
    const passphrase = input.safetyPassphrase ?? input.passphrase!
    const zipBuf = await fs.readFile(tmpZip)
    const enc = encryptBuffer(zipBuf, passphrase)
    await fs.rm(tmpZip, { force: true })
    const fname = backupFileName(input.kind, collected.scopeLabels, new Date(), true)
    finalPath = path.join(input.kind === 'SAFETY' ? SAFETY_DIR : EXPORT_DIR, fname)
    await fs.writeFile(finalPath, enc)
  } else {
    const fname = backupFileName(input.kind, collected.scopeLabels, new Date(), false)
    finalPath = path.join(EXPORT_DIR, fname)
    await fs.rename(tmpZip, finalPath)
  }

  const sizeBytes = (await fs.stat(finalPath)).size
  const sha256 = await fileSha256(finalPath)

  // BackupEvent + audit (B.5: logging tindakan backup)
  await db.backupEvent.create({
    data: {
      kind: input.kind,
      action: 'EXPORT',
      actorId: input.actor.id,
      fileName: path.basename(finalPath),
      sizeBytes,
      sha256,
      status: 'COMPLETED',
      scopeJson: JSON.stringify({ unitIds, committeeIds, labels: collected.scopeLabels }),
      metadata: JSON.stringify({ counts: collected.counts, encrypted, filesMissing: filesMissing.length }),
      completedAt: new Date(),
    },
  })
  await writeAudit(db, {
    actorId: input.actor.id,
    action: `backup.${input.kind.toLowerCase()}.create`,
    entityType: 'backup',
    entityId: path.basename(finalPath),
    metadata: { unitIds, committeeIds, encrypted, sizeBytes, counts: collected.counts },
  })

  return { fileName: path.basename(finalPath), filePath: finalPath, sizeBytes, sha256, manifest, encrypted }
}

/** Prune safety backup lama — simpan maksimal `keep` terbaru. */
export async function pruneSafetyBackups(keep = 5): Promise<void> {
  try {
    const files = await fs.readdir(SAFETY_DIR)
    const sorted = files.filter(f => f.endsWith('.zip.enc')).sort().reverse()
    for (const f of sorted.slice(keep)) {
      await fs.rm(path.join(SAFETY_DIR, f), { force: true })
    }
  } catch {
    /* direktori belum ada — abaikan */
  }
}
