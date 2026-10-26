'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiGet, fmtDateTime } from '@/lib/client'
import {
  FileText, FolderArchive, Users, Building2, ShieldCheck, Activity,
  FileStack, FileX2, Sparkles, ArrowRight,
} from 'lucide-react'
import { PageHeader, StatCard, StatusBadge, MiniTag, EmptyState } from './ui-bits'
import type { LucideIcon } from 'lucide-react'

interface HealthData {
  status: string
  db: { ok: boolean; latencyMs: number }
  storage: { root: string; ok: boolean; detail: string }
  counts: { units: number; committees: number; letters: number; issued: number; cancelled: number; drafts: number; files: number; pendingVersions: number }
  lastAuditAt: string | null
  time: string
}

export function DashboardView() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthData>('/api/health'),
    refetchInterval: 30_000,
  })

  const recent = useQuery({
    queryKey: ['letters-recent'],
    queryFn: () => apiGet<{ letters: LetterRow[] }>('/api/letters?pageSize=6'),
  })

  const c = health.data?.counts

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Ringkasan sistem registrasi dan arsip surat YAPSI Darussalam."
      />

      {/* Sapaan + status sistem */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0d5c46] via-[#0a4a38] to-[#062f25] text-white p-6 md:p-8 mb-6 shadow-lift">
        <div className="absolute inset-0 pattern-islami" aria-hidden />
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full border-[22px] border-[#c9a227]/15" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[#e6c96a]/90 mb-2">
              Sistem aktif
            </p>
            <h2 className="font-display text-2xl md:text-[28px] font-bold text-balance">
              Selamat bertugas, semoga lancar.
            </h2>
            <p className="text-[13px] text-white/65 mt-2">
              {health.data
                ? <>Database {health.data.db.latencyMs} ms · Storage {health.data.storage.ok ? 'baik' : 'bermasalah'} · Audit terakhir {fmtDateTime(health.data.lastAuditAt)}</>
                : 'Memuat status sistem…'}
            </p>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl bg-white/10 border border-white/15 px-4 py-3 backdrop-blur-sm">
            <span className={`relative flex h-2.5 w-2.5 ${health.data?.db.ok !== false ? '' : 'opacity-40'}`}>
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#e6c96a] opacity-60 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#e6c96a]" />
            </span>
            <span className="text-[12.5px] font-medium text-white/90">
              {health.data ? (health.data.db.ok ? 'Semua layanan normal' : 'Perlu perhatian') : '…'}
            </span>
          </div>
        </div>
      </div>

      {/* Statistik */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 mb-6">
        <StatCard label="Surat Terbit" value={c?.issued ?? '—'} icon={FileText} tone="emerald" />
        <StatCard label="Draft" value={c?.drafts ?? '—'} icon={FileStack} tone="gold" />
        <StatCard label="Dibatalkan" value={c?.cancelled ?? '—'} icon={FileX2} tone="red" />
        <StatCard label="Berkas Arsip" value={c?.files ?? '—'} icon={FolderArchive} tone="teal" />
        <StatCard label="Unit" value={c?.units ?? '—'} icon={Building2} tone="slate" />
        <StatCard label="Kepanitiaan" value={c?.committees ?? '—'} icon={Users} tone="slate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Surat terbaru */}
        <Card className="lg:col-span-3 shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-gold" /> Surat Terbaru
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent.isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Memuat…</p>}
            {recent.data && recent.data.letters.length === 0 && (
              <EmptyState
                icon={FileText}
                title="Belum ada surat"
                description="Buat surat pertama dari menu Surat — nomor resmi akan dialokasikan saat diterbitkan."
              />
            )}
            <div className="divide-y">
              {recent.data?.letters.map((l) => (
                <div key={l.id} className="flex items-center gap-3.5 py-3 first:pt-0 last:pb-0">
                  <div className="w-9 h-9 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12.5px] font-semibold truncate">
                      {l.officialNumber ?? l.legacyNumber ?? 'Draft — belum bernomor'}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground truncate">
                      {l.issuingUnit.code}{l.committee ? ` / ${l.committee.code}` : ''}
                      {l.subject ? ` · ${l.subject}` : ''}
                    </p>
                  </div>
                  {l.isImported && <MiniTag tone="gold">import</MiniTag>}
                  <StatusBadge status={l.status} />
                </div>
              ))}
            </div>
            {recent.data && recent.data.letters.length > 0 && (
              <p className="mt-3 pt-3 border-t text-[12px] text-muted-foreground flex items-center gap-1.5">
                Buka menu <span className="font-medium text-foreground">Surat</span> untuk mencari dan menerbitkan
                <ArrowRight className="w-3.5 h-3.5" />
              </p>
            )}
          </CardContent>
        </Card>

        {/* Kesehatan */}
        <Card className="lg:col-span-2 shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald" /> Kesehatan Sistem
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <HealthRow
              icon={ShieldCheck}
              label="Database"
              ok={health.data?.db.ok}
              value={health.data ? `${health.data.db.latencyMs} ms` : 'memuat…'}
            />
            <HealthRow
              icon={FolderArchive}
              label="Storage Arsip"
              ok={health.data?.storage.ok}
              value={health.data ? (health.data.storage.ok ? 'Tulis/baca normal' : 'Bermasalah') : 'memuat…'}
            />
            <div className="rounded-lg bg-muted/60 px-3.5 py-3 space-y-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Direktori root arsip</p>
              <p className="text-[11px] font-mono break-all text-muted-foreground" title={health.data?.storage.root}>
                {health.data?.storage.root ?? '…'}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Pemindaian integritas lengkap tersedia di menu <span className="font-medium text-foreground">Kesehatan</span>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function HealthRow({ icon: Icon, label, ok, value }: {
  icon: LucideIcon
  label: string
  ok: boolean | undefined
  value: string
}) {
  return (
    <div className="flex items-center gap-3.5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${ok === false ? 'bg-red-50 text-red-600' : 'bg-emerald-soft text-emerald'}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">{value}</p>
      </div>
      <StatusDot ok={ok} />
    </div>
  )
}

function StatusDot({ ok }: { ok: boolean | undefined }) {
  if (ok === undefined) return <span className="text-[11px] text-muted-foreground">…</span>
  return ok
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-soft border border-emerald/25 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-deep"><span className="w-1.5 h-1.5 rounded-full bg-emerald" />Baik</span>
    : <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-[11px] font-semibold text-red-700"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Gangguan</span>
}

export function letterStatusId(s: string): string {
  return { DRAFT: 'Draft', ISSUED: 'Terbit', CANCELLED: 'Batal' }[s] ?? s
}
export function letterBadgeVariant(s: string): 'secondary' | 'default' | 'destructive' | 'outline' {
  return { DRAFT: 'secondary', ISSUED: 'default', CANCELLED: 'destructive' }[s] as never ?? 'outline'
}

export interface LetterRow {
  id: string
  officialNumber: string | null
  legacyNumber: string | null
  status: string
  letterDate: string | null
  direction: string | null
  recipient: string | null
  subject: string | null
  issuingUnit: { id: string; code: string; name: string }
  committee?: { id: string; code: string; name: string } | null
  letterType?: { id: string; code: string; name: string } | null
  issuer?: { id: string; fullName: string } | null
  isImported?: boolean
  _count?: { files: number }
}
