'use client'

import { useState } from 'react'
import { useSession, hasPerm, Me } from './use-session'
import { LoginView } from './login-view'
import { DashboardView } from './dashboard-view'
import { LettersView } from './letters-view'
import { UnitsView } from './units-view'
import { ProfilesView } from './profiles-view'
import { UsersView } from './users-view'
import { LetterTypesView } from './letter-types-view'
import { AuditView, HealthView } from './audit-health-views'
import { ImportView } from './import-view'
import { SettingsView } from './settings-view'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  FileText, LayoutDashboard, Building2, SlidersHorizontal, Users, ScrollText,
  HeartPulse, FileSpreadsheet, Settings, LogOut, Loader2, X, FileStack,
} from 'lucide-react'

type ViewKey = 'dashboard' | 'letters' | 'units' | 'profiles' | 'lettertypes' | 'users' | 'audit' | 'health' | 'import' | 'settings'

interface NavItem {
  key: ViewKey
  label: string
  icon: React.ElementType
  perm?: string
}
interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Utama',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'letters', label: 'Surat', icon: FileText, perm: 'letter.view' },
    ],
  },
  {
    title: 'Organisasi',
    items: [
      { key: 'units', label: 'Unit & Panitia', icon: Building2, perm: 'letter.view' },
      { key: 'profiles', label: 'Profil Nomor', icon: SlidersHorizontal, perm: 'letter.view' },
      { key: 'lettertypes', label: 'Jenis Surat', icon: FileStack, perm: 'lettertype.manage' },
      { key: 'users', label: 'Pengguna', icon: Users, perm: 'user.manage' },
    ],
  },
  {
    title: 'Sistem',
    items: [
      { key: 'audit', label: 'Audit', icon: ScrollText, perm: 'audit.view' },
      { key: 'health', label: 'Kesehatan', icon: HeartPulse, perm: 'health.view' },
      { key: 'import', label: 'Import Excel', icon: FileSpreadsheet, perm: 'import.manage' },
      { key: 'settings', label: 'Pengaturan', icon: Settings },
    ],
  },
]

export function AppShell() {
  const { me, loading, login, logout, refresh } = useSession()
  const [view, setView] = useState<ViewKey>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="w-14 h-14 rounded-2xl bg-[url('/logo.svg')] bg-cover bg-center shadow-lift" />
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Menyiapkan SIRAT…</span>
        </div>
      </div>
    )
  }

  if (!me) {
    return <LoginView onLogin={login} />
  }

  const sections = NAV_SECTIONS
    .map(s => ({ ...s, items: s.items.filter(n => !n.perm || hasPerm(me.permissions, n.perm)) }))
    .filter(s => s.items.length > 0)

  const initials = me.user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="min-h-screen bg-background flex">
      {/* ====== Sidebar ====== */}
      <aside
        className={cn(
          'w-64 shrink-0 flex flex-col sticky top-0 h-screen',
          'bg-gradient-to-b from-[#062f25] via-[#052b21] to-[#03251c]',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:transition-transform max-md:duration-300',
          !sidebarOpen && 'max-md:-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-xl bg-[url('/logo.svg')] bg-cover bg-center shadow-lift" />
          </div>
          <div className="leading-tight min-w-0">
            <p className="font-display text-[22px] font-bold text-white tracking-tight">SIRAT</p>
            <p className="text-[10.5px] text-white/55 truncate">Registrasi &amp; Arsip Surat</p>
          </div>
          <button
            className="md:hidden ml-auto text-white/70 hover:text-white"
            onClick={() => setSidebarOpen(false)}
            aria-label="Tutup menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mx-5 h-px bg-white/10" />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto scrollbar-slim px-3 py-4 space-y-5" aria-label="Navigasi utama">
          {sections.map(section => (
            <div key={section.title}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase text-white/35">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map(n => {
                  const active = view === n.key
                  return (
                    <button
                      key={n.key}
                      onClick={() => { setView(n.key); setSidebarOpen(false) }}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-left transition-all duration-150',
                        active
                          ? 'bg-[#c9a227] text-[#03251c] shadow-[0_2px_10px_-2px_rgba(201,162,39,0.5)]'
                          : 'text-white/65 hover:bg-white/[0.07] hover:text-white',
                      )}
                    >
                      <n.icon className={cn('w-[17px] h-[17px] shrink-0 transition-transform', !active && 'group-hover:scale-110')} />
                      {n.label}
                      {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#03251c]" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User + logout */}
        <div className="px-3 pb-4 pt-3 border-t border-white/10">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-white/[0.05]">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#c9a227] to-[#826714] flex items-center justify-center text-[#062f25] text-xs font-bold shrink-0">
              {initials || 'U'}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-[13px] font-semibold text-white truncate">{me.user.fullName}</p>
              <p className="text-[10.5px] text-white/50 truncate">{roleLabel(me.user.role)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8 text-white/50 hover:text-[#e6c96a] hover:bg-white/10"
              onClick={logout}
              aria-label="Keluar"
              title="Keluar"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
          <p className="mt-2.5 text-center text-[10px] text-white/30">
            YAPSI Darussalam · v1.1
          </p>
        </div>
      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* ====== Konten ====== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header mobile */}
        <header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 px-4 border-b bg-[#062f25] text-white">
          <button
            className="text-white/80 hover:text-white"
            onClick={() => setSidebarOpen(true)}
            aria-label="Buka menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <div className="w-7 h-7 rounded-lg bg-[url('/logo.svg')] bg-cover bg-center" />
          <p className="font-display font-bold tracking-tight">SIRAT</p>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-full overflow-x-hidden">
          <div className="mx-auto max-w-6xl animate-rise" key={view}>
            <MainContent view={view} me={me} onProfileUpdated={refresh} />
          </div>
        </main>

        <footer className="border-t bg-surface mt-auto">
          <div className="mx-auto max-w-6xl px-4 md:px-8 py-3.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-display font-semibold text-foreground/70">SIRAT</span>
            <span>·</span>
            <span>Sistem Informasi Registrasi &amp; Arsip Surat</span>
            <span>·</span>
            <span>YAPSI Darussalam</span>
          </div>
        </footer>
      </div>
    </div>
  )
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    SYSTEM_ADMIN: 'Administrator Sistem',
    ORG_ADMIN: 'Admin Organisasi',
    UNIT_ADMIN: 'Admin Unit',
    COMMITTEE_ADMIN: 'Admin Kepanitiaan',
    OPERATOR: 'Operator',
    VIEWER: 'Pengamat',
    AUDITOR: 'Auditor',
  }
  return map[role] ?? role
}

function MainContent({ view, me, onProfileUpdated }: { view: ViewKey; me: Me; onProfileUpdated: () => void }) {
  switch (view) {
    case 'letters': return <LettersView />
    case 'units': return <UnitsView canManage={hasPerm(me.permissions, 'committee.manage')} />
    case 'profiles': return <ProfilesView />
    case 'lettertypes': return <LetterTypesView />
    case 'users': return <UsersView />
    case 'audit': return <AuditView />
    case 'health': return <HealthView />
    case 'import': return <ImportView />
    case 'settings': return <SettingsView me={me.user} onProfileUpdated={onProfileUpdated} />
    default: return <DashboardView />
  }
}
