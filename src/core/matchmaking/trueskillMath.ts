import type { RatedQueuePlayer, TeamSlot } from "../models/types.js";

const DEFAULT_BETA = 25 / 6;

const erf = (x: number): number => {
  const sign = Math.sign(x) || 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-absX * absX));

  return sign * y;
};

export const normalCdf = (value: number): number => 0.5 * (1 + erf(value / Math.SQRT2));

export const expectedBlueWinrate = (
  bluePlayers: readonly RatedQueuePlayer[],
  redPlayers: readonly RatedQueuePlayer[],
): number => {
  const deltaMu =
    bluePlayers.reduce((sum, player) => sum + player.rating.mu, 0) -
    redPlayers.reduce((sum, player) => sum + player.rating.mu, 0);

  const sigmaSquares = [...bluePlayers, ...redPlayers].reduce(
    (sum, player) => sum + player.rating.sigma ** 2,
    0,
  );
  const playerCount = bluePlayers.length + redPlayers.length;
  const denominator = Math.sqrt(playerCount * DEFAULT_BETA ** 2 + sigmaSquares);

  return normalCdf(deltaMu / denominator);
};

export const teamMu = (slots: readonly TeamSlot[]): number =>
  slots.reduce((sum, slot) => sum + slot.player.rating.mu, 0);

export const conservativeMmr = (mu: number, sigma: number): number => 20 * (mu - 3 * sigma + 25);
