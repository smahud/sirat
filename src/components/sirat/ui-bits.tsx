'use client'

// Komponen visual bersama SIRAT — konsisten di seluruh view.
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Check, Copy } from 'lucide-react'
import { copyText } from '@/lib/client'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'

/** Kepala halaman: judul serif + deskripsi + aksi kanan. */
export function PageHeader({ title, description, children }: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-6">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] md:text-[30px] font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="text-[13.5px] text-muted-foreground mt-1 max-w-2xl">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  )
}

/** Badge status surat dengan semantik warna YAPSI. */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; dot: string }> = {
    ISSUED: {
      label: 'Terbit',
      className: 'bg-emerald-soft text-emerald-deep border-emerald/25',
      dot: 'bg-emerald',
    },
    DRAFT: {
      label: 'Draft',
      className: 'bg-gold-soft text-gold-dark border-gold/30',
      dot: 'bg-gold',
    },
    CANCELLED: {
      label: 'Batal',
      className: 'bg-red-50 text-red-700 border-red-200',
      dot: 'bg-red-500',
    },
  }
  const s = map[status] ?? { label: status, className: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
      s.className,
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

/** Badge lifecycle unit/panitia. */
export function LifecycleBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    ACTIVE: { label: 'Aktif', className: 'bg-emerald-soft text-emerald-deep border-emerald/25' },
    INACTIVE: { label: 'Nonaktif', className: 'bg-muted text-muted-foreground border-border' },
    ARCHIVED: { label: 'Arsip', className: 'bg-gold-soft text-gold-dark border-gold/30' },
    DRAFT: { label: 'Draft', className: 'bg-gold-soft text-gold-dark border-gold/30' },
    COMPLETED: { label: 'Selesai', className: 'bg-emerald-soft text-emerald-deep border-emerald/25' },
  }
  const s = map[status] ?? { label: status, className: 'bg-muted text-muted-foreground border-border' }
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
      s.className,
    )}>
      {s.label}
    </span>
  )
}

/** Kartu statistik dengan ikon tinted dan aksen atas. */
export function StatCard({ label, value, icon: Icon, tone = 'emerald', hint }: {
  label: string
  value: string | number
  icon: LucideIcon
  tone?: 'emerald' | 'gold' | 'teal' | 'slate' | 'red'
  hint?: string
}) {
  const tones = {
    emerald: { bg: 'bg-emerald-soft', fg: 'text-emerald', bar: 'bg-emerald' },
    gold: { bg: 'bg-gold-soft', fg: 'text-gold-dark', bar: 'bg-gold' },
    teal: { bg: 'bg-teal-50', fg: 'text-teal-700', bar: 'bg-teal-500' },
    slate: { bg: 'bg-muted', fg: 'text-muted-foreground', bar: 'bg-muted-foreground/60' },
    red: { bg: 'bg-red-50', fg: 'text-red-600', bar: 'bg-red-400' },
  }
  const t = tones[tone]
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-surface p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
      <span className={cn('absolute inset-x-0 top-0 h-[3px]', t.bar, 'opacity-70')} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[26px] font-bold leading-none tracking-tight tabular-nums">{value}</p>
          <p className="text-[12px] text-muted-foreground mt-1.5 truncate">{label}</p>
        </div>
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110', t.bg, t.fg)}>
          <Icon className="w-[19px] h-[19px]" />
        </div>
      </div>
      {hint && <p className="text-[10.5px] text-muted-foreground/70 mt-2 truncate">{hint}</p>}
    </div>
  )
}

/** Empty state yang informatif dan mengundang aksi. */
export function EmptyState({ icon: Icon, title, description, children }: {
  icon: LucideIcon
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-emerald-soft text-emerald flex items-center justify-center mb-4">
        <Icon className="w-7 h-7" />
      </div>
      <p className="font-display text-lg font-semibold">{title}</p>
      {description && <p className="text-[13px] text-muted-foreground mt-1.5 max-w-sm text-balance">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}

/** Label kecil bergaya kapsul untuk metadata (mis. "import"). */
export function MiniTag({ children, tone = 'slate' }: {
  children: React.ReactNode
  tone?: 'slate' | 'gold' | 'emerald'
}) {
  const tones = {
    slate: 'bg-muted text-muted-foreground border-border',
    gold: 'bg-gold-soft text-gold-dark border-gold/30',
    emerald: 'bg-emerald-soft text-emerald-deep border-emerald/25',
  }
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide', tones[tone])}>
      {children}
    </span>
  )
}

/**
 * Tombol salin teks (v1.7 — permintaan pemilik: akses copy nomor surat di semua
 * posisi yang dibutuhkan: pratinjau saat draft, nomor resmi saat terbit, daftar surat).
 * Umpan balik: ikon berubah jadi centang 1,6 dtk + toast opsional.
 * `tone="onDark"` untuk latar gelap (hero nomor surat).
 */
export function CopyButton({ value, label = 'Salin nomor', toastLabel, tone = 'default', iconSize = 15, className, disabled }: {
  value: string
  label?: string
  toastLabel?: string
  tone?: 'default' | 'onDark'
  iconSize?: number
  className?: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const ok = await copyText(value)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      if (toastLabel) toast.success(toastLabel)
    } else {
      toast.error(`Gagal menyalin — salin manual: ${value}`)
    }
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onCopy}
      disabled={disabled || !value}
      className={cn(
        'inline-flex items-center justify-center rounded-md p-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none',
        tone === 'onDark'
          ? 'text-white/75 hover:text-white hover:bg-white/15 active:bg-white/25'
          : 'text-muted-foreground hover:text-emerald hover:bg-emerald-soft/60 active:bg-emerald-soft',
        className,
      )}
    >
      {copied
        ? <Check size={iconSize} className="text-emerald" aria-hidden />
        : <Copy size={iconSize} aria-hidden />}
      <span className="sr-only">{label}</span>
    </button>
  )
}
