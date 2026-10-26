import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { ok, fail, handle, guardMutation, readJson } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-helpers'
import { writeAudit } from '@/lib/audit'
import { ROLES } from '@/lib/constants'
import { ROLE_PERMISSIONS } from '@/lib/rbac'

export async function GET() {
  return handle(async () => {
    const r = await requirePermission('user.manage')
    if ('error' in r) return r.error
    const users = await db.user.findMany({
      include: { assignments: { include: { unit: { select: { code: true, name: true } }, committee: { select: { code: true, name: true } } } } },
      orderBy: { username: 'asc' },
    })
    return ok({ users })
  })
}

const createSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().optional().nullable(),
  password: z.string().min(10).max(128),
  role: z.enum(ROLES),
  assignments: z.array(z.object({
    unitId: z.string().optional().nullable(),
    committeeId: z.string().optional().nullable(),
    includeCommittees: z.boolean().default(false),
  })).default([]),
})

export async function POST(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('user.manage')
    if ('error' in r) return r.error

    const parsed = createSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data pengguna tidak valid', { issues: parsed.error.issues })
    const body = parsed.data

    // Batas delegasi (blueprint 16.5): Unit Admin hanya bisa membuat role dengan subset permission miliknya
    const myPerms = ROLE_PERMISSIONS[r.user.role]
    if (myPerms !== '*') {
      const targetPerms = ROLE_PERMISSIONS[body.role]
      if (targetPerms === '*' || (Array.isArray(targetPerms) && targetPerms.some(p => !(myPerms as string[]).includes(p)))) {
        return fail(403, 'ESCALATION', 'Anda hanya dapat membuat pengguna dengan permission yang merupakan subset milik Anda')
      }
    }

    const dup = await db.user.findUnique({ where: { username: body.username } })
    if (dup) return fail(409, 'CONFLICT', 'Username sudah dipakai')

    const passwordHash = await bcrypt.hash(body.password, 10)
    const user = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: body.username, fullName: body.fullName, email: body.email ?? null,
          passwordHash, role: body.role, isActive: true,
        },
      })
      for (const a of body.assignments) {
        await tx.accessAssignment.create({
          data: {
            userId: user.id,
            unitId: a.unitId ?? null,
            committeeId: a.committeeId ?? null,
            includeCommittees: a.includeCommittees,
          },
        })
      }
      await writeAudit(tx, {
        actorId: r.user.id, action: 'user.create', entityType: 'user', entityId: user.id,
        correlationId: r.correlationId,
        metadata: { username: body.username, role: body.role, assignments: body.assignments },
      })
      return user
    })
    return ok({ user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role } }, 201)
  })
}

const patchSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().optional().nullable(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(10).max(128).optional(),
  assignments: z.array(z.object({
    unitId: z.string().optional().nullable(),
    committeeId: z.string().optional().nullable(),
    includeCommittees: z.boolean().default(false),
  })).optional(),
})

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const guard = await guardMutation(req)
    if (guard) return guard
    const r = await requirePermission('user.manage')
    if ('error' in r) return r.error

    const parsed = patchSchema.safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })
    const { id, ...changes } = parsed.data

    const target = await db.user.findUnique({ where: { id } })
    if (!target) return fail(404, 'NOT_FOUND', 'Pengguna tidak ditemukan')

    const myPerms = ROLE_PERMISSIONS[r.user.role]
    if (myPerms !== '*' && changes.role) {
      const targetPerms = ROLE_PERMISSIONS[changes.role]
      if (targetPerms === '*' || (Array.isArray(targetPerms) && targetPerms.some(p => !(myPerms as string[]).includes(p)))) {
        return fail(403, 'ESCALATION', 'Tidak dapat menaikkan role melebihi permission Anda')
      }
    }

    const data: Record<string, unknown> = {}
    if (changes.fullName !== undefined) data.fullName = changes.fullName
    if (changes.email !== undefined) data.email = changes.email
    if (changes.role !== undefined) data.role = changes.role
    if (changes.isActive !== undefined) data.isActive = changes.isActive
    if (changes.password) data.passwordHash = await bcrypt.hash(changes.password, 10)

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data })
      if (changes.assignments) {
        await tx.accessAssignment.deleteMany({ where: { userId: id } })
        for (const a of changes.assignments) {
          await tx.accessAssignment.create({
            data: {
              userId: id, unitId: a.unitId ?? null, committeeId: a.committeeId ?? null,
              includeCommittees: a.includeCommittees,
            },
          })
        }
      }
      await writeAudit(tx, {
        actorId: r.user.id, action: 'user.update', entityType: 'user', entityId: id,
        correlationId: r.correlationId,
        metadata: {
          before: { role: target.role, isActive: target.isActive },
          after: { role: changes.role, isActive: changes.isActive },
          assignmentsReplaced: changes.assignments !== undefined,
          passwordChanged: !!changes.password,
        },
      })
      return u
    })
    return ok({ user: { id: updated.id, username: updated.username, fullName: updated.fullName, role: updated.role, isActive: updated.isActive } })
  })
}
