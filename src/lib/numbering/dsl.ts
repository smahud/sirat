// Numbering DSL — JSON schema tervalidasi, tanpa eval/executable code.
// Blueprint 16.2: komponen literal, sequence, field enum/text tervalidasi,
// unit/committee code, date formatter, mapping lookup. Rule terbatas.
import { z } from 'zod'
import { DIRECTIONS, DATE_FORMATS, SEPARATORS } from '@/lib/constants'

const literalComp = z.object({
  type: z.literal('literal'),
  value: z.string().min(1).max(32),
})

const sequenceComp = z.object({
  type: z.literal('sequence'),
  padding: z.number().int().min(1).max(10),
})

const directionComp = z.object({
  type: z.literal('direction'),
  mapping: z.record(z.enum(DIRECTIONS), z.string().min(1).max(16)),
})

const letterTypeCodeComp = z.object({
  type: z.literal('letterTypeCode'),
})

const unitCodeComp = z.object({ type: z.literal('unitCode') })
const committeeCodeComp = z.object({ type: z.literal('committeeCode') })

const dateComp = z.object({
  type: z.enum(['letterDate', 'issueDate']),
  format: z.enum(DATE_FORMATS),
})

export const componentSchema = z.discriminatedUnion('type', [
  literalComp, sequenceComp, directionComp, letterTypeCodeComp,
  unitCodeComp, committeeCodeComp, dateComp,
])
export type DSLComponent = z.infer<typeof componentSchema>

export const dslSchema = z.object({
  version: z.literal(1),
  separator: z.enum(SEPARATORS),
  components: z.array(componentSchema).min(1),
})
export type NumberingDSL = z.infer<typeof dslSchema>

/** Preset workbook YAPSI (Blueprint baseline 1.1):
 *  [SEQ:3]/[DIRECTION_CODE]/[LETTER_TYPE_CODE]/YAPSI-DS/[MONTH_ROMAN]/[YEAR4]
 *  Internal→A, Eksternal→B; bulan/tahun dari tanggal surat. */
export function presetYapsiDsl(): NumberingDSL {
  return {
    version: 1,
    separator: '/',
    components: [
      { type: 'sequence', padding: 3 },
      { type: 'direction', mapping: { INTERNAL: 'A', EXTERNAL: 'B' } },
      { type: 'letterTypeCode' },
      { type: 'literal', value: 'YAPSI-DS' },
      { type: 'letterDate', format: 'MONTH_ROMAN' },
      { type: 'letterDate', format: 'YEAR_4' },
    ],
  }
}

export function parseDsl(json: string): NumberingDSL {
  return dslSchema.parse(JSON.parse(json))
}
