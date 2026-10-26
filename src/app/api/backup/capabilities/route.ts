import { handle, ok, requireUser } from '@/lib/api-helpers'
import { resolveBackupCapabilities } from '@/lib/rbac'

/** Kapabilitas backup user (B.1–B.2): full + scoped, dipakai FE untuk render UI. */
export async function GET() {
  return handle(async () => {
    const r = await requireUser()
    if ('error' in r) return r.error
    const caps = await resolveBackupCapabilities(r.user)
    return ok({
      capabilities: {
        ...caps,
        canExportAny: caps.fullExport || caps.scopes.some(s => s.canExport),
        canRestoreAny: caps.fullRestore || caps.scopes.some(s => s.canRestore),
        singleExportScope: !caps.fullExport && caps.scopes.filter(s => s.canExport).length === 1
          ? caps.scopes.find(s => s.canExport)!
          : null,
        singleRestoreScope: !caps.fullRestore && caps.scopes.filter(s => s.canRestore).length === 1
          ? caps.scopes.find(s => s.canRestore)!
          : null,
      },
    })
  })
}
