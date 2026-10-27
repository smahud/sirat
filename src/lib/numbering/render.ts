// Render engine nomor — murni, deterministik, tanpa side effect.
// v1.6: komponen 'direction' diganti 'fieldRef' → resolusi via konfigurasi
// Dropdown (operator memilih LABEL, nomor memakai KODE terpetakan).
import { NumberingDSL, DSLComponent, DropdownField, findField } from './dsl'
import { romanMonth, monthNameId, padSequence, DateFormat } from '@/lib/constants'

export interface RenderContext {
  seq?: number              // hanya saat issue nyata; preview boleh undefined
  fieldValues?: Record<string, string>  // fieldKey → optionId (pilihan operator)
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

/** Opsi terpilih sebuah field: nilai eksplisit → default → null. */
export function resolveOption(
  field: DropdownField,
  values: Record<string, string> | undefined,
): { id: string; label: string; code: string } | null {
  const v = values?.[field.key] ?? field.defaultOptionId ?? null
  if (!v) return null
  const opt = field.options.find(o => o.id === v)
  if (!opt) return null
  return { id: opt.id, label: opt.label, code: opt.code }
}

/**
 * Merender nomor dari DSL dan konteks.
 * seq undefined → placeholder '###' sesuai padding (PREVIEW, bukan reservasi).
 * Komponen yang sumbernya kosong → error eksplisit (bukan string kosong diam-diam).
 * fieldRef: operator melihat label, nomor memakai kode (F.3).
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
      case 'fieldRef': {
        const field = findField(dsl, c.field)
        if (!field) throw new RenderError(`Komponen nomor merujuk field yang tidak didefinisikan: "${c.field}"`)
        const opt = resolveOption(field, ctx.fieldValues)
        if (!opt) throw new RenderError(`"${field.label}" belum dipilih`)
        parts.push({
          componentType: 'fieldRef',
          source: `${field.label}: ${opt.label} → ${opt.code}`,
          value: opt.code,
        })
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

// ===== Spesifikasi formulir dinamis untuk operator =====

export interface FormFieldOptionSpec {
  id: string
  label: string
}
export interface FormFieldSpec {
  key: string
  label: string
  placeholder: string | null
  helperText: string | null
  required: boolean
  inNumber: boolean          // true bila kode ikut nomor (ada fieldRef)
  defaultOptionId: string | null
  options: FormFieldOptionSpec[]
}

/**
 * Daftar field formulir yang harus dirender operator (urut 'order', stabil
 * berdasar posisi array). Hanya opsi AKTIF yang ditawarkan (E.5).
 */
export function formFields(dsl: NumberingDSL): FormFieldSpec[] {
  const inNumberKeys = new Set(
    dsl.components.filter(c => c.type === 'fieldRef').map(c => (c as { field: string }).field),
  )
  return [...dsl.fields]
    .map((f, idx) => ({ f, idx }))
    .sort((a, b) => (a.f.order ?? a.idx) - (b.f.order ?? b.idx) || a.idx - b.idx)
    .map(({ f }) => ({
      key: f.key,
      label: f.label,
      placeholder: f.placeholder ?? null,
      helperText: f.helperText ?? null,
      required: f.required,
      inNumber: inNumberKeys.has(f.key),
      defaultOptionId: f.defaultOptionId ?? null,
      options: f.options.filter(o => o.active).map(o => ({ id: o.id, label: o.label })),
    }))
}

/**
 * Daftar input yang dibutuhkan DSL sebelum nomor dapat diterbitkan.
 * Field wajib tanpa default harus diisi operator (E.4); field dalam nomor
 * selalu wajib tersedia nilai saat render (default dipakai bila ada).
 */
export function requiredInputs(dsl: NumberingDSL): string[] {
  const out = new Set<string>()
  for (const c of dsl.components) {
    if (c.type === 'letterTypeCode') out.add('letterTypeId')
    if (c.type === 'letterDate') out.add('letterDate')
    if (c.type === 'fieldRef') {
      const f = findField(dsl, c.field)
      if (f && !f.defaultOptionId) out.add(`field:${f.key}`)
    }
  }
  // Field wajib meskipun hanya metadata (tidak ikut nomor) tetap harus terisi
  for (const f of dsl.fields) {
    if (f.required && !f.defaultOptionId) out.add(`field:${f.key}`)
  }
  return [...out]
}
