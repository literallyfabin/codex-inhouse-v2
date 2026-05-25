/**
 * PDL gain/loss calculation.
 * Variable by match balance + current win/loss streak.
 */

const BASE_PDL = 25;
const UPSET_SWING = 20;
const STREAK_STEP = 3;
const STREAK_BONUS_CAP = 5; // max +15 PDL per win (5 wins * 3)
const ANTI_TILT_THRESHOLD = 3; // 3+ losses in a row triggers anti-tilt
const ANTI_TILT_MULTIPLIER = 0.7; // loss damage cut to 70%
const MIN_PDL_CHANGE = 10;
const MAX_PDL_CHANGE = 60;

export interface PdlCalcInput {
  /** Did this player's team win the match? */
  won: boolean;
  /** Pre-match expected winrate of THIS PLAYER'S TEAM (0..1, 0.5 = balanced). */
  expectedWinrate: number;
  /**
   * Streak BEFORE this match. Positive = consecutive wins, negative = consecutive losses,
   * 0 = no streak (first match or mixed last result).
   */
  currentStreak: number;
}

export interface PdlCalcResult {
  pdlDelta: number;
}

/**
 * Returns the signed PDL change to apply to the player.
 *
 * Balanced match (expected=0.5), no streak:
 *   won  -> +35
 *   lost -> -35
 *
 * Win on a 3-game win streak: +35 + 3*3 = +44
 * Win on a 5-game win streak: +35 + 5*3 = +50 (cap)
 * Win on a 7-game win streak: +35 + 5*3 = +50 (capped at 5)
 *
 * Loss after 3 losses (anti-tilt): -35 * 0.7 = -25
 * Loss after 5 losses: still -25 (cap doesn't compound, just 0.7x)
 *
 * Heavy favorite (expected=0.8):
 *   won  -> +29 (small bonus, expected win)
 *   lost -> -41 (big penalty, threw the lead)
 *
 * Underdog (expected=0.2):
 *   won  -> +41 (huge bonus, upset)
 *   lost -> -29 (small penalty, expected loss)
 */
export const computePdlDelta = (input: PdlCalcInput): PdlCalcResult => {
  const expected = clamp(input.expectedWinrate, 0, 1);
  const streak = input.currentStreak;

  let raw: number;
  if (input.won) {
    raw = BASE_PDL + UPSET_SWING * (1 - expected);
    // Streak bonus only when player is on a winning streak.
    if (streak > 0) {
      raw += Math.min(streak, STREAK_BONUS_CAP) * STREAK_STEP;
    }
  } else {
    raw = -(BASE_PDL + UPSET_SWING * expected);
    // Anti-tilt: after N consecutive losses, reduce damage.
    if (streak <= -ANTI_TILT_THRESHOLD) {
      raw *= ANTI_TILT_MULTIPLIER;
    }
  }

  const rounded = Math.round(raw);
  const signed = input.won
    ? Math.max(MIN_PDL_CHANGE, Math.min(MAX_PDL_CHANGE, rounded))
    : Math.min(-MIN_PDL_CHANGE, Math.max(-MAX_PDL_CHANGE, rounded));

  return { pdlDelta: signed };
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
