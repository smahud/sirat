'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost, fmtDate } from '@/lib/client'
import { letterBadgeVariant, letterStatusId, LetterRow } from './dashboard-view'
import { PageHeader, StatusBadge, EmptyState, MiniTag } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Plus, Search, FileDown, ChevronLeft, ChevronRight, FileText, Paperclip, Inbox } from 'lucide-react'
import { CreateLetterDialog } from './letter-create'
import { LetterDetail } from './letter-detail'

interface UnitsRes { units: UnitRow[] }
export interface UnitRow { id: string; code: string; name: string; status: string }

export function LettersView() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('ALL')
  const [unitId, setUnitId] = useState('ALL')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<UnitsRes>('/api/units') })

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (status !== 'ALL') p.set('status', status)
    if (unitId !== 'ALL') p.set('unitId', unitId)
    p.set('page', String(page))
    return p.toString()
  }, [q, status, unitId, page])

  const letters = useQuery({
    queryKey: ['letters', params],
    queryFn: () => apiGet<{ letters: LetterRow[]; total: number; page: number; pageSize: number }>(`/api/letters?${params}`),
  })

  const totalPages = letters.data ? Math.max(1, Math.ceil(letters.data.total / letters.data.pageSize)) : 1

  const exportCsv = () => {
    const p = new URLSearchParams()
    if (unitId !== 'ALL') p.set('unitId', unitId)
    if (status !== 'ALL') p.set('status', status)
    const qs = p.toString()
    window.open(`/api/export/letters.csv${qs ? `?${qs}` : ''}`, '_blank')
    toast.success('Export CSV dimulai — mengikuti filter unit & status aktif')
  }

  return (
    <div>
      <PageHeader
        title="Surat"
        description="Registrasi, penerbitan nomor resmi, dan arsip digital."
      >
        <Button
          variant="outline"
          onClick={exportCsv}
          className="shadow-card bg-surface"
        >
          <FileDown className="w-4 h-4 mr-1.5" /> Export CSV
        </Button>
        <Button onClick={() => setShowCreate(true)} className="shadow-card">
          <Plus className="w-4 h-4 mr-1.5" /> Buat Surat
        </Button>
      </PageHeader>

      {/* Filter bar */}
      <Card className="mb-4 shadow-card">
        <CardContent className="p-4 grid gap-3 md:grid-cols-[1fr_180px_220px]">
          <div className="space-y-1.5">
            <Label htmlFor="q" className="text-[12px] font-semibold text-muted-foreground">Pencarian</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                id="q" className="pl-9 bg-surface" placeholder="Nomor / penerima / perihal…"
                value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
              <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua status</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="ISSUED">Terbit</SelectItem>
                <SelectItem value="CANCELLED">Batal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold text-muted-foreground">Unit penerbit</Label>
            <Select value={unitId} onValueChange={(v) => { setUnitId(v); setPage(1) }}>
              <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua unit</SelectItem>
                {units.data?.units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabel */}
      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="min-w-44 font-semibold">Nomor</TableHead>
                <TableHead className="font-semibold">Tanggal</TableHead>
                <TableHead className="font-semibold">Unit / Jenis</TableHead>
                <TableHead className="font-semibold">Penerima</TableHead>
                <TableHead className="min-w-52 font-semibold">Perihal</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="text-right font-semibold">Berkas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {letters.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-14">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-soft text-emerald flex items-center justify-center animate-pulse">
                        <FileText className="w-5 h-5" />
                      </div>
                      <span className="text-sm">Memuat daftar surat…</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {letters.data && letters.data.letters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="p-0 border-0">
                    <EmptyState
                      icon={Inbox}
                      title="Tidak ada surat yang cocok"
                      description="Ubah kata kunci atau filter, atau buat surat baru untuk memulai registrasi."
                    >
                      <Button onClick={() => setShowCreate(true)} className="shadow-card">
                        <Plus className="w-4 h-4 mr-1.5" /> Buat Surat
                      </Button>
                    </EmptyState>
                  </TableCell>
                </TableRow>
              )}
              {letters.data?.letters.map((l) => (
                <TableRow
                  key={l.id}
                  className="cursor-pointer transition-colors hover:bg-emerald-soft/40"
                  onClick={() => setDetailId(l.id)}
                >
                  <TableCell className="font-mono text-[12px] font-semibold whitespace-nowrap">
                    {l.officialNumber ?? l.legacyNumber
                      ? <span>{l.officialNumber ?? l.legacyNumber}</span>
                      : <span className="text-muted-foreground/70 italic">draft — belum bernomor</span>}
                    {l.isImported && <MiniTag tone="gold">{` import`}</MiniTag>}
                  </TableCell>
                  <TableCell className="text-[13px] whitespace-nowrap">{fmtDate(l.letterDate) ?? '—'}</TableCell>
                  <TableCell>
                    <span className="text-[13px] font-medium">{l.issuingUnit.code}</span>
                    {l.committee && <span className="text-[12px] text-muted-foreground"> / {l.committee.code}</span>}
                    {l.letterType && (
                      <span className="block text-[11px] text-muted-foreground">{l.letterType.code}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-[13px]">{l.recipient ?? '—'}</TableCell>
                  <TableCell className="max-w-52 truncate text-[13px] text-muted-foreground">{l.subject ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={l.status} /></TableCell>
                  <TableCell className="text-right">
                    {(l._count?.files ?? 0) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald">
                        <Paperclip className="w-3.5 h-3.5" />{l._count?.files}
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <p className="text-[12.5px] text-muted-foreground">
          {letters.data
            ? <>Menampilkan <span className="font-semibold text-foreground">{letters.data.letters.length}</span> dari <span className="font-semibold text-foreground">{letters.data.total}</span> surat</>
            : '…'}
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 bg-surface shadow-card" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="w-4 h-4" /> Sebelumnya
          </Button>
          <span className="text-[12.5px] font-medium tabular-nums px-2">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" className="h-8 bg-surface shadow-card" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Berikutnya <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <CreateLetterDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); setDetailId(id); qc.invalidateQueries({ queryKey: ['letters'] }) }}
      />
      <LetterDetail
        letterId={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  )
}
