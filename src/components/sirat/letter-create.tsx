'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Info, Hash, Building2, CalendarDays, User, MessageSquareText, StickyNote, Users2 } from 'lucide-react'
import { UnitRow } from './letters-view'

interface LetterTypesRes { letterTypes: { id: string; code: string; name: string; isActive: boolean }[] }
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

  const myCommittees = useMemo(
    () => (committees.data?.committees ?? []).filter(c => c.unitId === unitId && c.status === 'ACTIVE'),
    [committees.data, unitId],
  )

  // Preview nomor (perkiraan)
  const previewParams = useMemo(() => {
    const p = new URLSearchParams({ unitId })
    if (committeeId !== 'NONE') p.set('committeeId', committeeId)
    if (direction) p.set('direction', direction)
    if (letterTypeId) p.set('letterTypeId', letterTypeId)
    if (letterDate) p.set('letterDate', letterDate)
    return p.toString()
  }, [unitId, committeeId, direction, letterTypeId, letterDate])

  const preview = useQuery({
    queryKey: ['preview', previewParams],
    queryFn: () => apiGet<PreviewRes>(`/api/letters/preview?${previewParams}`),
    enabled: open && !!unitId,
  })

  const createDraft = useMutation({
    mutationFn: async () => {
      const body = {
        issuingUnitId: unitId,
        committeeId: committeeId === 'NONE' ? null : committeeId,
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

  const canSubmit = unitId && direction && letterTypeId && letterDate

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
              <Label className="text-[12px] font-semibold flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted-foreground" /> Unit penerbit</Label>
              <Select value={unitId || undefined} onValueChange={(v) => { setUnitId(v); setCommitteeId('NONE') }}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                <SelectContent>
                  {units.data?.units.filter(u => u.status === 'ACTIVE').map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold flex items-center gap-1.5"><Users2 className="w-3.5 h-3.5 text-muted-foreground" /> Kepanitiaan</Label>
              <Select value={committeeId} onValueChange={setCommitteeId} disabled={!unitId || myCommittees.length === 0}>
                <SelectTrigger className="bg-surface"><SelectValue placeholder="Tidak ada" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Surat reguler unit</SelectItem>
                  {myCommittees.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label className="text-[12px] font-semibold">Jenis surat</Label>
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

interface PreviewRes {
  available: boolean
  previewNumber?: string
  note?: string
  reason?: string
  error?: string
}
