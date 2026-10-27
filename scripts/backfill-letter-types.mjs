// Backfill katalog default Jenis Surat (v1.4) untuk instalasi yang SUDAH berjalan.
//
// Tujuan: mengisi panduan kategori/deskripsi/fungsi/contoh/catatan pada jenis
// surat yang ada, serta menambahkan jenis umum yang belum ada — sehingga
// tooltip "Kode Surat" pada form Buat Surat langsung informatif.
//
// Prinsip aman:
// - Field yang SUDAH diisi manual TIDAK ditimpa (mode default: isi yang kosong saja).
// - --force: kanonikalisasi penuh (nama/kode/keterangan ditimpa dari katalog),
//   tapi PERUBAHAN KODE/NAMA hanya diterapkan bila jenis belum pernah dipakai surat
//   (menjaga snapshot nomor histori).
// - Jenis surat kustom milik lembaga TIDAK dihapus.
// - --dry-run: tampilkan rencana tanpa menulis.
//
// Jalankan: node scripts/backfill-letter-types.mjs [--dry-run] [--force]
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const prisma = new PrismaClient()
const DRY = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')

const DEFAULTS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'letter-types-defaults.json'), 'utf8'),
)

// Alias kode lama → kode katalog (instalasi dengan seed versi lama)
const CODE_ALIASES = { 'SK-PENGESAHAN': 'SK' }

const TEXT_FIELDS = ['category', 'description', 'purpose', 'usageExamples', 'notes']

async function main() {
  console.log(`Backfill jenis surat default (dry-run: ${DRY}, force: ${FORCE})`)
  const report = { created: [], updated: [], skipped: [] }

  for (const def of DEFAULTS.letterTypes) {
    const existing = await prisma.letterType.findUnique({ where: { code: def.code } })
      ?? (CODE_ALIASES[def.code]
        ? await prisma.letterType.findUnique({ where: { code: CODE_ALIASES[def.code] } })
        : null)

    if (!existing) {
      if (!DRY) {
        await prisma.letterType.create({ data: { ...def, isActive: true } })
      }
      report.created.push(def.code)
      continue
    }

    const usage = await prisma.letter.count({ where: { letterTypeId: existing.id } })
    const data = {}
    let changed = false

    // 1) Keterangan teks: default = isi yang kosong; --force = kanonikalisasi.
    for (const f of TEXT_FIELDS) {
      const cur = (existing[f] ?? '').trim()
      const want = (def[f] ?? '').trim()
      if (FORCE ? cur !== want : (!cur && want)) { data[f] = want; changed = true }
    }
    // 2) Nama: koreksi bila kosong, atau --force (aman untuk tampilan).
    if ((FORCE || !existing.name.trim()) && existing.name !== def.name) { data.name = def.name; changed = true }
    // 3) Kode: HANYA bila belum pernah dipakai surat (snapshot nomor histori tidak boleh berubah).
    const renameCode = existing.code !== def.code
    if (renameCode) {
      if (usage === 0) { data.code = def.code; changed = true }
      else report.skipped.push(`${existing.code}: kode tidak diubah (dipakai ${usage} surat)`)
    }

    if (!changed) { report.skipped.push(existing.code); continue }

    if (!DRY) await prisma.letterType.update({ where: { id: existing.id }, data })
    report.updated.push(renameCode && usage === 0 ? `${existing.code} → ${def.code}` : existing.code)
  }

  console.log(`\nHasil (${DRY ? 'DRY-RUN, tidak ada yang ditulis' : 'tersimpan'}):`)
  console.log(`+ Dibuat     : ${report.created.length ? report.created.join(', ') : '—'}`)
  console.log(`~ Diperbarui : ${report.updated.length ? report.updated.join(', ') : '—'}`)
  console.log(`= Dilewati  : ${report.skipped.length ? report.skipped.join(', ') : '—'}`)
  console.log(`\nTotal jenis surat sekarang: ${await prisma.letterType.count()}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
