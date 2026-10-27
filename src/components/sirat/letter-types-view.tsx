'use client'

// Jenis Surat (master prompt lanjutan D.1–D.3 + default config v1.4):
// Kelola kode, nama, kategori, deskripsi, fungsi/tujuan, contoh penggunaan, catatan, status.
// Semua keterangan tersimpan di DB — tooltip form Buat Surat memakai data terbaru.
// Hapus fisik hanya untuk jenis tanpa histori; yang sudah dipakai diarsipkan (D.6).
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiGet, apiPatch, apiPost } from '@/lib/client'
import { PageHeader, EmptyState } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { FileStack, Plus, Pencil, Trash2, Eye, Info } from 'lucide-react'

interface LetterTypeRow {
  id: string
  code: string
  name: string
  category: string | null
  description: string | null
  purpose: string | null
  usageExamples: string | null
  notes: string | null
  isActive: boolean
  _count?: { letters: number }
}

type FormState = {
  code: string
  name: string
  category: string
  description: string
  purpose: string
  usageExamples: string
  notes: string
  isActive: boolean
}

// 5 kategori standar (default config v1.4) — saran isian, lembaga bisa menulis kategori sendiri.
const CATEGORY_SUGGESTIONS = [
  'Kebijakan & Keputusan',
  'Tugas & Penugasan',
  'Komunikasi & Koordinasi',
  'Administrasi & Layanan',
  'Pertanggungjawaban & Dokumentasi',
]

const EMPTY_FORM: FormState = { code: '', name: '', category: '', description: '', purpose: '', usageExamples: '', notes: '', isActive: true }

export function LetterTypesView() {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editId, setEditId] = useState<string | null>(null)
  const [detail, setDetail] = useState<LetterTypeRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LetterTypeRow | null>(null)

  const letterTypes = useQuery({ queryKey: ['letter-types'], queryFn: () => apiGet<{ letterTypes: LetterTypeRow[] }>('/api/letter-types') })

  const closeForm = () => { setForm(EMPTY_FORM); setEditId(null) }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code, name: form.name,
        category: form.category || null,
        description: form.description || null,
        purpose: form.purpose || null,
        usageExamples: form.usageExamples || null,
        notes: form.notes || null,
        isActive: form.isActive,
      }
      return editId ? apiPatch('/api/letter-types', { id: editId, ...body }) : apiPost('/api/letter-types', body)
    },
    onSuccess: () => {
      toast.success(editId ? 'Jenis surat diperbarui' : 'Jenis surat dibuat')
      closeForm()
      qc.invalidateQueries({ queryKey: ['letter-types'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiPatch('/api/letter-types', { id, isActive }),
    onSuccess: () => { toast.success('Status jenis surat diubah'); qc.invalidateQueries({ queryKey: ['letter-types'] }) },
    onError: (e) => toast.error((e as Error).message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api('/api/letter-types', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { toast.success('Jenis surat dihapus'); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['letter-types'] }) },
    onError: (e) => { toast.error((e as Error).message); setDeleteTarget(null) },
  })

  const openEdit = (t: LetterTypeRow) => {
    setEditId(t.id)
    setForm({
      code: t.code, name: t.name,
      category: t.category ?? '',
      description: t.description ?? '', purpose: t.purpose ?? '',
      usageExamples: t.usageExamples ?? '', notes: t.notes ?? '',
      isActive: t.isActive,
    })
  }

  return (
    <div>
      <PageHeader
        title="Jenis Surat"
        description="Master jenis surat: kode, kategori, deskripsi, fungsi, dan contoh penggunaan. Dikelola pusat (scope global) — semua unit melihat informasi yang sama; keterangan ini tampil sebagai bantuan ⓘ pada form Buat Surat."
      >
        <Button className="shadow-card" onClick={() => { closeForm(); setForm({ ...EMPTY_FORM }) }}>
          <Plus className="w-4 h-4 mr-1.5" /> Tambah Jenis
        </Button>
      </PageHeader>

      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><FileStack className="w-4 h-4" /></span>
            Daftar Jenis Surat
            <span className="text-muted-foreground font-normal text-[13px]">({letterTypes.data?.letterTypes.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {letterTypes.data?.letterTypes.length === 0 && (
            <EmptyState icon={FileStack} title="Belum ada jenis surat" description="Tambahkan jenis surat (mis. SK — Surat Keputusan) beserta keterangannya." />
          )}
          {(letterTypes.data?.letterTypes.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="font-semibold">Kode</TableHead>
                    <TableHead className="font-semibold min-w-44">Nama jenis</TableHead>
                    <TableHead className="font-semibold hidden md:table-cell">Kategori</TableHead>
                    <TableHead className="font-semibold hidden lg:table-cell">Deskripsi</TableHead>
                    <TableHead className="font-semibold text-center">Surat</TableHead>
                    <TableHead className="font-semibold text-center">Aktif</TableHead>
                    <TableHead className="text-right font-semibold w-36">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...letterTypes.data?.letterTypes ?? []]
                    .sort((a, b) => (a.category ?? '~').localeCompare(b.category ?? '~', 'id') || a.code.localeCompare(b.code))
                    .map((t) => (
                    <TableRow key={t.id} className={`transition-colors hover:bg-emerald-soft/40 ${!t.isActive ? 'opacity-60' : ''}`}>
                      <TableCell className="font-mono text-[12.5px] font-semibold">{t.code}</TableCell>
                      <TableCell className="text-[13.5px]">{t.name}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {t.category ? (
                          <span className="inline-flex rounded-full border border-emerald/25 bg-emerald-soft px-2.5 py-0.5 text-[11px] font-semibold text-emerald-deep">
                            {t.category}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground hidden lg:table-cell max-w-64 truncate">{t.description ?? '—'}</TableCell>
                      <TableCell className="text-center text-[12.5px] font-semibold">{t._count?.letters ?? 0}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${t.isActive ? 'bg-emerald-soft text-emerald-deep border-emerald/25' : 'bg-muted text-muted-foreground border-border'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${t.isActive ? 'bg-emerald' : 'bg-muted-foreground/50'}`} />
                          {t.isActive ? 'Ya' : 'Tidak'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0 bg-surface" onClick={() => setDetail(t)} aria-label={`Detail ${t.code}`}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0 bg-surface" onClick={() => openEdit(t)} aria-label={`Edit ${t.code}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0 bg-surface text-destructive hover:bg-red-50" onClick={() => setDeleteTarget(t)} aria-label={`Hapus ${t.code}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Jenis surat adalah master terpisah dari profil penomoran. Mengubah kode hanya berlaku untuk terbitan baru —
            nomor final surat lama memakai snapshot kode saat diterbitkan. Jenis yang sudah dipakai surat tidak dihapus fisik;
            nonaktifkan untuk menghentikan penggunaan baru.
          </p>
        </CardContent>
      </Card>

      {/* ===== Form tambah/edit ===== */}
      <Dialog open={editId !== null || form !== EMPTY_FORM} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto scrollbar-slim">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{editId ? 'Edit Jenis Surat' : 'Tambah Jenis Surat'}</DialogTitle>
            <DialogDescription>
              Semua keterangan tersimpan di database dan langsung dipakai UI (tooltip ⓘ form Buat Surat).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Kode</Label>
                <Input value={form.code} className="bg-surface font-mono" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SK" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Nama jenis surat</Label>
                <Input value={form.name} className="bg-surface" onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} placeholder="SURAT KEPUTUSAN" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Kategori</Label>
              <Input
                list="lt-category-suggestions"
                value={form.category}
                className="bg-surface"
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="mis. Administrasi & Layanan"
              />
              <datalist id="lt-category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
              <p className="text-[11px] text-muted-foreground">Kelompok navigasi pada form Buat Surat — pilih saran standar atau tulis kategori lembaga Anda.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Deskripsi</Label>
              <Textarea value={form.description} className="bg-surface resize-none" rows={2}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="mis. Dokumen keputusan resmi yang ditetapkan pihak berwenang" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Fungsi / tujuan</Label>
              <Textarea value={form.purpose} className="bg-surface resize-none" rows={2}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="mis. Menetapkan kebijakan, pengangkatan, penugasan, atau keputusan administratif" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Contoh penggunaan <span className="text-muted-foreground font-normal">(satu per baris)</span></Label>
              <Textarea value={form.usageExamples} className="bg-surface resize-none font-mono text-[12px]" rows={3}
                onChange={(e) => setForm({ ...form, usageExamples: e.target.value })}
                placeholder={'SK Pengangkatan\nSK Perpanjangan Jabatan\nSK Penetapan Panitia'} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Catatan / petunjuk tambahan</Label>
              <Textarea value={form.notes} className="bg-surface resize-none" rows={2}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="mis. Wajib mencantumkan dasar hukum pada isi surat" />
            </div>
            <div className="flex items-center gap-2.5">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} id="lt-active" />
              <Label htmlFor="lt-active" className="text-[13px]">
                Aktif <span className="text-muted-foreground text-[11.5px]">— hanya jenis aktif bisa dipilih untuk surat baru</span>
              </Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeForm}>Batal</Button>
            <Button disabled={!form.code || !form.name || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Menyimpan…' : editId ? 'Simpan Perubahan' : 'Tambah Jenis'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Detail ===== */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2.5">
              <span className="font-mono text-[13px] font-bold text-emerald-deep bg-emerald-soft rounded-md px-2 py-0.5">{detail?.code}</span>
              {detail?.name}
            </DialogTitle>
            <DialogDescription>Detail jenis surat sebagaimana tampil pada bantuan form Buat Surat.</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3.5 text-[13px]">
              <DetailBlock title="Kategori" value={detail.category} />
              <DetailBlock title="Deskripsi" value={detail.description} />
              <DetailBlock title="Fungsi / tujuan" value={detail.purpose} />
              <DetailBlock title="Contoh penggunaan" value={detail.usageExamples} list />
              <DetailBlock title="Catatan" value={detail.notes} />
              <div className="flex gap-4 text-[12px] text-muted-foreground pt-1 border-t">
                <span>Status: <span className="font-semibold text-foreground">{detail.isActive ? 'Aktif' : 'Nonaktif'}</span></span>
                <span>Dipakai <span className="font-semibold text-foreground">{detail._count?.letters ?? 0}</span> surat</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Konfirmasi hapus ===== */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-lg">
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><Trash2 className="w-4 h-4" /></span>
              Hapus Jenis Surat?
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono font-semibold text-foreground">{deleteTarget?.code}</span> — {deleteTarget?.name}
              <br />
              Hapus fisik hanya bila belum pernah dipakai surat. Bila sudah dipakai, nonaktifkan agar histori tetap sah.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            {deleteTarget && (deleteTarget._count?.letters ?? 0) === 0 ? (
              <Button variant="destructive" disabled={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>
                {remove.isPending ? 'Menghapus…' : 'Ya, hapus'}
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={toggleActive.isPending}
                onClick={() => {
                  if (!deleteTarget) return
                  toggleActive.mutate({ id: deleteTarget.id, isActive: false }, {
                    onSuccess: () => setDeleteTarget(null),
                  })
                }}
              >
                Nonaktifkan (arsipkan)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetailBlock({ title, value, list }: { title: string; value: string | null; list?: boolean }) {
  if (!value) {
    return (
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-muted-foreground text-[12.5px] mt-0.5">Belum ada.</p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {list ? (
        <ul className="mt-1 space-y-0.5">
          {value.split('\n').filter(Boolean).map((line, i) => (
            <li key={i} className="text-[12.5px] flex gap-2">
              <span className="text-emerald font-bold">•</span>{line.trim()}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] leading-relaxed mt-0.5">{value}</p>
      )}
    </div>
  )
}
