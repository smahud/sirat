'use client'

// Unit & Kepanitiaan (master prompt lanjutan C):
// C.1 label "Unit Permanen" → "Unit / Departemen"; C.2 fitur edit (nama/kode/keterangan/status);
// C.3 ID internal stabil (storageKey tidak berubah saat kode diedit); C.4 hapus guarded;
// C.5 kolom Status & Aksi sejajar (satu kolom aksi, tanpa posisi absolut).
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiGet, apiPatch, apiPost } from '@/lib/client'
import { PageHeader, LifecycleBadge, EmptyState } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Building2, Users2, Plus, Share2, Boxes, Pencil, Trash2, Info } from 'lucide-react'

interface UnitRow { id: string; code: string; name: string; description: string | null; status: string }
interface CommitteeRow {
  id: string; code: string; name: string; description: string | null; status: string; unitId: string
  shareParentCounter: boolean; startDate: string | null; endDate: string | null
  unit: { id: string; code: string; name: string }
}

export function UnitsView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [newUnit, setNewUnit] = useState({ code: '', name: '', description: '' })
  const [newCommittee, setNewCommittee] = useState({ unitId: '', code: '', name: '', shareParentCounter: false })

  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: UnitRow[] }>('/api/units') })
  const committees = useQuery({ queryKey: ['committees'], queryFn: () => apiGet<{ committees: CommitteeRow[] }>('/api/committees') })

  // ===== Edit modal state =====
  const [editUnit, setEditUnit] = useState<UnitRow | null>(null)
  const [editCommittee, setEditCommittee] = useState<CommitteeRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'unit' | 'committee'; id: string; label: string } | null>(null)

  const createUnit = useMutation({
    mutationFn: () => apiPost('/api/units', { ...newUnit, description: newUnit.description || null }),
    onSuccess: () => { toast.success('Unit dibuat'); setNewUnit({ code: '', name: '', description: '' }); qc.invalidateQueries({ queryKey: ['units'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const updateUnit = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiPatch(`/api/units?id=${id}`, data),
    onSuccess: () => { toast.success('Unit diperbarui'); setEditUnit(null); qc.invalidateQueries({ queryKey: ['units'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const deleteUnit = useMutation({
    mutationFn: (id: string) => api(`/api/units?id=${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Unit dihapus'); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['units'] }) },
    onError: (e) => { toast.error((e as Error).message); setDeleteTarget(null) },
  })
  const createCommittee = useMutation({
    mutationFn: () => apiPost('/api/committees', newCommittee),
    onSuccess: () => { toast.success('Kepanitiaan dibuat (status DRAFT)'); setNewCommittee({ unitId: '', code: '', name: '', shareParentCounter: false }); qc.invalidateQueries({ queryKey: ['committees'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const updateCommittee = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiPatch('/api/committees', { id, ...data }),
    onSuccess: () => { toast.success('Kepanitiaan diperbarui'); setEditCommittee(null); qc.invalidateQueries({ queryKey: ['committees'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const deleteCommittee = useMutation({
    mutationFn: (id: string) => api('/api/committees', { method: 'DELETE', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => { toast.success('Kepanitiaan dihapus'); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['committees'] }) },
    onError: (e) => { toast.error((e as Error).message); setDeleteTarget(null) },
  })

  return (
    <div>
      <PageHeader
        title="Unit & Panitia"
        description="Master data organisasi: Unit / Departemen permanen beserta kepanitiaan di bawahnya. Jenis surat dikelola di menunya sendiri."
      />

      {/* ===== Unit / Departemen ===== */}
      <Card className="shadow-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><Building2 className="w-4 h-4" /></span>
              Unit / Departemen
              <span className="text-muted-foreground font-normal text-[13px]">({units.data?.units.length ?? 0})</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Kode</TableHead>
                  <TableHead className="font-semibold min-w-44">Nama</TableHead>
                  <TableHead className="font-semibold min-w-40 hidden md:table-cell">Keterangan</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  {canManage && <TableHead className="text-right font-semibold w-28">Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.data?.units.map((u) => (
                  <TableRow key={u.id} className="transition-colors hover:bg-emerald-soft/40">
                    <TableCell className="font-mono text-[12.5px] font-semibold">{u.code}</TableCell>
                    <TableCell className="text-[13.5px]">{u.name}</TableCell>
                    <TableCell className="text-[12.5px] text-muted-foreground hidden md:table-cell">{u.description ?? '—'}</TableCell>
                    <TableCell><LifecycleBadge status={u.status} /></TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0 bg-surface" onClick={() => setEditUnit(u)} aria-label={`Edit unit ${u.code}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 w-8 p-0 bg-surface text-destructive hover:bg-red-50" onClick={() => setDeleteTarget({ kind: 'unit', id: u.id, label: `${u.code} — ${u.name}` })} aria-label={`Hapus unit ${u.code}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Mengubah kode (mis. KB → KB-RA) tidak mengubah identitas internal maupun nomor surat lama — nomor final historis tetap memakai kode saat surat diterbitkan.
          </p>

          {canManage && (
            <div className="rounded-xl border border-dashed p-4 bg-muted/30 space-y-3">
              <p className="text-[12px] font-semibold text-muted-foreground">Tambah Unit / Departemen</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1.5 w-32">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Kode unit</Label>
                  <Input value={newUnit.code} className="bg-surface" onChange={(e) => setNewUnit({ ...newUnit, code: e.target.value.toUpperCase() })} placeholder="mis. SMA" />
                </div>
                <div className="space-y-1.5 flex-1 min-w-52">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Nama unit</Label>
                  <Input value={newUnit.name} className="bg-surface" onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })} placeholder="mis. SMA Darussalam" />
                </div>
                <Button disabled={!newUnit.code || !newUnit.name || createUnit.isPending} onClick={() => createUnit.mutate()} className="shadow-card">
                  <Plus className="w-4 h-4 mr-1" /> Unit
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Kepanitiaan ===== */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gold-soft text-gold-dark flex items-center justify-center"><Users2 className="w-4 h-4" /></span>
            Kepanitiaan
            <span className="text-muted-foreground font-normal text-[13px]">({committees.data?.committees.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {committees.data?.committees.length === 0 && (
            <EmptyState
              icon={Users2}
              title="Belum ada kepanitiaan"
              description="Kepanitiaan bersifat temporer dan selalu berada di bawah satu Unit / Departemen, dengan counter terpisah secara default."
            />
          )}
          {committees.data && committees.data.committees.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="font-semibold">Unit parent</TableHead>
                    <TableHead className="font-semibold">Kode</TableHead>
                    <TableHead className="font-semibold min-w-44">Nama</TableHead>
                    <TableHead className="font-semibold">Counter</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    {canManage && <TableHead className="text-right font-semibold w-28">Aksi</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {committees.data.committees.map((c) => (
                    <TableRow key={c.id} className="transition-colors hover:bg-emerald-soft/40">
                      <TableCell className="text-[13px] font-medium">{c.unit.code}</TableCell>
                      <TableCell className="font-mono text-[12.5px] font-semibold">{c.code}</TableCell>
                      <TableCell className="text-[13.5px]">{c.name}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full border px-2.5 py-0.5 ${c.shareParentCounter ? 'bg-gold-soft text-gold-dark border-gold/30' : 'bg-emerald-soft text-emerald-deep border-emerald/25'}`}>
                          {c.shareParentCounter
                            ? <><Share2 className="w-3 h-3" /> share parent</>
                            : <><Boxes className="w-3 h-3" /> sendiri</>}
                        </span>
                      </TableCell>
                      <TableCell><LifecycleBadge status={c.status} /></TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0 bg-surface" onClick={() => setEditCommittee(c)} aria-label={`Edit kepanitiaan ${c.code}`}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0 bg-surface text-destructive hover:bg-red-50" onClick={() => setDeleteTarget({ kind: 'committee', id: c.id, label: `${c.code} — ${c.name}` })} aria-label={`Hapus kepanitiaan ${c.code}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {canManage && (
            <div className="rounded-xl border border-dashed p-4 bg-muted/30 space-y-3">
              <p className="text-[12px] font-semibold text-muted-foreground">Tambah Kepanitiaan</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1.5 w-48">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Unit parent</Label>
                  <Select value={newCommittee.unitId || undefined} onValueChange={(v) => setNewCommittee({ ...newCommittee, unitId: v })}>
                    <SelectTrigger className="bg-surface"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                    <SelectContent>
                      {units.data?.units.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 w-36">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Kode panitia</Label>
                  <Input value={newCommittee.code} className="bg-surface" onChange={(e) => setNewCommittee({ ...newCommittee, code: e.target.value.toUpperCase() })} placeholder="PAN-HUT81" />
                </div>
                <div className="space-y-1.5 flex-1 min-w-52">
                  <Label className="text-[12px] font-semibold text-muted-foreground">Nama kepanitiaan</Label>
                  <Input value={newCommittee.name} className="bg-surface" onChange={(e) => setNewCommittee({ ...newCommittee, name: e.target.value })} placeholder="mis. Panitia HUT RI" />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={newCommittee.shareParentCounter}
                    onCheckedChange={(v) => setNewCommittee({ ...newCommittee, shareParentCounter: v })}
                    id="share-counter" />
                  <Label htmlFor="share-counter" className="text-[12px] text-muted-foreground leading-tight">
                    Berbagi counter<br />dengan unit parent
                  </Label>
                </div>
                <Button disabled={!newCommittee.unitId || !newCommittee.code || !newCommittee.name || createCommittee.isPending}
                  onClick={() => createCommittee.mutate()} className="shadow-card">
                  <Plus className="w-4 h-4 mr-1" /> Kepanitiaan
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Modal edit unit ===== */}
      <Dialog open={!!editUnit} onOpenChange={(v) => !v && setEditUnit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit Unit / Departemen</DialogTitle>
            <DialogDescription>
              Perubahan kode tidak mengubah identitas internal (ID &amp; storageKey) — relasi surat, penugasan, dan nomor final historis tetap utuh.
            </DialogDescription>
          </DialogHeader>
          {editUnit && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-[120px_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold">Kode</Label>
                  <Input value={editUnit.code} className="bg-surface font-mono" onChange={(e) => setEditUnit({ ...editUnit, code: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold">Nama</Label>
                  <Input value={editUnit.name} className="bg-surface" onChange={(e) => setEditUnit({ ...editUnit, name: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Keterangan</Label>
                <Textarea value={editUnit.description ?? ''} className="bg-surface resize-none" rows={2}
                  onChange={(e) => setEditUnit({ ...editUnit, description: e.target.value })}
                  placeholder="mis. Lembaga pendidikan anak usia dini & RA" />
              </div>
              <div className="space-y-1.5 w-56">
                <Label className="text-[12px] font-semibold">Status</Label>
                <Select value={editUnit.status} onValueChange={(v) => setEditUnit({ ...editUnit, status: v })}>
                  <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Aktif</SelectItem>
                    <SelectItem value="INACTIVE">Nonaktif</SelectItem>
                    <SelectItem value="ARCHIVED">Arsip</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Unit nonaktif tidak bisa menerbitkan surat baru.</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditUnit(null)}>Batal</Button>
            <Button
              disabled={!editUnit?.code || !editUnit?.name || updateUnit.isPending}
              onClick={() => editUnit && updateUnit.mutate({
                id: editUnit.id,
                data: { code: editUnit.code, name: editUnit.name, description: editUnit.description || null, status: editUnit.status },
              })}
            >
              {updateUnit.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Modal edit kepanitiaan ===== */}
      <Dialog open={!!editCommittee} onOpenChange={(v) => !v && setEditCommittee(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto scrollbar-slim">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit Kepanitiaan</DialogTitle>
            <DialogDescription>
              Kepanitiaan di bawah <span className="font-semibold">{editCommittee?.unit.code} — {editCommittee?.unit.name}</span>. Perubahan kode hanya berlaku untuk terbitan baru.
            </DialogDescription>
          </DialogHeader>
          {editCommittee && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-[140px_1fr] gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold">Kode</Label>
                  <Input value={editCommittee.code} className="bg-surface font-mono" onChange={(e) => setEditCommittee({ ...editCommittee, code: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold">Nama</Label>
                  <Input value={editCommittee.name} className="bg-surface" onChange={(e) => setEditCommittee({ ...editCommittee, name: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-semibold">Keterangan</Label>
                <Textarea value={editCommittee.description ?? ''} className="bg-surface resize-none" rows={2}
                  onChange={(e) => setEditCommittee({ ...editCommittee, description: e.target.value })}
                  placeholder="mis. Panitia peringatan HUT ke-81" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-semibold">Status</Label>
                  <Select value={editCommittee.status} onValueChange={(v) => setEditCommittee({ ...editCommittee, status: v })}>
                    <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="ACTIVE">Aktif</SelectItem>
                      <SelectItem value="COMPLETED">Selesai</SelectItem>
                      <SelectItem value="ARCHIVED">Arsip</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    checked={editCommittee.shareParentCounter}
                    onCheckedChange={(v) => setEditCommittee({ ...editCommittee, shareParentCounter: v })}
                    id="edit-share-counter"
                    disabled={false}
                  />
                  <Label htmlFor="edit-share-counter" className="text-[12px] text-muted-foreground leading-tight">
                    Berbagi counter<br />dengan unit parent
                  </Label>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Kebijakan counter hanya bisa diubah bila kepanitiaan belum memiliki surat.</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditCommittee(null)}>Batal</Button>
            <Button
              disabled={!editCommittee?.code || !editCommittee?.name || updateCommittee.isPending}
              onClick={() => editCommittee && updateCommittee.mutate({
                id: editCommittee.id,
                data: {
                  code: editCommittee.code, name: editCommittee.name,
                  description: editCommittee.description || null,
                  status: editCommittee.status,
                  shareParentCounter: editCommittee.shareParentCounter,
                },
              })}
            >
              {updateCommittee.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Modal konfirmasi hapus ===== */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-lg">
              <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><Trash2 className="w-4 h-4" /></span>
              Hapus {deleteTarget?.kind === 'unit' ? 'Unit / Departemen' : 'Kepanitiaan'}?
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">{deleteTarget?.label}</span>
              <br />
              Penghapusan fisik hanya bisa dilakukan bila belum memiliki dependensi (surat, penugasan, profil).
              Bila sudah dipakai, sistem akan menyarankan mengarsipkan agar histori tetap tersambung.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button variant="destructive"
              disabled={deleteUnit.isPending || deleteCommittee.isPending}
              onClick={() => {
                if (!deleteTarget) return
                if (deleteTarget.kind === 'unit') deleteUnit.mutate(deleteTarget.id)
                else deleteCommittee.mutate(deleteTarget.id)
              }}
            >
              {(deleteUnit.isPending || deleteCommittee.isPending) ? 'Menghapus…' : 'Ya, hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
