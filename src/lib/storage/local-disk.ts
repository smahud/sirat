// Storage lokal: object key deterministik, staging→rename atomik, traversal guard.
// Layout (Blueprint 16.3):
//   surat reguler  : {unitKey}/letters/{YYYY}/{MM}/{letterId}/{fileId}/{verId}/blob
//   surat panitia  : {unitKey}/committees/{committeeKey}/letters/{YYYY}/{MM}/...
// Tahun/bulan dari tanggal surat. Manifest.json di folder letter.
import 'server-only'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'

export const ARCHIVE_ROOT = process.env.SIRAT_ARCHIVE_ROOT || path.join(process.cwd(), 'data', 'archive')
export const STAGING_ROOT = process.env.SIRAT_STAGING_ROOT || path.join(process.cwd(), 'data', 'staging')

export function objectKeyFor(letter: {
  id: string
  issuingUnitId: string
  committee?: { storageKey: string } | null
  letterDate?: Date | null
}, fileId: string, versionId: string, unitStorageKey: string): string {
  const d = letter.letterDate ? new Date(letter.letterDate) : new Date()
  const yyyy = String(d.getUTCFullYear())
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const mid = letter.committee
    ? `${unitStorageKey}/committees/${letter.committee.storageKey}`
    : `${unitStorageKey}`
  return `${mid}/letters/${yyyy}/${mm}/${letter.id}/${fileId}/${versionId}/blob`
}

/** Guard traversal: resolved path wajib di dalam root. */
export function safeJoin(root: string, relKey: string): string {
  const resolvedRoot = path.resolve(root)
  const full = path.resolve(root, relKey)
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Path di luar root storage ditolak')
  }
  return full
}

export function letterFolderOf(objectKey: string): string {
  // .../{letterId}/{fileId}/{versionId}/blob → folder letter
  const parts = objectKey.split('/')
  return parts.slice(0, -3).join('/') // buang fileId/versionId/blob
}

export interface StreamResult {
  size: number
  sha256: string
  stagingPath: string
}

/** Stream body request ke file staging; hitung ukuran + sha256; tolak kelebihan batas. */
export async function streamToStaging(
  body: ReadableStream<Uint8Array>, stagingName: string, maxBytes: number,
): Promise<StreamResult> {
  await fs.mkdir(STAGING_ROOT, { recursive: true })
  const stagingPath = safeJoin(STAGING_ROOT, `${stagingName}.part`)
  const hash = createHash('sha256')
  let size = 0
  const out = createWriteStream(stagingPath)
  try {
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        size += value.byteLength
        if (size > maxBytes) throw new StorageError(`Ukuran berkas melebihi batas ${Math.floor(maxBytes / 1024 / 1024)} MiB`)
        hash.update(value)
        if (!out.write(value)) {
          await new Promise<void>((res) => out.once('drain', () => res()))
        }
      }
    }
    await new Promise<void>((res, rej) => out.end((e: Error | null) => (e ? rej(e) : res())))
  } catch (e) {
    out.destroy()
    await fs.rm(stagingPath, { force: true })
    throw e
  }
  return { size, sha256: hash.digest('hex'), stagingPath }
}

/** Rename atomik staging → object key final; mkdir rekursif. */
export async function promoteStaging(stagingPath: string, objectKey: string): Promise<void> {
  const dest = safeJoin(ARCHIVE_ROOT, objectKey)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.rename(stagingPath, dest)
}

export function fileStream(objectKey: string): ReadableStream<Uint8Array> {
  const p = safeJoin(ARCHIVE_ROOT, objectKey)
  const nodeStream = createReadStream(p)
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
}

export async function statObject(objectKey: string): Promise<{ exists: boolean; size: number }> {
  try {
    const p = safeJoin(ARCHIVE_ROOT, objectKey)
    const s = await fs.stat(p)
    return { exists: s.isFile(), size: s.size }
  } catch {
    return { exists: false, size: 0 }
  }
}

export async function sha256File(objectKey: string): Promise<string> {
  const p = safeJoin(ARCHIVE_ROOT, objectKey)
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const st = createReadStream(p)
    st.on('data', (d) => hash.update(d))
    st.on('end', () => resolve(hash.digest('hex')))
    st.on('error', reject)
  })
}

/** Uji koneksi storage (FR-018): write→read→rename→delete di dalam root. */
export async function testStorage(root: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const probe = safeJoin(root, `.sirat-probe-${Date.now()}`)
    await fs.mkdir(path.dirname(probe), { recursive: true })
    await fs.writeFile(probe, 'sirat-storage-test')
    const readBack = await fs.readFile(probe, 'utf8')
    if (readBack !== 'sirat-storage-test') return { ok: false, detail: 'Gagal membaca ulang isi berkas uji' }
    const renamed = `${probe}.ok`
    await fs.rename(probe, renamed)
    await fs.rm(renamed, { force: true })
    return { ok: true, detail: 'Tulis/baca/rename/hapus berhasil' }
  } catch (e) {
    return { ok: false, detail: `Gagal: ${(e as Error).message}` }
  }
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

/** Tulis manifest dengan temp+rename (rebuildable dari DB; kegagalan tidak fatal). */
export async function writeManifest(letterFolderKey: string, manifest: unknown): Promise<void> {
  const dir = safeJoin(ARCHIVE_ROOT, letterFolderKey)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.manifest.tmp-${Date.now()}`)
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2))
  await fs.rename(tmp, path.join(dir, 'manifest.json'))
}
