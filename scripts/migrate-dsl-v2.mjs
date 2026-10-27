#!/usr/bin/env node
/**
 * migrate-dsl-v2.mjs — Migrasi data NumberingProfileVersion.dsl dari v1 → v2
 * (instruksi revisi E.10: konfigurasi "Arah" lama menjadi Dropdown ekuivalen).
 *
 * Sifat migrasi:
 * - Non-destruktif: hanya menulis ulang kolom dsl pada versi DRAFT;
 *   versi ACTIVE/RETIRED dibiarkan apa adanya (immutable) — parseDsl()
 *   meng-upgrade v1 secara transparan saat dibaca, sehingga nomor historis
 *   dan format existing 100% kompatibel.
 * - Konversi ekuivalen: komponen 'direction' {INTERNAL:'A',EXTERNAL:'B'}
 *   menjadi field 'arah_surat' + fieldRef dengan kode IDENTIK.
 *
 * Usage (di VPS, direktori /var/www/sirat):
 *   node scripts/migrate-dsl-v2.mjs --dry-run   # pratinjau tanpa menulis
 *   node scripts/migrate-dsl-v2.mjs             # jalankan
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const dryRun = process.argv.includes('--dry-run')

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'opt'
}

/** Konversi v1 → v2 — identik dengan src/lib/numbering/dsl.ts migrateV1ToV2. */
function migrateV1ToV2(v1) {
  const fields = []
  const usedKeys = new Set()
  const uniqueKey = (base) => {
    let k = base, n = 2
    while (usedKeys.has(k)) k = `${base}_${n++}`
    usedKeys.add(k)
    return k
  }
  const components = v1.components.map(c => {
    if (c.type !== 'direction') return { ...c }
    const key = uniqueKey('arah_surat')
    const entries = Object.entries(c.mapping)
    fields.push({
      type: 'dropdown',
      key,
      label: 'Arah Surat',
      placeholder: 'Pilih arah',
      helperText: null,
      options: entries.map(([enumKey, code]) => ({
        id: slugify(enumKey),
        label: enumKey === 'INTERNAL' ? 'Internal' : enumKey === 'EXTERNAL' ? 'Eksternal' : enumKey,
        code,
        active: true,
        legacyKey: enumKey,
      })),
      defaultOptionId: null,
      required: true,
      order: fields.length,
    })
    return { type: 'fieldRef', field: key }
  })
  return { version: 2, separator: v1.separator, fields, components }
}

async function main() {
  const versions = await prisma.numberingProfileVersion.findMany({
    include: { profile: { include: { owner: { select: { code: true } }, committee: { select: { code: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  let v1Count = 0, draftConverted = 0, skippedImmutable = 0, alreadyV2 = 0, failed = 0

  for (const v of versions) {
    let dsl
    try {
      dsl = JSON.parse(v.dsl)
    } catch {
      console.log(`  ✗ [${v.id}] DSL bukan JSON — dilewati`)
      failed++
      continue
    }
    if (dsl?.version !== 1) { alreadyV2++; continue }
    v1Count++
    const converted = migrateV1ToV2(dsl)
    const ctx = v.profile.committee ? `panitia ${v.profile.committee.code}` : `unit ${v.profile.owner.code}`
    console.log(`  • ${v.profile.name} (${ctx}) v${v.version} [${v.status}] → v2: ${converted.fields.length} field, ${converted.components.length} komponen`)
    // Verifikasi ekuivalen: setiap direction component menjadi fieldRef pada posisi sama
    const beforeDirs = dsl.components.filter(c => c.type === 'direction').length
    const afterRefs = converted.components.filter(c => c.type === 'fieldRef').length
    if (beforeDirs !== afterRefs) {
      console.log(`    ✗ Jumlah fieldRef (${afterRefs}) ≠ direction lama (${beforeDirs}) — DILEWATTI demi aman`)
      failed++
      continue
    }
    if (v.status !== 'DRAFT') {
      // Versi terbit immutable: tidak ditulis ulang; runtime parseDsl() menangani upgrade baca.
      skippedImmutable++
      console.log(`    ↷ immutable (${v.status}) — tidak ditulis ulang; dibaca via konversi runtime`)
      continue
    }
    if (dryRun) {
      console.log(`    [dry-run] akan menulis v2 (${JSON.stringify(converted).length} byte)`)
    } else {
      await prisma.numberingProfileVersion.update({
        where: { id: v.id },
        data: { dsl: JSON.stringify(converted) },
      })
      console.log(`    ✓ ditulis ulang sebagai v2`)
    }
    draftConverted++
  }

  console.log('\nRingkasan:')
  console.log(`  Total versi profil : ${versions.length}`)
  console.log(`  Sudah v2           : ${alreadyV2}`)
  console.log(`  v1 ditemukan       : ${v1Count}`)
  console.log(`  Draft dikonversi   : ${draftConverted}${dryRun ? ' (dry-run)' : ''}`)
  console.log(`  Immutable dibiarkan: ${skippedImmutable} (upgrade transparan saat dibaca)`)
  if (failed > 0) console.log(`  Gagal/anomali      : ${failed}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
