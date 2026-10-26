import { NextResponse } from 'next/server'

/**
 * GET /api — info layanan publik (tanpa data sensitif).
 * Health check terperinci memerlukan autentikasi: /api/health.
 */
export async function GET() {
  return NextResponse.json(
    {
      service: 'SIRAT',
      name: 'Sistem Informasi Registrasi & Arsip Surat',
      organization: 'YAPSI Darussalam',
      status: 'operational',
      docs: '/docs/RUNBOOK.md',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
