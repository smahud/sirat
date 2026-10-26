'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, ShieldCheck, LockKeyhole, User } from 'lucide-react'

export function LoginView({ onLogin }: { onLogin: (u: string, p: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLogin(username, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      {/* ===== Panel brand ===== */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0d5c46] via-[#062f25] to-[#03251c] p-12 text-white">
        <div className="absolute inset-0 pattern-islami" aria-hidden />

        {/* Ornamen sudut */}
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full border-[28px] border-[#c9a227]/15" aria-hidden />
        <div className="absolute -bottom-32 -left-16 w-[28rem] h-[28rem] rounded-full border-[36px] border-white/[0.05]" aria-hidden />

        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[url('/logo.svg')] bg-cover bg-center shadow-lift" />
          <div className="leading-tight">
            <p className="font-display text-2xl font-bold tracking-tight">SIRAT</p>
            <p className="text-[11px] text-white/60">YAPSI Darussalam</p>
          </div>
        </div>

        <div className="relative max-w-md space-y-6">
          <h1 className="font-display text-[42px] leading-[1.12] font-bold text-balance">
            Registrasi nomor surat yang{' '}
            <span className="text-[#e6c96a]">tertib</span>, aman, dan teraudit.
          </h1>
          <p className="text-[15px] leading-relaxed text-white/70">
            Satu sistem untuk seluruh unit dan kepanitiaan — nomor resmi dialokasikan
            secara atomik, arsip tersimpan dengan checksum, dan setiap tindakan
            tercatat di audit trail.
          </p>
          <ul className="space-y-3 text-sm text-white/80">
            {[
              'Penomoran deterministik tanpa duplikasi',
              'Arsip digital berversi dengan SHA-256',
              'Hak akses terbatas per unit & kepanitiaan',
            ].map(t => (
              <li key={t} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-[#c9a227]/20 border border-[#c9a227]/40 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-3 h-3 text-[#e6c96a]" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">
          © 2026 YAPSI Darussalam · Sistem internal terkendali
        </p>
      </div>

      {/* ===== Panel form ===== */}
      <div className="relative flex items-center justify-center bg-background pattern-islami-soft p-6 sm:p-10">
        <div className="w-full max-w-sm animate-rise">
          {/* Logo mobile */}
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex w-16 h-16 rounded-2xl bg-[url('/logo.svg')] bg-cover bg-center shadow-lift mb-4" />
            <h1 className="font-display text-3xl font-bold tracking-tight">SIRAT</h1>
            <p className="text-sm text-muted-foreground mt-1">YAPSI Darussalam</p>
          </div>

          <h2 className="font-display text-[28px] font-bold tracking-tight">Selamat datang kembali</h2>
          <p className="text-sm text-muted-foreground mt-1.5 mb-8">
            Masuk untuk mengelola registrasi dan arsip surat.
          </p>

          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-[13px] font-semibold">Username</Label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
                <Input
                  id="username" value={username} autoComplete="username"
                  onChange={(e) => setUsername(e.target.value)} required
                  placeholder="mis. admin"
                  className="h-11 pl-10 bg-surface shadow-card"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-[13px] font-semibold">Password</Label>
              <div className="relative">
                <LockKeyhole className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
                <Input
                  id="password" type="password" value={password} autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)} required
                  placeholder="••••••••••"
                  className="h-11 pl-10 bg-surface shadow-card"
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-4 py-3 text-[13px] text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full h-11 text-[14.5px] font-semibold shadow-card transition-transform active:scale-[0.99]"
              disabled={busy}
            >
              {busy
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Memproses…</>
                : 'Masuk ke SIRAT'}
            </Button>
          </form>

          <p className="text-center text-[11.5px] text-muted-foreground/80 mt-8 leading-relaxed">
            Akun diberikan oleh administrator sistem.<br />
            Seluruh aktivitas login tercatat di audit trail.
          </p>
        </div>
      </div>
    </div>
  )
}
