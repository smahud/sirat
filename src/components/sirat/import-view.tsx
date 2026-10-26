'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, fmtDate } from '@/lib/client'
import { PageHeader, StatCard, MiniTag } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { FileSpreadsheet, Upload, Info, Rows3, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react'

interface DryRunRow {
  rowId: string | null; rowIndex: number; seq: string | null; direction: string | null; letterTypeName: string | null
  letterTypeCode: string | null; letterDate: string | null; fullNumberRaw: string | null
  recipient: string | null; subject: string | null; status: string; issues: string[]
}
interface DryRunRes {
  batchId: string; sheet: string; majorYear: number
  counts: { total: number; candidates: number; praisi: number; errors: number; needsReview: number }
  note: string | null; rows: DryRunRow[]
}

export function ImportView() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dryRun, setDryRun] = useState<DryRunRes | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetUnitId, setTargetUnitId] = useState('')
  const [setHighWater, setSetHighWater] = useState(false)

  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: { id: string; code: string; name: string }[] }>('/api/units') })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return apiPost<DryRunRes>('/api/import/excel', fd)
    },
    onSuccess: (data) => {
      setDryRun(data)
      setSelected(new Set(
        data.rows.filter(r => (r.status === 'CANDIDATE' || r.status === 'NEEDS_REVIEW') && r.rowId)
          .map(r => r.rowId!)
      ))
      toast.success(`Dry-run selesai: ${data.counts.candidates} kandidat, ${data.counts.errors} error, ${data.counts.praisi} praisi`)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const commit = useMutation({
    mutationFn: async () => {
      return apiPost<{ accepted: string[]; skipped: { rowId: string; reason: string }[] }>(`/api/import/${dryRun!.batchId}/commit`, {
        rowIds: Array.from(selected),
        targetUnitId,
        setHighWater,
      })
    },
    onSuccess: (data) => {
      toast.success(`Commit selesai: ${data.accepted.length} diterima, ${data.skipped.length} dilewati`)
      setDryRun(null)
      qc.invalidateQueries({ queryKey: ['letters'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div>
      <PageHeader
        title="Import Histori Excel"
        description="Dry-run → review → commit terkontrol. Nomor lama dipertahankan persis; formula tidak dieksekusi."
      />

      {/* Info cutover */}
      <div className="rounded-xl border border-gold/30 bg-gold-soft/60 p-4 mb-5 flex gap-3.5">
        <Info className="w-4.5 h-4.5 w-[18px] h-[18px] text-gold-dark shrink-0 mt-0.5" />
        <div className="text-[12.5px] leading-relaxed text-foreground/80">
          <p className="font-semibold text-gold-dark mb-0.5">Syarat cutover yang aman</p>
          Bekukan pencatatan Excel selama final cutover. High-water counter hanya disetel bila Anda yakin tidak ada
          nomor di luar file. Baris praisi (tanpa tanggal) tidak diimpor sebagai surat terbit.
        </div>
      </div>

      {/* Upload */}
      <Card className="shadow-card mb-5">
        <CardContent className="p-5">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-soft text-emerald flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[14px] font-semibold">Unggah workbook “Nomor Surat”</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Format .xlsx / .xls — dibaca sebagai raw + cached value, formula tidak pernah dieksekusi.
                </p>
              </div>
            </div>
            <Button size="lg" onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="shadow-card">
              <Upload className="w-4 h-4 mr-1.5" />
              {upload.isPending ? 'Memproses dry-run…' : 'Pilih File Excel'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {dryRun && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 mb-4">
            <StatCard label="Total baris" value={dryRun.counts.total} icon={Rows3} tone="slate" />
            <StatCard label="Kandidat" value={dryRun.counts.candidates} icon={CheckCircle2} tone="emerald" />
            <StatCard label="Perlu review" value={dryRun.counts.needsReview} icon={AlertTriangle} tone="gold" />
            <StatCard label="Prais" value={dryRun.counts.praisi} icon={Clock} tone="slate" />
            <StatCard label="Error" value={dryRun.counts.errors} icon={XCircle} tone="red" />
          </div>

          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-[14px] font-semibold">
                Sheet “{dryRun.sheet}” — tahun mayoritas {dryRun.majorYear}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-h-96 overflow-y-auto scrollbar-slim rounded-xl border">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-muted/70 sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5 text-left w-10">
                        <input type="checkbox" aria-label="pilih semua"
                          className="accent-emerald"
                          checked={selected.size === dryRun.rows.filter(r => r.status === 'CANDIDATE' || r.status === 'NEEDS_REVIEW').length}
                          onChange={(e) => {
                            setSelected(e.target.checked
                              ? new Set(dryRun.rows.filter(r => r.status === 'CANDIDATE' || r.status === 'NEEDS_REVIEW').map(r => r.rowId).filter((x): x is string => !!x))
                              : new Set())
                          }} />
                      </th>
                      <th className="p-2.5 text-left font-semibold">Baris</th>
                      <th className="p-2.5 text-left font-semibold">Nomor (raw)</th>
                      <th className="p-2.5 text-left font-semibold">Tgl</th>
                      <th className="p-2.5 text-left font-semibold">Jenis</th>
                      <th className="p-2.5 text-left font-semibold">Penerima</th>
                      <th className="p-2.5 text-left font-semibold">Status</th>
                      <th className="p-2.5 text-left font-semibold">Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryRun.rows.map((r) => (
                      <tr key={r.rowIndex} className="border-t hover:bg-emerald-soft/30">
                        <td className="p-2.5">
                          {(r.status === 'CANDIDATE' || r.status === 'NEEDS_REVIEW') && r.rowId && (
                            <input type="checkbox" className="accent-emerald" checked={selected.has(r.rowId)} aria-label={`baris ${r.rowIndex}`}
                              onChange={(e) => {
                                const next = new Set(selected)
                                if (e.target.checked) next.add(r.rowId!)
                                else next.delete(r.rowId!)
                                setSelected(next)
                              }} />
                          )}
                        </td>
                        <td className="p-2.5 tabular-nums text-muted-foreground">{r.rowIndex}</td>
                        <td className="p-2.5 font-mono font-semibold whitespace-nowrap">{r.fullNumberRaw ?? '—'}</td>
                        <td className="p-2.5 whitespace-nowrap">{r.letterDate ? fmtDate(r.letterDate) : '—'}</td>
                        <td className="p-2.5">{r.letterTypeName ?? '—'}</td>
                        <td className="p-2.5 max-w-40 truncate">{r.recipient ?? '—'}</td>
                        <td className="p-2.5">
                          <MiniTag tone={r.status === 'CANDIDATE' ? 'emerald' : r.status === 'ERROR' ? 'slate' : r.status === 'NEEDS_REVIEW' ? 'gold' : 'slate'}>
                            {r.status}
                          </MiniTag>
                        </td>
                        <td className="p-2.5 text-muted-foreground max-w-64">
                          {r.issues.map((issue, i) => <div key={i} className="truncate" title={issue}>• {issue}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-4 rounded-xl border border-dashed bg-muted/30 p-4">
                <div className="space-y-1.5 w-56">
                  <p className="text-[12px] font-semibold text-muted-foreground">Unit target impor</p>
                  <Select value={targetUnitId || undefined} onValueChange={setTargetUnitId}>
                    <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                    <SelectContent>
                      {units.data?.units.map(u => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-start gap-2.5 text-[12.5px] pb-2 cursor-pointer max-w-xs">
                  <input type="checkbox" checked={setHighWater} onChange={(e) => setSetHighWater(e.target.checked)} className="accent-emerald mt-0.5" />
                  <span>
                    <span className="font-semibold">Setel counter high-water</span>
                    <span className="block text-[11px] text-muted-foreground">hanya bila yakin tidak ada nomor di luar file ini</span>
                  </span>
                </label>
                <Button className="ml-auto shadow-card" disabled={!targetUnitId || selected.size === 0 || commit.isPending}
                  onClick={() => commit.mutate()}>
                  {commit.isPending ? 'Meng-commit…' : `Commit ${selected.size} baris terpilih`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
