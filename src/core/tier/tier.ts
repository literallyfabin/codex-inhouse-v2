/**
 * Tier ladder for ranked Season 2+.
 * PDL drives the visible ranking. Tier and division are derived from PDL.
 */

export const TIERS = [
  "BRONZE",
  "PRATA",
  "OURO",
  "PLATINA",
  "ESMERALDA",
  "DIAMANTE",
  "MESTRE",
  "GRAOMESTRE",
  "CHALLENGER",
] as const;

export type Tier = (typeof TIERS)[number];

/** 4=IV (lowest), 3=III, 2=II, 1=I (highest). Apex tiers use 0. */
export type Division = 0 | 1 | 2 | 3 | 4;

export interface TierPosition {
  tier: Tier;
  division: Division;
  pdl: number;
}

/** Display labels (PT-BR) for human-facing surfaces. */
export const TIER_LABEL: Record<Tier, string> = {
  BRONZE: "Bronze",
  PRATA: "Prata",
  OURO: "Ouro",
  PLATINA: "Platina",
  ESMERALDA: "Esmeralda",
  DIAMANTE: "Diamante",
  MESTRE: "Mestre",
  GRAOMESTRE: "Grao-Mestre",
  CHALLENGER: "Challenger",
};

export const DIVISION_LABEL: Record<Division, string> = {
  0: "",
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
};

/** Emoji names you upload as custom emojis in Discord. */
export const TIER_EMOJI_NAMES: Record<Tier, string> = {
  BRONZE: "BRONZE",
  PRATA: "PRATA",
  OURO: "OURO",
  PLATINA: "PLATINA",
  ESMERALDA: "ESMERALDA",
  DIAMANTE: "DIAMANTE",
  MESTRE: "MESTRE",
  GRAOMESTRE: "GRAOMESTRE",
  CHALLENGER: "CHALLENGER",
};

interface TierBand {
  tier: Exclude<Tier, "MESTRE" | "GRAOMESTRE" | "CHALLENGER">;
  /** Inclusive lower PDL. */
  min: number;
  /** Exclusive upper PDL. */
  max: number;
  /** PDL width per division (4 divisions per base tier). */
  divisionSize: number;
}

/**
 * Base tier ladder.
 * - Bronze..Esmeralda: 100 PDL per tier, 25 per division.
 * - Diamante: 300 PDL stretch (75 per division) before Mestre.
 */
const BASE_TIER_BANDS: TierBand[] = [
  { tier: "BRONZE",    min: 0,   max: 100, divisionSize: 25 },
  { tier: "PRATA",     min: 100, max: 200, divisionSize: 25 },
  { tier: "OURO",      min: 200, max: 300, divisionSize: 25 },
  { tier: "PLATINA",   min: 300, max: 400, divisionSize: 25 },
  { tier: "ESMERALDA", min: 400, max: 500, divisionSize: 25 },
  { tier: "DIAMANTE",  min: 500, max: 800, divisionSize: 75 },
];

/** Apex thresholds (no divisions). */
export const APEX_THRESHOLDS = {
  MESTRE: 800,
  GRAOMESTRE: 1100,
  CHALLENGER: 1400,
} as const;

/**
 * Pure PDL → (tier, division) classifier.
 * Does not consider top-N apex ordering; that is computed separately at display time.
 */
export const classifyByPdl = (pdl: number): { tier: Tier; division: Division } => {
  const safe = Math.max(0, Math.floor(pdl));

  if (safe >= APEX_THRESHOLDS.CHALLENGER) return { tier: "CHALLENGER", division: 0 };
  if (safe >= APEX_THRESHOLDS.GRAOMESTRE) return { tier: "GRAOMESTRE", division: 0 };
  if (safe >= APEX_THRESHOLDS.MESTRE)     return { tier: "MESTRE", division: 0 };

  for (const band of BASE_TIER_BANDS) {
    if (safe >= band.min && safe < band.max) {
      const offset = safe - band.min;
      const divIdx = Math.min(3, Math.floor(offset / band.divisionSize));
      // Map 0..3 to IV..I  (idx 0 -> division 4, idx 3 -> division 1).
      const division = (4 - divIdx) as Division;
      return { tier: band.tier, division };
    }
  }

  // Above all base bands but below MESTRE threshold (shouldn't happen if ranges align,
  // but defensive default: stay at Diamante I).
  return { tier: "DIAMANTE", division: 1 };
};

/** Human-readable string: "Bronze IV", "Mestre", "Diamante I". */
export const formatTier = (tier: Tier, division: Division): string => {
  if (division === 0) return TIER_LABEL[tier];
  return `${TIER_LABEL[tier]} ${DIVISION_LABEL[division]}`;
};

/** Returns an emoji string usable inline in Discord, or fallback `[Tier]` text. */
export const tierIcon = (
  tier: Tier,
  emojis?: Partial<Record<Tier, string>>,
): string => {
  return emojis?.[tier] ?? `[${TIER_LABEL[tier]}]`;
};

export const isTier = (value: string): value is Tier =>
  (TIERS as readonly string[]).includes(value);
