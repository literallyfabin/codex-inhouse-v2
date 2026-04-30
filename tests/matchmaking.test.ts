import { describe, expect, it } from "vitest";
import { MatchmakingService } from "../src/core/matchmaking/MatchmakingService.js";
import type { RatedQueuePlayer, Role } from "../src/core/models/types.js";
import { ROLES } from "../src/core/models/types.js";

const player = (id: number, role: Role, mu: number): RatedQueuePlayer => ({
  guildId: "guild-1",
  channelId: "channel-1",
  userId: `user-${id}`,
  platform: "discord",
  platformUserId: `discord-${id}`,
  displayName: `Player ${id}`,
  role,
  joinedAt: new Date(id),
  rating: {
    guildId: "guild-1",
    userId: `user-${id}`,
    role,
    mu,
    sigma: 25 / 3,
    mmr: 500,
  },
});

describe("MatchmakingService", () => {
  it("balances exactly two players per role by the smallest team mu difference", () => {
    const players = ROLES.flatMap((role, roleIndex) => [
      player(roleIndex * 2, role, 30),
      player(roleIndex * 2 + 1, role, 20),
    ]);

    const match = new MatchmakingService().balance(players);

    expect(match.teamBlue).toHaveLength(5);
    expect(match.teamRed).toHaveLength(5);
    expect(match.muDifference).toBe(10);
  });

  it("rejects incomplete queues", () => {
    const service = new MatchmakingService();
    expect(() => service.balance([])).toThrow("exactly 10 players");
  });

  it("keeps duo players on the same team", () => {
    const players = ROLES.flatMap((role, roleIndex) => [
      player(roleIndex * 2, role, 25),
      player(roleIndex * 2 + 1, role, 25),
    ]);
    players[0] = { ...players[0]!, duoUserId: "user-2" };
    players[2] = { ...players[2]!, duoUserId: "user-0" };

    const match = new MatchmakingService().balance(players);
    const teamByUserId = new Map(
      [...match.teamBlue, ...match.teamRed].map((slot) => [slot.player.userId, slot.team]),
    );

    expect(teamByUserId.get("user-0")).toBe(teamByUserId.get("user-2"));
  });

  it("updates ratings after a result", () => {
    const service = new MatchmakingService();
    const players = ROLES.flatMap((role, roleIndex) => [
      player(roleIndex * 2, role, 25),
      player(roleIndex * 2 + 1, role, 25),
    ]);

    const match = service.balance(players);
    const updates = service.calculateUpdatedRatings(match, "BLUE");
    const blueUpdates = updates.filter((update) =>
      match.teamBlue.some((slot) => slot.player.userId === update.userId),
    );

    expect(updates).toHaveLength(10);
    expect(blueUpdates.every((update) => update.mu > update.previousMu)).toBe(true);
  });
});
