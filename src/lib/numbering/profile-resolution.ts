import type { Prisma } from '@prisma/client'

/**
 * Resolusi profil penomoran (v1.8 — multi-profil per konteks).
 *
 * Satu unit / kepanitiaan boleh memiliki BEBERAPA profil, masing-masing dengan
 * paling banyak satu versi ACTIVE. Kandidat diurutkan deterministik:
 *   1. Profil khusus kepanitiaan (bila konteks surat kepanitiaan) — tertua dulu
 *   2. Profil unit (committeeId null) — tertua dulu
 * Default (tanpa pilihan eksplisit) = kandidat pertama → kompatibel penuh
 * dengan resolusi lama (profil panitia didahulukan, lalu profil unit).
 */

export interface ActiveProfileCandidate {
  /** ID NumberingProfile — dipilih operator / dirujuk Letter.numberingProfileId */
  profileId: string
  /** ID NumberingProfileVersion berstatus ACTIVE (versi termuda yang aktif) */
  versionId: string
  /** Nomor versi (utk snapshot penerbitan) */
  version: number
  /** Nama profil (utk selector UI) */
  name: string
  /** true = profil khusus kepanitiaan; false = profil unit */
  committeeProfile: boolean
  /** Namespace counter yang dicap aktivasi versi ini (deterministik) */
  namespaceId: string | null
  /** DSL JSON versi aktif */
  dsl: string
}

type DbLike = Prisma.TransactionClient

/** Ambil semua profil ber-versi-ACTIVE untuk konteks (unit / unit+kepanitiaan). */
export async function activeProfileCandidates(
  db: DbLike,
  unitId: string,
  committeeId: string | null,
): Promise<ActiveProfileCandidate[]> {
  // Versi aktif profil KEPANITIAAN (hanya bila konteks kepanitiaan)
  const committeeVersions = committeeId
    ? await db.numberingProfileVersion.findMany({
        where: { status: 'ACTIVE', profile: { committeeId } },
        orderBy: [{ profile: { createdAt: 'asc' } }, { version: 'desc' }],
        include: { profile: { select: { id: true, name: true, createdAt: true } } },
      })
    : []
  // Versi aktif profil UNIT (committeeId null)
  const unitVersions = await db.numberingProfileVersion.findMany({
    where: { status: 'ACTIVE', profile: { ownerId: unitId, committeeId: null } },
    orderBy: [{ profile: { createdAt: 'asc' } }, { version: 'desc' }],
    include: { profile: { select: { id: true, name: true, createdAt: true } } },
  })

  // Satu profil hanya boleh membawa SATU versi aktif — kalau data legacy
  // melanggar (tidak seharusnya), ambil versi termuda per profil.
  // (findMany terurut profile asc lalu version desc → versi pertama per profil menang)
  const byProfile = new Map<string, ActiveProfileCandidate>()
  const push = (v: (typeof committeeVersions)[number], committeeProfile: boolean) => {
    if (byProfile.has(v.profile.id)) return
    byProfile.set(v.profile.id, {
      profileId: v.profile.id,
      versionId: v.id,
      version: v.version,
      name: v.profile.name,
      committeeProfile,
      namespaceId: v.namespaceId,
      dsl: v.dsl,
    })
  }
  for (const v of committeeVersions) push(v, true)
  for (const v of unitVersions) push(v, false)

  // Urutan: profil kepanitiaan dulu (sesuai resolusi lama), lalu profil unit
  return [
    ...[...byProfile.values()].filter(c => c.committeeProfile),
    ...[...byProfile.values()].filter(c => !c.committeeProfile),
  ]
}

/**
 * Resolusi versi aktif untuk PENERBITAN:
 * - Letter.numberingProfileId terisi → versi ACTIVE profil TERSEBUT
 *   (profil dipilih operator saat membuat draft; bila profilnya sudah tidak
 *   memiliki versi aktif → null, pemanggil memberi 409 yang jelas).
 * - null (surat lama / tanpa pilihan) → kandidat pertama (panitia → unit).
 */
export async function resolveActiveVersionForLetter(
  db: DbLike,
  letter: { issuingUnitId: string; committeeId: string | null; numberingProfileId: string | null },
): Promise<ActiveProfileCandidate | null> {
  if (letter.numberingProfileId) {
    const v = await db.numberingProfileVersion.findFirst({
      where: {
        status: 'ACTIVE',
        profile: {
          id: letter.numberingProfileId,
          // profil tidak bisa berpindah pemilik (PATCH hanya nama) — cek konteks
          // tetap dipertahankan demi defense in depth.
          ...(letter.committeeId
            ? { committeeId: letter.committeeId }
            : { ownerId: letter.issuingUnitId, committeeId: null }),
        },
      },
      orderBy: { version: 'desc' },
      include: { profile: { select: { id: true, name: true } } },
    })
    if (!v) return null
    return {
      profileId: v.profile.id,
      versionId: v.id,
      version: v.version,
      name: v.profile.name,
      committeeProfile: !!letter.committeeId,
      namespaceId: v.namespaceId,
      dsl: v.dsl,
    }
  }
  const candidates = await activeProfileCandidates(db, letter.issuingUnitId, letter.committeeId)
  return candidates[0] ?? null
}
