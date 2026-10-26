'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from '@/lib/client'
import { PageHeader, MiniTag } from './ui-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Users, ShieldCheck, Plus, AlertTriangle } from 'lucide-react'

interface UserRow {
  id: string; username: string; fullName: string; email: string | null; role: string; isActive: boolean
  assignments: { unitId: string | null; committeeId: string | null; includeCommittees: boolean; unit: { code: string } | null; committee: { code: string } | null }[]
}
interface UnitRow { id: string; code: string; name: string }
interface CommitteeRow { id: string; code: string; name: string; unitId: string; status: string }

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'Administrator Sistem',
  ORG_ADMIN: 'Admin Organisasi',
  UNIT_ADMIN: 'Admin Unit',
  COMMITTEE_ADMIN: 'Admin Kepanitiaan',
  OPERATOR: 'Operator',
  VIEWER: 'Pengamat',
  AUDITOR: 'Auditor',
}
const ROLES = Object.keys(ROLE_LABELS)
const GLOBAL_ROLES = ['SYSTEM_ADMIN', 'ORG_ADMIN', 'AUDITOR']

export function UsersView() {
  const qc = useQueryClient()
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const users = useQuery({ queryKey: ['users'], queryFn: () => apiGet<{ users: UserRow[] }>('/api/users') })
  const units = useQuery({ queryKey: ['units'], queryFn: () => apiGet<{ units: UnitRow[] }>('/api/units') })
  const committees = useQuery({ queryKey: ['committees'], queryFn: () => apiGet<{ committees: CommitteeRow[] }>('/api/committees') })

  const toggleActive = useMutation({
    mutationFn: (u: UserRow) => apiPatch('/api/users', { id: u.id, isActive: !u.isActive }),
    onSuccess: () => { toast.success('Berhasil'); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div>
      <PageHeader
        title="Pengguna & Akses"
        description="Role global dan assignment scope per unit/kepanitiaan — akses lintas scope ditolak secara default."
      >
        <Button onClick={() => setCreateOpen(true)} className="shadow-card">
          <Plus className="w-4 h-4 mr-1.5" /> Pengguna
        </Button>
      </PageHeader>

      <Card className="shadow-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Username</TableHead>
                <TableHead className="font-semibold">Nama</TableHead>
                <TableHead className="font-semibold">Role</TableHead>
                <TableHead className="font-semibold">Scope</TableHead>
                <TableHead className="font-semibold">Aktif</TableHead>
                <TableHead className="text-right font-semibold">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data?.users.map((u) => {
                const isGlobal = GLOBAL_ROLES.includes(u.role)
                return (
                  <TableRow key={u.id} className="transition-colors hover:bg-emerald-soft/40">
                    <TableCell className="font-mono text-[12.5px] font-semibold">{u.username}</TableCell>
                    <TableCell className="text-[13.5px]">{u.fullName}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        {u.role === 'SYSTEM_ADMIN' && <ShieldCheck className="w-3.5 h-3.5 text-gold-dark" />}
                        <span className="text-[12.5px] font-medium">{ROLE_LABELS[u.role] ?? u.role}</span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64">
                      {isGlobal ? (
                        <span className="text-[12px] text-muted-foreground italic">akses global</span>
                      ) : u.assignments.length === 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-destructive font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" /> tanpa scope!
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.assignments.map((a, i) => (
                            <MiniTag key={i} tone={a.committee ? 'gold' : 'emerald'}>
                              {a.committee ? `${a.unit?.code ?? ''}/${a.committee.code}` : `${a.unit?.code ?? '?'}${a.includeCommittees ? '+panitia' : ''}`}
                            </MiniTag>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${u.isActive ? 'bg-emerald-soft text-emerald-deep border-emerald/25' : 'bg-muted text-muted-foreground border-border'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-emerald' : 'bg-muted-foreground/50'}`} />
                        {u.isActive ? 'Ya' : 'Tidak'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right space-x-1.5">
                      <Button size="sm" variant="outline" className="h-8 bg-surface shadow-card" onClick={() => setEditUser(u)}>Edit</Button>
                      <Button size="sm" variant="outline" className="h-8 bg-surface shadow-card" onClick={() => toggleActive.mutate(u)}>
                        {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <UserForm
        open={createOpen || !!editUser}
        user={editUser}
        units={units.data?.units ?? []}
        committees={committees.data?.committees ?? []}
        onClose={() => { setCreateOpen(false); setEditUser(null) }}
        onSaved={() => { setCreateOpen(false); setEditUser(null); qc.invalidateQueries({ queryKey: ['users'] }) }}
      />
    </div>
  )
}

interface AssignmentDraft { unitId: string | null; committeeId: string | null; includeCommittees: boolean }

function UserForm({ open, user, units, committees, onClose, onSaved }: {
  open: boolean
  user: UserRow | null
  units: UnitRow[]
  committees: CommitteeRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!user
  const [username, setUsername] = useState(user?.username ?? '')
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(user?.role ?? 'OPERATOR')
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(
    user?.assignments.map(a => ({ unitId: a.unitId, committeeId: a.committeeId, includeCommittees: a.includeCommittees })) ?? []
  )

  const save = useMutation({
    mutationFn: () => {
      const base = { fullName, role, assignments: assignments.map(a => ({ ...a })) }
      if (isEdit) {
        const payload = { id: user!.id, ...base, ...(password ? { password } : {}) }
        return apiPatch('/api/users', payload)
      }
      return apiPost('/api/users', { username, ...base, password })
    },
    onSuccess: () => { toast.success(isEdit ? 'Pengguna diperbarui' : 'Pengguna dibuat'); onSaved() },
    onError: (e) => toast.error((e as Error).message),
  })

  const isGlobalRole = GLOBAL_ROLES.includes(role)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto scrollbar-slim">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><Users className="w-4 h-4" /></span>
            {isEdit ? `Edit: ${user!.username}` : 'Pengguna Baru'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label className="text-[12px] font-semibold">Username</Label>
              <Input value={username} className="bg-surface" onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="mis. budi.santoso" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Nama lengkap</Label>
            <Input value={fullName} className="bg-surface" onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">{isEdit ? 'Password baru (kosongkan bila tidak diubah)' : 'Password (min 10 karakter)'}</Label>
            <Input type="password" value={password} className="bg-surface" onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="bg-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Administrator Sistem / Admin Organisasi / Auditor = akses global. Role lain memerlukan assignment scope di bawah.
            </p>
          </div>

          {!isGlobalRole && (
            <div className="space-y-2.5">
              <Label className="text-[12px] font-semibold">Assignment scope</Label>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Assignment unit tidak otomatis mencakup kepanitiaan kecuali flag “termasuk panitia” dinyalakan.
              </p>
              {assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap rounded-xl border bg-surface p-3 shadow-card">
                  <Select
                    value={a.committeeId ?? a.unitId ?? 'NONE'}
                    onValueChange={(v) => {
                      const next = [...assignments]
                      if (v === 'NONE') next[i] = { unitId: null, committeeId: null, includeCommittees: false }
                      else if (v.startsWith('c:')) next[i] = { unitId: null, committeeId: v.slice(2), includeCommittees: false }
                      else next[i] = { unitId: v, committeeId: null, includeCommittees: a.includeCommittees }
                      setAssignments(next)
                    }}>
                    <SelectTrigger className="h-9 w-52 bg-surface text-[13px]"><SelectValue placeholder="Pilih scope" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">— pilih —</SelectItem>
                      {units.map(u => (
                        <SelectItem key={`u-${u.id}`} value={u.id}>Unit {u.code}</SelectItem>
                      ))}
                      {committees.map(c => (
                        <SelectItem key={`c-${c.id}`} value={`c:${c.id}`}>Panitia {c.code} ({c.status})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {a.unitId && !a.committeeId && (
                    <div className="flex items-center gap-1.5">
                      <Switch checked={a.includeCommittees} id={`ic-${i}`}
                        onCheckedChange={(v) => {
                          const next = [...assignments]
                          next[i] = { ...a, includeCommittees: v }
                          setAssignments(next)
                        }} />
                      <Label htmlFor={`ic-${i}`} className="text-[11.5px] text-muted-foreground">termasuk panitia unit</Label>
                    </div>
                  )}
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:bg-red-50"
                    onClick={() => setAssignments(assignments.filter((_, xi) => xi !== i))}>Hapus</Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="bg-surface shadow-card"
                onClick={() => setAssignments([...assignments, { unitId: null, committeeId: null, includeCommittees: false }])}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Assignment
              </Button>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={save.isPending || (!isEdit && (!username || password.length < 10)) || !fullName}
            onClick={() => save.mutate()} className="shadow-card min-w-28">
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
