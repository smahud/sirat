// Bootstrap admin sekali pakai (blueprint 16.5): tanpa wizard publik.
// SIRAT_ADMIN_USERNAME + SIRAT_ADMIN_PASSWORD (di-generate acak bila kosong — dicetak SEKALI).
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()
const username = process.env.SIRAT_ADMIN_USERNAME || 'admin'
const existing = await prisma.user.findUnique({ where: { username } })

if (existing && !process.argv.includes('--force')) {
  console.log(`User "${username}" sudah ada. Gunakan --force untuk reset password.`)
  process.exit(0)
}

const password = process.env.SIRAT_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url')
const passwordHash = await bcrypt.hash(password, 10)

if (existing) {
  await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, role: 'SYSTEM_ADMIN', isActive: true } })
  console.log(`Password "${username}" direset.`)
} else {
  await prisma.user.create({
    data: { username, fullName: 'Administrator SIRAT', passwordHash, role: 'SYSTEM_ADMIN', isActive: true },
  })
}

console.log('========================================')
console.log(`Username : ${username}`)
console.log(`Password : ${password}`)
console.log('Simpan sekarang — tidak akan ditampilkan lagi.')
console.log('========================================')
await prisma.$disconnect()
