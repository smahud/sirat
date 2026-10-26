// Seed SIRAT — preset awal sesuai Blueprint baseline 1.1 & master prompt:
// - Application Identity: SIRAT YAPSI Darussalam
// - 7 unit permanen (YAPSI/PP, KB, RA, MI, MTs, Pondok Pesantren, Rumah Tahfidz)
// - 13 jenis surat kaya keterangan (default config v1.4): scripts/letter-types-defaults.json
//   (8 kode lampiran workbook + 5 jenis umum tambahan; kategori/deskripsi/fungsi/contoh/catatan)
// - Profil preset YAPSI (format workbook) versi DRAFT (aktivasi eksplisit pemilik)
// - Namespace default per unit (counter terpisah antar unit)
// Jalankan: bun scripts/seed.mjs (atau node scripts/seed.mjs)
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const prisma = new PrismaClient()

const DEFAULTS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'letter-types-defaults.json'), 'utf8'),
)

const PRESET_DSL = {
  version: 1,
  separator: '/',
  components: [
    { type: 'sequence', padding: 3 },
    { type: 'direction', mapping: { INTERNAL: 'A', EXTERNAL: 'B' } },
    { type: 'letterTypeCode' },
    { type: 'literal', value: 'YAPSI-DS' },
    { type: 'letterDate', format: 'MONTH_ROMAN' },
    { type: 'letterDate', format: 'YEAR_4' },
  ],
}

const UNITS = [
  { code: 'YAPSI', name: 'YAPSI / Pengurus Pusat' },
  { code: 'KB', name: 'KB (Kelompok Bermain)' },
  { code: 'RA', name: 'RA (Raudhatul Athfal)' },
  { code: 'MI', name: 'MI (Madrasah Ibtidaiyah)' },
  { code: 'MTs', name: 'MTs (Madrasah Tsanawiyah)' },
  { code: 'PP', name: 'Pondok Pesantren' },
  { code: 'RT', name: 'Rumah Tahfidz' },
]

// Jenis surat default config (v1.4) — dipakai saat instalasi baru.
// Katalog lengkap + keterangannya ada di scripts/letter-types-defaults.json agar
// mudah disesuaikan lembaga lain tanpa menyentuh kode. Untuk instalasi yang SUDAH
// berjalan, gunakan scripts/backfill-letter-types.mjs (tidak menimpa edit manual).
const LETTER_TYPES = DEFAULTS.letterTypes

async function main() {
  // App identity
  await prisma.appIdentity.upsert({
    where: { id: 'app' },
    update: {},
    create: { id: 'app', name: 'SIRAT YAPSI Darussalam', ownerName: 'YAPSI Darussalam', timezone: 'Asia/Jakarta', locale: 'id-ID' },
  })

  // Units + namespace default per unit
  for (const u of UNITS) {
    const existing = await prisma.unit.findUnique({ where: { code: u.code } })
    let unitId = existing?.id
    if (!existing) {
      const unit = await prisma.unit.create({
        data: { code: u.code, name: u.name, storageKey: `${u.code.toLowerCase()}-${Date.now().toString(36)}` },
      })
      unitId = unit.id
    } else {
      unitId = existing.id
    }
    const ns = await prisma.counterNamespace.findFirst({ where: { unitId, committeeId: null } })
    if (!ns) {
      await prisma.counterNamespace.create({
        data: { name: `default:${u.code}`, unitId, resetPolicy: 'ALL', dateSource: 'LETTER_DATE' },
      })
    }
  }

  // Letter types (kode persis lampiran)
  for (const lt of LETTER_TYPES) {
    const existing = await prisma.letterType.findUnique({ where: { code: lt.code } })
    if (!existing) {
      await prisma.letterType.create({ data: lt })
    }
  }

  // Profil preset YAPSI (unit YAPSI), versi DRAFT — pemilik mengaktivasi eksplisit
  const yapsi = await prisma.unit.findUnique({ where: { code: 'YAPSI' } })
  let profile = await prisma.numberingProfile.findFirst({ where: { ownerId: yapsi.id, committeeId: null } })
  if (!profile) {
    profile = await prisma.numberingProfile.create({
      data: { name: 'Preset Workbook 2026 (YAPSI-DS)', ownerId: yapsi.id },
    })
  }
  const hasVersion = await prisma.numberingProfileVersion.findFirst({ where: { profileId: profile.id } })
  if (!hasVersion) {
    await prisma.numberingProfileVersion.create({
      data: { profileId: profile.id, version: 1, status: 'DRAFT', dsl: JSON.stringify(PRESET_DSL) },
    })
  }

  // Admin bootstrap dari env (jangan hardcode password di repo)
  const adminUsername = process.env.SIRAT_ADMIN_USERNAME || 'admin'
  const adminPassword = process.env.SIRAT_ADMIN_PASSWORD
  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } })
  if (!existingAdmin && adminPassword) {
    await prisma.user.create({
      data: {
        username: adminUsername,
        fullName: 'Administrator SIRAT',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: 'SYSTEM_ADMIN',
        isActive: true,
      },
    })
    console.log(`Admin "${adminUsername}" dibuat (SYSTEM_ADMIN)`)
  } else if (existingAdmin) {
    console.log(`User "${adminUsername}" sudah ada — dilewati`)
  } else {
    console.log('SIRAT_ADMIN_PASSWORD tidak diisi — admin tidak dibuat. Gunakan scripts/bootstrap-admin.mjs')
  }

  console.log('Seed selesai:')
  console.log(`- ${await prisma.unit.count()} unit`)
  console.log(`- ${await prisma.letterType.count()} jenis surat`)
  console.log(`- profil preset YAPSI: ${profile.id} (versi DRAFT, menunggu aktivasi eksplisit)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
