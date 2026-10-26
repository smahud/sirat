// Restore backup (B.6–B.9): validasi menyeluruh, preview, eksekusi terkendali.
// Prinsip: jangan percaya nama file / payload FE; manifest adalah sumber kebenaran.
// Scoped restore = merge-amd: data yang ada DIPERTAHANKAN (tidak pernah ditimpa),
// data hilang ditambahkan, konflik nomor/ID ditolak dengan laporan, counter tak turun.
import 'server-only'
import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import yauzl from 'yauzl'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { writeAudit } from '@/lib/audit'
import { safeJoin, ARCHIVE_ROOT } from '@/lib/storage/local-disk'
import { decryptBuffer, isEncryptedContainer } from './crypto'
import { checkSchemaFingerprint, checkZipSafety, validateManifest, BackupManifest, ZIP_LIMITS } from './format'
import { schemaFingerprint } from './collect'

export class RestoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreError'
  }
}

export interface ParsedBackup {
  manifest: BackupManifest
  tables: Record<string, Record<string, unknown>[]>
  files: Map<string, string> // objectKey → path staging
  stagingDir: string
  warnings: string[]
}

export interface RestorePlan {
  kind: 'FULL' | 'SCOPED'
  backupCreatedAt: string
  createdBy: string
  scopeLabels: string[]
  willCreate: Record<string, number>
  keptExisting: Record<string, number>
  skippedOutOfTarget: number
  conflicts: { table: string; id: string; reason: string }[]
  warnings: string[]
  actorStillExists: boolean
}

const DATA_TABLES = [
  'AppIdentity', 'User', 'Unit', 'Committee', 'AccessAssignment', 'BackupGrant',
  'LetterType', 'NumberingProfile', 'NumberingProfileVersion', 'CounterNamespace',
  'Counter', 'Letter', 'NumberRegistry', 'LetterReference', 'ArchiveFile',
  'ArchiveVersion', 'AuditEvent', 'StorageBackend', 'ImportBatch', 'ImportRow',
] as const

// ==== 1. Inspeksi arsip (B.8: baca manifest, verifikasi integritas) ====

function openZip(buf: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf as unknown as Parameters<typeof yauzl.fromBuffer>[0], { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zf) => {
      if (err) reject(err)
      else resolve(zf)
    })
  })
}

function readEntry(zf: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zf.openReadStream(entry, (err, rs) => {
      if (err) return reject(err)
      const chunks: Buffer[] = []
      let total = 0
      rs.on('data', (d: Buffer) => {
        total += d.length
        if (total > entry.uncompressedSize + 1024 || total > ZIP_LIMITS.maxSingleUncompressed) {
          rs.destroy()
          reject(new RestoreError(`Ukuran entry melebihi deklarasi: ${entry.fileName}`))
          return
        }
        chunks.push(d)
      })
      rs.on('end', () => resolve(Buffer.concat(chunks)))
      rs.on('error', reject)
    })
  })
}

/**
 * Baca + validasi arsip backup. Melempar RestoreError bila: bukan zip SIRAT,
 * passphrase salah, nama entry berbahaya, zip-bomb, checksum cocok tidak,
 * manifest rusak, atau skema tidak kompatibel.
 */
export async function inspectBackupFile(filePath: string, passphrase?: string): Promise<ParsedBackup> {
  let raw: Buffer = await fs.readFile(filePath)
  if (isEncryptedContainer(raw)) {
    if (!passphrase) throw new RestoreError('Arsip terenkripsi — passphrase diperlukan')
    raw = decryptBuffer(raw, passphrase)
  }
  // Validasi skema dilakukan pemanggil (butuh konteks versi berjalan).

  const zf = await openZip(raw)
  const warnings: string[] = []
  try {
    // Pass 1: metadata semua entry → pemeriksaan keamanan
    const entries: yauzl.Entry[] = await new Promise((resolve, reject) => {
      const list: yauzl.Entry[] = []
      zf.on('error', reject)
      zf.on('entry', (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName)) return zf.readEntry() // direktori (tak diharapkan, abaikan)
        list.push(entry)
        zf.readEntry()
      })
      zf.on('end', () => resolve(list))
      zf.readEntry()
    })

    const safety = checkZipSafety(entries.map(e => ({
      name: e.fileName, uncompressedSize: e.uncompressedSize, compressedSize: e.compressedSize,
    })))
    if (!safety.ok) throw new RestoreError(`Arsip ditolak: ${safety.reason}`)

    const manifestEntry = entries.find(e => e.fileName === 'manifest.json')
    if (!manifestEntry) throw new RestoreError('Arsip tidak berisi manifest.json')

    const manifestBuf = await readEntry(zf, manifestEntry)
    const check = validateManifest(JSON.parse(manifestBuf.toString('utf8')))
    if (!check.ok || !check.manifest) throw new RestoreError(check.reason ?? 'Manifest tidak valid')
    const manifest = check.manifest

    if (manifest.encrypted && !isEncryptedContainer(await fs.readFile(filePath))) {
      throw new RestoreError('Manifest menyatakan terenkripsi namun arsip tidak terenkripsi — arsip dimodifikasi?')
    }

    // Pass 2: baca isi + verifikasi checksum terhadap manifest
    const manifestMap = new Map(manifest.entries.map(e => [e.name, e]))
    const tables: Record<string, Record<string, unknown>[]> = {}
    const stagingDir = path.join(path.dirname(filePath), `extract-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(stagingDir, { recursive: true })
    const files = new Map<string, string>()

    for (const entry of entries) {
      if (entry.fileName === 'manifest.json') continue
      const meta = manifestMap.get(entry.fileName)
      if (!meta) throw new RestoreError(`Entry tidak terdaftar di manifest: ${entry.fileName}`)
      const buf = await readEntry(zf, entry)
      const sha = createHash('sha256').update(buf).digest('hex')
      if (sha !== meta.sha256) {
        throw new RestoreError(`Checksum tidak cocok utk ${entry.fileName} — arsip rusak/dimodifikasi`)
      }
      if (buf.length !== meta.size) {
        throw new RestoreError(`Ukuran tidak cocok utk ${entry.fileName}`)
      }
      if (entry.fileName.startsWith('data/') && entry.fileName.endsWith('.json')) {
        const table = path.basename(entry.fileName, '.json')
        if (!DATA_TABLES.includes(table as (typeof DATA_TABLES)[number])) {
          throw new RestoreError(`Tabel tidak dikenal di backup: ${table}`)
        }
        const rows = JSON.parse(buf.toString('utf8'))
        if (!Array.isArray(rows)) throw new RestoreError(`Data tabel ${table} bukan array`)
        tables[table] = rows
      } else if (entry.fileName.startsWith('files/')) {
        const objectKey = entry.fileName.slice('files/'.length)
        const dest = safeJoin(stagingDir, objectKey.replace(/\//g, path.sep))
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, buf)
        files.set(objectKey, dest)
      }
    }
    // Entry di manifest tapi hilang dari zip → integritas gagal
    for (const meta of manifest.entries) {
      if (!entries.some(e => e.fileName === meta.name)) {
        throw new RestoreError(`Entry hilang dari arsip: ${meta.name}`)
      }
    }
    if (manifest.filesMissing.length > 0) {
      warnings.push(`${manifest.filesMissing.length} berkas arsip hilang saat backup dibuat (metadata tetap dipulihkan)`)
    }
    return { manifest, tables, files, stagingDir, warnings }
  } finally {
    zf.close()
  }
}

// ==== 2. Perencanaan restore (preview — B.9 langkah 6-7) ====

export interface RestoreTargets {
  type: 'FULL' | 'SCOPED'
  unitIds: string[]
  committeeIds: string[]
}

/** Surat dalam backup yang termasuk target restore (unit scope ⊇ kepanitiaannya). */
function letterInTargets(
  letter: Record<string, unknown>,
  committeesByUnit: Map<string, string[]>, // unitId → committeeIds
  targets: RestoreTargets,
): boolean {
  if (targets.type === 'FULL') return true
  const unitId = String(letter.issuingUnitId ?? '')
  const committeeId = letter.committeeId ? String(letter.committeeId) : null
  if (committeeId) return targets.committeeIds.includes(committeeId) || targets.unitIds.includes(unitId)
  return targets.unitIds.includes(unitId)
}

export async function planRestore(parsed: ParsedBackup, targets: RestoreTargets, actorId: string): Promise<RestorePlan> {
  const { manifest, tables, warnings: inspectWarnings } = parsed
  const warnings = [...inspectWarnings]
  const conflicts: { table: string; id: string; reason: string }[] = []
  const willCreate: Record<string, number> = {}
  const keptExisting: Record<string, number> = {}
  let skippedOutOfTarget = 0

  if (targets.type === 'FULL') {
    if (manifest.kind !== 'FULL' && manifest.kind !== 'SAFETY') {
      throw new RestoreError('Full restore membutuhkan backup FULL (atau safety), bukan backup per scope')
    }
    for (const t of DATA_TABLES) {
      if (tables[t]?.length) willCreate[t] = tables[t].length
    }
    const actorInBackup = (tables.User ?? []).some(u => u.id === actorId)
    if (!actorInBackup) {
      warnings.push('Akun Anda tidak terdapat di dalam backup — setelah restore Anda akan keluar dari sistem dan perlu login dengan akun dari backup.')
    }
    return {
      kind: 'FULL',
      backupCreatedAt: manifest.createdAt,
      createdBy: manifest.createdBy.fullName,
      scopeLabels: manifest.scopeLabels,
      willCreate, keptExisting, skippedOutOfTarget: 0, conflicts, warnings,
      actorStillExists: actorInBackup,
    }
  }

  // ==== SCOPED: merge-amd ====
  if (manifest.kind !== 'SCOPED') {
    throw new RestoreError('Restore scoped membutuhkan backup SCOPED; backup FULL hanya bisa dipulihkan lewat Full Restore oleh Super Admin')
  }
  const committeesByUnit = new Map<string, string[]>()
  for (const c of tables.Committee ?? []) {
    const uid = String(c.unitId ?? '')
    if (!committeesByUnit.has(uid)) committeesByUnit.set(uid, [])
    committeesByUnit.get(uid)!.push(String(c.id))
  }

  // Surat target + kumpulan ID terkait
  const targetLetters = (tables.Letter ?? []).filter(l => letterInTargets(l, committeesByUnit, targets))
  skippedOutOfTarget = (tables.Letter ?? []).length - targetLetters.length
  const targetLetterIds = new Set(targetLetters.map(l => String(l.id)))

  // Data existing (indeks) untuk keputusan merge
  const [existingLetters, existingRegistry, existingFiles, existingVersions, existingRefs] = await Promise.all([
    db.letter.findMany({ select: { id: true, officialNumber: true, normalizedNumber: true, status: true, sequence: true, namespaceId: true, periodKey: true, issuingUnitId: true, committeeId: true } }),
    db.numberRegistry.findMany({ select: { number: true, letterId: true } }),
    db.archiveFile.findMany({ select: { id: true } }),
    db.archiveVersion.findMany({ select: { id: true, objectKey: true, archiveFileId: true } }),
    db.letterReference.findMany({ select: { id: true } }),
  ])
  const letterById = new Map(existingLetters.map(l => [l.id, l]))
  const numberOwner = new Map(existingRegistry.map(r => [r.number, r.letterId]))
  const seqKey = (ns: unknown, pk: unknown, seq: unknown) => `${ns}|${pk}|${seq}`
  const existingSeq = new Set(existingLetters.filter(l => l.namespaceId && l.periodKey !== null && l.sequence !== null).map(l => seqKey(l.namespaceId, l.periodKey, l.sequence)))
  const fileIdSet = new Set(existingFiles.map(f => f.id))
  const versionById = new Map(existingVersions.map(v => [v.id, v]))
  const objectKeyOwner = new Map(existingVersions.map(v => [v.objectKey, v.id]))
  const refIdSet = new Set(existingRefs.map(r => r.id))

  // Master/global bersama: buat hanya jika hilang (stub referensial)
  const prismaModel = (table: string) => table.charAt(0).toLowerCase() + table.slice(1)
  for (const table of ['User', 'Unit', 'Committee', 'LetterType', 'NumberingProfile', 'NumberingProfileVersion', 'CounterNamespace'] as const) {
    const rows = tables[table] ?? []
    if (!rows.length) continue
    const ids = rows.map(r => String(r.id))
    const existing = await (db as unknown as Record<string, { findMany: (a: unknown) => Promise<unknown[]> }>)[prismaModel(table)].findMany({ where: { id: { in: ids } }, select: { id: true } })
    const existingIds = new Set((existing as { id: string }[]).map(r => r.id))
    const missing = rows.filter(r => !existingIds.has(String(r.id)))
    if (missing.length) willCreate[table] = missing.length
    const kept = rows.length - missing.length
    if (kept) keptExisting[table] = kept
    if (table === 'User' && missing.length) {
      warnings.push(`${missing.length} akun pengguna hanya dipulihkan sebagai snapshot identitas (tanpa password, nonaktif) — akun tidak bisa dipakai login. Gunakan Full Restore untuk memulihkan akun secara utuh.`)
    }
  }

  // Surat
  let lettersKept = 0
  for (const l of targetLetters) {
    const id = String(l.id)
    const ex = letterById.get(id)
    if (ex) {
      // Bandingkan field inti; identik → dipertahankan, beda → konflik (tidak ditimpa)
      const same = ex.officialNumber === (l.officialNumber ?? null)
        && ex.status === l.status
        && ex.sequence === (l.sequence ?? null)
        && ex.namespaceId === (l.namespaceId ?? null)
        && ex.periodKey === (l.periodKey ?? null)
      if (same) {
        lettersKept++
      } else {
        conflicts.push({ table: 'Letter', id, reason: 'Surat dengan ID sama sudah ada dengan isi berbeda — tidak ditimpa (kebijakan merge-amd)' })
      }
      continue
    }
    const norm = l.normalizedNumber ? String(l.normalizedNumber) : null
    if (norm) {
      const owner = numberOwner.get(norm)
      if (owner !== undefined && owner !== id) {
        conflicts.push({ table: 'Letter', id, reason: `Nomor ternormalisasi ${norm} sudah terpakai surat lain — tidak boleh duplikat nomor final` })
        continue
      }
    }
    if (l.namespaceId && l.periodKey !== null && l.sequence !== null) {
      const collides = existingLetters.some(x => x.id !== id && x.namespaceId === l.namespaceId && x.periodKey === l.periodKey && x.sequence === l.sequence)
      if (collides) {
        conflicts.push({ table: 'Letter', id, reason: `Urutan ${l.sequence} pada namespace/periode yang sama sudah dipakai surat lain` })
        continue
      }
    }
    willCreate.Letter = (willCreate.Letter ?? 0) + 1
  }
  if (lettersKept) keptExisting.Letter = lettersKept

  // NumberRegistry
  for (const r of tables.NumberRegistry ?? []) {
    const owner = numberOwner.get(String(r.number))
    if (owner === undefined) willCreate.NumberRegistry = (willCreate.NumberRegistry ?? 0) + 1
    else if (owner !== r.letterId) conflicts.push({ table: 'NumberRegistry', id: String(r.id), reason: `Nomor ${r.number} terdaftar milik surat lain` })
    else keptExisting.NumberRegistry = (keptExisting.NumberRegistry ?? 0) + 1
  }

  // Arsip berkas
  const targetFileIds = new Set((tables.ArchiveFile ?? []).filter(f => targetLetterIds.has(String(f.letterId))).map(f => String(f.id)))
  for (const f of tables.ArchiveFile ?? []) {
    if (!targetFileIds.has(String(f.id))) { skippedOutOfTarget++; continue }
    if (!fileIdSet.has(String(f.id))) willCreate.ArchiveFile = (willCreate.ArchiveFile ?? 0) + 1
    else keptExisting.ArchiveFile = (keptExisting.ArchiveFile ?? 0) + 1
  }
  for (const v of tables.ArchiveVersion ?? []) {
    if (!targetFileIds.has(String(v.archiveFileId))) continue
    const ex = versionById.get(String(v.id))
    if (ex) { keptExisting.ArchiveVersion = (keptExisting.ArchiveVersion ?? 0) + 1; continue }
    const keyOwner = objectKeyOwner.get(String(v.objectKey))
    if (keyOwner !== undefined && keyOwner !== v.id) {
      conflicts.push({ table: 'ArchiveVersion', id: String(v.id), reason: `objectKey ${v.objectKey} sudah dipakai versi lain` })
      continue
    }
    willCreate.ArchiveVersion = (willCreate.ArchiveVersion ?? 0) + 1
  }

  // Referensi
  for (const r of tables.LetterReference ?? []) {
    if (!targetLetterIds.has(String(r.letterId))) { skippedOutOfTarget++; continue }
    if (!refIdSet.has(String(r.id))) willCreate.LetterReference = (willCreate.LetterReference ?? 0) + 1
    else keptExisting.LetterReference = (keptExisting.LetterReference ?? 0) + 1
  }

  // Counter: naikkan bila perlu (tidak pernah turun)
  const counterUpdates = await planCounterUpdates(tables.Counter ?? [])
  if (counterUpdates > 0) willCreate.Counter = counterUpdates // "diperbarui" — FE menampilkan sebagai naik

  if (skippedOutOfTarget) {
    warnings.push(`${skippedOutOfTarget} baris data di luar target restore dipertahankan tidak diproses (data unit lain tidak tersentuh).`)
  }
  return {
    kind: 'SCOPED',
    backupCreatedAt: manifest.createdAt,
    createdBy: manifest.createdBy.fullName,
    scopeLabels: manifest.scopeLabels,
    willCreate, keptExisting, skippedOutOfTarget, conflicts, warnings,
    actorStillExists: true,
  }
}

async function planCounterUpdates(rows: Record<string, unknown>[]): Promise<number> {
  let updates = 0
  for (const c of rows) {
    const ex = await db.counter.findFirst({
      where: { namespaceId: String(c.namespaceId), periodKey: String(c.periodKey) },
      select: { lastValue: true },
    })
    if (!ex) { updates++; continue }
    if (Number(c.lastValue) > ex.lastValue) updates++
  }
  return updates
}

// ==== 3. Eksekusi restore ====

export interface RestoreReport {
  kind: 'FULL' | 'SCOPED'
  created: Record<string, number>
  kept: Record<string, number>
  conflicts: { table: string; id: string; reason: string }[]
  countersRaised: number
  filesPromoted: number
}

/** Urutan penghapusan (anak dulu) untuk full restore. */
const DELETE_ORDER = [
  'auditEvent', 'importRow', 'importBatch', 'letterReference', 'numberRegistry',
  'archiveVersion', 'archiveFile', 'letter', 'idempotencyKey', 'counter',
  'numberingProfileVersion', 'numberingProfile', 'counterNamespace',
  'backupGrant', 'accessAssignment', 'storageBackend', 'user', 'committee',
  'unit', 'letterType', 'appIdentity',
] as const

/** Urutan penyisipan (induk dulu). */
const INSERT_ORDER = [
  'appIdentity', 'user', 'unit', 'committee', 'letterType', 'accessAssignment',
  'backupGrant', 'storageBackend', 'numberingProfile', 'numberingProfileVersion',
  'counterNamespace', 'counter', 'letter', 'numberRegistry', 'letterReference',
  'archiveFile', 'archiveVersion', 'importBatch', 'importRow', 'auditEvent',
] as const

export async function executeRestore(parsed: ParsedBackup, targets: RestoreTargets, actor: { id: string; username: string }): Promise<RestoreReport> {
  const { manifest, tables, files } = parsed
  const fp = checkSchemaFingerprint(manifest, schemaFingerprint())
  if (!fp.ok) throw new RestoreError(fp.reason!)

  // Lock restore paralel (B.9): RUNNING segar (< 2 jam) → tolak
  const running = await db.backupEvent.findFirst({
    where: { action: 'RESTORE', status: 'RUNNING', createdAt: { gt: new Date(Date.now() - 2 * 3600 * 1000) } },
  })
  if (running) throw new RestoreError('Restore lain sedang berjalan. Tunggu hingga selesai.')
  await db.backupEvent.updateMany({
    where: { action: 'RESTORE', status: 'RUNNING' },
    data: { status: 'FAILED', metadata: JSON.stringify({ note: 'ditandai gagal — stale lock' }), completedAt: new Date() },
  })
  const lockEvent = await db.backupEvent.create({
    data: {
      kind: targets.type, action: 'RESTORE', actorId: actor.id,
      status: 'RUNNING', scopeJson: JSON.stringify({ unitIds: targets.unitIds, committeeIds: targets.committeeIds }),
    },
  })

  const report: RestoreReport = { kind: targets.type, created: {}, kept: {}, conflicts: [], countersRaised: 0, filesPromoted: 0 }
  try {
    if (targets.type === 'FULL') {
      await db.$transaction(async (tx) => {
        for (const model of DELETE_ORDER) {
          await (tx as unknown as Record<string, { deleteMany: (a?: unknown) => Promise<unknown> }>)[model].deleteMany({})
        }
        for (const model of INSERT_ORDER) {
          const table = model.charAt(0).toUpperCase() + model.slice(1)
          const rows = tables[table] ?? []
          if (!rows.length) continue
          await (tx as unknown as Record<string, { createMany: (a: unknown) => Promise<unknown> }>)[model].createMany({ data: rows, skipDuplicates: false } as never)
          report.created[table] = rows.length
        }
        // Counter tidak boleh lebih rendah dari sequence surat tertinggi
        report.countersRaised += await raiseCountersToMaxSequence(tx)
      }, { timeout: 120_000 })
      // Promosikan semua blob
      for (const [objectKey, stagedPath] of files) {
        report.filesPromoted += await promoteBlob(stagedPath, objectKey)
      }
    } else {
      // ==== SCOPED merge ====
      const committeesByUnit = new Map<string, string[]>()
      for (const c of tables.Committee ?? []) {
        const uid = String(c.unitId ?? '')
        if (!committeesByUnit.has(uid)) committeesByUnit.set(uid, [])
        committeesByUnit.get(uid)!.push(String(c.id))
      }
      const targetLetters = (tables.Letter ?? []).filter(l => letterInTargets(l, committeesByUnit, targets))
      const targetLetterIds = new Set(targetLetters.map(l => String(l.id)))

      await db.$transaction(async (tx) => {
        // 1. Master/global: stub hanya jika hilang
        for (const table of ['Unit', 'Committee', 'LetterType', 'NumberingProfile', 'NumberingProfileVersion', 'CounterNamespace'] as const) {
          const rows = tables[table] ?? []
          const model = table.charAt(0).toLowerCase() + table.slice(1)
          for (const row of rows) {
            const exists = await (tx as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>)[model].findUnique({ where: { id: row.id } })
            if (!exists) {
              await (tx as unknown as Record<string, { create: (a: unknown) => Promise<unknown> }>)[model].create({ data: row })
              report.created[table] = (report.created[table] ?? 0) + 1
            } else {
              report.kept[table] = (report.kept[table] ?? 0) + 1
            }
          }
        }
        // User: stub identitas nonaktif tanpa password (B.4 — akun global tak boleh ditimpa scoped restore)
        for (const u of tables.User ?? []) {
          const exists = await tx.user.findUnique({ where: { id: String(u.id) }, select: { id: true } })
          if (!exists) {
            // Pertahankan username asli bila bebas; bila terpakai akun lain → suffix unik
            let username = String(u.username)
            const taken = await tx.user.findUnique({ where: { username }, select: { id: true } })
            if (taken) username = `${username}-restored-${Date.now().toString(36)}`
            await tx.user.create({
              data: {
                id: String(u.id), username,
                passwordHash: '!', // tidak bisa login — bukan hash bcrypt valid
                fullName: String(u.fullName ?? 'Pengguna dipulihkan'), email: (u.email as string) ?? null,
                role: 'VIEWER', isActive: false,
                createdAt: u.createdAt ? new Date(String(u.createdAt)) : new Date(),
                updatedAt: new Date(),
              },
            })
            report.created.User = (report.created.User ?? 0) + 1
          } else {
            report.kept.User = (report.kept.User ?? 0) + 1
          }
        }
        // 2. Counter: naik bila perlu (tak pernah turun)
        for (const c of tables.Counter ?? []) {
          const ex = await tx.counter.findFirst({
            where: { namespaceId: String(c.namespaceId), periodKey: String(c.periodKey) },
            select: { id: true, lastValue: true },
          })
          if (!ex) {
            await tx.counter.create({ data: { id: String(c.id), namespaceId: String(c.namespaceId), periodKey: String(c.periodKey), lastValue: Number(c.lastValue), updatedAt: new Date(String(c.updatedAt)) } })
            report.created.Counter = (report.created.Counter ?? 0) + 1
          } else if (Number(c.lastValue) > ex.lastValue) {
            await tx.counter.update({ where: { id: ex.id }, data: { lastValue: Number(c.lastValue) } })
            report.countersRaised++
          } else {
            report.kept.Counter = (report.kept.Counter ?? 0) + 1
          }
        }
        // 3. Surat (merge-amd; konflik dilewati)
        for (const l of targetLetters) {
          const exists = await tx.letter.findUnique({ where: { id: String(l.id) }, select: { id: true, officialNumber: true, status: true, sequence: true } })
          if (exists) { report.kept.Letter = (report.kept.Letter ?? 0) + 1; continue }
          try {
            await tx.letter.create({ data: l as never })
            report.created.Letter = (report.created.Letter ?? 0) + 1
          } catch (e) {
            const err = e as { code?: string }
            if (err.code === 'P2002') {
              report.conflicts.push({ table: 'Letter', id: String(l.id), reason: 'Constraint unik (nomor/urutan) sudah terpakai — dilewati' })
            } else throw e
          }
        }
        // 4. Registry & referensi & berkas
        for (const r of tables.NumberRegistry ?? []) {
          const exists = await tx.numberRegistry.findUnique({ where: { number: String(r.number) } })
          if (!exists && targetLetterIds.has(String(r.letterId))) {
            await tx.numberRegistry.create({ data: r as never })
            report.created.NumberRegistry = (report.created.NumberRegistry ?? 0) + 1
          } else {
            report.kept.NumberRegistry = (report.kept.NumberRegistry ?? 0) + 1
          }
        }
        const targetFileIds = new Set((tables.ArchiveFile ?? []).filter(f => targetLetterIds.has(String(f.letterId))).map(f => String(f.id)))
        for (const f of tables.ArchiveFile ?? []) {
          if (!targetFileIds.has(String(f.id))) continue
          const exists = await tx.archiveFile.findUnique({ where: { id: String(f.id) }, select: { id: true } })
          if (!exists) {
            await tx.archiveFile.create({ data: f as never })
            report.created.ArchiveFile = (report.created.ArchiveFile ?? 0) + 1
          } else report.kept.ArchiveFile = (report.kept.ArchiveFile ?? 0) + 1
        }
        const createdVersionIds = new Set<string>()
        for (const v of tables.ArchiveVersion ?? []) {
          if (!targetFileIds.has(String(v.archiveFileId))) continue
          const exists = await tx.archiveVersion.findUnique({ where: { id: String(v.id) }, select: { id: true } })
          if (!exists) {
            try {
              await tx.archiveVersion.create({ data: v as never })
              createdVersionIds.add(String(v.id))
              report.created.ArchiveVersion = (report.created.ArchiveVersion ?? 0) + 1
            } catch (e) {
              const err = e as { code?: string }
              if (err.code === 'P2002') report.conflicts.push({ table: 'ArchiveVersion', id: String(v.id), reason: 'objectKey/ID sudah dipakai' })
              else throw e
            }
          } else report.kept.ArchiveVersion = (report.kept.ArchiveVersion ?? 0) + 1
        }
        for (const r of tables.LetterReference ?? []) {
          if (!targetLetterIds.has(String(r.letterId))) continue
          const exists = await tx.letterReference.findUnique({ where: { id: String(r.id) }, select: { id: true } })
          if (!exists) {
            await tx.letterReference.create({ data: r as never })
            report.created.LetterReference = (report.created.LetterReference ?? 0) + 1
          } else report.kept.LetterReference = (report.kept.LetterReference ?? 0) + 1
        }
        // Simpan ID versi yang dibuat untuk promosi blob setelah commit
        ;(report as unknown as { _createdVersionIds?: Set<string> })._createdVersionIds = createdVersionIds
      }, { timeout: 120_000 })

      // Promosikan blob hanya untuk versi yang baru dibuat
      const createdVersionIds = (report as unknown as { _createdVersionIds?: Set<string> })._createdVersionIds ?? new Set<string>()
      for (const v of tables.ArchiveVersion ?? []) {
        if (!createdVersionIds.has(String(v.id))) continue
        const staged = files.get(String(v.objectKey))
        if (staged) report.filesPromoted += await promoteBlob(staged, String(v.objectKey))
      }
    }

    await db.backupEvent.update({
      where: { id: lockEvent.id },
      data: {
        status: 'COMPLETED', completedAt: new Date(),
        metadata: JSON.stringify({ created: report.created, kept: report.kept, conflicts: report.conflicts.length, countersRaised: report.countersRaised, filesPromoted: report.filesPromoted }),
      },
    })
    await writeAudit(db, {
      actorId: actor.id, action: `backup.${targets.type.toLowerCase()}.restore`, entityType: 'backup',
      entityId: manifest.createdAt,
      metadata: { created: report.created, kept: report.kept, conflicts: report.conflicts.length, backupCreatedAt: manifest.createdAt },
    })
    return report
  } catch (e) {
    await db.backupEvent.update({
      where: { id: lockEvent.id },
      data: { status: 'FAILED', completedAt: new Date(), metadata: JSON.stringify({ error: (e as Error).message }) },
    }).catch(() => {})
    await writeAudit(db, {
      actorId: actor.id, action: `backup.${targets.type.toLowerCase()}.restore`, entityType: 'backup',
      outcome: 'FAILURE', entityId: manifest.createdAt, metadata: { error: (e as Error).message },
    })
    throw e
  }
}

async function raiseCountersToMaxSequence(tx: Prisma.TransactionClient): Promise<number> {
  // Setelah full restore: pastikan counter >= max sequence surat pada namespace/periode
  const rows = await tx.$queryRaw<Array<{ namespaceId: string; periodKey: string; maxSeq: bigint | null }>>(
    Prisma.sql`SELECT "namespaceId", "periodKey", MAX("sequence") as "maxSeq" FROM "Letter" WHERE "namespaceId" IS NOT NULL AND "sequence" IS NOT NULL GROUP BY "namespaceId", "periodKey"`,
  )
  let raised = 0
  for (const r of rows) {
    const maxSeq = Number(r.maxSeq ?? 0)
    const updated = await tx.counter.updateMany({
      where: { namespaceId: r.namespaceId, periodKey: r.periodKey, lastValue: { lt: maxSeq } },
      data: { lastValue: maxSeq },
    })
    raised += updated.count
  }
  return raised
}

async function promoteBlob(stagedPath: string, objectKey: string): Promise<number> {
  try {
    const dest = safeJoin(ARCHIVE_ROOT, objectKey)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    try {
      await fs.access(dest)
      return 0 // sudah ada — jangan ditimpa
    } catch {
      await fs.copyFile(stagedPath, dest)
      return 1
    }
  } catch {
    return 0
  }
}

/** Bersihkan direktori staging hasil ekstraksi. */
export async function cleanupParsed(parsed: ParsedBackup): Promise<void> {
  try {
    await fs.rm(parsed.stagingDir, { recursive: true, force: true })
  } catch { /* best effort */ }
}
