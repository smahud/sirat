'use client'

// Backup & Restore (master prompt lanjutan B + B.10 penjelasan UI):
// - Full Backup (otoritas global, wajib passphrase) vs Backup Per Unit/kepanitiaan (grant).
// - Restore: unggah → validasi manifest → preview → konfirmasi kuat + password → safety backup → eksekusi.
// - Hak Akses Backup: pengelolaan grant (hanya otoritas global).
// - Riwayat operasi (BackupEvent).
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiGet, apiPost, fmtBytes, fmtDateTime } from '@/lib/client'
import { PageHeader, EmptyState } from './ui-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import {
  DatabaseBackup, ShieldCheck, KeyRound, Lock, Upload, Download, History, Info,
  AlertTriangle, FileArchive, Trash2, Plus,
} from 'lucide-react'
import type { Me, MeBackupScope } from './use-session'

interface CapabilitiesRes {
  capabilities: {
    fullExport: boolean
    fullRestore: boolean
    scopes: MeBackupScope[]
    canExportAny: boolean
    canRestoreAny: boolean
    singleExportScope: MeBackupScope | null
    singleRestoreScope: MeBackupScope | null
  }
}

interface CreateRes {
  fileName: string
  sizeBytes: number
  sha256: string
  encrypted: boolean
  counts: Record<string, number>
  downloadToken: string
}

interface ValidateRes {
  uploadId: string
  originalName: string
  manifest: {
    kind: 'FULL' | 'SCOPED' | 'SAFETY'
    createdAt: string
    createdBy: string
    appVersion: string
    scopeLabels: string[]
    counts: Record<string, number>
    encrypted: boolean
    includesPasswordHash: boolean
    filesMissing: number
  }
  allowedTargets: { type: 'FULL' | 'SCOPED'; unitIds: string[]; committeeIds: string[] }
  warnings: string[]
}

interface RestoreReport {
  kind: 'FULL' | 'SCOPED'
  created: Record<string, number>
  kept: Record<string, number>
  conflicts: { table: string; id: string; reason: string }[]
  countersRaised: number
  filesPromoted: number
}

interface GrantRow {
  id: string
  userId: string
  unitId: string | null
  committeeId: string | null
  canExport: boolean
  canRestore: boolean
  user: { id: string; username: string; fullName: string; role: string }
  unit: { id: string; code: string; name: string } | null
  committee: { id: string; code: string; name: string; unit: { code: string } } | null
}

interface EventRow {
  id: string
  kind: string
  action: string
  actorId: string | null
  fileName: string | null
  sizeBytes: number | null
  status: string
  createdAt: string
  completedAt: string | null
}

export function BackupView({ me }: { me: Me }) {
  const qc = useQueryClient()
  const caps = useQuery({ queryKey: ['backup-caps'], queryFn: () => apiGet<CapabilitiesRes>('/api/backup/capabilities') })
  const grants = useQuery({ queryKey: ['backup-grants'], queryFn: () => apiGet<{ grants: GrantRow[] }>('/api/backup/grants') })
  const events = useQuery({ queryKey: ['backup-events'], queryFn: () => apiGet<{ events: EventRow[] }>('/api/backup/events?limit=30') })

  const C = caps.data?.capabilities
  const isGlobalAuthority = !!C?.fullExport

  // ===== Buat backup =====
  const [createOpen, setCreateOpen] = useState(false)
  const [createType, setCreateType] = useState<'FULL' | 'SCOPED'>('SCOPED')
  const [selectedUnits, setSelectedUnits] = useState<string[]>([])
  const [selectedCommittees, setSelectedCommittees] = useState<string[]>([])
  const [passphrase, setPassphrase] = useState('')
  const [passConfirm, setPassConfirm] = useState('')

  const exportScopes = useMemo(() => (C?.scopes ?? []).filter(s => s.canExport), [C])
  const singleExport = C?.singleExportScope ?? null

  const createBackup = useMutation({
    mutationFn: async (): Promise<CreateRes> => {
      const body: Record<string, unknown> = { type: createType }
      if (createType === 'FULL') {
        body.passphrase = passphrase
      } else if (singleExport) {
        // B.2: satu-satunya scope → otomatis terkunci, tidak bisa dimanipulasi lewat request
        body.unitIds = singleExport.type === 'UNIT' ? [singleExport.id] : []
        body.committeeIds = singleExport.type === 'COMMITTEE' ? [singleExport.id] : []
      } else {
        body.unitIds = selectedUnits
        body.committeeIds = selectedCommittees
      }
      return apiPost<CreateRes>('/api/backup/create', body)
    },
    onSuccess: (data) => {
      setCreateOpen(false)
      setPassphrase('')
      setPassConfirm('')
      toast.success(`Backup dibuat: ${data.fileName}`)
      // Unduh via token satu kali
      window.open(`/api/backup/download?token=${data.downloadToken}`, '_blank')
      qc.invalidateQueries({ queryKey: ['backup-events'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // ===== Restore =====
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [validation, setValidation] = useState<ValidateRes | null>(null)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [restorePassword, setRestorePassword] = useState('')

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      if (restorePassphrase) fd.append('passphrase', restorePassphrase)
      return api<ValidateRes>('/api/backup/validate', { method: 'POST', body: fd })
    },
    onSuccess: (data) => {
      setValidation(data)
      setConfirmText('')
      setRestorePassword('')
      toast.success('Arsip tervalidasi — periksa pratinjau sebelum melanjutkan')
      qc.invalidateQueries({ queryKey: ['backup-events'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const restoreTargets = useMemo(() => {
    if (!validation) return { type: 'SCOPED' as const, unitIds: [] as string[], committeeIds: [] as string[] }
    return validation.allowedTargets
  }, [validation])

  const restore = useMutation({
    mutationFn: () => apiPost<{ report: RestoreReport }>('/api/backup/restore', {
      uploadId: validation!.uploadId,
      passphrase: restorePassphrase || undefined,
      targetType: restoreTargets.type,
      unitIds: restoreTargets.unitIds,
      committeeIds: restoreTargets.committeeIds,
      confirm: 'RESTORE',
      password: restorePassword,
    }),
    onSuccess: (data) => {
      setRestoreConfirmOpen(false)
      setValidation(null)
      setRestorePassphrase('')
      setConfirmText('')
      setRestorePassword('')
      const r = data.report
      toast.success(`Restore ${r.kind} selesai — ${Object.values(r.created).reduce((a, b) => a + b, 0)} baris dipulihkan, ${r.conflicts.length} konflik dilewati`)
      qc.invalidateQueries({ queryKey: ['backup-events'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // ===== Grant =====
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantForm, setGrantForm] = useState({ userId: '', scopeType: 'UNIT' as 'UNIT' | 'COMMITTEE', scopeId: '', canExport: false, canRestore: false })
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<{ users: { id: string; username: string; fullName: string; role: string }[] }>('/api/users'),
    enabled: grantOpen,
  })
  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: { id: string; code: string; name: string }[] }>('/api/units'), enabled: grantOpen })
  const committees = useQuery({
    queryKey: ['committees'],
    queryFn: () => apiGet<{ committees: { id: string; code: string; name: string; unit: { code: string } }[] }>('/api/committees'),
    enabled: grantOpen,
  })

  const upsertGrant = useMutation({
    mutationFn: () => apiPost('/api/backup/grants', {
      userId: grantForm.userId,
      unitId: grantForm.scopeType === 'UNIT' ? grantForm.scopeId : null,
      committeeId: grantForm.scopeType === 'COMMITTEE' ? grantForm.scopeId : null,
      canExport: grantForm.canExport,
      canRestore: grantForm.canRestore,
    }),
    onSuccess: () => {
      toast.success('Hak akses backup disimpan')
      setGrantOpen(false)
      setGrantForm({ userId: '', scopeType: 'UNIT', scopeId: '', canExport: false, canRestore: false })
      qc.invalidateQueries({ queryKey: ['backup-grants'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const revokeGrant = useMutation({
    mutationFn: (id: string) => api('/api/backup/grants', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { toast.success('Hak akses backup dicabut — langsung efektif'); qc.invalidateQueries({ queryKey: ['backup-grants'] }) },
    onError: (e) => toast.error((e as Error).message),
  })

  const canRestoreAnything = C?.canRestoreAny
  const canSeeGrants = isGlobalAuthority || me.permissions !== '*'

  if (caps.isLoading) {
    return <div className="py-16 text-center text-muted-foreground text-sm">Memuat kapabilitas backup…</div>
  }

  if (!C?.canExportAny && !C?.canRestoreAny) {
    return (
      <div>
        <PageHeader title="Backup & Restore" description="Arsip data SIRAT per scope dengan kontrol izin terpisah." />
        <EmptyState
          icon={DatabaseBackup}
          title="Anda tidak memiliki izin backup"
          description="Fungsi backup dan restore tidak tersedia untuk akun Anda. Hubungi Super Admin untuk diberi Hak Akses Backup (grant) pada unit/kepanitiaan tertentu."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Backup & Restore"
        description="Arsip data per scope dengan izin terpisah: backup (export) dan restore adalah dua kewenangan berbeda."
      >
        {C.canExportAny && (
          <Button className="shadow-card" onClick={() => { setCreateType(singleExport || C.fullExport === false ? 'SCOPED' : (C.fullExport ? 'FULL' : 'SCOPED')); setCreateOpen(true) }}>
            <DatabaseBackup className="w-4 h-4 mr-1.5" /> Buat Backup
          </Button>
        )}
      </PageHeader>

      {/* Penjelasan (B.10) */}
      <Card className="shadow-card mb-5 border-emerald/20 bg-gradient-to-br from-emerald-soft/60 to-surface">
        <CardContent className="p-4 grid gap-3 md:grid-cols-3 text-[12.5px] leading-relaxed">
          <div className="flex gap-2.5">
            <FileArchive className="w-4 h-4 text-emerald shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Backup ≠ Restore</p>
              <p className="text-muted-foreground">Membuat/mengunduh backup (export) dan memulihkan data (restore) adalah dua izin berbeda. Bisa backup tanpa boleh restore, dan sebaliknya.</p>
            </div>
          </div>
          <div className="flex gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Full vs Per Unit</p>
              <p className="text-muted-foreground">Full System Backup (seluruh data, terenkripsi, hanya otoritas global) berbeda dari Backup Per Unit/kepanitiaan — hanya data scope Anda, tanpa hash password akun.</p>
            </div>
          </div>
          <div className="flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Risiko Restore</p>
              <p className="text-muted-foreground">Scoped restore bersifat tambah-yang-hilang: data yang sudah ada dipertahankan, konflik nomor ditolak. Ia tidak bisa mengubah akun, role, password, atau jenis surat global.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ===== Kapabilitas ===== */}
        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><KeyRound className="w-4 h-4" /></span>
              Kapabilitas Anda
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant={C.fullExport ? 'default' : 'outline'} className={C.fullExport ? 'bg-emerald text-white' : ''}>
                Full Backup {C.fullExport ? '✓' : '—'}
              </Badge>
              <Badge variant={C.fullRestore ? 'default' : 'outline'} className={C.fullRestore ? 'bg-emerald text-white' : ''}>
                Full Restore {C.fullRestore ? '✓' : '—'}
              </Badge>
              {C.scopes.length === 0 && !C.fullExport && !C.fullRestore && (
                <Badge variant="outline">Tanpa scope</Badge>
              )}
            </div>
            {C.scopes.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="font-semibold">Scope</TableHead>
                    <TableHead className="font-semibold text-center">Backup</TableHead>
                    <TableHead className="font-semibold text-center">Restore</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {C.scopes.map(s => (
                    <TableRow key={`${s.type}-${s.id}`}>
                      <TableCell>
                        <span className="font-mono text-[12px] font-semibold">{s.code}</span>
                        <span className="text-muted-foreground text-[12px]"> — {s.name}</span>
                        {s.type === 'COMMITTEE' && <span className="text-[10.5px] text-muted-foreground"> (kepanitiaan{ s.parentCode ? ` di ${s.parentCode}` : ''})</span>}
                      </TableCell>
                      <TableCell className="text-center">{s.canExport ? <Badge className="bg-emerald text-white">ya</Badge> : <span className="text-muted-foreground text-[12px]">—</span>}</TableCell>
                      <TableCell className="text-center">{s.canRestore ? <Badge className="bg-emerald text-white">ya</Badge> : <span className="text-muted-foreground text-[12px]">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              Scope unit mencakup surat reguler unit <span className="font-semibold">dan seluruh surat kepanitiaan di bawahnya</span> —
              ini adalah makna izin administratif yang diberikan, bukan pewarisan diam-diam.
            </p>
          </CardContent>
        </Card>

        {/* ===== Restore ===== */}
        {canRestoreAnything ? (
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-gold-soft text-gold-dark flex items-center justify-center"><Upload className="w-4 h-4" /></span>
                Restore
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={fileInputRef} type="file" className="hidden"
                accept=".zip,.enc"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) upload.mutate(file)
                  e.target.value = ''
                }}
              />
              <div className="rounded-xl border border-dashed p-4 bg-muted/30 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" className="bg-surface" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
                    <Upload className="w-4 h-4 mr-1.5" /> {upload.isPending ? 'Memvalidasi…' : 'Pilih file backup (.zip / .zip.enc)'}
                  </Button>
                  <div className="flex-1 min-w-44 space-y-1.5">
                    <Label className="text-[11.5px] text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Passphrase (jika arsip terenkripsi)</Label>
                    <Input type="password" value={restorePassphrase} onChange={(e) => setRestorePassphrase(e.target.value)} className="bg-surface h-8" placeholder="Kosongkan bila tidak terenkripsi" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Validasi membaca manifest di dalam arsip (bukan nama file): tipe backup, scope, versi skema, dan integritas checksum.
                  Restore memerlukan konfirmasi kuat + password Anda; safety backup otomatis dibuat sistem sebelum eksekusi.
                </p>
              </div>

              {validation && (
                <div className="rounded-xl border bg-surface p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={validation.manifest.kind === 'FULL' || validation.manifest.kind === 'SAFETY' ? 'bg-emerald text-white' : 'bg-gold text-gold-dark'}>
                      {validation.manifest.kind === 'SCOPED' ? 'Backup Per Scope' : 'Backup FULL'}
                    </Badge>
                    <span className="text-[12px] text-muted-foreground">
                      dibuat {fmtDateTime(validation.manifest.createdAt)} oleh {validation.manifest.createdBy}
                    </span>
                  </div>
                  {validation.manifest.scopeLabels.length > 0 && (
                    <p className="text-[12.5px]">Scope asal: <span className="font-mono font-semibold">{validation.manifest.scopeLabels.join(', ')}</span></p>
                  )}
                  <div className="text-[12px] text-muted-foreground">
                    Isi: {Object.entries(validation.manifest.counts).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'kosong'}
                  </div>
                  {validation.warnings.map((w, i) => (
                    <p key={i} className="text-[11.5px] text-gold-dark flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</p>
                  ))}
                  {validation.allowedTargets.type === 'SCOPED' && (
                    <p className="text-[11.5px] text-muted-foreground">
                      Target restore Anda: {validation.allowedTargets.unitIds.length + validation.allowedTargets.committeeIds.length} scope yang Anda miliki izin restore-nya.
                      Data unit lain di dalam arsip tidak akan disentuh.
                    </p>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => setRestoreConfirmOpen(true)}
                    disabled={restore.isPending}
                  >
                    <Upload className="w-4 h-4 mr-1.5" /> Lanjutkan ke Restore…
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center"><Lock className="w-4 h-4" /></span>
                Restore
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Anda dapat membuat backup, tetapi <span className="font-semibold text-foreground">tidak memiliki izin restore</span>.
                Fungsi pemulihan data memerlukan kewenangan terpisah — hubungi Super Admin.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ===== Grants ===== */}
      {canSeeGrants && (
        <Card className="shadow-card mt-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] font-semibold flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><ShieldCheck className="w-4 h-4" /></span>
                Hak Akses Backup
                <span className="text-muted-foreground font-normal text-[13px]">({grants.data?.grants.length ?? 0})</span>
              </span>
              {isGlobalAuthority && (
                <Button size="sm" className="shadow-card h-8" onClick={() => setGrantOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Beri Hak
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(grants.data?.grants.length ?? 0) === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="Belum ada grant"
                description="Admin Unit tidak otomatis bisa backup/restore. Super Admin memberikan izin eksplisit per unit/kepanitiaan lewat daftar ini — pencabutan langsung efektif."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="font-semibold">Pengguna</TableHead>
                      <TableHead className="font-semibold">Scope</TableHead>
                      <TableHead className="font-semibold text-center">Backup</TableHead>
                      <TableHead className="font-semibold text-center">Restore</TableHead>
                      {isGlobalAuthority && <TableHead className="text-right font-semibold">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grants.data?.grants.map(g => (
                      <TableRow key={g.id}>
                        <TableCell>
                          <p className="text-[13px] font-semibold">{g.user.fullName}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{g.user.username}</p>
                        </TableCell>
                        <TableCell>
                          {g.unit ? (
                            <span><span className="font-mono text-[12px] font-semibold">{g.unit.code}</span> — {g.unit.name}</span>
                          ) : g.committee ? (
                            <span><span className="font-mono text-[12px] font-semibold">{g.committee.code}</span> — {g.committee.name} <span className="text-[10.5px] text-muted-foreground">(di {g.committee.unit.code})</span></span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-center">{g.canExport ? <Badge className="bg-emerald text-white">ya</Badge> : '—'}</TableCell>
                        <TableCell className="text-center">{g.canRestore ? <Badge className="bg-emerald text-white">ya</Badge> : '—'}</TableCell>
                        {isGlobalAuthority && (
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-8 bg-surface text-destructive hover:bg-red-50"
                              onClick={() => revokeGrant.mutate(g.id)} aria-label="Cabut grant">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== Riwayat ===== */}
      {(events.data?.events.length ?? 0) > 0 && (
        <Card className="shadow-card mt-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><History className="w-4 h-4" /></span>
              Riwayat Operasi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="font-semibold">Waktu</TableHead>
                    <TableHead className="font-semibold">Jenis</TableHead>
                    <TableHead className="font-semibold">Aksi</TableHead>
                    <TableHead className="font-semibold">File</TableHead>
                    <TableHead className="font-semibold">Ukuran</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.data?.events.map(ev => (
                    <TableRow key={ev.id}>
                      <TableCell className="text-[12px] whitespace-nowrap">{fmtDateTime(ev.createdAt)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10.5px]">{ev.kind}</Badge></TableCell>
                      <TableCell className="text-[12px]">{ev.action}</TableCell>
                      <TableCell className="text-[11.5px] font-mono max-w-52 truncate">{ev.fileName ?? '—'}</TableCell>
                      <TableCell className="text-[12px] whitespace-nowrap">{ev.sizeBytes ? fmtBytes(ev.sizeBytes) : '—'}</TableCell>
                      <TableCell>
                        <Badge className={ev.status === 'COMPLETED' ? 'bg-emerald text-white' : ev.status === 'FAILED' ? 'bg-red-600 text-white' : 'bg-gold text-gold-dark'}>
                          {ev.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Dialog: buat backup ===== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Buat Backup</DialogTitle>
            <DialogDescription>
              Arsip diunduh sebagai ZIP dengan manifest integritas. Full backup terenkripsi AES-256-GCM.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant={createType === 'FULL' ? 'default' : 'outline'}
                className={`h-auto py-3 flex-col gap-1 ${createType === 'FULL' ? 'shadow-card' : 'bg-surface'}`}
                disabled={!C?.fullExport}
                onClick={() => setCreateType('FULL')}
              >
                <DatabaseBackup className="w-5 h-5" />
                <span className="text-[13px] font-semibold">Full System</span>
                <span className="text-[10.5px] font-normal opacity-75">seluruh data + hash password</span>
              </Button>
              <Button
                type="button"
                variant={createType === 'SCOPED' ? 'default' : 'outline'}
                className={`h-auto py-3 flex-col gap-1 ${createType === 'SCOPED' ? 'shadow-card' : 'bg-surface'}`}
                disabled={exportScopes.length === 0}
                onClick={() => setCreateType('SCOPED')}
              >
                <FileArchive className="w-5 h-5" />
                <span className="text-[13px] font-semibold">Per Scope</span>
                <span className="text-[10.5px] font-normal opacity-75">unit / kepanitiaan Anda</span>
              </Button>
            </div>

            {createType === 'FULL' && (
              <div className="space-y-3">
                <p className="text-[12px] text-muted-foreground leading-relaxed flex gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-gold-dark" />
                  Full backup memuat hash password akun — wajib dienkripsi. Simpan passphrase Anda; tanpa passphrase, arsip tidak bisa dipulihkan.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold">Passphrase enkripsi (min 8 karakter)</Label>
                  <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="bg-surface" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold">Ulangi passphrase</Label>
                  <Input type="password" value={passConfirm} onChange={(e) => setPassConfirm(e.target.value)} className="bg-surface" />
                </div>
              </div>
            )}

            {createType === 'SCOPED' && singleExport && (
              <div className="rounded-xl border bg-surface p-3.5 space-y-1.5">
                <p className="text-[12.5px] font-semibold flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-muted-foreground" /> Scope otomatis</p>
                <p className="text-[12px] text-muted-foreground">
                  Anda hanya memiliki satu scope: <span className="font-mono font-semibold text-foreground">{singleExport.code}</span> — {singleExport.name}.
                  Target terkunci dan tidak dapat diubah.
                </p>
              </div>
            )}

            {createType === 'SCOPED' && !singleExport && exportScopes.length > 1 && (
              <div className="space-y-2.5">
                <Label className="text-[12px] font-semibold">Pilih scope (bisa lebih dari satu)</Label>
                {exportScopes.map(s => (
                  <label key={`${s.type}-${s.id}`} className="flex items-center gap-2.5 rounded-lg border bg-surface p-2.5 cursor-pointer">
                    <Checkbox
                      checked={s.type === 'UNIT' ? selectedUnits.includes(s.id) : selectedCommittees.includes(s.id)}
                      onCheckedChange={(v) => {
                        if (s.type === 'UNIT') {
                          setSelectedUnits(prev => v ? [...prev, s.id] : prev.filter(x => x !== s.id))
                        } else {
                          setSelectedCommittees(prev => v ? [...prev, s.id] : prev.filter(x => x !== s.id))
                        }
                      }}
                    />
                    <span className="text-[13px]">
                      <span className="font-mono font-semibold">{s.code}</span> — {s.name}
                      {s.type === 'COMMITTEE' && <span className="text-[10.5px] text-muted-foreground"> (kepanitiaan)</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {createType === 'SCOPED' && exportScopes.length > 1 && (
              <p className="text-[11.5px] text-muted-foreground">Passphrase opsional untuk backup per scope (tidak berisi hash password akun).</p>
            )}
            {createType === 'SCOPED' && exportScopes.length > 1 && (
              <div className="space-y-1.5">
                <Input
                  type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                  className="bg-surface" placeholder="Passphrase opsional untuk enkripsi"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button
              disabled={createBackup.isPending
                || (createType === 'FULL' && (passphrase.length < 8 || passphrase !== passConfirm))
                || (createType === 'SCOPED' && !singleExport && selectedUnits.length + selectedCommittees.length === 0)}
              onClick={() => createBackup.mutate()}
            >
              {createBackup.isPending ? 'Membangun arsip…' : 'Buat & Unduh'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: konfirmasi restore ===== */}
      <Dialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-lg">
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><AlertTriangle className="w-4 h-4" /></span>
              Konfirmasi Restore {restoreTargets.type === 'FULL' ? 'Penuh' : 'Per Scope'}
            </DialogTitle>
            <DialogDescription>
              {restoreTargets.type === 'FULL'
                ? 'Full restore MENGGANTI seluruh data sistem dengan isi arsip. Safety backup otomatis dibuat sebelum eksekusi.'
                : 'Scoped restore menambahkan data yang hilang dan mempertahankan data yang sudah ada; konflik nomor ditolak otomatis.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-[12px] text-red-700 leading-relaxed">
              Ketik <span className="font-mono font-bold">RESTORE</span> untuk konfirmasi, lalu masukkan password akun Anda
              (autentikasi ulang wajib).
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Ketik RESTORE</Label>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} className="bg-surface font-mono" placeholder="RESTORE" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Password akun Anda</Label>
              <Input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} className="bg-surface" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRestoreConfirmOpen(false)}>Batal</Button>
            <Button variant="destructive" disabled={confirmText !== 'RESTORE' || !restorePassword || restore.isPending} onClick={() => restore.mutate()}>
              {restore.isPending ? 'Memulihkan…' : 'Jalankan Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: grant ===== */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Beri Hak Akses Backup</DialogTitle>
            <DialogDescription>
              Izin eksplisit per scope. Backup dan restore diberikan terpisah; pencabutan langsung efektif.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Pengguna</Label>
              <Select value={grantForm.userId || undefined} onValueChange={(v) => setGrantForm({ ...grantForm, userId: v })}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih pengguna" /></SelectTrigger>
                <SelectContent>
                  {(users.data?.users ?? []).filter(u => u.role !== 'SYSTEM_ADMIN').map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.username})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Jenis scope</Label>
                <Select value={grantForm.scopeType} onValueChange={(v) => setGrantForm({ ...grantForm, scopeType: v as 'UNIT' | 'COMMITTEE', scopeId: '' })}>
                  <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNIT">Unit / Departemen</SelectItem>
                    <SelectItem value="COMMITTEE">Kepanitiaan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Scope</Label>
                <Select value={grantForm.scopeId || undefined} onValueChange={(v) => setGrantForm({ ...grantForm, scopeId: v })}>
                  <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>
                    {grantForm.scopeType === 'UNIT'
                      ? (units.data?.units ?? []).map(u => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)
                      : (committees.data?.committees ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-5">
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={grantForm.canExport} onCheckedChange={(v) => setGrantForm({ ...grantForm, canExport: !!v })} />
                Boleh backup (export)
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={grantForm.canRestore} onCheckedChange={(v) => setGrantForm({ ...grantForm, canRestore: !!v })} />
                Boleh restore
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setGrantOpen(false)}>Batal</Button>
            <Button
              disabled={!grantForm.userId || !grantForm.scopeId || (!grantForm.canExport && !grantForm.canRestore) || upsertGrant.isPending}
              onClick={() => upsertGrant.mutate()}
            >
              {upsertGrant.isPending ? 'Menyimpan…' : 'Simpan Hak'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
