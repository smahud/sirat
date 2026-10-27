'use client'

import { useMemo, useState } from 'react'
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
  Layers, ShieldCheck, ChevronDown, ChevronUp, Copy, Settings2, ArrowLeft, CircleAlert,
  ListPlus, GripVertical, Save, Rocket, CircleCheck, Table2,
} from 'lucide-react'
import {
  type NumberingDSL, type DSLComponent, type DropdownField, type DropdownOption,
  parseDsl, freshFieldKey, freshOptionId, fieldUsedInNumber,
} from '@/lib/numbering/dsl'
import { renderNumber } from '@/lib/numbering/render'
import { validateDslForActivation, exampleFieldValues } from '@/lib/numbering/validate'

interface ProfileRow {
  id: string
  name: string
  ownerId: string
  committeeId: string | null
  owner: { id: string; code: string; name: string }
  committee: { id: string; code: string; name: string } | null
  versions: { id: string; version: number; status: string; activatedAt: string | null; dsl: string }[]
}
interface UnitRow { id: string; code: string; name: string }
interface CommitteeRow { id: string; code: string; name: string; unitId: string; status: string }

/** Konteks builder: buat profil baru, edit draft, atau turunkan versi baru. */
interface BuilderCtx {
  mode: 'create' | 'draft' | 'new-version'
  profileId?: string
  versionId?: string // versi draft yang sedang diedit / baru dibuat
  name?: string
  ownerId?: string
  committeeId?: string | null
  initialDsl?: NumberingDSL
}

// ===================== Tampilan daftar profil =====================

export function ProfilesView() {
  const qc = useQueryClient()
  const [builder, setBuilder] = useState<BuilderCtx | null>(null)
  const [activateVersion, setActivateVersion] = useState<ProfileRow['versions'][0] | null>(null)
  const [renameProfile, setRenameProfile] = useState<ProfileRow | null>(null)
  const [deleteProfile, setDeleteProfile] = useState<ProfileRow | null>(null)

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => apiGet<{ profiles: ProfileRow[] }>('/api/numbering-profiles') })
  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: UnitRow[] }>('/api/units') })
  const committees = useQuery({ queryKey: ['committees'], queryFn: () => apiGet<{ committees: CommitteeRow[] }>('/api/committees') })

  const activate = useMutation({
    mutationFn: ({ versionId, resetPolicy, dateSource }: { versionId: string; resetPolicy: string; dateSource: string }) =>
      apiPost('/api/numbering-profiles/activate', { versionId, resetPolicy, dateSource }),
    onSuccess: () => {
      toast.success('Versi profil diaktifkan')
      setActivateVersion(null)
      setBuilder(null) // v1.6: tutup builder setelah aktivasi berhasil
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // v1.6: dialog aktivasi diekstrak — HARUS ikut ter-render saat builder terbuka,
  // karena tombol "Aktivasi…" di builder memanggil setActivateVersion.
  const activateDialog = (
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
          version={activateVersion}
          onSubmit={(resetPolicy, dateSource) =>
            activate.mutate({ versionId: activateVersion!.id, resetPolicy, dateSource })}
          busy={activate.isPending}
        />
      </DialogContent>
    </Dialog>
  )

  // v1.6: builder halaman penuh menggantikan daftar (bukan modal bertumpuk)
  if (builder) {
    return (
      <>
        <ProfileBuilderPage
          ctx={builder}
          units={units.data?.units ?? []}
          committees={committees.data?.committees ?? []}
          onClose={() => setBuilder(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['profiles'] })}
          onActivate={(v) => setActivateVersion(v)}
        />
        {activateDialog}
      </>
    )
  }

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
              description="Buat profil untuk unit — susun komponen nomor secara visual: urutan, Dropdown bebas (mis. Arah Surat Internal→A), kode jenis, kode unit, tanggal."
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
                        ownerId: p.ownerId, committeeId: p.committeeId,
                        initialDsl: active ? parseDsl(active.dsl) : undefined,
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
                const dsl = parseDsl(v.dsl)
                const sample = dsl.components.map(c => componentToken(c, dsl)).join(dsl.separator)
                const isActive = v.status === 'ACTIVE'
                const isDraft = v.status === 'DRAFT'
                const isLatest = v.id === latest?.id
                const dropdownCount = dsl.fields.length
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
                        {dropdownCount > 0 && (
                          <Badge variant="outline" className="text-[11px]" title="Jumlah Dropdown pada profil">
                            <Table2 className="w-3 h-3 mr-1" /> {dropdownCount} Dropdown
                          </Badge>
                        )}
                        {isActive && <CheckCircle2 className="w-4 h-4 text-emerald" />}
                      </div>
                      <p className="text-[11.5px] text-muted-foreground mt-1.5">
                        {dsl.components.length} komponen · {dsl.fields.length} Dropdown · separator “{dsl.separator}”
                        {v.activatedAt ? ` · aktif sejak ${new Date(v.activatedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isDraft && isLatest && (
                        <Button size="sm" variant="outline" className="bg-surface h-8"
                          onClick={() => setBuilder({
                            mode: 'draft', profileId: p.id, versionId: v.id, name: p.name,
                            ownerId: p.ownerId, committeeId: p.committeeId,
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

      {activateDialog}

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

/** Token tampilan komponen pada shape nomor — gaya {KEY} sesuai instruksi C. */
export function componentToken(c: DSLComponent, dsl?: NumberingDSL): string {
  switch (c.type) {
    case 'literal': return c.value
    case 'sequence': return `{SEQ:${c.padding}}`
    case 'fieldRef': {
      const f = dsl?.fields.find(x => x.key === c.field)
      return `{${c.field}}` + (f ? '' : '?')
    }
    case 'letterTypeCode': return '{JENIS}'
    case 'unitCode': return '{UNIT}'
    case 'committeeCode': return '{PANITIA}'
    case 'letterDate': return `{TGL_SURAT:${c.format}}`
    case 'issueDate': return `{TGL_TERBIT:${c.format}}`
  }
}

// ===================== Dialog Aktivasi / Rename / Delete =====================

function ActivateForm({ version, onSubmit, busy }: {
  version: ProfileRow['versions'][0] | null
  onSubmit: (resetPolicy: string, dateSource: string) => void
  busy: boolean
}) {
  // v1.6: prefill dari saran kebijakan yang tersimpan pada DSL builder (D.3)
  const hint = useMemo(() => {
    if (!version) return { resetPolicy: 'ALL', dateSource: 'LETTER_DATE' }
    try {
      const dsl = parseDsl(version.dsl)
      return {
        resetPolicy: dsl.policy?.resetPolicy ?? 'ALL',
        dateSource: dsl.policy?.dateSource ?? 'LETTER_DATE',
      }
    } catch {
      return { resetPolicy: 'ALL', dateSource: 'LETTER_DATE' }
    }
  }, [version])
  const [resetPolicy, setResetPolicy] = useState(hint.resetPolicy)
  const [dateSource, setDateSource] = useState(hint.dateSource)
  // ikuti perubahan target dialog
  const [lastVid, setLastVid] = useState('')
  if (version && version.id !== lastVid) {
    setLastVid(version.id)
    setResetPolicy(hint.resetPolicy)
    setDateSource(hint.dateSource)
  }
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gold/30 bg-gold-soft/60 p-3.5 flex gap-3">
        <Info className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
        <p className="text-[12px] text-foreground/75 leading-relaxed">
          Bukti workbook 2026 menunjukkan sequence berjalan lintas bulan. <span className="font-semibold">YEARLY adalah usulan</span> —
          pilih dengan sadar sesuai kebijakan organisasi. Mengubah Dropdown atau kode <span className="font-semibold">tidak</span> mengubah kebijakan counter.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="font-semibold text-[13px]">Kebijakan reset counter</Label>
        <Select value={resetPolicy} onValueChange={setResetPolicy}>
          <SelectTrigger className="bg-surface" aria-label="Kebijakan reset counter"><SelectValue /></SelectTrigger>
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
          <SelectTrigger className="bg-surface" aria-label="Sumber tanggal komponen"><SelectValue /></SelectTrigger>
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
          <Label htmlFor="profileName" className="font-semibold text-[13px]">Nama profil</Label>
          <Input id="profileName" value={name} className="bg-surface" onChange={(e) => setName(e.target.value)}
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

// ===================== Builder (halaman penuh, dua kolom) =====================
// D.4: desktop = editor kiri + live preview kanan; layar kecil satu kolom.
// Tanpa modal bertumpuk; state React tunggal menjaga konfigurasi belum disimpan
// tetap utuh saat berpindah bagian (D: "pertahankan konfigurasi").

interface EditorState {
  name: string
  ownerId: string
  committeeId: string // '' = profil unit
  separator: string
  fields: DropdownField[]
  components: DSLComponent[]
  resetPolicy: string
  dateSource: string
  example: {
    letterTypeCode: string
    unitCode: string
    committeeCode: string
    letterDate: string
    fieldValues: Record<string, string>
  }
}

const DEFAULT_COMPONENTS: DSLComponent[] = [
  { type: 'sequence', padding: 3 },
  { type: 'fieldRef', field: 'arah_surat' },
  { type: 'letterTypeCode' },
  { type: 'literal', value: 'YAPSI-DS' },
  { type: 'letterDate', format: 'MONTH_ROMAN' },
  { type: 'letterDate', format: 'YEAR_4' },
]
const DEFAULT_FIELDS: DropdownField[] = [{
  type: 'dropdown',
  key: 'arah_surat',
  label: 'Arah Surat',
  placeholder: 'Pilih arah',
  helperText: null,
  options: [
    { id: 'internal', label: 'Internal', code: 'A', active: true },
    { id: 'eksternal', label: 'Eksternal', code: 'B', active: true },
  ],
  defaultOptionId: null,
  required: true,
  order: 0,
}]

function newDropdownField(existingKeys: string[], label?: string): DropdownField {
  return {
    type: 'dropdown',
    key: freshFieldKey(existingKeys, (label ?? 'dropdown').toLowerCase()),
    label: label ?? 'Dropdown Baru',
    placeholder: 'Pilih nilai',
    helperText: null,
    options: [{ id: 'opt1', label: 'Pilihan 1', code: 'A', active: true }],
    defaultOptionId: null,
    required: true,
    order: existingKeys.length,
  }
}

function ProfileBuilderPage({ ctx, units, committees, onClose, onSaved, onActivate }: {
  ctx: BuilderCtx
  units: UnitRow[]
  committees: CommitteeRow[]
  onClose: () => void
  onSaved: () => void
  onActivate: (v: { id: string; version: number; status: string; activatedAt: string | null; dsl: string }) => void
}) {
  const isCreate = ctx.mode === 'create'
  const [st, setSt] = useState<EditorState>(() => initEditorState(ctx, units))
  const [expandedComp, setExpandedComp] = useState<number | null>(null)   // index komponen
  const [expandedField, setExpandedField] = useState<string | null>(null) // key field metadata
  const [savedVersionId, setSavedVersionId] = useState<string | undefined>(ctx.versionId)
  const [savedVersionNo, setSavedVersionNo] = useState<number | undefined>(undefined)
  const [savedSnapshot, setSavedSnapshot] = useState<string>('')
  const [serverValidation, setServerValidation] = useState<{ ok: boolean; errors: string[]; warnings: string[]; example?: string } | null>(null)

  // ===== DSL & derivasi =====
  const dsl: NumberingDSL = useMemo(() => ({
    version: 2,
    separator: st.separator as NumberingDSL['separator'],
    fields: st.fields,
    components: st.components,
    policy: { resetPolicy: st.resetPolicy as never, dateSource: st.dateSource as never },
  }), [st.separator, st.fields, st.components, st.resetPolicy, st.dateSource])

  const validation = useMemo(() => validateDslForActivation(dsl), [dsl])

  // Nilai contoh efektif: eksplisit → default → opsi aktif pertama (F.4)
  const effExampleFields = useMemo(() => {
    const out: Record<string, string> = {}
    for (const f of st.fields) {
      const v = st.example.fieldValues[f.key]
      const opt = f.options.find(o => o.id === v && o.active)
        ?? f.options.find(o => o.id === f.defaultOptionId && o.active)
        ?? f.options.find(o => o.active)
      if (opt) out[f.key] = opt.id
    }
    return out
  }, [st.fields, st.example.fieldValues])

  const preview = useMemo(() => {
    try {
      const r = renderNumber(dsl, {
        fieldValues: effExampleFields,
        letterTypeCode: st.example.letterTypeCode || undefined,
        unitCode: st.example.unitCode || undefined,
        committeeCode: st.example.committeeCode || undefined,
        letterDate: st.example.letterDate ? new Date(`${st.example.letterDate}T00:00:00.000Z`) : null,
        issueDate: new Date(),
      })
      return { text: r.text, error: null as string | null }
    } catch (e) {
      return { text: null, error: (e as Error).message }
    }
  }, [dsl, effExampleFields, st.example])

  const currentSnapshot = JSON.stringify({
    name: st.name, ownerId: st.ownerId, committeeId: st.committeeId,
    separator: st.separator, fields: st.fields, components: st.components,
    resetPolicy: st.resetPolicy, dateSource: st.dateSource,
  })
  const dirty = savedSnapshot !== '' && savedSnapshot !== currentSnapshot
  const metadataFields = st.fields.filter(f => !fieldUsedInNumber(dsl, f.key))
  const inNumberKeys = new Set(st.components.filter(c => c.type === 'fieldRef').map(c => (c as { field: string }).field))

  const patch = (p: Partial<EditorState>) => setSt(prev => ({ ...prev, ...p }))

  // ===== Mutasi =====
  const save = useMutation({
    mutationFn: async () => {
      if (ctx.mode === 'create') {
        return apiPost<{ profile: { id: string }; version: { id: string; version: number } }>(
          '/api/numbering-profiles', {
            name: st.name, ownerId: st.ownerId,
            committeeId: st.committeeId || null,
            dsl,
          })
      }
      return apiPut<{ version: { id: string; version: number } }>(
        '/api/numbering-profiles', {
          profileId: ctx.profileId, dsl,
          mode: ctx.mode === 'draft' ? 'draft' : 'new',
        }) as unknown as { profile: { id: string }; version: { id: string; version: number } }
    },
    onSuccess: (resp) => {
      setSavedVersionId(resp.version.id)
      setSavedVersionNo(resp.version.version)
      setSavedSnapshot(currentSnapshot)
      toast.success(isCreate ? 'Profil dibuat (versi DRAFT)'
        : ctx.mode === 'draft' ? 'Draft diperbarui' : 'Versi baru dibuat (DRAFT)')
      onSaved()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const serverValidate = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; errors: string[]; warnings: string[]; example?: string; preview?: { text: string } }>(
      '/api/numbering-profiles/validate', {
        dsl,
        sample: {
          seq: 1,
          letterTypeCode: st.example.letterTypeCode || 'SPR',
          unitCode: st.example.unitCode || 'YAPSI',
          committeeCode: st.example.committeeCode || undefined,
          letterDate: st.example.letterDate || '2026-01-15',
          fieldValues: effExampleFields,
        },
      }),
    onSuccess: (data) => setServerValidation(data),
    onError: (e) => toast.error((e as Error).message),
  })

  // ===== Operasi komponen =====
  const moveComp = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= st.components.length) return
    const next = [...st.components]
    ;[next[i], next[j]] = [next[j], next[i]]
    patch({ components: next })
  }
  const addComponent = (c: DSLComponent) => {
    patch({ components: [...st.components, c] })
  }
  const addDropdownComponent = () => {
    const field = newDropdownField(st.fields.map(f => f.key))
    patch({
      fields: [...st.fields, field],
      components: [...st.components, { type: 'fieldRef', field: field.key }],
    })
    setExpandedComp(st.components.length) // buka editor langsung
  }
  const duplicateComp = (i: number) => {
    const c = st.components[i]
    if (c.type === 'fieldRef') {
      const src = st.fields.find(f => f.key === c.field)
      if (!src) return
      const clone: DropdownField = {
        ...structuredClone(src),
        key: freshFieldKey(st.fields.map(f => f.key), src.key),
        label: `${src.label} (salinan)`,
      }
      const nextComps = [...st.components]
      nextComps.splice(i + 1, 0, { type: 'fieldRef', field: clone.key })
      patch({ fields: [...st.fields, clone], components: nextComps })
    } else {
      const next = [...st.components]
      next.splice(i + 1, 0, structuredClone(c))
      patch({ components: next })
    }
  }
  const removeComp = (i: number) => {
    const c = st.components[i]
    const next = st.components.filter((_, xi) => xi !== i)
    patch({ components: next })
    if (c.type === 'fieldRef') {
      toast.info('Dropdown dikeluarkan dari nomor — kini menjadi field metadata (bisa dihapus di daftar field di bawah)')
    }
    if (expandedComp === i) setExpandedComp(null)
  }
  const updateComp = (i: number, c: DSLComponent) => {
    patch({ components: st.components.map((x, xi) => xi === i ? c : x) })
  }

  // ===== Operasi field =====
  const updateField = (key: string, f: DropdownField) => {
    // perubahan key → sinkronkan fieldRef + contoh nilai
    const keyChanged = f.key !== key
    patch({
      fields: st.fields.map(x => x.key === key ? f : x),
      components: keyChanged
        ? st.components.map(c => c.type === 'fieldRef' && c.field === key ? { ...c, field: f.key } : c)
        : st.components,
      example: keyChanged
        ? {
            ...st.example,
            fieldValues: Object.fromEntries(
              Object.entries(st.example.fieldValues).map(([k, v]) => [k === key ? f.key : k, v]),
            ),
          }
        : st.example,
    })
  }
  const moveField = (key: string, dir: -1 | 1) => {
    const idx = st.fields.findIndex(f => f.key === key)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= st.fields.length) return
    const next = [...st.fields]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    patch({ fields: next.map((f, i) => ({ ...f, order: i })) })
  }
  const deleteField = (key: string) => {
    if (fieldUsedInNumber(dsl, key)) {
      toast.error('Field masih dipakai dalam template nomor — matikan "Gunakan dalam nomor" terlebih dahulu')
      return
    }
    patch({ fields: st.fields.filter(f => f.key !== key) })
    if (expandedField === key) setExpandedField(null)
  }
  const setIncludeInNumber = (key: string, on: boolean) => {
    if (on) {
      if (!st.components.some(c => c.type === 'fieldRef' && c.field === key)) {
        patch({ components: [...st.components, { type: 'fieldRef', field: key }] })
      }
    } else {
      patch({ components: st.components.filter(c => !(c.type === 'fieldRef' && (c as { field: string }).field === key)) })
      setExpandedComp(null)
    }
  }

  const canSave = isCreate
    ? st.name.trim().length > 0 && !!st.ownerId && st.components.length > 0
    : st.components.length > 0
  const canActivate = !!savedVersionId && !dirty && validation.ok && !save.isPending

  const titles: Record<BuilderCtx['mode'], { title: string; desc: string }> = {
    create: {
      title: 'Profil Baru',
      desc: 'Susun profil penomoran dari nol — disimpan sebagai DRAFT, aktivasi terpisah setelah validasi lolos.',
    },
    draft: {
      title: 'Edit Draft Versi',
      desc: 'Perubahan langsung mengubah DSL pada draft terbuka. Setelah diaktivasi, versi menjadi immutable — perubahan selanjutnya lewat versi baru.',
    },
    'new-version': {
      title: 'Buat Versi Baru',
      desc: 'Turunkan versi baru dari format terakhir, sesuaikan, lalu aktivasi. Versi aktif lama otomatis dipensiunkan — nomor historis tidak berubah.',
    },
  }

  return (
    <div>
      {/* Kepala builder */}
      <div className="mb-5">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground"
          onClick={() => { if (!dirty || confirm('Perubahan belum disimpan — tutup builder?')) onClose() }}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Kembali ke daftar profil
        </Button>
        <PageHeader title={titles[ctx.mode].title} description={titles[ctx.mode].desc} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        {/* ===== KOLOM KIRI: editor ===== */}
        <div className="space-y-5 min-w-0">
          {/* 1. Identitas Profil */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center font-semibold text-[12px]">1</span>
                Identitas Profil
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isCreate ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pb-name" className="text-[12px] font-semibold">Nama profil</Label>
                      <Input id="pb-name" value={st.name} className="bg-surface" autoFocus
                        onChange={(e) => patch({ name: e.target.value })} placeholder="mis. Preset Workbook 2026" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pb-unit" className="text-[12px] font-semibold">Unit pemilik</Label>
                      <Select value={st.ownerId ?? ''}
                        onValueChange={(v) => patch({ ownerId: v, committeeId: '', example: { ...st.example, unitCode: units.find(u => u.id === v)?.code ?? '' } })}>
                        <SelectTrigger id="pb-unit" className="bg-surface"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                        <SelectContent>
                          {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pb-comm" className="text-[12px] font-semibold">
                      Kepanitiaan <span className="font-normal text-muted-foreground">(opsional — kosongkan untuk profil unit)</span>
                    </Label>
                    <Select value={st.committeeId || 'NONE'} onValueChange={(v) => patch({ committeeId: v === 'NONE' ? '' : v })}>
                      <SelectTrigger id="pb-comm" className="bg-surface"><SelectValue placeholder="Profil unit (reguler)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Profil unit (reguler)</SelectItem>
                        {committees.filter(c => !st.ownerId || c.unitId === st.ownerId).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12.5px]">
                  <div className="rounded-lg border bg-muted/30 px-3.5 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Profil</p>
                    <p className="font-semibold mt-0.5">{ctx.name}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 px-3.5 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Mode</p>
                    <p className="font-semibold mt-0.5">{ctx.mode === 'draft' ? `Edit draft terbuka${savedVersionNo ? ` (v${savedVersionNo})` : ''}` : 'Turunkan versi baru'}</p>
                  </div>
                </div>
              )}
              <div className="rounded-lg border border-emerald/20 bg-emerald-soft/30 px-3.5 py-2.5 flex gap-2.5">
                <Info className="w-4 h-4 text-emerald shrink-0 mt-0.5" />
                <p className="text-[11.5px] leading-relaxed text-foreground/75">
                  <span className="font-semibold">Prioritas resolusi:</span> surat kepanitiaan memakai profil panitianya
                  (bila ada), sisanya jatuh ke profil unit. Satu profil per konteks — perubahan format = versi baru.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 2. Builder Komponen Nomor */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center font-semibold text-[12px]">2</span>
                Builder Komponen Nomor
                <Badge variant="outline" className="text-[10.5px] font-normal ml-1">{st.components.length} komponen</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <p className="text-[11.5px] text-muted-foreground">
                Daftar diurutkan kiri→kanan sesuai nomor. Gunakan ↑↓ untuk memindahkan; pratinjau di kanan langsung mengikuti.
              </p>

              {st.components.map((c, i) => {
                const isField = c.type === 'fieldRef'
                const field = isField ? st.fields.find(f => f.key === (c as { field: string }).field) : undefined
                const expanded = expandedComp === i
                return (
                  <div key={i} className={`rounded-xl border bg-surface transition-shadow ${expanded ? 'shadow-card border-emerald/30' : 'shadow-card'}`}>
                    <div className="flex items-center gap-2 p-2.5 flex-wrap">
                      <GripVertical className="w-4 h-4 text-muted-foreground/50 shrink-0" aria-hidden />
                      <span className="font-mono text-[11px] font-semibold bg-emerald text-white px-2.5 py-1.5 rounded-md text-center shrink-0 min-w-20">
                        {componentToken(c, dsl)}
                      </span>
                      <span className="text-[12px] font-medium min-w-0 truncate">
                        {componentTypeName(c)}
                        {isField && field && <span className="text-muted-foreground font-normal"> · {field.options.length} pilihan</span>}
                      </span>
                      <div className="flex gap-0.5 ml-auto shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveComp(i, -1)} disabled={i === 0}
                          aria-label="Naikkan komponen" title="Naikkan">
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveComp(i, 1)} disabled={i === st.components.length - 1}
                          aria-label="Turunkan komponen" title="Turunkan">
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => duplicateComp(i)}
                          aria-label="Duplikasi komponen" title="Duplikasi">
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setExpandedComp(expanded ? null : i)}
                          aria-label={expanded ? 'Tutup konfigurasi' : 'Buka konfigurasi'} title="Konfigurasi"
                          aria-expanded={expanded}>
                          {expanded ? <ChevronUp className="w-4 h-4" /> : <Settings2 className="w-4 h-4" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-red-50" onClick={() => removeComp(i)}
                          aria-label="Keluarkan dari nomor" title={isField ? 'Keluarkan dari nomor (field tetap ada sebagai metadata)' : 'Hapus komponen'}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t px-3.5 pb-3.5 pt-3">
                        {isField && field ? (
                          <DropdownEditor
                            field={field}
                            allFields={st.fields}
                            inNumber
                            onChange={(f) => updateField(field.key, f)}
                            onIncludeInNumber={(on) => setIncludeInNumber(field.key, on)}
                            onMove={(d) => moveField(field.key, d)}
                            onDelete={() => deleteField(field.key)}
                          />
                        ) : (
                          <SimpleComponentEditor component={c} onChange={(nc) => updateComp(i, nc)} />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="pt-1">
                <AddComponentMenu onAdd={addComponent} onAddDropdown={addDropdownComponent} />
              </div>

              {/* Field metadata (Dropdown tanpa nomor) */}
              <div className="pt-3 mt-2 border-t">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Label className="text-[12px] font-semibold flex items-center gap-1.5">
                    <ListPlus className="w-3.5 h-3.5 text-muted-foreground" />
                    Field formulir tanpa nomor (metadata)
                  </Label>
                  <Button size="sm" variant="outline" className="h-7 bg-surface text-[11.5px]"
                    onClick={() => {
                      const field = newDropdownField(st.fields.map(f => f.key))
                      patch({ fields: [...st.fields, field] })
                      setExpandedField(field.key)
                    }}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Dropdown metadata
                  </Button>
                </div>
                {metadataFields.length === 0 ? (
                  <p className="text-[11.5px] text-muted-foreground pl-1">
                    Tidak ada — semua Dropdown ikut dalam nomor. Dropdown metadata berguna untuk data klasifikasi
                    tambahan yang tidak perlu muncul di nomor surat.
                  </p>
                ) : metadataFields.map((f) => {
                  const expanded = expandedField === f.key
                  return (
                    <div key={f.key} className={`rounded-xl border bg-surface shadow-card mb-2 ${expanded ? 'border-emerald/30' : ''}`}>
                      <div className="flex items-center gap-2 p-2.5 flex-wrap">
                        <span className="font-mono text-[11px] font-semibold bg-muted px-2.5 py-1.5 rounded-md shrink-0">
                          {'{'}{f.key}{'}'}
                        </span>
                        <span className="text-[12px] font-medium truncate">{f.label}</span>
                        <Badge variant="outline" className="text-[10.5px]">{f.options.length} pilihan</Badge>
                        {!f.required && <Badge variant="outline" className="text-[10.5px]">opsional</Badge>}
                        <div className="flex gap-0.5 ml-auto shrink-0">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveField(f.key, -1)}
                            aria-label="Naikkan urutan formulir" title="Urutan formulir naik">
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveField(f.key, 1)}
                            aria-label="Turunkan urutan formulir" title="Urutan formulir turun">
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setExpandedField(expanded ? null : f.key)}
                            aria-label={expanded ? 'Tutup konfigurasi' : 'Buka konfigurasi'} title="Konfigurasi" aria-expanded={expanded}>
                            {expanded ? <ChevronUp className="w-4 h-4" /> : <Settings2 className="w-4 h-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-red-50" onClick={() => deleteField(f.key)}
                            aria-label="Hapus field" title="Hapus field">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {expanded && (
                        <div className="border-t px-3.5 pb-3.5 pt-3">
                          <DropdownEditor
                            field={f}
                            allFields={st.fields}
                            inNumber={false}
                            onChange={(nf) => updateField(f.key, nf)}
                            onIncludeInNumber={(on) => setIncludeInNumber(f.key, on)}
                            onMove={(d) => moveField(f.key, d)}
                            onDelete={() => deleteField(f.key)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* 3. Pengaturan Penomoran */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center font-semibold text-[12px]">3</span>
                Pengaturan Penomoran
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pb-sep" className="text-[12px] font-semibold">Separator antar komponen</Label>
                  <Select value={st.separator} onValueChange={(v) => patch({ separator: v })}>
                    <SelectTrigger id="pb-sep" className="bg-surface"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="/">/ (garis miring)</SelectItem>
                      <SelectItem value="-">- (strip)</SelectItem>
                      <SelectItem value=".">. (titik)</SelectItem>
                      <SelectItem value=" ">spasi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(() => {
                  const seqIdx = st.components.findIndex(c => c.type === 'sequence')
                  const seq = st.components[seqIdx] as { type: 'sequence'; padding: number } | undefined
                  return (
                    <div className="space-y-1.5">
                      <Label htmlFor="pb-pad" className="text-[12px] font-semibold">Digit urutan (padding)</Label>
                      {seq ? (
                        <Input id="pb-pad" className="bg-surface" type="number" min={1} max={10} value={seq.padding}
                          onChange={(e) => updateComp(seqIdx, { type: 'sequence', padding: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
                          aria-label="Jumlah digit padding urutan" />
                      ) : (
                        <p className="text-[11.5px] text-muted-foreground flex items-center gap-1.5 h-9">
                          <CircleAlert className="w-3.5 h-3.5 text-gold-dark" /> Tidak ada komponen urutan
                        </p>
                      )}
                    </div>
                  )
                })()}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pb-reset" className="text-[12px] font-semibold">Kebijakan reset counter</Label>
                  <Select value={st.resetPolicy} onValueChange={(v) => patch({ resetPolicy: v })}>
                    <SelectTrigger id="pb-reset" className="bg-surface"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Tidak pernah reset (ALL)</SelectItem>
                      <SelectItem value="YEARLY">Reset tahunan (YEARLY)</SelectItem>
                      <SelectItem value="MONTHLY">Reset bulanan (MONTHLY)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10.5px] text-muted-foreground">Saran default — dikonfirmasi eksplisit saat aktivasi. Tidak berubah hanya karena Dropdown diedit.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pb-datesrc" className="text-[12px] font-semibold">Sumber tanggal komponen</Label>
                  <Select value={st.dateSource} onValueChange={(v) => patch({ dateSource: v })}>
                    <SelectTrigger id="pb-datesrc" className="bg-surface"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LETTER_DATE">Tanggal surat</SelectItem>
                      <SelectItem value="ISSUE_DATE">Waktu penerbitan</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10.5px] text-muted-foreground">Menentukan periode reset (YEARLY/MONTHLY) mengikuti tanggal surat atau waktu terbit.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Aksi mobile (di bawah editor) */}
          <div className="xl:hidden flex flex-wrap gap-2.5">
            <Button variant="outline" className="bg-surface" onClick={onClose}>Batal</Button>
            <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()} className="shadow-card min-w-36">
              <Save className="w-4 h-4 mr-1.5" /> {save.isPending ? 'Menyimpan…' : isCreate ? 'Simpan DRAFT' : 'Simpan'}
            </Button>
            {canActivate && (
              <Button variant="secondary" className="shadow-card"
                onClick={() => onActivate({ id: savedVersionId!, version: savedVersionNo ?? 1, status: 'DRAFT', activatedAt: null, dsl: JSON.stringify(dsl) })}>
                <Rocket className="w-4 h-4 mr-1.5" /> Aktivasi…
              </Button>
            )}
          </div>
        </div>

        {/* ===== KOLOM KANAN: preview & aksi (sticky di desktop) ===== */}
        <div className="space-y-5 xl:sticky xl:top-4">
          {/* 4. Preview & Validasi */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-gold-soft text-gold-dark flex items-center justify-center font-semibold text-[12px]">4</span>
                Preview &amp; Validasi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Bentuk template</p>
                <p className="font-mono text-[12.5px] font-semibold text-foreground/80 break-all">
                  {st.components.map(c => componentToken(c, dsl)).join(st.separator)}
                </p>
              </div>

              {/* Contoh nilai — mengubah pratinjau secara langsung (F.4) */}
              <div className="space-y-2.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Nilai contoh</p>
                {st.fields.filter(f => inNumberKeys.has(f.key)).map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label htmlFor={`ex-${f.key}`} className="text-[11.5px] font-medium">
                      {f.label}
                      <span className="font-mono text-muted-foreground font-normal ml-1">{'{'}{f.key}{'}'}</span>
                    </Label>
                    <Select
                      value={effExampleFields[f.key] ?? ''}
                      onValueChange={(v) => patch({ example: { ...st.example, fieldValues: { ...st.example.fieldValues, [f.key]: v } } })}>
                      <SelectTrigger id={`ex-${f.key}`} className="bg-surface h-9 text-[12.5px]"><SelectValue placeholder={f.placeholder ?? 'Pilih'} /></SelectTrigger>
                      <SelectContent>
                        {f.options.filter(o => o.active).map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.label} → kode “{o.code}”</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  {st.components.some(c => c.type === 'letterTypeCode') && (
                    <div className="space-y-1">
                      <Label htmlFor="ex-jenis" className="text-[11.5px] font-medium">Kode jenis contoh</Label>
                      <Input id="ex-jenis" className="bg-surface h-9 font-mono text-[12.5px]" value={st.example.letterTypeCode}
                        onChange={(e) => patch({ example: { ...st.example, letterTypeCode: e.target.value.toUpperCase() } })} />
                    </div>
                  )}
                  {st.components.some(c => c.type === 'unitCode') && (
                    <div className="space-y-1">
                      <Label htmlFor="ex-unit" className="text-[11.5px] font-medium">Kode unit contoh</Label>
                      <Input id="ex-unit" className="bg-surface h-9 font-mono text-[12.5px]" value={st.example.unitCode}
                        onChange={(e) => patch({ example: { ...st.example, unitCode: e.target.value.toUpperCase() } })} />
                    </div>
                  )}
                  {st.components.some(c => c.type === 'committeeCode') && (
                    <div className="space-y-1">
                      <Label htmlFor="ex-pan" className="text-[11.5px] font-medium">Kode panitia contoh</Label>
                      <Input id="ex-pan" className="bg-surface h-9 font-mono text-[12.5px]" value={st.example.committeeCode}
                        onChange={(e) => patch({ example: { ...st.example, committeeCode: e.target.value.toUpperCase() } })} />
                    </div>
                  )}
                  {st.components.some(c => c.type === 'letterDate') && (
                    <div className="space-y-1">
                      <Label htmlFor="ex-tgl" className="text-[11.5px] font-medium">Tanggal surat contoh</Label>
                      <Input id="ex-tgl" type="date" className="bg-surface h-9 text-[12.5px]" value={st.example.letterDate}
                        onChange={(e) => patch({ example: { ...st.example, letterDate: e.target.value } })} />
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-emerald/25 bg-gradient-to-br from-emerald-soft to-surface p-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-emerald-deep/70 mb-1.5">
                  Pratinjau nomor (contoh — bukan alokasi)
                </p>
                {preview.text !== null ? (
                  <p className="font-mono text-[15px] font-bold text-emerald-deep break-all">{preview.text}</p>
                ) : (
                  <p className="text-[12px] text-destructive font-medium break-words">{preview.error}</p>
                )}
                <p className="text-[10.5px] text-muted-foreground mt-2">
                  Urutan memakai placeholder # — nomor resmi hanya dialokasikan saat penerbitan surat berhasil.
                </p>
              </div>

              {/* Validasi langsung (klien) */}
              <div className={`rounded-xl border p-3.5 space-y-1.5 ${validation.ok ? 'border-emerald/30 bg-emerald-soft/50' : 'border-destructive/30 bg-red-50'}`}>
                <p className="font-semibold text-[12.5px] flex items-center gap-1.5">
                  {validation.ok
                    ? <><CircleCheck className="w-4 h-4 text-emerald" /> Profil valid</>
                    : <><CircleAlert className="w-4 h-4 text-destructive" /> Profil tidak valid</>}
                </p>
                {validation.errors.map((e, i) => <p key={i} className="text-[11.5px] text-destructive break-words">• {e}</p>)}
                {validation.warnings.map((w, i) => <p key={i} className="text-[11.5px] text-muted-foreground break-words">ℹ {w}</p>)}
                {validation.ok && validation.errors.length === 0 && validation.warnings.length === 0 && (
                  <p className="text-[11.5px] text-muted-foreground">Tidak ada peringatan.</p>
                )}
              </div>

              <div>
                <Button variant="outline" size="sm" className="bg-surface shadow-card w-full"
                  onClick={() => serverValidate.mutate()} disabled={serverValidate.isPending}>
                  {serverValidate.isPending ? 'Memvalidasi di server…' : 'Validasi ulang di server'}
                </Button>
                {serverValidation && (
                  <div className={`rounded-lg border p-3 mt-2 space-y-1 ${serverValidation.ok ? 'border-emerald/30 bg-emerald-soft/40' : 'border-destructive/30 bg-red-50'}`}>
                    <p className="text-[11.5px] font-semibold">
                      Server: {serverValidation.ok ? 'lolos' : 'ditolak'}
                      {serverValidation.example && <span className="font-mono font-normal text-muted-foreground ml-2">{serverValidation.example}</span>}
                    </p>
                    {serverValidation.errors.map((e, i) => <p key={i} className="text-[11px] text-destructive break-words">• {e}</p>)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 5. Simpan & Aktivasi */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center font-semibold text-[12px]">5</span>
                Simpan &amp; Aktivasi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dirty && (
                <div className="rounded-lg border border-gold/40 bg-gold-soft/60 px-3 py-2 flex gap-2">
                  <CircleAlert className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
                  <p className="text-[11.5px] text-foreground/80">Ada perubahan belum disimpan.</p>
                </div>
              )}
              {!dirty && savedVersionId && (
                <div className="rounded-lg border border-emerald/30 bg-emerald-soft/40 px-3 py-2 flex gap-2">
                  <CircleCheck className="w-4 h-4 text-emerald shrink-0 mt-0.5" />
                  <p className="text-[11.5px] text-foreground/80">
                    Tersimpan sebagai DRAFT{savedVersionNo ? ` (v${savedVersionNo})` : ''} — siap diaudit atau diaktivasi.
                  </p>
                </div>
              )}
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Simpan menyimpan <span className="font-semibold">draft</span>. Aktivasi memeriksa seluruh validasi
                dan menjadikan profil dipakai penerbitan berikutnya — dilakukan secara eksplisit, terpisah dari simpan.
              </p>
              <div className="flex flex-col gap-2">
                <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()} className="shadow-card w-full">
                  <Save className="w-4 h-4 mr-1.5" />
                  {save.isPending ? 'Menyimpan…' : isCreate ? 'Simpan DRAFT' : ctx.mode === 'draft' ? 'Simpan Perubahan' : 'Simpan Versi Baru'}
                </Button>
                <Button variant="secondary" disabled={!canActivate}
                  className="shadow-card w-full"
                  onClick={() => onActivate({ id: savedVersionId!, version: savedVersionNo ?? 1, status: 'DRAFT', activatedAt: null, dsl: JSON.stringify(dsl) })}>
                  <Rocket className="w-4 h-4 mr-1.5" /> Aktivasi…
                </Button>
                {!canActivate && !dirty && !validation.ok && (
                  <p className="text-[11px] text-muted-foreground">Aktivasi terbuka setelah validasi lolos dan draft tersimpan.</p>
                )}
                <Button variant="outline" className="bg-surface w-full"
                  onClick={() => { if (!dirty || confirm('Perubahan belum disimpan — tutup builder?')) onClose() }}>
                  Batal
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function initEditorState(ctx: BuilderCtx, units: UnitRow[]): EditorState {
  const dsl = ctx.initialDsl
  const today = new Date().toISOString().slice(0, 10)
  const ownerCode = ctx.ownerId ? units.find(u => u.id === ctx.ownerId)?.code ?? 'YAPSI' : 'YAPSI'
  return {
    name: ctx.name ?? '',
    ownerId: ctx.ownerId ?? '',
    committeeId: ctx.committeeId ?? '',
    separator: dsl?.separator ?? '/',
    fields: dsl?.fields ?? structuredClone(DEFAULT_FIELDS),
    components: dsl?.components ?? structuredClone(DEFAULT_COMPONENTS),
    resetPolicy: dsl?.policy?.resetPolicy ?? 'ALL',
    dateSource: dsl?.policy?.dateSource ?? 'LETTER_DATE',
    example: {
      letterTypeCode: 'SPR',
      unitCode: ownerCode,
      committeeCode: 'PAN',
      letterDate: today,
      fieldValues: dsl ? exampleFieldValues(dsl) : { arah_surat: 'internal' },
    },
  }
}

// ===================== Editor komponen & Dropdown =====================

function componentTypeName(c: DSLComponent): string {
  switch (c.type) {
    case 'literal': return 'Teks statis'
    case 'sequence': return 'Urutan (sequence)'
    case 'fieldRef': return 'Dropdown'
    case 'letterTypeCode': return 'Kode jenis surat'
    case 'unitCode': return 'Kode unit'
    case 'committeeCode': return 'Kode kepanitiaan'
    case 'letterDate': return 'Tanggal surat'
    case 'issueDate': return 'Tanggal terbit'
  }
}

function SimpleComponentEditor({ component, onChange }: { component: DSLComponent; onChange: (c: DSLComponent) => void }) {
  if (component.type === 'literal') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`lit-${component.value}`} className="text-[11.5px] font-semibold">Nilai statis</Label>
        <Input id={`lit-${component.value}`} className="h-9 bg-surface font-mono" value={component.value}
          onChange={(e) => onChange({ type: 'literal', value: e.target.value })} aria-label="Nilai statis" />
        <p className="text-[10.5px] text-muted-foreground">Tidak boleh mengandung "/" — akan terlihat seperti pemisah.</p>
      </div>
    )
  }
  if (component.type === 'sequence') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="seq-pad" className="text-[11.5px] font-semibold">Jumlah digit minimum (padding)</Label>
        <Input id="seq-pad" className="h-9 w-24 bg-surface" type="number" min={1} max={10} value={component.padding}
          onChange={(e) => onChange({ type: 'sequence', padding: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
          aria-label="Jumlah digit padding" />
        <p className="text-[10.5px] text-muted-foreground">Contoh: padding 3 → 001, 002, …; 1000 tetap 1000.</p>
      </div>
    )
  }
  if (component.type === 'letterDate' || component.type === 'issueDate') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`fmt-${component.type}-${component.format}`} className="text-[11.5px] font-semibold">Format keluaran</Label>
        <Select value={component.format} onValueChange={(v) => onChange({ type: component.type, format: v as never })}>
          <SelectTrigger id={`fmt-${component.type}-${component.format}`} className="h-9 bg-surface text-[12.5px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="MONTH_ROMAN">Bulan Romawi (I–XII)</SelectItem>
            <SelectItem value="MONTH_2">Bulan 2 digit (01–12)</SelectItem>
            <SelectItem value="MONTH_NAME">Nama bulan (Januari…)</SelectItem>
            <SelectItem value="YEAR_4">Tahun 4 digit</SelectItem>
            <SelectItem value="YEAR_2">Tahun 2 digit</SelectItem>
            <SelectItem value="DATE_ISO">Tanggal ISO (2026-01-15)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }
  return (
    <p className="text-[11.5px] text-muted-foreground">
      Komponen ini tidak punya pengaturan tambahan — nilainya diambil otomatis dari konteks surat.
    </p>
  )
}

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/

/**
 * Editor Dropdown lengkap (B.2): label tampilan, kunci variabel unik, placeholder,
 * daftar pilihan (label visual vs kode nomor), default, wajib/opsional, urutan
 * tampilan formulir, dan gunakan-dalam-nomor vs metadata.
 */
function DropdownEditor({ field, allFields, inNumber, onChange, onIncludeInNumber, onMove, onDelete }: {
  field: DropdownField
  allFields: DropdownField[]
  inNumber: boolean
  onChange: (f: DropdownField) => void
  onIncludeInNumber: (on: boolean) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const otherKeys = allFields.filter(f => f.key !== field.key).map(f => f.key)
  const keyError = !FIELD_KEY_RE.test(field.key)
    ? 'Kunci harus snake_case (huruf kecil/angka/underscore), diawali huruf, 2–32 karakter'
    : otherKeys.includes(field.key)
      ? 'Kunci sudah dipakai Dropdown lain pada profil ini'
      : null
  const dupCodes = field.options.map(o => o.code).filter((c, i, a) => a.indexOf(c) !== i)
  const patch = (p: Partial<DropdownField>) => onChange({ ...field, ...p })

  const setOption = (id: string, p: Partial<DropdownOption>) => {
    patch({ options: field.options.map(o => o.id === id ? { ...o, ...p } : o) })
  }
  const addOption = () => {
    const id = freshOptionId(field.options.map(o => o.id))
    const nextLetter = String.fromCharCode(65 + (field.options.length % 26))
    patch({ options: [...field.options, { id, label: `Pilihan ${field.options.length + 1}`, code: nextLetter, active: true }] })
  }
  const removeOption = (id: string) => {
    patch({
      options: field.options.filter(o => o.id !== id),
      defaultOptionId: field.defaultOptionId === id ? null : field.defaultOptionId,
    })
  }

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`de-label-${field.key}`} className="text-[11.5px] font-semibold">Label tampilan</Label>
          <Input id={`de-label-${field.key}`} className="h-9 bg-surface" value={field.label}
            onChange={(e) => patch({ label: e.target.value })} placeholder="mis. Arah Surat" aria-label="Label tampilan dropdown" />
          <p className="text-[10.5px] text-muted-foreground">Teks yang dilihat operator pada formulir surat.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`de-key-${field.key}`} className="text-[11.5px] font-semibold">
            Kunci variabel <span className="font-mono font-normal text-muted-normal">{'{'}{field.key || '…'}{'}'}</span>
          </Label>
          <Input id={`de-key-${field.key}`} className={`h-9 bg-surface font-mono text-[12.5px] ${keyError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
            value={field.key} onChange={(e) => patch({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
            placeholder="mis. arah_surat" aria-label="Kunci variabel dropdown" aria-invalid={!!keyError} />
          {keyError
            ? <p className="text-[10.5px] text-destructive">{keyError}</p>
            : <p className="text-[10.5px] text-muted-foreground">Identifier stabil — dipakai dalam template nomor & penyimpanan pilihan.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`de-ph-${field.key}`} className="text-[11.5px] font-semibold">Placeholder</Label>
          <Input id={`de-ph-${field.key}`} className="h-9 bg-surface" value={field.placeholder ?? ''}
            onChange={(e) => patch({ placeholder: e.target.value || null })} placeholder="mis. Pilih arah" aria-label="Placeholder dropdown" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`de-help-${field.key}`} className="text-[11.5px] font-semibold">Teks bantuan <span className="font-normal text-muted-foreground">(opsional)</span></Label>
          <Input id={`de-help-${field.key}`} className="h-9 bg-surface" value={field.helperText ?? ''}
            onChange={(e) => patch({ helperText: e.target.value || null })} placeholder="mis. Internal = dalam organisasi" aria-label="Teks bantuan dropdown" />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 cursor-pointer text-[12px] font-medium">
          <input type="checkbox" className="accent-emerald w-4 h-4" checked={field.required}
            onChange={(e) => patch({ required: e.target.checked })} aria-label="Field wajib diisi" />
          Wajib diisi operator
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-[12px] font-medium">
          <input type="checkbox" className="accent-emerald w-4 h-4" checked={inNumber}
            onChange={(e) => onIncludeInNumber(e.target.checked)} aria-label="Gunakan kode dalam nomor surat" />
          Gunakan kode dalam nomor surat
          <span className="text-[10.5px] font-normal text-muted-foreground">(matikan = hanya metadata)</span>
        </label>
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="font-medium">Urutan formulir:</span>
          <Button size="icon" variant="outline" className="h-7 w-7 bg-surface" onClick={() => onMove(-1)} aria-label="Naikkan urutan formulir" title="Naik">
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="outline" className="h-7 w-7 bg-surface" onClick={() => onMove(1)} aria-label="Turunkan urutan formulir" title="Turun">
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Opsi: label visual vs kode nomor (D.2) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[11.5px] font-semibold">Daftar pilihan ({field.options.length})</Label>
          <Button size="sm" variant="outline" className="h-7 bg-surface text-[11.5px]" onClick={addOption}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Pilihan
          </Button>
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          Operator memilih <span className="font-semibold">label</span>; nomor surat memakai <span className="font-semibold">kode</span>.
          Contoh: Internal → A.
        </p>
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="min-w-[430px] space-y-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_86px_64px_58px_36px] gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Label visual</span><span>Kode</span><span>Default</span><span>Aktif</span><span />
            </div>
            {field.options.map((o) => (
              <div key={o.id} className={`grid grid-cols-[minmax(0,1fr)_86px_64px_58px_36px] gap-2 items-center ${!o.active ? 'opacity-55' : ''}`}>
                <Input className="h-8 bg-surface text-[12.5px]" value={o.label}
                  onChange={(e) => setOption(o.id, { label: e.target.value })}
                  aria-label={`Label pilihan ${o.id}`} />
                <Input className="h-8 bg-surface font-mono text-[12.5px]" value={o.code}
                  onChange={(e) => setOption(o.id, { code: e.target.value.trim() })}
                  aria-label={`Kode pilihan ${o.id}`} />
                <div className="flex justify-center">
                  <input type="radio" name={`def-${field.key}`} className="accent-emerald w-4 h-4"
                    checked={field.defaultOptionId === o.id}
                    onChange={() => patch({ defaultOptionId: o.id })}
                    aria-label={`Jadikan default: ${o.label}`} title="Pilihan default" />
                </div>
                <div className="flex justify-center">
                  <input type="checkbox" className="accent-emerald w-4 h-4" checked={o.active}
                    onChange={(e) => setOption(o.id, { active: e.target.checked })}
                    aria-label={`Aktifkan pilihan ${o.label}`} title="Opsi aktif (bisa dipilih)" />
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-red-50"
                  onClick={() => removeOption(o.id)} aria-label={`Hapus pilihan ${o.label}`} title="Hapus pilihan"
                  disabled={field.options.length <= 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        {dupCodes.length > 0 && (
          <p className="text-[10.5px] text-gold-dark">
            ⚠ Kode ganda dalam Dropdown ini: {dupCodes.join(', ')} — nomor tetap unik lewat urutan, tetapi segmen ini tidak membedakan pilihan.
          </p>
        )}
      </div>

      {inNumber ? (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 text-destructive hover:bg-red-50 text-[11.5px]"
            onClick={() => { onIncludeInNumber(false); toast.info(`"${field.label}" kini hanya metadata — hapus dari daftar field di bawah bila tidak diperlukan`) }}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Keluarkan dari nomor
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 text-destructive hover:bg-red-50 text-[11.5px]"
            onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Hapus field ini
          </Button>
        </div>
      )}
    </div>
  )
}

// ===================== Menu tambah komponen =====================

function AddComponentMenu({ onAdd, onAddDropdown }: {
  onAdd: (c: DSLComponent) => void
  onAddDropdown: () => void
}) {
  const items: { label: string; hint: string; action: () => void }[] = [
    { label: 'Dropdown', hint: 'pilihan bebas + kode (mis. Arah, Klasifikasi)', action: onAddDropdown },
    { label: 'Urutan (sequence)', hint: 'nomor berurutan dari counter', action: () => onAdd({ type: 'sequence', padding: 3 }) },
    { label: 'Teks statis', hint: 'segmen tetap, mis. YAPSI-DS', action: () => onAdd({ type: 'literal', value: 'YAPSI-DS' }) },
    { label: 'Kode jenis surat', hint: 'dari master jenis surat', action: () => onAdd({ type: 'letterTypeCode' }) },
    { label: 'Kode unit', hint: 'unit penerbit surat', action: () => onAdd({ type: 'unitCode' }) },
    { label: 'Kode kepanitiaan', hint: 'panitia penerbit (khusus surat panitia)', action: () => onAdd({ type: 'committeeCode' }) },
    { label: 'Bulan (tgl surat)', hint: 'Romawi, 2 digit, atau nama', action: () => onAdd({ type: 'letterDate', format: 'MONTH_ROMAN' }) },
    { label: 'Tahun (tgl surat)', hint: '4 digit', action: () => onAdd({ type: 'letterDate', format: 'YEAR_4' }) },
    { label: 'Tanggal ISO (tgl surat)', hint: 'mis. 2026-01-15', action: () => onAdd({ type: 'letterDate', format: 'DATE_ISO' }) },
    { label: 'Tahun (tgl terbit)', hint: 'berdasar waktu penerbitan', action: () => onAdd({ type: 'issueDate', format: 'YEAR_4' }) },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button key={it.label} type="button"
          onClick={it.action}
          title={it.hint}
          className="group inline-flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-[12px] font-medium shadow-card transition-colors hover:border-emerald/40 hover:bg-emerald-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald/40">
          <Plus className="w-3.5 h-3.5 text-emerald" />
          {it.label}
        </button>
      ))}
    </div>
  )
}


