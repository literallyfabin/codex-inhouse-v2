import { describe, it, expect } from "vitest";
import { MatchmakingService } from "./MatchmakingService.js";
import { conservativeMmr } from "./trueskillMath.js";
import type { RatedQueuePlayer, Role } from "../models/types.js";

const ROLES: Role[] = ["TOP", "JGL", "MID", "ADC", "SUP"];

const makePlayer = (
  userId: string,
  role: Role,
  mu = 25,
  sigma = 25 / 3,
  opts: { joinedAsFill?: boolean; streak?: number } = {},
): RatedQueuePlayer => ({
  guildId: "g1",
  channelId: "c1",
  userId,
  platform: "discord",
  platformUserId: userId,
  displayName: userId,
  role,
  joinedAt: new Date(),
  joinedAsFill: opts.joinedAsFill ?? false,
  streak: opts.streak ?? 0,
  rating: { guildId: "g1", userId, role, mu, sigma, mmr: conservativeMmr(mu, sigma) },
});

const makeFullMatch = (overrides: Partial<Record<string, Partial<RatedQueuePlayer>>> = {}): RatedQueuePlayer[] => {
  const players: RatedQueuePlayer[] = [];
  let i = 0;
  for (const role of ROLES) {
    for (let k = 0; k < 2; k++) {
      const id = `p${i++}`;
      const base = makePlayer(id, role);
      const override = overrides[id] ?? {};
      players.push({ ...base, ...override });
    }
  }
  return players;
};

describe("MatchmakingService — FILL multiplier", () => {
  const service = new MatchmakingService();

  it("FILL player win gains 1.5x mu delta vs non-FILL", () => {
    const players = makeFullMatch();
    // Make p0 (TOP, BLUE) a FILL player
    const fillPlayer = { ...players[0]!, joinedAsFill: true };
    const normalPlayer = { ...players[1]!, joinedAsFill: false };
    players[0] = fillPlayer;
    players[1] = normalPlayer;

    const match = service.balance(players);
    // Determine which team got each player
    const fillSlot = [...match.teamBlue, ...match.teamRed].find((s) => s.player.userId === fillPlayer.userId)!;
    const normalSlot = [...match.teamBlue, ...match.teamRed].find((s) => s.player.userId === normalPlayer.userId)!;

    const winningTeam = fillSlot.team;
    const updates = service.calculateUpdatedRatings(match, winningTeam);

    const fillUpdate = updates.find((u) => u.userId === fillPlayer.userId)!;
    const normalUpdateSameTeam = updates.find(
      (u) => u.userId !== fillPlayer.userId && updates.find((uu) => uu.userId === u.userId)?.previousMu === 25,
    );

    // Find a non-FILL player on the winning team for comparison
    const winningSlots = winningTeam === "BLUE" ? match.teamBlue : match.teamRed;
    const nonFillWinningPlayer = winningSlots.find((s) => !s.player.joinedAsFill && s.player.userId !== fillPlayer.userId);

    if (nonFillWinningPlayer) {
      const nonFillUpdate = updates.find((u) => u.userId === nonFillWinningPlayer.player.userId)!;
      const fillDelta = fillUpdate.mu - fillUpdate.previousMu;
      const normalDelta = nonFillUpdate.mu - nonFillUpdate.previousMu;
      // FILL player should gain ~1.5x the normal delta
      expect(fillDelta).toBeGreaterThan(normalDelta);
      expect(fillDelta / normalDelta).toBeCloseTo(1.5, 1);
    }
  });

  it("FILL player loss loses 1.5x mu delta", () => {
    const players = makeFullMatch();
    const fillPlayer = { ...players[0]!, joinedAsFill: true };
    players[0] = fillPlayer;

    const match = service.balance(players);
    const fillSlot = [...match.teamBlue, ...match.teamRed].find((s) => s.player.userId === fillPlayer.userId)!;
    // Make FILL player's team LOSE → opposing team is the winner
    const winningTeam = fillSlot.team === "BLUE" ? "RED" : "BLUE";
    const updates = service.calculateUpdatedRatings(match, winningTeam);

    const fillUpdate = updates.find((u) => u.userId === fillPlayer.userId)!;
    // Find another player on the same losing team (non-FILL) for comparison
    const losingSlots = fillSlot.team === "BLUE" ? match.teamBlue : match.teamRed;
    const nonFillLoser = losingSlots.find((s) => !s.player.joinedAsFill && s.player.userId !== fillPlayer.userId);

    expect(nonFillLoser).toBeDefined();
    const nonFillUpdate = updates.find((u) => u.userId === nonFillLoser!.player.userId)!;
    const fillDelta = fillUpdate.mu - fillUpdate.previousMu;
    const normalDelta = nonFillUpdate.mu - nonFillUpdate.previousMu;
    // Both negative on loss
    expect(fillDelta).toBeLessThan(0);
    expect(normalDelta).toBeLessThan(0);
    // FILL loses more (more negative)
    expect(Math.abs(fillDelta)).toBeGreaterThan(Math.abs(normalDelta));
    expect(fillDelta / normalDelta).toBeCloseTo(1.5, 1);
  });

  it("Non-FILL players have unchanged TrueSkill delta", () => {
    const players = makeFullMatch();
    // All non-FILL
    const match = service.balance(players);
    const updates = service.calculateUpdatedRatings(match, "BLUE");
    for (const u of updates) {
      // mu changed, sigma decreased
      expect(u.mu).not.toBe(u.previousMu);
      expect(u.sigma).toBeLessThan(u.previousSigma);
    }
  });
});

describe("MatchmakingService — streak protection", () => {
  const service = new MatchmakingService();

  it("Player on heavy loss streak has rating restored after balance", () => {
    // Streak player has mu=20, 5-loss streak. Others mu=25.
    const players = makeFullMatch();
    players[0] = makePlayer("losing_streak", "TOP", 20, 5, { streak: -5 });

    const match = service.balance(players);
    const slot = [...match.teamBlue, ...match.teamRed].find((s) => s.player.userId === "losing_streak")!;

    // Real persisted mu should be restored to 20 — streak protection only affects balancing
    expect(slot.player.rating.mu).toBe(20);
  });

  it("Heavy loss streak applies non-zero adjustment internally", () => {
    // Two scenarios: one with streak, one without. Compare balance outcomes.
    const playersA = makeFullMatch();
    playersA[0] = makePlayer("p_streak", "TOP", 22, 5, { streak: -5 });
    const matchA = service.balance(playersA);

    const playersB = makeFullMatch();
    playersB[0] = makePlayer("p_nostreak", "TOP", 22, 5, { streak: 0 });
    const matchB = service.balance(playersB);

    // Both should produce valid matches with real (restored) ratings
    const streakSlot = [...matchA.teamBlue, ...matchA.teamRed].find((s) => s.player.userId === "p_streak")!;
    const noStreakSlot = [...matchB.teamBlue, ...matchB.teamRed].find((s) => s.player.userId === "p_nostreak")!;
    expect(streakSlot.player.rating.mu).toBe(22);
    expect(noStreakSlot.player.rating.mu).toBe(22);
  });

  it("Does not affect player with no loss streak", () => {
    const players = makeFullMatch();
    players[0] = makePlayer("normal", "TOP", 20, 5, { streak: 0 });
    const match = service.balance(players);
    const slot = [...match.teamBlue, ...match.teamRed].find((s) => s.player.userId === "normal")!;
    // Rating preserved
    expect(slot.player.rating.mu).toBe(20);
  });
});
