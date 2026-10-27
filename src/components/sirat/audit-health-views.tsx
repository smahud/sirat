'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiGet, apiPost, fmtDateTime } from '@/lib/client'
import { PageHeader, EmptyState } from './ui-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { ScanSearch, ShieldCheck, ScrollText, Search, Database, HardDrive, BarChart3, ChevronLeft, ChevronRight, Activity } from 'lucide-react'

interface AuditRow {
  id: string; actorId: string | null; action: string; entityType: string | null; entityId: string | null
  outcome: string; createdAt: string; metadata: string | null
  actor: { id: string; username: string; fullName: string } | null
}

export function AuditView() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  params.set('page', String(page))

  const audit = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => apiGet<{ events: AuditRow[]; total: number; pageSize: number }>(`/api/audit?${params}`),
  })

  const totalPages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.pageSize)) : 1

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        description="Riwayat aktivitas kritis — append-only, mencatat aktor, waktu, aksi, dan hasil."
      />

      <Card className="mb-4 shadow-card">
        <CardContent className="p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
            <Input placeholder="Cari aksi / entitas / aktor…" value={q} className="pl-9 bg-surface"
              onChange={(e) => { setQ(e.target.value); setPage(1) }} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold whitespace-nowrap">Waktu</TableHead>
                <TableHead className="font-semibold">Aktor</TableHead>
                <TableHead className="font-semibold">Aksi</TableHead>
                <TableHead className="font-semibold">Objek</TableHead>
                <TableHead className="font-semibold">Hasil</TableHead>
                <TableHead className="font-semibold">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-14 text-muted-foreground text-sm">Memuat…</TableCell></TableRow>
              )}
              {audit.data && audit.data.events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="p-0 border-0">
                    <EmptyState
                      icon={ScrollText}
                      title="Belum ada event audit"
                      description="Aktivitas seperti login, penerbitan nomor, dan unggah arsip akan tercatat di sini."
                    />
                  </TableCell>
                </TableRow>
              )}
              {audit.data?.events.map((e) => (
                <TableRow key={e.id} className="transition-colors hover:bg-emerald-soft/40">
                  <TableCell className="whitespace-nowrap text-[11.5px] text-muted-foreground">{fmtDateTime(e.createdAt)}</TableCell>
                  <TableCell className="text-[12.5px] font-medium">{e.actor?.fullName ?? e.actorId?.slice(0, 8) ?? 'sistem'}</TableCell>
                  <TableCell className="font-mono text-[11.5px] font-semibold text-emerald-deep">{e.action}</TableCell>
                  <TableCell className="text-[12px]">{e.entityType ?? '—'}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold ${
                      e.outcome === 'SUCCESS' ? 'bg-emerald-soft text-emerald-deep border-emerald/25'
                      : e.outcome === 'DENIED' ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-muted text-muted-foreground border-border'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${e.outcome === 'SUCCESS' ? 'bg-emerald' : e.outcome === 'DENIED' ? 'bg-red-500' : 'bg-muted-foreground/50'}`} />
                      {e.outcome}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <details>
                      <summary className="cursor-pointer text-[11.5px] text-muted-foreground hover:text-foreground select-none">lihat</summary>
                      <pre className="text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto mt-1 rounded-md bg-muted p-2">
                        {e.metadata ? JSON.stringify(JSON.parse(e.metadata), null, 1) : '—'}
                      </pre>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <p className="text-[12.5px] text-muted-foreground">
          {audit.data ? <><span className="font-semibold text-foreground">{audit.data.total}</span> event</> : '…'}
        </p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 bg-surface shadow-card" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="w-4 h-4" /> Sebelumnya
          </Button>
          <span className="text-[12.5px] font-medium tabular-nums px-2">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" className="h-8 bg-surface shadow-card" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Berikutnya <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ScanResult {
  scanned: number; ok: number
  missing: { versionId: string; objectKey: string }[]
  sizeMismatch: unknown[]; hashMismatch: unknown[]
  pendingWithoutFile: unknown[]; orphans: string[]; stagingFiles: number
  scannedAt: string
}

export function HealthView() {
  const [scan, setScan] = useState<ScanResult | null>(null)

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<{
      db: { ok: boolean; latencyMs: number }
      storage: { root: string; ok: boolean; detail: string }
      counts: Record<string, number>
      lastAuditAt: string | null
    }>('/api/health'),
    refetchInterval: 30_000,
  })

  const runScan = useMutation({
    mutationFn: () => apiPost<ScanResult>('/api/health/integrity-scan'),
    onSuccess: (data) => { setScan(data); toast.success('Integrity scan selesai') },
    onError: (e) => toast.error((e as Error).message),
  })

  const c = health.data?.counts ?? {}

  return (
    <div>
      <PageHeader
        title="Kesehatan Sistem"
        description="Status database, storage arsip, dan pemeriksaan integritas berkas."
      />

      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <div className="rounded-xl border bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${health.data?.db.ok ? 'bg-emerald-soft text-emerald' : 'bg-red-50 text-red-600'}`}>
              <Database className="w-5 h-5" />
            </div>
            <Badge variant={health.data?.db.ok ? 'default' : 'destructive'} className={health.data?.db.ok ? 'bg-emerald' : ''}>
              {health.data?.db.ok ? 'terhubung' : 'masalah'}
            </Badge>
          </div>
          <p className="text-[26px] font-bold leading-none tabular-nums">{health.data ? `${health.data.db.latencyMs} ms` : '…'}</p>
          <p className="text-[12px] text-muted-foreground mt-1.5">Latensi database</p>
        </div>

        <div className="rounded-xl border bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${health.data?.storage.ok ? 'bg-emerald-soft text-emerald' : 'bg-red-50 text-red-600'}`}>
              <HardDrive className="w-5 h-5" />
            </div>
            <Badge variant={health.data?.storage.ok ? 'default' : 'destructive'} className={health.data?.storage.ok ? 'bg-emerald' : ''}>
              {health.data?.storage.ok ? 'normal' : 'bermasalah'}
            </Badge>
          </div>
          <p className="text-[12px] font-mono break-all leading-relaxed min-h-[2.2em] text-foreground/80">
            {health.data?.storage.root ?? '…'}
          </p>
          <p className="text-[12px] text-muted-foreground mt-1.5">Root direktori arsip — uji tulis/baca/rename berkala</p>
        </div>

        <div className="rounded-xl border bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
          </div>
          <div className="text-[12px] space-y-1.5 text-foreground/80">
            <p><span className="font-semibold tabular-nums">{c.issued ?? '—'}</span> surat terbit · <span className="font-semibold tabular-nums">{c.drafts ?? '—'}</span> draft · <span className="font-semibold tabular-nums">{c.cancelled ?? '—'}</span> batal</p>
            <p><span className="font-semibold tabular-nums">{c.files ?? '—'}</span> berkas arsip · <span className="font-semibold tabular-nums">{c.units ?? '—'}</span> unit · <span className="font-semibold tabular-nums">{c.committees ?? '—'}</span> panitia</p>
            <p className="text-muted-foreground">Audit terakhir: {fmtDateTime(health.data?.lastAuditAt)}</p>
          </div>
        </div>
      </div>

      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-semibold flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <ScanSearch className="w-4 h-4 text-emerald" /> Integrity Scan Arsip
            </span>
            <Button size="sm" className="shadow-card h-8" onClick={() => runScan.mutate()} disabled={runScan.isPending}>
              <Activity className="w-3.5 h-3.5 mr-1.5" />
              {runScan.isPending ? 'Memindai…' : 'Jalankan Scan'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[12px] text-muted-foreground mb-4">
            Memeriksa berkas hilang, berubah, dan orphan dengan checksum SHA-256. Scan hanya melaporkan — tidak menghapus apa pun secara otomatis.
          </p>
          {scan && (
            <div className="rounded-xl border bg-surface p-4 text-[13px] space-y-2 shadow-card">
              <div className="flex flex-wrap gap-2 mb-2">
                <span className="rounded-lg bg-emerald-soft text-emerald-deep border border-emerald/25 px-3 py-1.5 text-[12px] font-semibold">
                  {scan.ok}/{scan.scanned} versi OK
                </span>
                <span className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${scan.missing.length ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-soft text-emerald-deep border-emerald/25'}`}>
                  {scan.missing.length} hilang
                </span>
                <span className="rounded-lg bg-muted border px-3 py-1.5 text-[12px] font-semibold text-muted-foreground">
                  {scan.sizeMismatch.length} ukuran beda · {scan.hashMismatch.length} hash beda
                </span>
                <span className="rounded-lg bg-muted border px-3 py-1.5 text-[12px] font-semibold text-muted-foreground">
                  {scan.orphans.length} orphan · {scan.stagingFiles} staging
                </span>
              </div>
              {scan.missing.length > 0 && (
                <pre className="text-[10.5px] bg-muted rounded-lg p-3 max-h-44 overflow-y-auto scrollbar-slim whitespace-pre-wrap">
                  {scan.missing.map(m => `${m.versionId} → ${m.objectKey}`).join('\n')}
                </pre>
              )}
              <p className="text-[11px] text-muted-foreground pt-1 border-t">
                Dipindai pada {fmtDateTime(scan.scannedAt)} · Orphan dilaporkan saja, rekonsiliasi tidak menghapus otomatis.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
