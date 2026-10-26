// Render engine nomor — murni, deterministik, tanpa side effect.
import { NumberingDSL, DSLComponent } from './dsl'
import { Direction, romanMonth, monthNameId, padSequence, DateFormat } from '@/lib/constants'

export interface RenderContext {
  seq?: number              // hanya saat issue nyata; preview boleh undefined
  direction?: Direction | string
  letterTypeCode?: string
  unitCode?: string
  committeeCode?: string
  letterDate?: Date | null
  issueDate?: Date | null
}

export interface RenderedPart {
  componentType: DSLComponent['type']
  source: string   // asal nilai (untuk penjelasan rule)
  value: string
}

export interface RenderResult {
  text: string
  parts: RenderedPart[]
}

function formatDate(d: Date, format: DateFormat): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  switch (format) {
    case 'MONTH_ROMAN': return romanMonth(m)
    case 'MONTH_2': return String(m).padStart(2, '0')
    case 'MONTH_NAME': return monthNameId(m)
    case 'YEAR_4': return String(y)
    case 'YEAR_2': return String(y % 100).padStart(2, '0')
    case 'DATE_ISO': return d.toISOString().slice(0, 10)
  }
}

/**
 * Merender nomor dari DSL dan konteks.
 * seq undefined → placeholder '###' sesuai padding (PREVIEW, bukan reservasi).
 * Komponen yang sumbernya kosong → error eksplisit (bukan string kosong diam-diam).
 */
export function renderNumber(dsl: NumberingDSL, ctx: RenderContext): RenderResult {
  const parts: RenderedPart[] = []
  for (const c of dsl.components) {
    switch (c.type) {
      case 'literal':
        parts.push({ componentType: 'literal', source: 'nilai statis', value: c.value })
        break
      case 'sequence': {
        const v = ctx.seq === undefined
          ? '#'.repeat(c.padding)
          : padSequence(ctx.seq, c.padding)
        parts.push({ componentType: 'sequence', source: 'urutan dari counter (preview belum dialokasikan)', value: v })
        break
      }
      case 'direction': {
        if (!ctx.direction) throw new RenderError('Arah surat (internal/eksternal) belum dipilih')
        const mapped = c.mapping[ctx.direction as Direction]
        if (!mapped) throw new RenderError(`Mapping arah tidak punya nilai untuk ${ctx.direction}`)
        parts.push({ componentType: 'direction', source: `arah ${ctx.direction} → ${mapped}`, value: mapped })
        break
      }
      case 'letterTypeCode': {
        if (!ctx.letterTypeCode) throw new RenderError('Jenis surat belum dipilih')
        parts.push({ componentType: 'letterTypeCode', source: `kode jenis surat ${ctx.letterTypeCode}`, value: ctx.letterTypeCode })
        break
      }
      case 'unitCode': {
        if (!ctx.unitCode) throw new RenderError('Kode unit tidak tersedia')
        parts.push({ componentType: 'unitCode', source: `kode unit ${ctx.unitCode}`, value: ctx.unitCode })
        break
      }
      case 'committeeCode': {
        if (!ctx.committeeCode) throw new RenderError('Surat reguler tidak memiliki kode kepanitiaan')
        parts.push({ componentType: 'committeeCode', source: `kode panitia ${ctx.committeeCode}`, value: ctx.committeeCode })
        break
      }
      case 'letterDate': {
        if (!ctx.letterDate) throw new RenderError('Tanggal surat belum diisi')
        parts.push({ componentType: 'letterDate', source: `tanggal surat ${ctx.letterDate.toISOString().slice(0, 10)}`, value: formatDate(ctx.letterDate, c.format) })
        break
      }
      case 'issueDate': {
        if (!ctx.issueDate) throw new RenderError('Waktu penerbitan belum tersedia')
        parts.push({ componentType: 'issueDate', source: 'waktu penerbitan', value: formatDate(ctx.issueDate, c.format) })
        break
      }
    }
  }
  return { text: parts.map(p => p.value).join(dsl.separator), parts }
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderError'
  }
}

/** Daftar field input yang dibutuhkan DSL untuk membangun form dinamis. */
export function requiredInputs(dsl: NumberingDSL): string[] {
  const out = new Set<string>()
  for (const c of dsl.components) {
    if (c.type === 'direction') out.add('direction')
    if (c.type === 'letterTypeCode') out.add('letterTypeId')
    if (c.type === 'letterDate') out.add('letterDate')
  }
  return [...out]
}
