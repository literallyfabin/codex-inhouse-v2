/**
 * PDL gain/loss calculation.
 * Variable by match balance (the harder the upset, the bigger the swing).
 */

const BASE_PDL = 25;
const UPSET_SWING = 20;
const MIN_PDL_CHANGE = 10;
const MAX_PDL_CHANGE = 50;

export interface PdlCalcInput {
  /** Did this player's team win the match? */
  won: boolean;
  /** Pre-match expected winrate of THIS PLAYER'S TEAM (0..1, 0.5 = balanced). */
  expectedWinrate: number;
}

export interface PdlCalcResult {
  pdlDelta: number;
}

/**
 * Returns the signed PDL change to apply to the player.
 *
 * Examples (balanced match, expected=0.5):
 *   won  -> +25
 *   lost -> -25
 *
 * Examples (heavy favorite, expected=0.8):
 *   won  -> +29 (small bonus, expected win)
 *   lost -> -41 (big penalty, threw the lead)
 *
 * Examples (underdog, expected=0.2):
 *   won  -> +41 (huge bonus, upset)
 *   lost -> -29 (small penalty, expected loss)
 */
export const computePdlDelta = (input: PdlCalcInput): PdlCalcResult => {
  const expected = clamp(input.expectedWinrate, 0, 1);

  let raw: number;
  if (input.won) {
    raw = BASE_PDL + UPSET_SWING * (1 - expected);
  } else {
    raw = -(BASE_PDL + UPSET_SWING * expected);
  }

  const rounded = Math.round(raw);
  const signed = input.won ? Math.max(MIN_PDL_CHANGE, Math.min(MAX_PDL_CHANGE, rounded))
                           : Math.min(-MIN_PDL_CHANGE, Math.max(-MAX_PDL_CHANGE, rounded));

  return { pdlDelta: signed };
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
