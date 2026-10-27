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
import { IdCard, KeyRound, Info, UserRound } from 'lucide-react'

export function SettingsView({ me, onProfileUpdated }: {
  me: { fullName: string; username: string; email: string | null }
  onProfileUpdated?: () => void
}) {
  const qc = useQueryClient()
  const identity = useQuery({
    queryKey: ['app-identity'],
    queryFn: () => apiGet<{ identity: { name: string; ownerName: string | null; timezone: string; locale: string } | null }>('/api/app-identity'),
  })

  const [form, setForm] = useState<{ name: string; ownerName: string } | null>(null)

  // A.3: profil mandiri — terpisah dari ganti password
  const [profile, setProfile] = useState({ fullName: me.fullName, email: me.email ?? '' })
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })

  // Derived: identitas dari server, lokal hanya menyimpan edit pengguna
  const identityForm = form ?? {
    name: identity.data?.identity?.name ?? '',
    ownerName: identity.data?.identity?.ownerName ?? '',
  }
  const setIdentityForm = (patch: Partial<{ name: string; ownerName: string }>) => {
    setForm({ ...identityForm, ...patch })
  }

  const saveIdentity = useMutation({
    mutationFn: () => apiPut('/api/app-identity', {
      name: identityForm.name, ownerName: identityForm.ownerName || null,
      timezone: 'Asia/Jakarta', locale: 'id-ID',
    }),
    onSuccess: () => { toast.success('Identitas aplikasi disimpan'); qc.invalidateQueries({ queryKey: ['app-identity'] }) },
    onError: (e) => toast.error((e as Error).message),
  })

  const saveProfile = useMutation({
    mutationFn: () => apiPatch('/api/users/me/profile', {
      fullName: profile.fullName,
      email: profile.email || null,
    }),
    onSuccess: () => {
      toast.success('Profil disimpan')
      qc.invalidateQueries({ queryKey: ['me'] })
      onProfileUpdated?.()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const pwMismatch = pw.confirm !== '' && pw.next !== pw.confirm
  const changePw = useMutation({
    mutationFn: () => apiPost('/api/users/me/password', {
      currentPassword: pw.current, newPassword: pw.next, confirmPassword: pw.confirm,
    }),
    onSuccess: () => { toast.success('Password diganti'); setPw({ current: '', next: '', confirm: '' }) },
    onError: (e) => toast.error((e as Error).message),
  })

  const canChangePw = pw.current && pw.next.length >= 10 && pw.next === pw.confirm && pw.next !== pw.current

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Pengaturan"
        description="Profil akun, keamanan, dan identitas aplikasi."
      />

      {/* A.3 — Profil Saya (terpisah dari Ganti Password) */}
      <Card className="shadow-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-emerald-soft text-emerald flex items-center justify-center"><UserRound className="w-4 h-4" /></span>
            Profil Saya
            <span className="text-[12px] font-normal text-muted-foreground">({me.username})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-gold/25 bg-gold-soft/50 p-3.5 flex gap-3">
            <Info className="w-4 h-4 text-gold-dark shrink-0 mt-0.5" />
            <p className="text-[12px] text-foreground/75 leading-relaxed">
              Username <span className="font-mono font-semibold">{me.username}</span> adalah identitas login dan tidak dapat
              diubah. Nama lengkap hanya identitas tampilan — boleh sama dengan pengguna lain.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Nama lengkap</Label>
            <Input value={profile.fullName} className="bg-surface" onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Email</Label>
            <Input type="email" value={profile.email} className="bg-surface" placeholder="nama@yapsidarussalam.or.id"
              onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button disabled={!profile.fullName.trim() || (profile.fullName === me.fullName && (profile.email || null) === (me.email ?? null)) || saveProfile.isPending}
              onClick={() => saveProfile.mutate()} className="shadow-card">
              {saveProfile.isPending ? 'Menyimpan…' : 'Simpan Profil'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* A.2 — Ganti Password + konfirmasi */}
      <Card className="shadow-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-gold-soft text-gold-dark flex items-center justify-center"><KeyRound className="w-4 h-4" /></span>
            Ganti Password
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
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Konfirmasi password baru</Label>
            <Input type="password" value={pw.confirm} className="bg-surface" onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            {pwMismatch && (
              <p className="text-[11px] text-destructive font-medium">Konfirmasi password tidak cocok</p>
            )}
          </div>
          <div className="flex justify-end">
            <Button disabled={!canChangePw || changePw.isPending} onClick={() => changePw.mutate()} className="shadow-card">
              {changePw.isPending ? 'Mengganti…' : 'Ganti Password'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
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
            <Input value={identityForm.name} className="bg-surface" onChange={(e) => setIdentityForm({ name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-semibold">Nama pemilik / organisasi</Label>
            <Input value={identityForm.ownerName} className="bg-surface" onChange={(e) => setIdentityForm({ ownerName: e.target.value })} />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11.5px] text-muted-foreground">
              Zona waktu <span className="font-medium text-foreground">Asia/Jakarta</span> · Lokal <span className="font-medium text-foreground">id-ID</span>
            </p>
            <Button disabled={!identityForm.name || saveIdentity.isPending} onClick={() => saveIdentity.mutate()} className="shadow-card">
              {saveIdentity.isPending ? 'Menyimpan…' : 'Simpan Identitas'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
