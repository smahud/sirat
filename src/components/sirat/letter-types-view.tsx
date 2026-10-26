'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from '@/lib/client'
import { PageHeader, LifecycleBadge, EmptyState, MiniTag } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { FileStack, Plus, Pencil, Info, AlertTriangle } from 'lucide-react'

interface LetterTypeRow {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  _count?: { letters: number }
}

/**
 * Manajemen Jenis Surat (master prompt B) — menu khusus admin (lettertype.manage,
 * diverifikasi di BE pada setiap request, bukan sekadar menu disembunyikan).
 *
 * Entitas: Jenis surat (kode + nama + keterangan) adalah master TERPISAH dari
 * format penomoran (NumberingProfile). Kode jenis menjadi komponen nomor saat
 * terbit — snapshot-nya tersimpan di surat, sehingga:
 *  - Mengubah kode/nama TIDAK mengubah nomor surat yang sudah terbit.
 *  - Menonaktifkan hanya mencegah pemakaian baru; surat lama tetap sah.
 *  - Tidak ada hapus fisik — histori harus tetap valid (FR-002/FR-005).
 */
export function LetterTypesView() {
  const qc = useQueryClient()
  const [editType, setEditType] = useState<LetterTypeRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const types = useQuery({
    queryKey: ['letter-types'],
    queryFn: () => apiGet<{ letterTypes: LetterTypeRow[] }>('/api/letter-types'),
  })

  const toggleActive = useMutation({
    mutationFn: (t: LetterTypeRow) => apiPatch('/api/letter-types', { id: t.id, isActive: !t.isActive }),
    onSuccess: (_d, t) => {
      toast.success(t.isActive ? `Jenis ${t.code} dinonaktifkan — surat lama tetap sah` : `Jenis ${t.code} diaktifkan`)
      qc.invalidateQueries({ queryKey: ['letter-types'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div>
      <PageHeader
        title="Jenis Surat"
        description="Master jenis surat beserta kode dan keterangannya. Kode menjadi komponen nomor surat; perubahan hanya berlaku untuk terbitan baru."
      >
        <Button onClick={() => setCreateOpen(true)} className="shadow-card">
          <Plus className="w-4 h-4 mr-1.5" /> Jenis Surat
        </Button>
      </PageHeader>

      <div className="rounded-xl border border-gold/25 bg-gold-soft/50 p-3.5 flex gap-3 mb-5">
        <Info className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
        <p className="text-[12px] text-foreground/75 leading-relaxed">
          Jenis surat terpisah dari <span className="font-semibold">Profil Nomor</span>: profil mengatur susunan nomor
          (urutan, separator, bulan romawi, dsb.), sedangkan kode jenis di sini adalah komponen isinya.
          Jenis yang sudah dipakai surat terbit tidak dapat dihapus — gunakan <span className="font-semibold">nonaktifkan</span> agar
          tidak dipakai untuk surat baru.
        </p>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {types.data && types.data.letterTypes.length === 0 ? (
            <EmptyState
              icon={FileStack}
              title="Belum ada jenis surat"
              description="Tambahkan jenis surat (mis. UND — Undangan) untuk dipakai saat membuat surat."
            >
              <Button onClick={() => setCreateOpen(true)} className="shadow-card">
                <Plus className="w-4 h-4 mr-1.5" /> Jenis Surat
              </Button>
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Kode</TableHead>
                  <TableHead className="font-semibold">Nama / Klasifikasi</TableHead>
                  <TableHead className="font-semibold">Keterangan</TableHead>
                  <TableHead className="font-semibold">Dipakai</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-right font-semibold">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.data?.letterTypes.map((t) => (
                  <TableRow key={t.id} className="transition-colors hover:bg-emerald-soft/40">
                    <TableCell className="font-mono text-[12.5px] font-bold">{t.code}</TableCell>
                    <TableCell className="text-[13.5px]">{t.name}</TableCell>
                    <TableCell className="max-w-64 text-[12.5px] text-muted-foreground">
                      {t.description ? <span className="line-clamp-2">{t.description}</span> : <span className="italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <MiniTag tone={(t._count?.letters ?? 0) > 0 ? 'emerald' : 'slate'}>
                        {(t._count?.letters ?? 0)} surat
                      </MiniTag>
                    </TableCell>
                    <TableCell><LifecycleBadge status={t.isActive ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                    <TableCell className="text-right space-x-1.5">
                      <Button size="sm" variant="outline" className="h-8 bg-surface shadow-card" onClick={() => setEditType(t)}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-8 bg-surface shadow-card"
                        disabled={toggleActive.isPending}
                        onClick={() => toggleActive.mutate(t)}
                      >
                        {t.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LetterTypeForm
        open={createOpen || !!editType}
        type={editType}
        onClose={() => { setCreateOpen(false); setEditType(null) }}
        onSaved={() => { setCreateOpen(false); setEditType(null); qc.invalidateQueries({ queryKey: ['letter-types'] }) }}
      />
    </div>
  )
}

function LetterTypeForm({ open, type, onClose, onSaved }: {
  open: boolean
  type: LetterTypeRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!type
  const [code, setCode] = useState(type?.code ?? '')
  const [name, setName] = useState(type?.name ?? '')
  const [description, setDescription] = useState(type?.description ?? '')
  const [isActive, setIsActive] = useState(type?.isActive ?? true)

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || null,
        ...(isEdit ? { id: type!.id, isActive } : {}),
      }
      return isEdit ? apiPatch('/api/letter-types', payload) : apiPost('/api/letter-types', payload)
    },
    onSuccess: () => { toast.success(isEdit ? 'Jenis surat diperbarui' : 'Jenis surat dibuat'); onSaved() },
    onError: (e) => toast.error((e as Error).message),
  })

  const usedCount = type?._count?.letters ?? 0

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto scrollbar-slim">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><FileStack className="w-4 h-4" /></span>
            {isEdit ? `Edit Jenis: ${type!.code}` : 'Jenis Surat Baru'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Perubahan kode hanya berlaku untuk surat yang diterbitkan setelah ini.'
              : 'Kode singkat jenis surat yang menjadi komponen nomor (mis. UND untuk undangan).'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {isEdit && usedCount > 0 && (
            <div className="rounded-lg border border-gold/30 bg-gold-soft p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
              <p className="text-[11.5px] text-foreground/75 leading-relaxed">
                Jenis ini sudah dipakai <span className="font-semibold">{usedCount} surat</span>. Nomor surat yang sudah
                terbit tidak akan berubah — kode baru hanya dipakai terbitan berikutnya.
              </p>
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,120px)_1fr] gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Kode</Label>
              <Input value={code} className="bg-surface font-mono uppercase" onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="UND" maxLength={24} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Nama / klasifikasi</Label>
              <Input value={name} className="bg-surface" onChange={(e) => setName(e.target.value)} placeholder="Undangan" maxLength={120} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Keterangan (untuk tooltip ⓘ di form buat surat)</Label>
            <Textarea value={description} rows={3} className="bg-surface resize-none" maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mis. Undangan resmi kegiatan internal/eksternal; diterbitkan satuan kerja &amp; kepanitiaan." />
            <p className="text-[11px] text-muted-foreground">
              Muncul sebagai penjelasan saat petugas menekan ikon ⓘ pada kolom jenis surat.
            </p>
          </div>
          {isEdit && (
            <div className="flex items-center justify-between rounded-xl border bg-surface p-3 shadow-card">
              <div>
                <Label className="text-[12.5px] font-semibold">Aktif</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">Jenis nonaktif tidak bisa dipilih untuk surat baru.</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Status aktif" />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={save.isPending || !code.trim() || !name.trim()} onClick={() => save.mutate()} className="shadow-card min-w-28">
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
