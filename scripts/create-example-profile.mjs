#!/usr/bin/env node
/**
 * v1.7 — Membuat profil penomoran CONTOH berstatus DRAFT (permintaan pemilik:
 * "buat baru draft profile surat sebagai contoh").
 *
 * - Tidak mengganggu profil aktif manapun: versi dibuat DRAFT, tanpa namespace.
 * - Mengikuti format riil unit (001/A/N/UND/MI/X/2026) dengan fitur lengkap DSL v2:
 *   2 dropdown dalam nomor (Arah Surat, Klasifikasi) + 1 field metadata (Sifat Surat).
 * - Idempoten: profil dengan nama sama pada unit sama tidak dibuat ulang.
 * - Setelah aktivasi via menu Profil Nomor, unit MI langsung bisa bernomor.
 *
 * Pemakaian: node scripts/create-example-profile.mjs [unitCode] [namaProfil]
 *   default unitCode=MI, namaProfil="Contoh Profil — Arah & Klasifikasi"
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { PrismaClient } from '@prisma/client'

const here = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(here, 'example-numbering-profile.json'), 'utf8'))

const prisma = new PrismaClient()

async function main() {
  const unitCode = process.argv[2] || spec.unitCode
  const profileName = process.argv[3] || spec.name

  const unit = await prisma.unit.findUnique({ where: { code: unitCode } })
  if (!unit) {
    console.error(`Unit "${unitCode}" tidak ditemukan — daftar kode unit ada di menu Unit & Panitia.`)
    process.exit(1)
  }

  const existing = await prisma.numberingProfile.findFirst({
    where: { name: profileName, ownerId: unit.id, committeeId: null },
    include: { versions: true },
  })
  if (existing) {
    const v1 = existing.versions.find(v => v.version === 1)
    console.log(`Profil "${profileName}" sudah ada di unit ${unit.code} (id ${existing.id}) — tidak diubah.`)
    console.log(`  Status versi 1: ${v1?.status ?? '(belum ada)'}`)
    return
  }

  const profile = await prisma.numberingProfile.create({
    data: {
      name: profileName,
      ownerId: unit.id,
      committeeId: null,
      versions: {
        create: { version: 1, status: 'DRAFT', dsl: JSON.stringify(spec.dsl) },
      },
    },
    include: { versions: true },
  })

  console.log('Profil contoh DIBUAT:')
  console.log(`  Nama : ${profile.name}`)
  console.log(`  Unit : ${unit.code} — ${unit.name}`)
  console.log(`  Versi: 1 (DRAFT — belum aktif, tanpa alokasi counter)`)
  console.log(`  Bentuk nomor setelah aktivasi: 001/A/N/UND/${unit.code}/X/2026`)
  console.log(`  Fitur yang didemonstrasikan:`)
  console.log(`   - Dropdown "Arah Surat" (Internal→A, Eksternal→B) — wajib, masuk nomor`)
  console.log(`   - Dropdown "Klasifikasi" (Biasa→N, Rahasia→R, Sangat Rahasia→SR) — default Biasa, masuk nomor`)
  console.log(`   - Dropdown "Sifat Surat" (Biasa/Penting/Segera) — metadata, TIDAK masuk nomor`)
  console.log(`   - Kebijakan counter disarankan: YEARLY / LETTER_DATE (prefill dialog aktivasi)`)
  console.log(`  Aktivasi: menu Profil Nomor → profil ini → tombol "Aktivasi versi 1".`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
