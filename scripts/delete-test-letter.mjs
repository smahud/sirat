#!/usr/bin/env node
/**
 * v1.7 — Hapus surat uji terdaftar dari produksi + bebaskan nomornya kembali.
 *
 * Permintaan pemilik (2026-10-27): "sementara hapus dulu surat yg sudah
 * terregister 001/A/SPR/YAPSI-DS/X/2026" — surat tersebut adalah surat UJI
 * milik tim pengembang (status CANCELLED saat cleanup audit v1.6.1).
 *
 * Yang dilakukan (satu transaksi):
 *  1. Guard: target harus DRAFT/CANCELLED — surat ISSUED ditolak tanpa --force.
 *  2. Hapus referensi masuk/keluar, berkas arsip + versinya, idempotency key,
 *     baris NumberRegistry (nomor bebas dipakai ulang), lalu suratnya.
 *  3. Reset counter periode ke 0 BILA tidak ada surat lain pada periode itu
 *     → nomor berikutnya kembali 001. (Namespace milik profil versi AKTIF
 *     tidak disentuh — profil tetap berfungsi.)
 *  4. Catat AuditEvent 'letter.purge' — jejak tindakan tetap ada.
 *
 * Pemakaian: node scripts/delete-test-letter.mjs ["NOMOR"] [--force]
 *   default NOMOR=001/A/SPR/YAPSI-DS/X/2026
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const target = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : '001/A/SPR/YAPSI-DS/X/2026'
  const force = process.argv.includes('--force')

  const registry = await prisma.numberRegistry.findUnique({ where: { number: target } })
  if (!registry) {
    console.log(`Nomor "${target}" tidak terdaftar di NumberRegistry — tidak ada yang perlu dihapus.`)
    return
  }

  const letter = await prisma.letter.findUnique({
    where: { id: registry.letterId },
    include: {
      files: { include: { versions: true } },
      referencesFrom: true,
    },
  })
  if (!letter) {
    // Registry yatim (surat sudah tidak ada) — bersihkan registry saja
    await prisma.numberRegistry.delete({ where: { id: registry.id } })
    console.log(`Registry yatim utk "${target}" dibersihkan.`)
    return
  }
  if (letter.status === 'ISSUED' && !force) {
    console.error(`Surat "${target}" berstatus ISSUED — pengecualian prinsip "nomor terbit permanen" butuh --force.`)
    process.exit(1)
  }

  console.log(`Target : ${letter.officialNumber ?? '(tanpa nomor)'}`)
  console.log(`Status : ${letter.status} · dibuat ${letter.createdAt.toISOString()}`)
  console.log(`Isi    : ${letter.files.length} berkas arsip, ${letter.referencesFrom.length} referensi keluar`)

  const incoming = await prisma.letterReference.count({ where: { refLetterId: letter.id } })
  console.log(`Diref. : ${incoming} surat lain merujuk ke sini (akan dihapus barisnya)`)

  await prisma.$transaction(async (tx) => {
    // 1) Referensi — keluar (cascade milik surat ini) dan masuk (baris di surat lain)
    await tx.letterReference.deleteMany({ where: { letterId: letter.id } })
    await tx.letterReference.deleteMany({ where: { refLetterId: letter.id } })

    // 2) Berkas arsip + seluruh versinya (berkas fisik di disk dibiarkan —
    //    versioning objectKey unik; storage lama dibersihkan prosedur backup/retensi)
    for (const f of letter.files) {
      await tx.archiveVersion.deleteMany({ where: { archiveFileId: f.id } })
    }
    await tx.archiveFile.deleteMany({ where: { letterId: letter.id } })

    // 3) Idempotency keys milik surat ini
    await tx.idempotencyKey.deleteMany({ where: { letterId: letter.id } })

    // 4) Registry + surat
    await tx.numberRegistry.deleteMany({ where: { letterId: letter.id } })
    await tx.letter.delete({ where: { id: letter.id } })

    // 5) Reset counter periode BILA surat ini satu-satunya pada periode itu
    if (letter.namespaceId && letter.periodKey) {
      const others = await tx.letter.count({
        where: { namespaceId: letter.namespaceId, periodKey: letter.periodKey },
      })
      if (others === 0) {
        await tx.counter.updateMany({
          where: { namespaceId: letter.namespaceId, periodKey: letter.periodKey },
          data: { lastValue: 0 },
        })
        console.log(`Counter periode ${letter.periodKey} direset ke 0 → nomor berikutnya kembali 001.`)
      } else {
        console.log(`Counter TIDAK direset — masih ada ${others} surat lain pada periode ini.`)
      }
    }

    // 6) Jejak audit (append-only, tidak pernah dihapus)
    await tx.auditEvent.create({
      data: {
        action: 'letter.purge',
        entityType: 'letter',
        entityId: letter.id,
        metadata: JSON.stringify({
          officialNumber: letter.officialNumber,
          previousStatus: letter.status,
          reason: 'Permintaan pemilik: hapus surat uji terdaftar, bebaskan nomor 001 untuk pemakaian riil',
          freedNumber: target,
        }),
      },
    })
  })

  const verify = await prisma.numberRegistry.findUnique({ where: { number: target } })
  console.log(verify ? 'PERINGATAN: registry masih ada — periksa manual!' : `Selesai — nomor "${target}" kini bebas dipakai ulang.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
