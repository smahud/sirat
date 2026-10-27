import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'

/**
 * Manajemen Hak Akses Backup (BackupGrant) — master prompt lanjutan B.1/A.7.
 * Hanya otoritas global (SYSTEM_ADMIN/ORG_ADMIN via permission backup.export)
 * yang boleh memberi/mencabut grant. Pencabutan langsung efektif: kapabilitas
 * di-resolve per request dari tabel ini.
 */

const GRANT_SELECT = {
  id: true, userId: true, unitId: true, committeeId: true,
  canExport: true, canRestore: true, grantedById: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, username: true, fullName: true, role: true } },
  unit: { select: { id: true, code: true, name: true } },
  committee: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } },
} as const

export async function GET() {
  return handle(async () => {
    const r = await requirePermission('user.manage')
    if ('error' in r) return r.error
    const grants = await db.backupGrant.findMany({
      select: GRANT_SELECT,
      orderBy: [{ user: { username: 'asc' } }],
    })
    return ok({ grants })
  })
}

const upsertSchema = z.object({
  userId: z.string().min(1),
  unitId: z.string().optional().nullable(),
  committeeId: z.string().optional().nullable(),
  canExport: z.boolean().default(false),
  canRestore: z.boolean().default(false),
}).refine(g => !!g.unitId !== !!g.committeeId, {
  message: 'Pilih tepat satu: unit ATAU kepanitiaan',
}).refine(g => g.canExport || g.canRestore, {
  message: 'Minimal satu izin (backup atau restore) harus aktif',
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    // Hanya pemberi izin global — Admin Unit TIDAK bisa memberi grant (A.7:
    // tidak boleh memberikan permission melebihi kewenangannya)
    const r = await requirePermission('backup.export')
    if ('error' in r) return r.error

    const parsed = upsertSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data grant tidak valid', { issues: parsed.error.issues })
    const g = parsed.data

    const user = await db.user.findUnique({ where: { id: g.userId }, select: { id: true, username: true, role: true, isActive: true } })
    if (!user) return fail(404, 'NOT_FOUND', 'Pengguna tidak ditemukan')
    if (user.role === 'SYSTEM_ADMIN') {
      return fail(409, 'NOT_NEEDED', 'Super Admin sudah memiliki kewenangan backup global — grant tidak diperlukan')
    }
    if (g.unitId) {
      const unit = await db.unit.findUnique({ where: { id: g.unitId }, select: { id: true, code: true } })
      if (!unit) return fail(404, 'NOT_FOUND', 'Unit tidak ditemukan')
    }
    if (g.committeeId) {
      const c = await db.committee.findUnique({ where: { id: g.committeeId }, select: { id: true, code: true } })
      if (!c) return fail(404, 'NOT_FOUND', 'Kepanitiaan tidak ditemukan')
    }

    const grant = await db.$transaction(async (tx) => {
      // Upsert pada (userId, unitId, committeeId)
      const existing = await tx.backupGrant.findFirst({
        where: { userId: g.userId, unitId: g.unitId ?? null, committeeId: g.committeeId ?? null },
      })
      if (existing) {
        return tx.backupGrant.update({
          where: { id: existing.id },
          data: { canExport: g.canExport, canRestore: g.canRestore, grantedById: r.user.id },
          select: GRANT_SELECT,
        })
      }
      return tx.backupGrant.create({
        data: {
          userId: g.userId, unitId: g.unitId ?? null, committeeId: g.committeeId ?? null,
          canExport: g.canExport, canRestore: g.canRestore, grantedById: r.user.id,
        },
        select: GRANT_SELECT,
      })
    })
    await writeAudit(db, {
      actorId: r.user.id, action: 'backup.grant.upsert', entityType: 'backupGrant', entityId: grant.id,
      correlationId: r.correlationId,
      metadata: { user: user.username, unitId: g.unitId, committeeId: g.committeeId, canExport: g.canExport, canRestore: g.canRestore },
    })
    return ok({ grant }, 201)
  })
}

const deleteSchema = z.object({ id: z.string().min(1) })

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('backup.export')
    if ('error' in r) return r.error
    const parsed = deleteSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Parameter id wajib')
    const existing = await db.backupGrant.findUnique({ where: { id: parsed.data.id } })
    if (!existing) return fail(404, 'NOT_FOUND', 'Grant tidak ditemukan')
    await db.$transaction(async (tx) => {
      await tx.backupGrant.delete({ where: { id: existing.id } })
      await writeAudit(tx, {
        actorId: r.user.id, action: 'backup.grant.revoke', entityType: 'backupGrant', entityId: existing.id,
        correlationId: r.correlationId,
        metadata: { userId: existing.userId, unitId: existing.unitId, committeeId: existing.committeeId },
      })
    })
    return ok({ revoked: true })
  })
}
