'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Info, Hash, Building2, CalendarDays, User, MessageSquareText, StickyNote, Users2, Lock } from 'lucide-react'
import { UnitRow } from './letters-view'
import { useMe, canUseUnitForRegularLetter, canUseCommitteeForLetter } from './use-session'

interface LetterTypeRow {
  id: string; code: string; name: string; description: string | null; isActive: boolean
  _count?: { letters: number }
}
interface LetterTypesRes { letterTypes: LetterTypeRow[] }
interface CommitteesRes { committees: { id: string; code: string; name: string; unitId: string; status: string }[] }

export function CreateLetterDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (letterId: string) => void
}) {
  const qc = useQueryClient()
  const [unitId, setUnitId] = useState('')
  const [committeeId, setCommitteeId] = useState('NONE')
  const [direction, setDirection] = useState('')
  const [letterTypeId, setLetterTypeId] = useState('')
  const [letterDate, setLetterDate] = useState(new Date().toISOString().slice(0, 10))
  const [recipient, setRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')

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

  // Preview nomor (perkiraan)
  const previewParams = useMemo(() => {
    const p = new URLSearchParams({ unitId: effectiveUnitId })
    if (effectiveCommitteeId !== 'NONE') p.set('committeeId', effectiveCommitteeId)
    if (direction) p.set('direction', direction)
    if (letterTypeId) p.set('letterTypeId', letterTypeId)
    if (letterDate) p.set('letterDate', letterDate)
    return p.toString()
  }, [effectiveUnitId, effectiveCommitteeId, direction, letterTypeId, letterDate])

  const preview = useQuery({
    queryKey: ['preview', previewParams],
    queryFn: () => apiGet<PreviewRes>(`/api/letters/preview?${previewParams}`),
    enabled: open && !!effectiveUnitId,
  })

  const createDraft = useMutation({
    mutationFn: async () => {
      const body = {
        issuingUnitId: effectiveUnitId,
        committeeId: effectiveCommitteeId === 'NONE' ? null : effectiveCommitteeId,
        direction,
        letterTypeId,
        letterDate,
        recipient: recipient || null,
        subject: subject || null,
        notes: notes || null,
      }
      return apiPost<{ letter: { id: string } }>('/api/letters', body)
    },
    onSuccess: (data) => {
      toast.success('Draft surat dibuat')
      qc.invalidateQueries({ queryKey: ['preview'] })
      onCreated(data.letter.id)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const canSubmit = effectiveUnitId && direction && letterTypeId && letterDate
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
              <Select value={effectiveUnitId || undefined} onValueChange={(v) => { setUnitId(v); setCommitteeId('NONE') }} disabled={singleUnit}>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Arah surat</Label>
              <Select value={direction || undefined} onValueChange={setDirection}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Internal / Eksternal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INTERNAL">Internal</SelectItem>
                  <SelectItem value="EXTERNAL">Eksternal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold flex items-center gap-1">
                Jenis surat
                <LetterTypeInfo selected={selectedType} />
              </Label>
              <Select value={letterTypeId || undefined} onValueChange={setLetterTypeId}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                <SelectContent>
                  {letterTypes.data?.letterTypes.filter(t => t.isActive).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.code})</SelectItem>
                  ))}
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
          <div className="p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold">Kode Surat</p>
              <span className="font-mono text-[12px] font-bold text-emerald-deep bg-emerald-soft rounded-md px-2 py-0.5">
                {selected.code}
              </span>
            </div>
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Nama / klasifikasi</p>
              <p className="text-[12.5px]">{selected.name}</p>
            </div>
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Keterangan</p>
              <p className="text-[12.5px] leading-relaxed">
                {selected.description || 'Belum ada keterangan untuk jenis surat ini.'}
              </p>
            </div>
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
}
