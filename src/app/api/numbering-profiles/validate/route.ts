import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, fail, handle, readJson, requirePermission } from '@/lib/api-helpers'
import { dslInputSchema, dslSchema } from '@/lib/numbering/dsl'
import { validateDslForActivation, exampleFieldValues } from '@/lib/numbering/validate'
import { renderNumber } from '@/lib/numbering/render'
import { resolveFieldValuesForPreview } from '@/lib/numbering/fields'

/** POST /api/numbering-profiles/validate — validasi + preview contoh render untuk builder. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const r = await requirePermission('profile.manage')
    if ('error' in r) return r.error

    const parsed = z.object({
      dsl: dslInputSchema,
      sample: z.object({
        seq: z.number().int().positive().default(1),
        letterTypeCode: z.string().default('SPR'),
        unitCode: z.string().default('YAPSI'),
        committeeCode: z.string().optional(),
        letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-01-15'),
        fieldValues: z.record(z.string(), z.string()).optional(), // contoh pilihan Dropdown
      }).prefault({}),
    }).safeParse(await readJson(req))
    if (!parsed.success) return fail(400, 'VALIDATION', 'Data tidak valid', { issues: parsed.error.issues })

    const dsl = dslSchema.parse(parsed.data.dsl)
    const { sample } = parsed.data
    const validation = validateDslForActivation(dsl)

    // Nilai contoh: pilihan eksplisit → default per field → opsi aktif pertama
    const resolved = resolveFieldValuesForPreview(dsl, sample.fieldValues ?? exampleFieldValues(dsl))
    const fieldValues = Object.fromEntries(Object.entries(resolved.values).map(([k, v]) => [k, v.optionId]))

    let preview: { text: string; parts: unknown[] } | null = null
    try {
      const rendered = renderNumber(dsl, {
        seq: sample.seq,
        fieldValues,
        letterTypeCode: sample.letterTypeCode,
        unitCode: sample.unitCode,
        committeeCode: sample.committeeCode,
        letterDate: new Date(`${sample.letterDate}T00:00:00.000Z`),
        issueDate: new Date(),
      })
      preview = { text: rendered.text, parts: rendered.parts }
    } catch (e) {
      preview = null
      validation.errors.push(`Contoh render gagal: ${(e as Error).message}`)
      validation.ok = false
    }

    return ok({ ...validation, preview })
  })
}
