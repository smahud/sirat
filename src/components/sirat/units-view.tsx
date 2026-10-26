'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from '@/lib/client'
import { PageHeader, LifecycleBadge, EmptyState } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Building2, Users2, Hash, Plus, Share2, Boxes } from 'lucide-react'

interface UnitRow { id: string; code: string; name: string; status: string }
interface CommitteeRow {
  id: string; code: string; name: string; status: string; unitId: string
  shareParentCounter: boolean; startDate: string | null; endDate: string | null
  unit: { id: string; code: string; name: string }
}
interface LetterTypeRow { id: string; code: string; name: string; isActive: boolean }

export function UnitsView({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [newUnit, setNewUnit] = useState({ code: '', name: '' })
  const [newCommittee, setNewCommittee] = useState({ unitId: '', code: '', name: '', shareParentCounter: false })
  const [newType, setNewType] = useState({ code: '', name: '' })

  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: UnitRow[] }>('/api/units') })
  const committees = useQuery({ queryKey: ['committees'], queryFn: () => apiGet<{ committees: CommitteeRow[] }>('/api/committees') })
  const letterTypes = useQuery({ queryKey: ['letter-types'], queryFn: () => apiGet<{ letterTypes: LetterTypeRow[] }>('/api/letter-types') })

  const createUnit = useMutation({
    mutationFn: () => apiPost('/api/units', newUnit),
    onSuccess: () => { toast.success('Unit dibuat'); setNewUnit({ code: '', name: '' }); qc.invalidateQueries({ queryKey: ['units'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const updateUnit = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiPatch(`/api/units?id=${id}`, data),
    onSuccess: () => { toast.success('Unit diperbarui'); qc.invalidateQueries({ queryKey: ['units'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const createCommittee = useMutation({
    mutationFn: () => apiPost('/api/committees', newCommittee),
    onSuccess: () => { toast.success('Kepanitiaan dibuat (status DRAFT)'); setNewCommittee({ unitId: '', code: '', name: '', shareParentCounter: false }); qc.invalidateQueries({ queryKey: ['committees'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const updateCommittee = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiPatch('/api/committees', { id, ...data }),
    onSuccess: () => { toast.success('Kepanitiaan diperbarui'); qc.invalidateQueries({ queryKey: ['committees'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const createType = useMutation({
    mutationFn: () => apiPost('/api/letter-types', newType),
    onSuccess: () => { toast.success('Jenis surat dibuat'); setNewType({ code: '', name: '' }); qc.invalidateQueries({ queryKey: ['letter-types'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const updateType = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiPatch('/api/letter-types', { id, ...data }),
    onSuccess: () => { toast.success('Jenis surat diperbarui'); qc.invalidateQueries({ queryKey: ['letter-types'] }) },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div>
      <PageHeader
        title="Unit & Panitia"
        description="Master data organisasi: unit permanen, kepanitiaan di bawah unit, dan jenis surat."
      />

      {/* ===== Unit ===== */}
      <Card className="shadow-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><Building2 className="w-4 h-4" /></span>
            Unit Permanen
            <span className="text-muted-foreground font-normal text-[13px]">({units.data?.units.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Kode</TableHead>
                <TableHead className="font-semibold">Nama</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                {canManage && <TableHead className="text-right font-semibold">Ubah status</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.data?.units.map((u) => (
                <TableRow key={u.id} className="transition-colors hover:bg-emerald-soft/40">
                  <TableCell className="font-mono text-[12.5px] font-semibold">{u.code}</TableCell>
                  <TableCell className="text-[13.5px]">{u.name}</TableCell>
                  <TableCell><LifecycleBadge status={u.status} /></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Select value={u.status} onValueChange={(v) => updateUnit.mutate({ id: u.id, data: { status: v } })}>
                        <SelectTrigger className="w-32 h-8 bg-surface text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Aktif</SelectItem>
                          <SelectItem value="INACTIVE">Nonaktif</SelectItem>
                          <SelectItem value="ARCHIVED">Arsip</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {canManage && (
            <div className="rounded-xl border border-dashed p-4 flex flex-wrap gap-3 items-end bg-muted/30">
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
          )}
        </CardContent>
      </Card>

      {/* ===== Kepanitiaan ===== */}
      <Card className="shadow-card mb-5">
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
              description="Kepanitiaan bersifat temporer dan selalu berada di bawah satu unit permanen, dengan counter terpisah secara default."
            />
          )}
          {committees.data && committees.data.committees.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Unit parent</TableHead>
                  <TableHead className="font-semibold">Kode</TableHead>
                  <TableHead className="font-semibold">Nama</TableHead>
                  <TableHead className="font-semibold">Counter</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  {canManage && <TableHead className="text-right font-semibold">Ubah status</TableHead>}
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
                      <TableCell className="text-right">
                        <Select value={c.status} onValueChange={(v) => updateCommittee.mutate({ id: c.id, data: { status: v } })}>
                          <SelectTrigger className="w-36 h-8 bg-surface text-[12px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DRAFT">Draft</SelectItem>
                            <SelectItem value="ACTIVE">Aktif</SelectItem>
                            <SelectItem value="COMPLETED">Selesai</SelectItem>
                            <SelectItem value="ARCHIVED">Arsip</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {canManage && (
            <div className="rounded-xl border border-dashed p-4 flex flex-wrap gap-3 items-end bg-muted/30">
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
          )}
        </CardContent>
      </Card>

      {/* ===== Jenis surat ===== */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><Hash className="w-4 h-4" /></span>
            Jenis Surat
            <span className="text-muted-foreground font-normal text-[13px]">({letterTypes.data?.letterTypes.length ?? 0})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Kode</TableHead>
                <TableHead className="font-semibold">Nama jenis</TableHead>
                <TableHead className="font-semibold">Aktif</TableHead>
                {canManage && <TableHead className="text-right font-semibold">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {letterTypes.data?.letterTypes.map((t) => (
                <TableRow key={t.id} className="transition-colors hover:bg-emerald-soft/40">
                  <TableCell className="font-mono text-[12.5px] font-semibold">{t.code}</TableCell>
                  <TableCell className="text-[13.5px]">{t.name}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${t.isActive ? 'bg-emerald-soft text-emerald-deep border-emerald/25' : 'bg-muted text-muted-foreground border-border'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${t.isActive ? 'bg-emerald' : 'bg-muted-foreground/50'}`} />
                      {t.isActive ? 'Ya' : 'Tidak'}
                    </span>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="h-8 bg-surface shadow-card"
                        onClick={() => updateType.mutate({ id: t.id, data: { isActive: !t.isActive } })}>
                        {t.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {canManage && (
            <div className="rounded-xl border border-dashed p-4 flex flex-wrap gap-3 items-end bg-muted/30">
              <div className="space-y-1.5 w-36">
                <Label className="text-[12px] font-semibold text-muted-foreground">Kode jenis</Label>
                <Input value={newType.code} className="bg-surface" onChange={(e) => setNewType({ ...newType, code: e.target.value.toUpperCase() })} placeholder="mis. BA" />
              </div>
              <div className="space-y-1.5 flex-1 min-w-52">
                <Label className="text-[12px] font-semibold text-muted-foreground">Nama jenis surat</Label>
                <Input value={newType.name} className="bg-surface" onChange={(e) => setNewType({ ...newType, name: e.target.value.toUpperCase() })} placeholder="mis. BERITA ACARA" />
              </div>
              <Button disabled={!newType.code || !newType.name || createType.isPending} onClick={() => createType.mutate()} className="shadow-card">
                <Plus className="w-4 h-4 mr-1" /> Jenis
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
