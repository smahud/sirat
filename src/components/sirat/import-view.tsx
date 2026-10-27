'use client'

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDownload, fmtDate, fmtDateTime } from '@/lib/client'
import { PageHeader, StatCard, MiniTag } from './ui-bits'
import type { Me } from './use-session'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  FileSpreadsheet, Upload, Info, Rows3, CheckCircle2, AlertTriangle, XCircle, Clock,
  Download, ShieldCheck, History, ListChecks, Lock, Building2,
} from 'lucide-react'

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
interface BatchRow {
  id: string; status: string; sheet: string; fileName: string
  createdAt: string; committedAt: string | null
  targetUnit: { code: string; name: string } | null
  totalRows: number
  report: { majorYear: number | null; candidates: number; praisi: number; errors: number; needsReview: number }
}
interface UnitRow { id: string; code: string; name: string }

/** Spesifikasi kolom template — cermin TEMPLATE_COLUMNS di import-service (backend). */
const TEMPLATE_COLS: { col: string; header: string; required: boolean; example: string; note: string }[] = [
  { col: 'A', header: 'Urutan', required: true, example: '001', note: 'Angka urut, boleh berawalan nol' },
  { col: 'B', header: 'Arah', required: true, example: 'Internal', note: '"Internal" atau "Eksternal"' },
  { col: 'C', header: 'Kode Arah', required: false, example: 'A', note: 'Catatan saja (A/B)' },
  { col: 'D', header: 'Nama Jenis Surat', required: false, example: 'Surat Keputusan', note: 'Dicocokkan ke Jenis Surat' },
  { col: 'E', header: 'Kode Jenis', required: false, example: 'SK', note: 'Cadangan pencocokan' },
  { col: 'F', header: 'Bulan (Romawi)', required: false, example: 'I', note: 'Catatan saja' },
  { col: 'G', header: 'Tahun', required: false, example: '2026', note: 'Catatan saja' },
  { col: 'H', header: 'Tanggal Surat', required: true, example: '2026-01-15', note: '2026-01-15 / 15/01/2026 / 15 Jan 2026' },
  { col: 'I', header: 'Nomor Lengkap', required: true, example: '001/A/SK/YAPSI-DS/I/2026', note: 'Teks persis; bukan rumus' },
  { col: 'J', header: 'Penerima', required: false, example: 'Dinas Pendidikan', note: 'Disarankan diisi' },
  { col: 'K', header: 'Perihal', required: false, example: 'Undangan rapat', note: 'Disarankan diisi' },
]

export function ImportView({ me }: { me: Me }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dryRun, setDryRun] = useState<DryRunRes | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetUnitId, setTargetUnitId] = useState('')
  const [setHighWater, setSetHighWater] = useState(false)

  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: UnitRow[] }>('/api/units') })

  // Unit yang boleh jadi target import = unit yang DIKELOLA user (bukan sekadar terlihat).
  // Role global → semua unit; UNIT_ADMIN → unit assignment-nya; selain itu → kosong.
  const manageableUnits = useMemo(() => {
    const all = units.data?.units ?? []
    if (me.scope.all) return all
    return all.filter(u => me.scope.unitIds.includes(u.id))
  }, [units.data, me.scope])

  const template = useMutation({
    mutationFn: (format: 'csv' | 'xlsx' | 'xls') =>
      apiDownload(`/api/import/template?format=${format}`, `template-import-sirat.${format}`),
    onError: (e) => toast.error((e as Error).message),
  })

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
      // Prapilih unit target bila hanya ada satu pilihan sah
      if (manageableUnits.length === 1) setTargetUnitId(manageableUnits[0].id)
      toast.success(`Dry-run selesai: ${data.counts.candidates} kandidat, ${data.counts.errors} error, ${data.counts.praisi} praisi`)
      qc.invalidateQueries({ queryKey: ['import-batches'] })
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
      setSetHighWater(false)
      qc.invalidateQueries({ queryKey: ['letters'] })
      qc.invalidateQueries({ queryKey: ['import-batches'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const history = useQuery({
    queryKey: ['import-batches'],
    queryFn: () => apiGet<{ batches: BatchRow[] }>('/api/import/batches'),
  })

  return (
    <div>
      <PageHeader
        title="Import Data"
        description="Pindahkan histori surat dari berkas Excel/CSV lama ke SIRAT — dengan uji coba (dry-run) terlebih dahulu, tinjauan baris per baris, dan konfirmasi selektif sebelum apa pun disimpan."
      />

      {/* ====== Panduan lengkap ====== */}
      <Card className="shadow-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
            <Info className="w-4 h-4 text-gold-dark" /> Apa itu Import Data &amp; bagaimana cara kerjanya
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-surface p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-emerald-deep/75 mb-2.5">Untuk apa menu ini</p>
              <p className="text-[12.5px] leading-relaxed text-foreground/85">
                Import Data dipakai <span className="font-semibold">satu kali saat peralihan sistem</span> (cutover):
                memindahkan daftar surat lama yang selama ini dicatat di Excel ke dalam SIRAT, lengkap dengan
                nomor aslinya, sehingga histori tetap bisa dicari dan diarsipkan di satu tempat.
                Untuk surat <em>baru</em>, gunakan menu Surat (Buat Surat) — jangan di-import.
              </p>
            </div>
            <div className="rounded-xl border bg-surface p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-emerald-deep/75 mb-2.5">Siapa yang boleh memakai</p>
              <p className="text-[12.5px] leading-relaxed text-foreground/85">
                Hanya pengguna dengan izin <span className="font-mono text-[11.5px] bg-muted px-1.5 py-0.5 rounded">import.manage</span>{' '}
                (Admin Organisasi ke atas, dan Admin Unit). Menu ini tidak muncul sama sekali bagi pengguna tanpa izin.
                {' '}Semakin tinggi hak akses, semakin bebas memilih target: <span className="font-semibold">Admin Organisasi/Sistem</span> dapat
                meng-import ke unit/departemen mana pun; <span className="font-semibold">Admin Unit</span> hanya ke unit yang dikelolanya.
              </p>
            </div>
          </div>

          {/* Alur kerja */}
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Alur kerja — 4 langkah</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { n: 1, t: 'Unduh template', d: 'Ambil format resmi (CSV/Excel), lalu isi dengan data surat lama Anda. Jangan mengubah susunan kolom.' },
                { n: 2, t: 'Unggah & uji', d: 'Sistem membaca berkas dan menampilkan UJI DULU (dry-run). Pada tahap ini belum ada data yang disimpan.' },
                { n: 3, t: 'Tinjau hasil', d: 'Hijau = siap disimpan. Kuning = perlu keputusan Anda. Merah = bermasalah dan tidak bisa disimpan.' },
                { n: 4, t: 'Konfirmasi', d: 'Pilih baris yang disimpan, pilih unit tujuan, lalu commit. Hanya baris terpilih yang masuk.' },
              ].map(s => (
                <div key={s.n} className="rounded-xl border border-dashed bg-muted/25 p-3.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald text-white text-[12px] font-bold mb-2">{s.n}</span>
                  <p className="text-[12.5px] font-semibold mb-1">{s.t}</p>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">{s.d}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Jaminan keamanan */}
          <div className="rounded-xl border border-emerald/25 bg-emerald-soft/40 p-4">
            <p className="text-[12px] font-semibold flex items-center gap-1.5 text-emerald-deep mb-2">
              <ShieldCheck className="w-4 h-4" /> Jaminan keamanan
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2 text-[12px] leading-relaxed text-foreground/85">
              <li>• Nomor lama disimpan <span className="font-semibold">persis seperti tertulis</span> — sistem tidak membuat nomor baru untuk histori.</li>
              <li>• Rumus Excel <span className="font-semibold">tidak pernah dijalankan</span>; yang dibaca hanyalah nilai teksnya.</li>
              <li>• Duplikat nomor (dalam berkas maupun dengan data yang sudah ada) otomatis ditolak.</li>
              <li>• Dry-run tidak menulis surat apa pun — mencoba tidak ada risikonya.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-gold/30 bg-gold-soft/60 p-4 flex gap-3.5">
            <Info className="w-[18px] h-[18px] text-gold-dark shrink-0 mt-0.5" />
            <div className="text-[12.5px] leading-relaxed text-foreground/80">
              <p className="font-semibold text-gold-dark mb-0.5">Syarat cutover yang aman</p>
              Bekukan pencatatan Excel selama final cutover agar tidak ada nomor yang tertinggal di luar berkas.
              Baris tanpa tanggal (nomor praisi/cadangan) tidak diimpor sebagai surat terbit. Opsi{" "}
              <span className="font-semibold">Setel counter high-water</span> hanya dicentang bila Anda yakin tidak ada
              nomor unit tersebut di luar berkas ini.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ====== Template ====== */}
      <Card className="shadow-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
            <Download className="w-4 h-4 text-emerald" /> Template siap pakai — unduh, isi, unggah
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[12.5px] text-muted-foreground leading-relaxed">
            Template berisi judul kolom resmi, 2 baris contoh (ganti dengan data Anda), dan — untuk format Excel —
            sheet <span className="font-semibold">Petunjuk</span> berisi panduan lengkap. Ketiga format berisi kolom
            yang sama; pilih yang paling nyaman bagi Anda.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              { format: 'xlsx' as const, name: 'Excel Modern', ext: '.xlsx', desc: 'Untuk Excel 2007 ke atas & Google Sheets. Termasuk sheet Petunjuk.' },
              { format: 'xls' as const, name: 'Excel Lama', ext: '.xls', desc: 'Untuk Excel versi lama (1997–2003). Termasuk sheet Petunjuk.' },
              { format: 'csv' as const, name: 'CSV', ext: '.csv', desc: 'Teks sederhana; cocok dari aplikasi apa pun. Pemisah titik-koma, siap dibuka Excel Indonesia.' },
            ]).map(t => (
              <div key={t.format} className="rounded-xl border bg-surface p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{t.ext}</p>
                  </div>
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground flex-1">{t.desc}</p>
                <Button
                  size="sm" variant="outline" className="bg-surface shadow-card w-full"
                  disabled={template.isPending}
                  onClick={() => template.mutate(t.format)}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  {template.isPending ? 'Menyiapkan…' : 'Unduh'}
                </Button>
              </div>
            ))}
          </div>

          {/* Referensi kolom */}
          <details className="rounded-xl border bg-muted/25">
            <summary className="cursor-pointer select-none px-4 py-3 text-[12.5px] font-semibold flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-muted-foreground" /> Rincian 11 kolom (A–K) — klik untuk membuka
            </summary>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3 font-semibold">Kolom</th>
                    <th className="py-2 pr-3 font-semibold">Judul</th>
                    <th className="py-2 pr-3 font-semibold">Wajib?</th>
                    <th className="py-2 pr-3 font-semibold">Contoh</th>
                    <th className="py-2 font-semibold">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {TEMPLATE_COLS.map(c => (
                    <tr key={c.col} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono font-semibold">{c.col}</td>
                      <td className="py-2 pr-3">{c.header}</td>
                      <td className="py-2 pr-3">
                        {c.required
                          ? <MiniTag tone="emerald">wajib</MiniTag>
                          : <MiniTag tone="slate">opsional</MiniTag>}
                      </td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{c.example}</td>
                      <td className="py-2 text-muted-foreground">{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardContent>
      </Card>

      {/* ====== Unggah ====== */}
      <Card className="shadow-card mb-5">
        <CardContent className="p-5">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-soft text-emerald flex items-center justify-center shrink-0">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[14px] font-semibold">Unggah berkas berisi data surat</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 max-w-lg">
                  Format .xlsx / .xls / .csv, maksimal 20 MiB, sheet pertama yang dibaca —
                  idealnya berkas yang diisi dari template di atas. Mulai dari dry-run: belum ada yang disimpan.
                </p>
              </div>
            </div>
            <Button size="lg" onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="shadow-card">
              <Upload className="w-4 h-4 mr-1.5" />
              {upload.isPending ? 'Memproses dry-run…' : 'Pilih Berkas'}
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

              {/* Commit panel — scope aware */}
              <div className="rounded-xl border border-dashed bg-muted/30 p-4 space-y-3.5">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" />
                  <p className="text-[12.5px] font-semibold">Konfirmasi &amp; simpan — pilih unit tujuan</p>
                </div>

                {manageableUnits.length === 0 ? (
                  <div className="rounded-lg border border-gold/30 bg-gold-soft/60 p-3.5 text-[12.5px] leading-relaxed text-foreground/80">
                    Anda tidak memiliki unit yang bisa menjadi target import. Surat hasil import adalah surat reguler
                    unit — hubungi Admin Organisasi agar diberi penugasan unit, atau minta mereka yang meng-import.
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5 w-64">
                      <p className="text-[12px] font-semibold text-muted-foreground">
                        Unit target impor {me.scope.all
                          ? <span className="font-normal text-emerald-deep">(akses penuh — semua unit)</span>
                          : <span className="font-normal text-gold-dark">(dibatasi unit yang Anda kelola)</span>}
                      </p>
                      <Select value={targetUnitId || undefined} onValueChange={setTargetUnitId}>
                        <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                        <SelectContent>
                          {manageableUnits.map(u => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-start gap-2.5 text-[12.5px] pb-2 cursor-pointer max-w-xs">
                      <input type="checkbox" checked={setHighWater} onChange={(e) => setSetHighWater(e.target.checked)} className="accent-emerald mt-0.5" />
                      <span>
                        <span className="font-semibold">Setel counter high-water</span>
                        <span className="block text-[11px] text-muted-foreground">hanya bila yakin tidak ada nomor unit ini di luar berkas — counter baru mulai di atas nomor terbesar terimpor</span>
                      </span>
                    </label>
                    <Button className="ml-auto shadow-card" disabled={!targetUnitId || selected.size === 0 || commit.isPending}
                      onClick={() => commit.mutate()}>
                      {commit.isPending ? 'Menyimpan…' : `Commit ${selected.size} baris terpilih`}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ====== Riwayat import ====== */}
      <Card className="shadow-card mt-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-emerald" /> Riwayat Import
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Memuat…</p>}
          {history.data && history.data.batches.length === 0 && (
            <p className="text-[12.5px] text-muted-foreground py-6 text-center">
              Belum ada berkas yang diuji. Riwayat setiap unggahan dan commit akan tercatat di sini.
            </p>
          )}
          {history.data && history.data.batches.length > 0 && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-[11.5px]">
                <thead className="bg-muted/70">
                  <tr>
                    <th className="p-2.5 text-left font-semibold">Waktu unggah</th>
                    <th className="p-2.5 text-left font-semibold">Berkas</th>
                    <th className="p-2.5 text-left font-semibold">Sheet</th>
                    <th className="p-2.5 text-left font-semibold">Baris</th>
                    <th className="p-2.5 text-left font-semibold">Kandidat / Review / Error</th>
                    <th className="p-2.5 text-left font-semibold">Unit tujuan</th>
                    <th className="p-2.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.batches.map(b => (
                    <tr key={b.id} className="border-t hover:bg-emerald-soft/20">
                      <td className="p-2.5 whitespace-nowrap">{fmtDateTime(b.createdAt)}</td>
                      <td className="p-2.5 max-w-44 truncate" title={b.fileName}>{b.fileName}</td>
                      <td className="p-2.5">{b.sheet}</td>
                      <td className="p-2.5 tabular-nums">{b.totalRows}</td>
                      <td className="p-2.5 tabular-nums">
                        <span className="text-emerald-deep font-semibold">{b.report.candidates}</span>
                        {' / '}
                        <span className="text-gold-dark">{b.report.needsReview}</span>
                        {' / '}
                        <span className="text-destructive">{b.report.errors}</span>
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        {b.targetUnit
                          ? <span className="inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted-foreground" />{b.targetUnit.code}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2.5">
                        {b.status === 'COMMITTED'
                          ? <MiniTag tone="emerald">TERSIMPAN{b.committedAt ? ` · ${fmtDateTime(b.committedAt)}` : ''}</MiniTag>
                          : <MiniTag tone="gold">DRY-RUN</MiniTag>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Menampilkan maksimal 25 riwayat terakhir{!me.scope.all && ' — dibatasi pada aktivitas Anda dan unit yang Anda kelola'}.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
