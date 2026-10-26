'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiGet, apiPost, fmtBytes, fmtDate, fmtDateTime } from '@/lib/client'
import { StatusBadge, MiniTag, EmptyState } from './ui-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import {
  Download, FileUp, Trash2, Undo2, Ban, Stamp, Paperclip, FileCheck2,
  Hash, Building2, Users2, CalendarDays, User, AlertTriangle,
} from 'lucide-react'

interface LetterDetailData {
  letter: {
    id: string
    status: string
    officialNumber: string | null
    legacyNumber: string | null
    direction: string | null
    letterDate: string | null
    issuedAt: string | null
    cancelReason: string | null
    cancelledAt: string | null
    recipient: string | null
    subject: string | null
    notes: string | null
    isImported: boolean
    issuingUnit: { id: string; code: string; name: string }
    committee?: { id: string; code: string; name: string } | null
    letterType?: { id: string; code: string; name: string } | null
    issuer?: { id: string; fullName: string } | null
    profileVersion?: { profile: { name: string }; version: number } | null
    files: ArchiveFileRow[]
  }
}

interface ArchiveFileRow {
  id: string
  label: string
  state: string
  versions: {
    id: string
    versionNo: number
    state: string
    isCurrent: boolean
    objectKey: string
    originalName: string
    sizeBytes: number
    mimeType: string
    sha256: string
    createdAt: string
  }[]
}

export function LetterDetail({ letterId, onClose }: { letterId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [replaceFileId, setReplaceFileId] = useState<string | null>(null)
  const [uploadLabel, setUploadLabel] = useState<'original' | 'attachment'>('original')

  const detail = useQuery({
    queryKey: ['letter', letterId],
    queryFn: () => apiGet<LetterDetailData>(`/api/letters/${letterId}`),
    enabled: !!letterId,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['letter', letterId] })
    qc.invalidateQueries({ queryKey: ['letters'] })
  }

  const issue = useMutation({
    mutationFn: () => apiPost<{ officialNumber: string }>(
      `/api/letters/${letterId}/issue`, undefined,
      { 'Idempotency-Key': crypto.randomUUID() },
    ),
    onSuccess: (data) => {
      toast.success(`Nomor resmi diterbitkan: ${data.officialNumber}`)
      invalidate()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const cancel = useMutation({
    mutationFn: () => apiPost(`/api/letters/${letterId}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      toast.success('Surat dibatalkan — nomor tidak akan dipakai ulang')
      setCancelOpen(false)
      setCancelReason('')
      invalidate()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const headers: Record<string, string> = {
        'x-file-name': encodeURIComponent(file.name),
        'x-file-label': uploadLabel,
        'Content-Type': file.type || 'application/octet-stream',
      }
      if (replaceFileId) headers['x-replace-file-id'] = replaceFileId
      return api<{ archiveFileId: string }>(`/api/letters/${letterId}/files`, {
        method: 'POST',
        headers,
        body: file,
      })
    },
    onSuccess: () => {
      toast.success('Berkas terunggah & tervalidasi')
      setReplaceFileId(null)
      invalidate()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const trash = useMutation({
    mutationFn: (fileId: string) => apiPost(`/api/archive-files/${fileId}/trash`, { reason: 'Dihapus melalui UI detail surat' }),
    onSuccess: () => { toast.success('Berkas dipindah ke trash'); invalidate() },
    onError: (e) => toast.error((e as Error).message),
  })
  const restore = useMutation({
    mutationFn: (fileId: string) => apiPost(`/api/archive-files/${fileId}/restore`),
    onSuccess: () => { toast.success('Berkas dipulihkan'); invalidate() },
    onError: (e) => toast.error((e as Error).message),
  })

  const l = detail.data?.letter

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && letterId) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error('Berkas melebihi 25 MiB')
        return
      }
      upload.mutate(file)
    }
    e.target.value = ''
  }

  return (
    <Dialog open={!!letterId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto scrollbar-slim">
        {detail.isLoading && (
          <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <div className="w-12 h-12 rounded-2xl bg-emerald-soft text-emerald flex items-center justify-center animate-pulse">
              <Hash className="w-6 h-6" />
            </div>
            <span className="text-sm">Memuat detail surat…</span>
          </div>
        )}
        {l && (
          <>
            {/* Hero nomor */}
            <DialogHeader className="space-y-3">
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#0d5c46] to-[#062f25] text-white p-5 -mt-1">
                <div className="absolute inset-0 pattern-islami opacity-60" aria-hidden />
                <div className="relative">
                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    <StatusBadge status={l.status} />
                    {l.isImported && <MiniTag tone="gold">Data impor</MiniTag>}
                    {l.profileVersion && (
                      <span className="text-[10.5px] text-white/60 font-medium">
                        {l.profileVersion.profile.name} · v{l.profileVersion.version}
                      </span>
                    )}
                  </div>
                  <DialogTitle className="font-mono text-[19px] md:text-[22px] font-bold tracking-tight break-all text-white">
                    {l.officialNumber ?? l.legacyNumber ?? 'Draft — belum bernomor'}
                  </DialogTitle>
                  <DialogDescription className="text-white/65 mt-1.5 text-[12.5px]">
                    {l.issuingUnit.code} — {l.issuingUnit.name}
                    {l.committee ? ` · ${l.committee.code} — ${l.committee.name}` : ''}
                    {l.letterType ? ` · ${l.letterType.name}` : ''}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5 rounded-xl border bg-surface p-4 shadow-card">
              <DetailItem icon={CalendarDays} label="Tanggal surat" value={fmtDate(l.letterDate) ?? '—'} />
              <DetailItem icon={Building2} label="Arah" value={l.direction === 'INTERNAL' ? 'Internal' : l.direction === 'EXTERNAL' ? 'Eksternal' : '—'} />
              <DetailItem icon={User} label="Penerima" value={l.recipient ?? '—'} />
              <DetailItem icon={Stamp} label="Penerbit" value={l.issuer?.fullName ?? '—'} />
              <DetailItem icon={CalendarDays} label="Waktu terbit" value={l.issuedAt ? fmtDateTime(l.issuedAt) : '—'} />
              <DetailItem icon={Users2} label="Jenis surat" value={l.letterType?.name ?? '—'} />
              {l.subject && <DetailItem icon={FileCheck2} label="Perihal" value={l.subject} full />}
              {l.cancelledAt && (
                <div className="sm:col-span-2 rounded-lg bg-red-50 border border-red-200 p-3 flex gap-3">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-[12.5px]">
                    <p className="font-semibold text-red-700">Dibatalkan pada {fmtDateTime(l.cancelledAt)}</p>
                    <p className="text-red-600/85 mt-0.5">{l.cancelReason ?? '—'}</p>
                    <p className="text-[11px] text-red-500/75 mt-1">Nomor tidak dihapus dari registry dan tidak dipakai ulang.</p>
                  </div>
                </div>
              )}
            </div>

            {l.notes && (
              <div className="rounded-xl border bg-gold-soft/50 p-4 text-[13px] text-foreground/80 italic">
                “{l.notes}”
              </div>
            )}

            {/* Aksi */}
            {l.status === 'DRAFT' && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald/25 bg-emerald-soft/60 p-4">
                <Button onClick={() => issue.mutate()} disabled={issue.isPending} className="shadow-card">
                  <Stamp className="w-4 h-4 mr-1.5" />
                  {issue.isPending ? 'Menerbitkan…' : 'Terbitkan Nomor'}
                </Button>
                <p className="text-[12px] text-muted-foreground">
                  Nomor dialokasikan <span className="font-semibold text-foreground">atomik</span> saat tombol ditekan — preview bukan reservasi.
                </p>
              </div>
            )}

            {l.status === 'ISSUED' && (
              <div className="flex justify-end">
                <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-red-50 hover:text-destructive bg-surface" onClick={() => setCancelOpen(true)}>
                  <Ban className="w-4 h-4 mr-1.5" /> Batalkan Surat
                </Button>
              </div>
            )}

            {/* Arsip berkas */}
            <Card className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-[14px] font-semibold flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-emerald" /> Arsip Berkas
                    <span className="text-muted-foreground font-normal">({l.files.length})</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border bg-surface p-0.5" role="tablist" aria-label="Kategori berkas">
                      {(['original', 'attachment'] as const).map(t => (
                        <button
                          key={t}
                          role="tab"
                          aria-selected={uploadLabel === t}
                          onClick={() => setUploadLabel(t)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${uploadLabel === t ? 'bg-emerald text-white' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          {t === 'original' ? 'Asli' : 'Lampiran'}
                        </button>
                      ))}
                    </div>
                    <input
                      ref={fileInputRef} type="file" className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.txt"
                      onChange={onPickFile}
                    />
                    <Button size="sm" className="shadow-card h-8" onClick={() => {
                      setReplaceFileId(null)
                      fileInputRef.current?.click()
                    }} disabled={l.status === 'CANCELLED' || upload.isPending}>
                      <FileUp className="w-4 h-4 mr-1" />
                      {upload.isPending ? 'Mengunggah…' : 'Unggah'}
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {l.files.length === 0 && (
                  <EmptyState
                    icon={FileUp}
                    title="Belum ada berkas"
                    description="Unggah PDF/JPEG/PNG/DOCX/XLSX/TXT hingga 25 MiB. Reupload membuat versi baru, bukan menimpa."
                  />
                )}
                {l.files.map((f) => {
                  const current = f.versions.find(v => v.isCurrent) ?? f.versions[0]
                  return (
                    <div key={f.id} className={`rounded-xl border p-3.5 space-y-2.5 transition-opacity ${f.state === 'TRASHED' ? 'opacity-55 border-dashed' : 'bg-surface shadow-card'}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="min-w-0 flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${f.state === 'TRASHED' ? 'bg-muted text-muted-foreground' : 'bg-emerald-soft text-emerald'}`}>
                            <FileCheck2 className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold truncate flex items-center gap-2">
                              {current?.originalName}
                              <MiniTag tone={f.label === 'original' ? 'emerald' : 'slate'}>
                                {f.label === 'original' ? 'Asli' : 'Lampiran'}
                              </MiniTag>
                              {f.state === 'TRASHED' && <Badge variant="outline" className="text-[10px] py-0">trash</Badge>}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {current ? `${fmtBytes(current.sizeBytes)} · SHA-256 ${current.sha256.slice(0, 10)}… · versi ${current.versionNo}/${f.versions.length}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          {current && current.state === 'READY' && f.state !== 'TRASHED' && (
                            <Button size="sm" variant="outline" className="h-8 bg-surface" asChild>
                              <a href={`/api/archive-versions/${current.id}/download`} aria-label="Unduh berkas">
                                <Download className="w-4 h-4" />
                              </a>
                            </Button>
                          )}
                          <input
                            type="file" className="hidden" id={`replace-${f.id}`}
                            accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.txt"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) {
                                setReplaceFileId(f.id)
                                setTimeout(() => upload.mutate(file), 0)
                              }
                              e.target.value = ''
                            }}
                          />
                          {f.state !== 'TRASHED' && l.status !== 'CANCELLED' && (
                            <Button size="sm" variant="outline" className="h-8 bg-surface" onClick={() => document.getElementById(`replace-${f.id}`)?.click()}>
                              <FileUp className="w-4 h-4 mr-1" /> Versi baru
                            </Button>
                          )}
                          {f.state === 'TRASHED' ? (
                            <Button size="sm" variant="outline" className="h-8 bg-surface" onClick={() => restore.mutate(f.id)} aria-label="Pulihkan berkas">
                              <Undo2 className="w-4 h-4" />
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-8 bg-surface text-destructive hover:bg-red-50" onClick={() => trash.mutate(f.id)} aria-label="Pindah ke trash">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {f.versions.length > 1 && (
                        <details className="text-[11.5px] group">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                            Riwayat versi ({f.versions.length})
                          </summary>
                          <ul className="mt-2 space-y-1.5 border-l-2 border-line pl-3.5">
                            {f.versions.map((v) => (
                              <li key={v.id} className="flex items-center justify-between gap-2">
                                <span className="font-mono">
                                  v{v.versionNo} {v.isCurrent && <span className="text-emerald font-semibold">(saat ini)</span>}
                                  {' '}· {fmtBytes(v.sizeBytes)} · {fmtDateTime(v.createdAt)}
                                </span>
                                {v.state === 'READY' && (
                                  <a className="underline decoration-dotted text-emerald hover:text-emerald-light font-medium" href={`/api/archive-versions/${v.id}/download`}>unduh</a>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </>
        )}
      </DialogContent>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-lg">
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><Ban className="w-4 h-4" /></span>
              Batalkan Surat
            </DialogTitle>
            <DialogDescription>
              Nomor yang sudah terbit tidak dihapus dan tidak akan dipakai ulang.
              Tindakan ini tercatat permanen di audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Alasan pembatalan</Label>
            <Textarea id="reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="bg-surface resize-none"
              placeholder="mis. Salah isi jenis surat — akan diterbitkan ulang" rows={3} />
            <p className="text-[11px] text-muted-foreground">Minimal 5 karakter. Jika perlu nomor pengganti, buat surat baru setelah pembatalan.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Tidak jadi</Button>
            <Button variant="destructive" disabled={cancelReason.trim().length < 5 || cancel.isPending}
              onClick={() => cancel.mutate()}>
              {cancel.isPending ? 'Membatalkan…' : 'Ya, batalkan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

function DetailItem({ icon: Icon, label, value, full }: {
  icon: React.ElementType
  label: string
  value: string
  full?: boolean
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      <p className="text-[13.5px] font-medium break-words">{value}</p>
    </div>
  )
}
