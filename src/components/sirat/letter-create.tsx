'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Info, Hash, Building2, CalendarDays, User, MessageSquareText, StickyNote, Users2, Lock, Link2, X, FileSearch } from 'lucide-react'
import { UnitRow } from './letters-view'
import { useMe, canUseUnitForRegularLetter, canUseCommitteeForLetter } from './use-session'

interface LetterTypeRow {
  id: string; code: string; name: string; category: string | null
  description: string | null; purpose: string | null; usageExamples: string | null; notes: string | null
  isActive: boolean
  _count?: { letters: number }
}
interface LetterTypesRes { letterTypes: LetterTypeRow[] }
interface CommitteesRes { committees: { id: string; code: string; name: string; unitId: string; status: string }[] }

interface RefSearchResult {
  id: string
  officialNumber: string | null
  legacyNumber: string | null
  subject: string | null
  letterDate: string | null
  status: string
  unitCode: string
}

interface RefDraft {
  letterId: string | null
  refNumberText: string
  subject?: string | null
  note?: string
}

export function CreateLetterDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (letterId: string) => void
}) {
  const qc = useQueryClient()
  const [unitId, setUnitId] = useState('')
  const [committeeId, setCommitteeId] = useState('NONE')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({}) // pilihan Dropdown dinamis (v1.6)
  const [letterTypeId, setLetterTypeId] = useState('')
  const [letterDate, setLetterDate] = useState(new Date().toISOString().slice(0, 10))
  const [recipient, setRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')

  // Referensi surat sebelumnya (master prompt lanjutan G.1)
  const [refDrafts, setRefDrafts] = useState<RefDraft[]>([])
  const [refInput, setRefInput] = useState('')
  const [refDropdown, setRefDropdown] = useState(false)
  const refDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [refResults, setRefResults] = useState<RefSearchResult[]>([])
  const [refSearching, setRefSearching] = useState(false)

  // Scope user (master prompt D.3): FE hanya menawarkan opsi yang diizinkan;
  // BE tetap memvalidasi ulang setiap payload (defense in depth).
  const me = useMe()
  const scope = me.data?.scope

  const units = useQuery({
    queryKey: ['units'],
    queryFn: () => apiGet<{ units: UnitRow[] }>('/api/units'),
    enabled: open,
  })
  const letterTypes = useQuery({
    queryKey: ['letter-types'],
    queryFn: () => apiGet<LetterTypesRes>('/api/letter-types'),
    enabled: open,
  })
  const committees = useQuery({
    queryKey: ['committees'],
    queryFn: () => apiGet<CommitteesRes>('/api/committees'),
    enabled: open,
  })

  // D.1: hanya unit aktif; D.2: scope tunggal → auto-select (derived, tanpa efek) & dikunci
  const activeUnits = useMemo(
    () => (units.data?.units ?? []).filter(u => u.status === 'ACTIVE'),
    [units.data],
  )
  const singleUnit = scope && !scope.all ? activeUnits.length === 1 : false
  const autoUnit = !unitId && singleUnit && activeUnits.length === 1 ? activeUnits[0].id : ''
  const effectiveUnitId = unitId || autoUnit

  // E.2: surat kepanitiaan hanya utk committee yang memang diizinkan
  // (assignment langsung / unit + includeCommittees). Unit tanpa izin → wajib panitia.
  const canRegular = canUseUnitForRegularLetter(scope, effectiveUnitId)
  const myCommittees = useMemo(
    () => (committees.data?.committees ?? []).filter(c =>
      c.unitId === effectiveUnitId && c.status === 'ACTIVE' && canUseCommitteeForLetter(scope, c)),
    [committees.data, effectiveUnitId, scope],
  )
  const committeeRequired = !!effectiveUnitId && !canRegular
  const effectiveCommitteeId = committeeRequired && committeeId === 'NONE' && myCommittees.length > 0
    ? myCommittees[0].id
    : committeeId

  const selectedType = letterTypes.data?.letterTypes.find(t => t.id === letterTypeId)

  // Preview nomor (perkiraan) + spesifikasi field formulir dinamis dari profil aktif (v1.6)
  const previewParams = useMemo(() => {
    const p = new URLSearchParams({ unitId: effectiveUnitId })
    if (effectiveCommitteeId !== 'NONE') p.set('committeeId', effectiveCommitteeId)
    if (letterTypeId) p.set('letterTypeId', letterTypeId)
    if (letterDate) p.set('letterDate', letterDate)
    const filled = Object.fromEntries(Object.entries(fieldValues).filter(([, v]) => v))
    if (Object.keys(filled).length > 0) p.set('fields', JSON.stringify(filled))
    return p.toString()
  }, [effectiveUnitId, effectiveCommitteeId, fieldValues, letterTypeId, letterDate])

  const preview = useQuery({
    queryKey: ['preview', previewParams],
    queryFn: () => apiGet<PreviewRes>(`/api/letters/preview?${previewParams}`),
    enabled: open && !!effectiveUnitId,
  })

  // Autocomplete referensi (G.2): debounce 300ms, min 2 karakter, hasil dibatasi & scope user
  useEffect(() => {
    if (refDebounce.current) clearTimeout(refDebounce.current)
    const q = refInput.trim()
    if (q.length < 2) {
      setRefResults([])
      setRefSearching(false)
      return
    }
    setRefSearching(true)
    refDebounce.current = setTimeout(async () => {
      try {
        const data = await apiGet<{ results: RefSearchResult[] }>(`/api/letters/search?q=${encodeURIComponent(q)}&limit=8`)
        setRefResults(data.results)
      } catch {
        setRefResults([])
      } finally {
        setRefSearching(false)
      }
    }, 300)
    return () => { if (refDebounce.current) clearTimeout(refDebounce.current) }
  }, [refInput])

  const addInternalRef = (r: RefSearchResult) => {
    const text = r.officialNumber ?? r.legacyNumber ?? r.id
    if (refDrafts.some(d => d.letterId === r.id || d.refNumberText.toUpperCase() === text.toUpperCase())) return
    setRefDrafts(prev => [...prev, { letterId: r.id, refNumberText: text, subject: r.subject }])
    setRefInput('')
    setRefResults([])
    setRefDropdown(false)
  }

  const addManualRef = () => {
    const text = refInput.trim()
    if (!text) return
    if (refDrafts.some(d => d.refNumberText.toUpperCase() === text.toUpperCase())) { setRefInput(''); return }
    setRefDrafts(prev => [...prev, { letterId: null, refNumberText: text }])
    setRefInput('')
    setRefResults([])
  }

  const createDraft = useMutation({
    mutationFn: async () => {
      const body = {
        issuingUnitId: effectiveUnitId,
        committeeId: effectiveCommitteeId === 'NONE' ? null : effectiveCommitteeId,
        fieldValues: Object.fromEntries(Object.entries(fieldValues).filter(([, v]) => v)),
        letterTypeId,
        letterDate,
        recipient: recipient || null,
        subject: subject || null,
        notes: notes || null,
        references: refDrafts.map(d => ({ letterId: d.letterId, refNumberText: d.refNumberText })),
      }
      return apiPost<{ letter: { id: string } }>('/api/letters', body)
    },
    onSuccess: (data) => {
      toast.success('Draft surat dibuat')
      qc.invalidateQueries({ queryKey: ['preview'] })
      setRefDrafts([])
      setRefInput('')
      onCreated(data.letter.id)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Field formulir dinamis (v1.6): spesifikasi dari profil aktif via preview API.
  // Wajib = flag required ATAU ikut nomor (segmen nomor butuh nilai).
  const dynFields = preview.data?.fields ?? []
  const dynMissing = dynFields.filter(f =>
    (f.required || f.inNumber) && !fieldValues[f.key] && !f.defaultOptionId)
  const canSubmit = effectiveUnitId && letterTypeId && letterDate
    && dynMissing.length === 0
    && (effectiveCommitteeId !== 'NONE' || canRegular)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto scrollbar-slim">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Buat Surat Baru</DialogTitle>
          <DialogDescription>
            Isi data surat sebagai draft, periksa perkiraan nomor, lalu terbitkan dari detail surat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> Unit penerbit
                {singleUnit && <Lock className="w-3 h-3 text-muted-foreground" aria-label="Ditetapkan otomatis — scope tunggal" />}
              </Label>
              <Select value={effectiveUnitId ?? ''} onValueChange={(v) => { setUnitId(v); setCommitteeId('NONE') }} disabled={singleUnit}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                <SelectContent>
                  {activeUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {singleUnit && (
                <p className="text-[11px] text-muted-foreground">Anda hanya memiliki satu unit — dipilih otomatis.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold flex items-center gap-1.5">
                <Users2 className="w-3.5 h-3.5 text-muted-foreground" /> Kepanitiaan
              </Label>
              <Select value={effectiveCommitteeId} onValueChange={setCommitteeId} disabled={!effectiveUnitId || (myCommittees.length === 0 && committeeRequired)}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Tidak ada" /></SelectTrigger>
                <SelectContent>
                  {!committeeRequired && <SelectItem value="NONE">Surat reguler unit</SelectItem>}
                  {myCommittees.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {committeeRequired && (
                <p className="text-[11px] text-muted-foreground">
                  Anda tidak berhak menerbitkan surat reguler unit ini — pilih kepanitiaan Anda.
                </p>
              )}
            </div>
          </div>

          {/* Field formulir dinamis dari profil penomoran (v1.6 — mis. Arah Surat, Klasifikasi) */}
          {dynFields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {dynFields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`df-${f.key}`} className="text-[12px] font-semibold flex items-center gap-1 flex-wrap">
                    {f.label}
                    {(f.required || f.inNumber) && <span className="text-destructive">*</span>}
                    {!f.inNumber && (
                      <span className="text-[10px] font-normal text-muted-foreground">(metadata)</span>
                    )}
                  </Label>
                  <Select
                    value={fieldValues[f.key] || f.defaultOptionId || ''}
                    onValueChange={(v) => setFieldValues(prev => ({ ...prev, [f.key]: v }))}>
                    <SelectTrigger id={`df-${f.key}`} className="bg-surface">
                      <SelectValue placeholder={f.placeholder || 'Pilih nilai'} />
                    </SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {f.helperText && (
                    <p className="text-[10.5px] text-muted-foreground">{f.helperText}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold flex items-center gap-1">
                Jenis surat
                <LetterTypeInfo selected={selectedType} />
              </Label>
              <Select value={letterTypeId ?? ''} onValueChange={setLetterTypeId}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                <SelectContent>
                  {(() => {
                    // Kelompokkan per kategori (default config v1.4) — memudahkan pengguna
                    // baru memilih jenis yang tepat tanpa harus hafal kode surat.
                    const active = (letterTypes.data?.letterTypes ?? []).filter(t => t.isActive)
                    const groups = new Map<string, typeof active>()
                    for (const t of active) {
                      const key = t.category || 'Lainnya'
                      if (!groups.has(key)) groups.set(key, [])
                      groups.get(key)!.push(t)
                    }
                    return [...groups.entries()].map(([category, items]) => (
                      <SelectGroup key={category}>
                        <SelectLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{category}</SelectLabel>
                        {items.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name} ({t.code})</SelectItem>
                        ))}
                      </SelectGroup>
                    ))
                  })()}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="letterDate" className="text-[12px] font-semibold flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-muted-foreground" /> Tanggal surat</Label>
            <Input id="letterDate" type="date" value={letterDate} className="bg-surface"
              onChange={(e) => setLetterDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recipient" className="text-[12px] font-semibold flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-muted-foreground" /> Penerima / instansi tujuan</Label>
            <Input id="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-surface"
              placeholder="mis. Kepala MI Darussalam" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject" className="text-[12px] font-semibold flex items-center gap-1.5"><MessageSquareText className="w-3.5 h-3.5 text-muted-foreground" /> Perihal</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="bg-surface"
              placeholder="mis. Permohonan izin kegiatan" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-[12px] font-semibold flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5 text-muted-foreground" /> Catatan (opsional)</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-surface resize-none" />
          </div>

          {/* Referensi surat sebelumnya (G.1): manual + autocomplete */}
          <div className="space-y-1.5">
            <Label htmlFor="refInput" className="text-[12px] font-semibold flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-muted-foreground" /> Referensi Surat Sebelumnya
              <span className="text-[10.5px] font-normal text-muted-foreground">(opsional)</span>
            </Label>
            <div className="relative">
              <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                id="refInput"
                value={refInput}
                className="bg-surface pl-9"
                placeholder="Ketik nomor (mis. 001/SK/…) atau masukkan nomor manual…"
                onChange={(e) => { setRefInput(e.target.value); setRefDropdown(true) }}
                onFocus={() => setRefDropdown(true)}
                onBlur={() => setTimeout(() => setRefDropdown(false), 180)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (refResults.length > 0 && refInput.trim().length >= 2) addInternalRef(refResults[0])
                    else addManualRef()
                  }
                }}
              />
              {refDropdown && refInput.trim().length >= 2 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-xl border bg-surface shadow-lift overflow-hidden">
                  {refSearching && <p className="px-3 py-2.5 text-[12px] text-muted-foreground">Mencari surat…</p>}
                  {!refSearching && refResults.length === 0 && (
                    <div className="px-3 py-2.5">
                      <p className="text-[12px] text-muted-foreground">Tidak ada surat yang cocok.</p>
                      <button type="button" className="mt-1 text-[12px] font-semibold text-emerald hover:underline" onClick={addManualRef}>
                        Simpan “{refInput.trim()}” sebagai referensi manual →
                      </button>
                    </div>
                  )}
                  {!refSearching && refResults.map(r => {
                    const num = r.officialNumber ?? r.legacyNumber ?? '(tanpa nomor)'
                    const already = refDrafts.some(d => d.letterId === r.id || d.refNumberText.toUpperCase() === num.toUpperCase())
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={already}
                        className="w-full text-left px-3 py-2 hover:bg-emerald-soft/50 disabled:opacity-40 transition-colors"
                        onMouseDown={(e) => { e.preventDefault(); addInternalRef(r) }}
                      >
                        <p className="font-mono text-[12px] font-semibold text-emerald-deep">{num}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {r.unitCode} · {r.status === 'CANCELLED' ? 'Batal' : 'Terbit'} · {r.subject ?? '(tanpa perihal)'}
                        </p>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {refDrafts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {refDrafts.map((d, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-emerald/25 bg-emerald-soft pl-2.5 pr-1.5 py-1 text-[11.5px]">
                    <Link2 className="w-3 h-3 text-emerald" />
                    <span className="font-mono font-semibold text-emerald-deep">{d.refNumberText}</span>
                    {d.letterId
                      ? <span className="text-emerald-deep/70">terhubung</span>
                      : <span className="text-muted-foreground">manual</span>}
                    <button
                      type="button"
                      className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-emerald/20"
                      aria-label="Hapus referensi"
                      onClick={() => setRefDrafts(prev => prev.filter((_, j) => j !== i))}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Pilih hasil pencarian untuk menghubungkan surat (relasi internal), atau simpan nomor apa pun sebagai referensi manual.
              Referensi hanya bisa diubah selama status masih draft.
            </p>
          </div>

          {/* Panel preview nomor */}
          {preview.data?.available && (
            <div className="rounded-xl border border-emerald/25 bg-gradient-to-br from-emerald-soft to-surface p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-emerald text-white flex items-center justify-center">
                  <Hash className="w-3.5 h-3.5" />
                </div>
                <p className="text-[12px] font-semibold text-emerald-deep">Perkiraan nomor</p>
                <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-muted-foreground">belum dialokasikan</span>
              </div>
              <p className="font-mono text-lg font-bold text-emerald-deep tracking-tight break-all">
                {preview.data.previewNumber}
              </p>
              <p className="text-[11.5px] text-muted-foreground mt-1.5 leading-relaxed">
                {preview.data.note}
                {preview.data.error && <span className="text-destructive"> {preview.data.error}</span>}
              </p>
            </div>
          )}
          {preview.data && !preview.data.available && (
            <div className="rounded-xl border border-gold/30 bg-gold-soft p-4 flex gap-3">
              <Info className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
              <div>
                <p className="text-[12.5px] font-semibold text-gold-dark">Nomor belum bisa dihitung</p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5">{preview.data.reason}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            disabled={!canSubmit || createDraft.isPending}
            onClick={() => createDraft.mutate()}
            className="shadow-card min-w-32"
          >
            {createDraft.isPending ? 'Menyimpan…' : 'Simpan Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * ⓘ Kode Surat (master prompt C): popover dari data master LetterType — bukan hardcode.
 * Dukung hover (desktop), tap (layar sentuh), dan keyboard (focus + Enter/Space).
 */
function LetterTypeInfo({ selected }: { selected?: LetterTypeRow }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Keterangan kode surat"
          className="inline-flex w-4 h-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] font-bold text-muted-foreground hover:text-emerald hover:border-emerald transition-colors align-middle"
          onClick={(e) => { e.preventDefault(); setOpen(v => !v) }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onBlur={() => setOpen(false)}
        >
          i
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {selected ? (
          <div className="p-3.5 space-y-2 max-h-72 overflow-y-auto scrollbar-slim">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold">Kode Surat</p>
              <div className="flex items-center gap-1.5">
                {selected.category && (
                  <span className="text-[10px] font-semibold text-emerald-deep/90">{selected.category}</span>
                )}
                <span className="font-mono text-[12px] font-bold text-emerald-deep bg-emerald-soft rounded-md px-2 py-0.5">
                  {selected.code}
                </span>
              </div>
            </div>
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Nama / klasifikasi</p>
              <p className="text-[12.5px]">{selected.name}</p>
            </div>
            {selected.description && (
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Keterangan</p>
                <p className="text-[12.5px] leading-relaxed">{selected.description}</p>
              </div>
            )}
            {selected.purpose && (
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Fungsi / tujuan</p>
                <p className="text-[12.5px] leading-relaxed">{selected.purpose}</p>
              </div>
            )}
            {selected.usageExamples && (
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Contoh penggunaan</p>
                <ul className="mt-1 space-y-0.5">
                  {selected.usageExamples.split('\n').filter(Boolean).map((line, i) => (
                    <li key={i} className="text-[12px] flex gap-1.5"><span className="text-emerald font-bold">•</span>{line.trim()}</li>
                  ))}
                </ul>
              </div>
            )}
            {selected.notes && (
              <div className="rounded-lg bg-gold-soft/70 p-2 text-[11.5px] text-gold-dark leading-relaxed">
                {selected.notes}
              </div>
            )}
            {!selected.description && !selected.purpose && !selected.usageExamples && (
              <p className="text-[12.5px] text-muted-foreground leading-relaxed">Belum ada keterangan untuk jenis surat ini.</p>
            )}
            <div className="rounded-lg bg-muted/60 p-2.5 text-[11.5px] text-muted-foreground leading-relaxed">
              Kode ini menjadi komponen nomor surat saat terbit
              {typeof selected._count?.letters === 'number' && (
                <> · sudah dipakai <span className="font-semibold text-foreground">{selected._count.letters}</span> surat</>
              )}
              . Hanya jenis <span className="font-semibold text-foreground">aktif</span> yang bisa dipilih untuk surat baru.
            </div>
          </div>
        ) : (
          <div className="p-3.5 text-[12.5px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Kode surat</span> adalah singkatan jenis surat
            (mis. <span className="font-mono">UND</span> = undangan) yang menjadi bagian nomor surat resmi.
            Pilih jenis surat terlebih dahulu untuk melihat keterangannya.
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface PreviewRes {
  available: boolean
  previewNumber?: string
  note?: string
  reason?: string
  error?: string
  fields?: DynFieldSpec[]
}

/** Spesifikasi field formulir dinamis dari profil penomoran aktif (v1.6). */
interface DynFieldSpec {
  key: string
  label: string
  placeholder: string | null
  helperText: string | null
  required: boolean
  inNumber: boolean
  defaultOptionId: string | null
  options: { id: string; label: string }[]
}
