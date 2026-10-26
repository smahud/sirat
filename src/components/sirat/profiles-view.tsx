'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '@/lib/client'
import { PageHeader, EmptyState } from './ui-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, Plus, Trash2, Pencil, SlidersHorizontal, Hash, CheckCircle2, Info,
  Layers, ShieldCheck,
} from 'lucide-react'
import type { NumberingDSL, DSLComponent } from '@/lib/numbering/dsl'

interface ProfileRow {
  id: string
  name: string
  ownerId: string
  owner: { id: string; code: string; name: string }
  committee: { id: string; code: string; name: string } | null
  versions: { id: string; version: number; status: string; activatedAt: string | null; dsl: string }[]
}
interface UnitRow { id: string; code: string; name: string }

/** Konteks builder: buat profil baru, edit draft, atau turunkan versi baru. */
interface BuilderCtx {
  mode: 'create' | 'draft' | 'new-version'
  profileId?: string
  name?: string
  initialDsl?: NumberingDSL
}

export function ProfilesView() {
  const qc = useQueryClient()
  const [builder, setBuilder] = useState<BuilderCtx | null>(null)
  const [activateVersion, setActivateVersion] = useState<ProfileRow['versions'][0] | null>(null)
  const [renameProfile, setRenameProfile] = useState<ProfileRow | null>(null)
  const [deleteProfile, setDeleteProfile] = useState<ProfileRow | null>(null)

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => apiGet<{ profiles: ProfileRow[] }>('/api/numbering-profiles') })
  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: UnitRow[] }>('/api/units') })

  const activate = useMutation({
    mutationFn: ({ versionId, resetPolicy, dateSource }: { versionId: string; resetPolicy: string; dateSource: string }) =>
      apiPost('/api/numbering-profiles/activate', { versionId, resetPolicy, dateSource }),
    onSuccess: () => {
      toast.success('Versi profil diaktifkan')
      setActivateVersion(null)
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div>
      <PageHeader
        title="Profil Nomor"
        description="Format nomor surat per unit/kepanitiaan — dikelola pusat sebagai kebijakan organisasi. Versi yang sudah aktif immutable; setiap perubahan berarti versi baru."
      >
        <Button onClick={() => setBuilder({ mode: 'create' })} className="shadow-card">
          <Plus className="w-4 h-4 mr-1.5" /> Profil Baru
        </Button>
      </PageHeader>

      <div className="rounded-xl border border-emerald/25 bg-emerald-soft/40 p-4 mb-5 flex gap-3.5">
        <ShieldCheck className="w-[18px] h-[18px] text-emerald shrink-0 mt-0.5" />
        <p className="text-[12.5px] leading-relaxed text-foreground/80">
          <span className="font-semibold text-emerald-deep">Menu khusus pusat.</span> Profil penomoran menentukan bentuk
          nomor resmi seluruh surat organisasi, sehingga hanya Admin Organisasi/Sistem yang berhak mengelolanya.
          Admin unit ke bawah tidak melihat menu ini. Perubahan pada versi yang sudah aktif selalu dibuat sebagai
          <span className="font-semibold"> versi baru</span> — histori nomor surat lama tidak pernah berubah.
        </p>
      </div>

      {profiles.data?.profiles.length === 0 && (
        <Card className="shadow-card">
          <CardContent className="p-0">
            <EmptyState
              icon={SlidersHorizontal}
              title="Belum ada profil penomoran"
              description="Buat profil untuk unit — misalnya preset workbook 2026 untuk YAPSI: 001/A/SR/YAPSI-DS/X/2026."
            >
              <Button onClick={() => setBuilder({ mode: 'create' })} className="shadow-card">
                <Plus className="w-4 h-4 mr-1.5" /> Buat Profil Pertama
              </Button>
            </EmptyState>
          </CardContent>
        </Card>
      )}

      {profiles.data?.profiles.map((p) => {
        const latest = p.versions[0]
        const hasOpenDraft = latest?.status === 'DRAFT'
        return (
          <Card key={p.id} className="shadow-card mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-[15px] font-semibold flex flex-wrap items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center">
                  <SlidersHorizontal className="w-4 h-4" />
                </span>
                <span className="truncate max-w-xs" title={p.name}>{p.name}</span>
                <Badge variant="outline" className="font-medium text-[11px]">
                  {p.committee ? `Panitia ${p.committee.code}` : `Unit ${p.owner.code}`}
                </Badge>
                <span className="ml-auto flex items-center gap-1.5">
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Ubah nama profil"
                    onClick={() => setRenameProfile(p)} aria-label="Ubah nama profil">
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Buat versi baru dari profil ini"
                    onClick={() => {
                      const active = p.versions.find(v => v.status === 'ACTIVE') ?? latest
                      setBuilder({
                        mode: 'new-version', profileId: p.id, name: p.name,
                        initialDsl: active ? JSON.parse(active.dsl) as NumberingDSL : undefined,
                      })
                    }} aria-label="Buat versi baru">
                    <Layers className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-red-50"
                    title="Hapus profil" onClick={() => setDeleteProfile(p)} aria-label="Hapus profil">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {p.versions.map((v) => {
                const dsl = JSON.parse(v.dsl) as NumberingDSL
                const sample = dsl.components.map(c => componentLabel(c)).join(dsl.separator)
                const isActive = v.status === 'ACTIVE'
                const isDraft = v.status === 'DRAFT'
                const isLatest = v.id === latest?.id
                return (
                  <div
                    key={v.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 transition-colors ${isActive ? 'border-emerald/30 bg-emerald-soft/40' : 'bg-surface'}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-mono text-[12px] font-semibold px-2.5 py-1 rounded-md ${isActive ? 'bg-emerald text-white' : 'bg-muted'}`}>
                          {sample}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[11px] font-semibold ${isActive ? 'border-emerald/40 text-emerald-deep' : ''}`}
                        >
                          v{v.version} · {versionStatusLabel(v.status)}
                        </Badge>
                        {isActive && <CheckCircle2 className="w-4 h-4 text-emerald" />}
                      </div>
                      <p className="text-[11.5px] text-muted-foreground mt-1.5">
                        {dsl.components.length} komponen · separator “{dsl.separator}”
                        {v.activatedAt ? ` · aktif sejak ${new Date(v.activatedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isDraft && isLatest && (
                        <Button size="sm" variant="outline" className="bg-surface h-8"
                          onClick={() => setBuilder({
                            mode: 'draft', profileId: p.id, name: p.name,
                            initialDsl: dsl,
                          })}>
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit Draft
                        </Button>
                      )}
                      {isDraft && (
                        <Button size="sm" className="shadow-card h-8" onClick={() => setActivateVersion(v)}>
                          Aktivasi…
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
              {!hasOpenDraft && (
                <p className="text-[11.5px] text-muted-foreground pl-1">
                  Tidak ada draft terbuka — gunakan tombol <span className="font-semibold inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5" />Buat versi baru</span> untuk mengubah format ke depan.
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}

      <ProfileBuilder
        ctx={builder}
        units={units.data?.units ?? []}
        onClose={() => setBuilder(null)}
        onSaved={() => { setBuilder(null); qc.invalidateQueries({ queryKey: ['profiles'] }) }}
      />

      <Dialog open={!!activateVersion} onOpenChange={(v) => !v && setActivateVersion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-lg flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-gold-soft text-gold-dark flex items-center justify-center"><Hash className="w-4 h-4" /></span>
              Aktivasi Versi Profil
            </DialogTitle>
            <DialogDescription>
              Pilih kebijakan counter secara eksplisit — keputusan bisnis yang tidak diasumsikan dari workbook.
            </DialogDescription>
          </DialogHeader>
          <ActivateForm
            onSubmit={(resetPolicy, dateSource) =>
              activate.mutate({ versionId: activateVersion!.id, resetPolicy, dateSource })}
            busy={activate.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* ==== Rename ==== */}
      <RenameDialog
        profile={renameProfile}
        onClose={() => setRenameProfile(null)}
        onSaved={() => { setRenameProfile(null); qc.invalidateQueries({ queryKey: ['profiles'] }) }}
      />

      {/* ==== Delete (guarded) ==== */}
      <DeleteDialog
        profile={deleteProfile}
        onClose={() => setDeleteProfile(null)}
        onSaved={() => { setDeleteProfile(null); qc.invalidateQueries({ queryKey: ['profiles'] }) }}
      />
    </div>
  )
}

function versionStatusLabel(s: string): string {
  return { DRAFT: 'Draft', ACTIVE: 'Aktif', RETIRED: 'Pensiun' }[s] ?? s
}

function componentLabel(c: DSLComponent): string {
  switch (c.type) {
    case 'literal': return c.value
    case 'sequence': return `[SEQ:${c.padding}]`
    case 'direction': return `[ARAH:${Object.values(c.mapping).join('/')}]`
    case 'letterTypeCode': return '[KODE_JENIS]'
    case 'unitCode': return '[KODE_UNIT]'
    case 'committeeCode': return '[KODE_PANITIA]'
    case 'letterDate': return `[TGL_SURAT:${c.format}]`
    case 'issueDate': return `[TGL_TERBIT:${c.format}]`
  }
}

function ActivateForm({ onSubmit, busy }: { onSubmit: (resetPolicy: string, dateSource: string) => void; busy: boolean }) {
  const [resetPolicy, setResetPolicy] = useState('ALL')
  const [dateSource, setDateSource] = useState('LETTER_DATE')
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gold/30 bg-gold-soft/60 p-3.5 flex gap-3">
        <Info className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
        <p className="text-[12px] text-foreground/75 leading-relaxed">
          Bukti workbook 2026 menunjukkan sequence berjalan lintas bulan. <span className="font-semibold">YEARLY adalah usulan</span> —
          pilih dengan sadar sesuai kebijakan organisasi.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="font-semibold text-[13px]">Kebijakan reset counter</Label>
        <Select value={resetPolicy} onValueChange={setResetPolicy}>
          <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tidak pernah reset (ALL)</SelectItem>
            <SelectItem value="YEARLY">Reset tahunan (YEARLY)</SelectItem>
            <SelectItem value="MONTHLY">Reset bulanan (MONTHLY)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="font-semibold text-[13px]">Sumber tanggal komponen</Label>
        <Select value={dateSource} onValueChange={setDateSource}>
          <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="LETTER_DATE">Tanggal surat</SelectItem>
            <SelectItem value="ISSUE_DATE">Waktu penerbitan</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button onClick={() => onSubmit(resetPolicy, dateSource)} disabled={busy} className="shadow-card min-w-28">
          {busy ? 'Mengaktivasi…' : 'Aktivasi'}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ===================== Rename & Delete =====================

function RenameDialog({ profile, onClose, onSaved }: {
  profile: ProfileRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  // reset state saat profil target berganti
  const [lastId, setLastId] = useState('')
  if (profile && profile.id !== lastId) {
    setLastId(profile.id)
    setName(profile.name)
  }
  const rename = useMutation({
    mutationFn: () => apiPatch(`/api/numbering-profiles?id=${profile!.id}`, { name }),
    onSuccess: () => { toast.success('Nama profil diperbarui'); onSaved() },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog open={!!profile} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><Pencil className="w-4 h-4" /></span>
            Ubah Nama Profil
          </DialogTitle>
          <DialogDescription>
            Nama hanya label dokumentasi — pemilik profil (unit/kepanitiaan) tidak dapat dipindahkan
            demi kesinambungan histori nomor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="font-semibold text-[13px]">Nama profil</Label>
          <Input value={name} className="bg-surface" onChange={(e) => setName(e.target.value)}
            placeholder="mis. Preset Workbook 2026" autoFocus />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={!name.trim() || name === profile?.name || rename.isPending}
            onClick={() => rename.mutate()} className="shadow-card min-w-28">
            {rename.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ profile, onClose, onSaved }: {
  profile: ProfileRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const del = useMutation({
    mutationFn: () => apiDelete(`/api/numbering-profiles?id=${profile!.id}`),
    onSuccess: () => { toast.success('Profil dihapus'); onSaved() },
    onError: (e) => toast.error((e as Error).message),
  })
  const hasActive = !!profile?.versions.some(v => v.status === 'ACTIVE')
  return (
    <Dialog open={!!profile} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-red-50 text-destructive flex items-center justify-center"><Trash2 className="w-4 h-4" /></span>
            Hapus Profil?
          </DialogTitle>
          <DialogDescription>
            {profile && (
              <>
                Profil <span className="font-semibold">{profile.name}</span>
                {' '}({profile.committee ? `Panitia ${profile.committee.code}` : `Unit ${profile.owner.code}`})
                {hasActive
                  ? ' masih memiliki versi AKTIF — unit/panitia ini sedang memakainya untuk menerbitkan surat. '
                  : ' beserta seluruh versinya akan dihapus. '}
                Penghapusan diblokir sistem bila profil masih aktif atau memiliki histori penomoran.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button variant="destructive" disabled={del.isPending || hasActive} onClick={() => del.mutate()}>
            {del.isPending ? 'Menghapus…' : 'Ya, Hapus'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================== Builder =====================

const COMPONENT_PRESETS: { label: string; make: () => DSLComponent }[] = [
  { label: 'Urutan (sequence)', make: () => ({ type: 'sequence', padding: 3 }) },
  { label: 'Arah (dgn mapping)', make: () => ({ type: 'direction', mapping: { INTERNAL: 'A', EXTERNAL: 'B' } }) },
  { label: 'Kode jenis surat', make: () => ({ type: 'letterTypeCode' }) },
  { label: 'Kode unit', make: () => ({ type: 'unitCode' }) },
  { label: 'Kode kepanitiaan', make: () => ({ type: 'committeeCode' }) },
  { label: 'Nilai statis', make: () => ({ type: 'literal', value: 'YAPSI-DS' }) },
  { label: 'Bulan Romawi (tgl surat)', make: () => ({ type: 'letterDate', format: 'MONTH_ROMAN' }) },
  { label: 'Tahun 4 digit (tgl surat)', make: () => ({ type: 'letterDate', format: 'YEAR_4' }) },
]

const DEFAULT_COMPONENTS: DSLComponent[] = [
  { type: 'sequence', padding: 3 },
  { type: 'direction', mapping: { INTERNAL: 'A', EXTERNAL: 'B' } },
  { type: 'letterTypeCode' },
  { type: 'literal', value: 'YAPSI-DS' },
  { type: 'letterDate', format: 'MONTH_ROMAN' },
  { type: 'letterDate', format: 'YEAR_4' },
]

function ProfileBuilder({ ctx, units, onClose, onSaved }: {
  ctx: BuilderCtx | null
  units: UnitRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const isCreate = ctx?.mode === 'create'
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [separator, setSeparator] = useState('/')
  const [components, setComponents] = useState<DSLComponent[]>(DEFAULT_COMPONENTS)
  // Sinkronkan state saat konteks builder berganti
  const [lastKey, setLastKey] = useState('')
  const key = ctx ? `${ctx.mode}:${ctx.profileId ?? 'new'}:${ctx.initialDsl ? JSON.stringify(ctx.initialDsl) : ''}` : ''
  if (ctx && key !== lastKey) {
    setLastKey(key)
    setName(ctx.name ?? '')
    setOwnerId('')
    setSeparator(ctx.initialDsl?.separator ?? '/')
    setComponents(ctx.initialDsl?.components ?? DEFAULT_COMPONENTS)
  }

  const dsl: NumberingDSL = { version: 1, separator: separator as NumberingDSL['separator'], components }

  const validate = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; errors: string[]; warnings: string[]; example?: string; preview?: { text: string } }>(
      '/api/numbering-profiles/validate', { dsl }),
  })

  const save = useMutation({
    mutationFn: () => {
      if (!ctx) throw new Error('Konteks builder kosong')
      if (ctx.mode === 'create') {
        return apiPost('/api/numbering-profiles', { name, ownerId, dsl })
      }
      return apiPut('/api/numbering-profiles', { profileId: ctx.profileId, dsl, mode: ctx.mode === 'draft' ? 'draft' : 'new' })
    },
    onSuccess: () => {
      toast.success(isCreate ? 'Profil dibuat (versi DRAFT)' : ctx?.mode === 'draft' ? 'Draft diperbarui' : 'Versi baru dibuat (DRAFT)')
      onSaved()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= components.length) return
    const next = [...components]
    ;[next[i], next[j]] = [next[j], next[i]]
    setComponents(next)
  }

  const sample = components.map(c => componentLabel(c)).join(separator)

  const titles: Record<BuilderCtx['mode'], { title: string; desc: string }> = {
    create: {
      title: 'Builder Profil Penomoran',
      desc: 'Susun komponen nomor dari kiri ke kanan. Profil dibuat sebagai DRAFT — validasi dan aktivasi eksplisit setelahnya.',
    },
    draft: {
      title: 'Edit Draft Versi',
      desc: 'Perubahan langsung mengubah DSL pada draft terbuka. Setelah diaktivasi, versi menjadi immutable — perubahan selanjutnya lewat versi baru.',
    },
    'new-version': {
      title: 'Buat Versi Baru',
      desc: 'Turunkan versi baru dari format terakhir, sesuaikan, lalu aktivasi. Versi aktif lama otomatis dipensiunkan saat versi baru diaktifkan — nomor historis tidak berubah.',
    },
  }

  return (
    <Dialog open={!!ctx} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-slim">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{ctx ? titles[ctx.mode].title : ''}</DialogTitle>
          <DialogDescription>{ctx ? titles[ctx.mode].desc : ''}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {isCreate && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Nama profil</Label>
                <Input value={name} className="bg-surface" onChange={(e) => setName(e.target.value)} placeholder="mis. Preset Workbook 2026" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Unit pemilik</Label>
                <Select value={ownerId || undefined} onValueChange={setOwnerId}>
                  <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                  <SelectContent>
                    {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {!isCreate && ctx && (
            <div className="rounded-xl border bg-muted/30 px-4 py-3 text-[12.5px]">
              Profil: <span className="font-semibold">{ctx.name}</span>
              {' '}· mode: <span className="font-semibold">{ctx.mode === 'draft' ? 'edit draft terbuka' : 'turunkan versi baru'}</span>
            </div>
          )}

          <div className="space-y-1.5 w-44">
            <Label className="text-[12px] font-semibold">Separator antar komponen</Label>
            <Select value={separator} onValueChange={setSeparator}>
              <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="/">/ (garis miring)</SelectItem>
                <SelectItem value="-">- (strip)</SelectItem>
                <SelectItem value=".">. (titik)</SelectItem>
                <SelectItem value=" ">spasi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Preview live */}
          <div className="rounded-xl border border-emerald/25 bg-gradient-to-br from-emerald-soft to-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-deep/70 mb-1.5">Bentuk nomor</p>
            <p className="font-mono text-[15px] font-bold text-emerald-deep break-all">{sample}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px] font-semibold">Komponen (atas = paling kiri pada nomor)</Label>
            {components.map((c, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-xl border bg-surface p-2.5 shadow-card">
                <span className="font-mono text-[11px] font-semibold bg-emerald text-white px-2.5 py-1.5 rounded-md min-w-24 text-center shrink-0">
                  {componentLabel(c)}
                </span>
                <ComponentEditor component={c} onChange={(nc) => setComponents(components.map((x, xi) => xi === i ? nc : x))} />
                <div className="flex gap-0.5 ml-auto shrink-0">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Naikkan">
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === components.length - 1} aria-label="Turunkan">
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-red-50" onClick={() => setComponents(components.filter((_, xi) => xi !== i))} aria-label="Hapus komponen">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              {COMPONENT_PRESETS.map((p) => (
                <Button key={p.label} size="sm" variant="outline" className="h-8 bg-surface shadow-card text-[12px]"
                  onClick={() => setComponents([...components, p.make()])}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> {p.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Button variant="outline" className="bg-surface shadow-card" onClick={() => validate.mutate()} disabled={validate.isPending}>
              {validate.isPending ? 'Memvalidasi…' : 'Validasi & Contoh'}
            </Button>
          </div>

          {validate.data && (
            <div className={`rounded-xl border p-4 text-sm space-y-1.5 ${validate.data.ok ? 'border-emerald/30 bg-emerald-soft/50' : 'border-destructive/30 bg-red-50'}`}>
              <p className="font-semibold text-[13px]">{validate.data.ok ? '✓ Profil valid' : '✕ Profil tidak valid'}</p>
              {validate.data.preview && (
                <p className="font-mono text-[12.5px] font-semibold text-emerald-deep">Contoh: {validate.data.preview.text}</p>
              )}
              {validate.data.errors.map((e, i) => <p key={i} className="text-[12px] text-destructive">• {e}</p>)}
              {validate.data.warnings.map((w, i) => <p key={i} className="text-[12px] text-muted-foreground">ℹ {w}</p>)}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={components.length === 0 || save.isPending || (isCreate && (!name || !ownerId))}
            onClick={() => save.mutate()} className="shadow-card min-w-32">
            {save.isPending ? 'Menyimpan…' : isCreate ? 'Simpan DRAFT' : ctx?.mode === 'draft' ? 'Simpan Perubahan' : 'Simpan Versi Baru'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ComponentEditor({ component, onChange }: { component: DSLComponent; onChange: (c: DSLComponent) => void }) {
  if (component.type === 'literal') {
    return (
      <Input className="h-9 w-40 bg-surface" value={component.value}
        onChange={(e) => onChange({ type: 'literal', value: e.target.value })} aria-label="Nilai statis" />
    )
  }
  if (component.type === 'sequence') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">padding</span>
        <Input className="h-9 w-20 bg-surface" type="number" min={1} max={10} value={component.padding}
          onChange={(e) => onChange({ type: 'sequence', padding: Number(e.target.value) || 1 })} aria-label="Jumlah digit padding" />
      </div>
    )
  }
  if (component.type === 'direction') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Int→</span>
        <Input className="h-9 w-14 bg-surface font-mono" value={component.mapping.INTERNAL}
          onChange={(e) => onChange({ type: 'direction', mapping: { ...component.mapping, INTERNAL: e.target.value.toUpperCase() } })} aria-label="Kode internal" />
        <span className="text-[11px] text-muted-foreground">Eks→</span>
        <Input className="h-9 w-14 bg-surface font-mono" value={component.mapping.EXTERNAL}
          onChange={(e) => onChange({ type: 'direction', mapping: { ...component.mapping, EXTERNAL: e.target.value.toUpperCase() } })} aria-label="Kode eksternal" />
      </div>
    )
  }
  if (component.type === 'letterDate' || component.type === 'issueDate') {
    return (
      <Select value={component.format}
        onValueChange={(v) => onChange({ type: component.type, format: v as never })}>
        <SelectTrigger className="h-9 w-44 bg-surface text-[12.5px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="MONTH_ROMAN">Bulan Romawi</SelectItem>
          <SelectItem value="MONTH_2">Bulan 2 digit</SelectItem>
          <SelectItem value="MONTH_NAME">Nama bulan</SelectItem>
          <SelectItem value="YEAR_4">Tahun 4 digit</SelectItem>
          <SelectItem value="YEAR_2">Tahun 2 digit</SelectItem>
          <SelectItem value="DATE_ISO">Tanggal ISO</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  return null
}
