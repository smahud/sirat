'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/client'
import { PageHeader } from './ui-bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { IdCard, KeyRound, Info } from 'lucide-react'

export function SettingsView({ me }: { me: { fullName: string; username: string } }) {
  const qc = useQueryClient()
  const identity = useQuery({
    queryKey: ['app-identity'],
    queryFn: () => apiGet<{ identity: { name: string; ownerName: string | null; timezone: string; locale: string } | null }>('/api/app-identity'),
  })

  const [form, setForm] = useState({ name: '', ownerName: '' })
  const [pw, setPw] = useState({ current: '', next: '' })
  const [initialized, setInitialized] = useState(false)

  if (identity.data && !initialized) {
    setForm({ name: identity.data.identity?.name ?? '', ownerName: identity.data.identity?.ownerName ?? '' })
    setInitialized(true)
  }

  const saveIdentity = useMutation({
    mutationFn: () => apiPut('/api/app-identity', {
      name: form.name, ownerName: form.ownerName || null,
      timezone: 'Asia/Jakarta', locale: 'id-ID',
    }),
    onSuccess: () => { toast.success('Identitas aplikasi disimpan'); qc.invalidateQueries({ queryKey: ['app-identity'] }) },
    onError: (e) => toast.error((e as Error).message),
  })

  const changePw = useMutation({
    mutationFn: () => apiPost('/api/users/me/password', {
      currentPassword: pw.current, newPassword: pw.next,
    }),
    onSuccess: () => { toast.success('Password diganti'); setPw({ current: '', next: '' }) },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Pengaturan"
        description="Identitas aplikasi dan keamanan akun Anda."
      />

      <Card className="shadow-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><IdCard className="w-4 h-4" /></span>
            Identitas Aplikasi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-gold/25 bg-gold-soft/50 p-3.5 flex gap-3">
            <Info className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
            <p className="text-[12px] text-foreground/75 leading-relaxed">
              Nama aplikasi terpisah dari unit penerbit — mengubahnya tidak mengubah nomor surat historis maupun struktur arsip.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Nama aplikasi</Label>
            <Input value={form.name} className="bg-surface" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Nama pemilik / organisasi</Label>
            <Input value={form.ownerName} className="bg-surface" onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11.5px] text-muted-foreground">
              Zona waktu <span className="font-medium text-foreground">Asia/Jakarta</span> · Lokal <span className="font-medium text-foreground">id-ID</span>
            </p>
            <Button disabled={!form.name || saveIdentity.isPending} onClick={() => saveIdentity.mutate()} className="shadow-card">
              {saveIdentity.isPending ? 'Menyimpan…' : 'Simpan Identitas'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-gold-soft text-gold-dark flex items-center justify-center"><KeyRound className="w-4 h-4" /></span>
            Ganti Password
            <span className="text-[12px] font-normal text-muted-foreground">({me.username})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Password saat ini</Label>
            <Input type="password" value={pw.current} className="bg-surface" onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Password baru (min 10 karakter)</Label>
            <Input type="password" value={pw.next} className="bg-surface" onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            {pw.next && pw.next.length < 10 && (
              <p className="text-[11px] text-muted-foreground">Kekuatan: {pw.next.length}/10 karakter minimum</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button disabled={!pw.current || pw.next.length < 10 || changePw.isPending} onClick={() => changePw.mutate()} className="shadow-card">
              {changePw.isPending ? 'Mengganti…' : 'Ganti Password'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
