import { describe, expect, it } from "vitest";
import { QueueService } from "../src/core/queue/QueueService.js";
import type { QueuePlayer, Role } from "../src/core/models/types.js";
import { ROLES } from "../src/core/models/types.js";

describe("QueueService", () => {
  it("emits match players when the queue reaches 10 with 2 per role", () => {
    const queue = new QueueService();
    const events: string[] = [];
    queue.on("matchReady", ({ queueId }) => events.push(queueId));

    let lastMatchCount = 0;
    for (const [roleIndex, role] of ROLES.entries()) {
      for (let slot = 0; slot < 2; slot += 1) {
        const id = roleIndex * 2 + slot;
        const result = queue.join("channel-1", {
          guildId: "guild-1",
          channelId: "channel-1",
          userId: `user-${id}`,
          platform: "discord",
          platformUserId: `discord-${id}`,
          displayName: `Player ${id}`,
          role: role as Role,
        });
        lastMatchCount = result.matchPlayers?.length ?? 0;
      }
    }

    expect(events).toEqual(["channel-1"]);
    expect(lastMatchCount).toBe(10);
  });

  it("keeps extra players waiting in the same role", () => {
    const queue = new QueueService();
    for (let id = 0; id < 2; id += 1) {
      queue.join("channel-1", {
        guildId: "guild-1",
        channelId: "channel-1",
        userId: `user-${id}`,
        platform: "discord",
        platformUserId: `discord-${id}`,
        displayName: `Player ${id}`,
        role: "TOP",
      });
    }

    const result = queue.join("channel-1", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-3",
      platform: "discord",
      platformUserId: "discord-3",
      displayName: "Player 3",
      role: "TOP",
    });

    expect(result.status).toBe("joined");
    expect(result.snapshot.totalPlayers).toBe(3);
    expect(result.snapshot.roles.TOP).toHaveLength(3);
    expect(result.snapshot.roles.TOP.map((player) => player.userId)).toEqual([
      "user-0",
      "user-1",
      "user-3",
    ]);
  });

  it("does not replace older visible slots when a third player joins the same role", () => {
    const queue = new QueueService();
    const players = [
      { id: "adc-1", joinedAt: "2026-01-01T00:00:00.000Z" },
      { id: "adc-2", joinedAt: "2026-01-01T00:01:00.000Z" },
      { id: "adc-3", joinedAt: "2026-01-01T00:02:00.000Z" },
    ];

    let adcOrder: string[] = [];

    for (const player of players) {
      const result = queue.join("channel-1", {
        guildId: "guild-1",
        channelId: "channel-1",
        userId: player.id,
        platform: "discord",
        platformUserId: player.id,
        displayName: player.id,
        role: "ADC",
        joinedAt: new Date(player.joinedAt),
      });
      adcOrder = result.snapshot.roles.ADC.map((entry) => entry.userId);
    }

    const snapshot = queue.snapshot("channel-1");

    expect(adcOrder).toEqual(["adc-1", "adc-2", "adc-3"]);
    expect(snapshot.roles.ADC.slice(0, 2).map((player) => player.userId)).toEqual(["adc-1", "adc-2"]);
    expect(snapshot.roles.ADC.slice(2).map((player) => player.userId)).toEqual(["adc-3"]);
  });

  it("updates a user's role instead of duplicating the same user in one queue", () => {
    const queue = new QueueService();
    const first = queue.join("channel-1", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      platform: "discord",
      platformUserId: "discord-1",
      displayName: "Player 1",
      role: "TOP",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const second = queue.join("channel-1", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      platform: "discord",
      platformUserId: "discord-1",
      displayName: "Player 1",
      role: "JGL",
      joinedAt: new Date("2026-01-01T00:01:00.000Z"),
    });

    expect(first.status).toBe("joined");
    expect(second.status).toBe("updated");
    expect(second.snapshot.totalPlayers).toBe(1);
    expect(second.snapshot.roles.TOP).toHaveLength(0);
    expect(second.snapshot.roles.JGL).toHaveLength(1);
    expect(second.snapshot.roles.JGL[0]?.joinedAt.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("moves a role switcher behind existing players in the target role", () => {
    const queue = new QueueService();
    queue.join("channel-1", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "mid-old",
      platform: "discord",
      platformUserId: "mid-old",
      displayName: "Mid Old",
      role: "MID",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    for (const [index, userId] of ["adc-1", "adc-2"].entries()) {
      queue.join("channel-1", {
        guildId: "guild-1",
        channelId: "channel-1",
        userId,
        platform: "discord",
        platformUserId: userId,
        displayName: userId,
        role: "ADC",
        joinedAt: new Date(`2026-01-01T00:0${index + 1}:00.000Z`),
      });
    }

    const result = queue.join("channel-1", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "mid-old",
      platform: "discord",
      platformUserId: "mid-old",
      displayName: "Mid Old",
      role: "ADC",
      joinedAt: new Date("2026-01-01T00:03:00.000Z"),
    });

    expect(result.status).toBe("updated");
    expect(result.snapshot.roles.MID).toHaveLength(0);
    expect(result.snapshot.roles.ADC.map((player) => player.userId)).toEqual([
      "adc-1",
      "adc-2",
      "mid-old",
    ]);
  });

  it("deduplicates stale loaded queue entries before counting players", () => {
    const queue = new QueueService();
    const basePlayer = {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      platform: "discord" as const,
      platformUserId: "discord-1",
      displayName: "Player 1",
      duoUserId: null,
      readyCheckId: null,
    };
    const loadedPlayers: QueuePlayer[] = [
      {
        ...basePlayer,
        role: "TOP",
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        ...basePlayer,
        role: "JGL",
        joinedAt: new Date("2026-01-01T00:01:00.000Z"),
      },
    ];

    queue.loadQueues(loadedPlayers);
    const snapshot = queue.snapshot("channel-1");

    expect(snapshot.totalPlayers).toBe(1);
    expect(snapshot.roles.TOP).toHaveLength(0);
    expect(snapshot.roles.JGL).toHaveLength(1);
  });

  it("selects only 10 players for a match when a role has extras", () => {
    const queue = new QueueService();
    const roles: Role[] = ["TOP", "TOP", "TOP", "JGL", "JGL", "MID", "MID", "ADC", "ADC", "SUP", "SUP"];
    let matchPlayers: string[] = [];

    roles.forEach((role, id) => {
      const result = queue.join("channel-1", {
        guildId: "guild-1",
        channelId: "channel-1",
        userId: `user-${id}`,
        platform: "discord",
        platformUserId: `discord-${id}`,
        displayName: `Player ${id}`,
        role,
      });
      matchPlayers = result.matchPlayers?.map((player) => player.userId) ?? matchPlayers;
    });

    expect(matchPlayers).toHaveLength(10);
    expect(matchPlayers).not.toContain("user-2");
  });

  it("joins a duo atomically and keeps the duo link in the snapshot", () => {
    const queue = new QueueService();
    const result = queue.joinGroup("channel-1", [
      {
        guildId: "guild-1",
        channelId: "channel-1",
        userId: "user-1",
        platform: "discord",
        platformUserId: "discord-1",
        displayName: "Player 1",
        role: "TOP",
        duoUserId: "user-2",
      },
      {
        guildId: "guild-1",
        channelId: "channel-1",
        userId: "user-2",
        platform: "discord",
        platformUserId: "discord-2",
        displayName: "Player 2",
        role: "JGL",
        duoUserId: "user-1",
      },
    ]);

    expect(result.status).toBe("joined");
    expect(result.snapshot.totalPlayers).toBe(2);
    expect(result.snapshot.roles.TOP[0]?.duoUserId).toBe("user-2");
    expect(result.snapshot.roles.JGL[0]?.duoUserId).toBe("user-1");
  });

  it("marks a ready-check across every queue entry for the same guild user", () => {
    const queue = new QueueService();
    queue.join("channel-1", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      platform: "discord",
      platformUserId: "discord-1",
      displayName: "Player 1",
      role: "TOP",
    });
    queue.join("channel-2", {
      guildId: "guild-1",
      channelId: "channel-2",
      userId: "user-1",
      platform: "discord",
      platformUserId: "discord-1",
      displayName: "Player 1",
      role: "MID",
    });
    queue.join("channel-3", {
      guildId: "guild-2",
      channelId: "channel-3",
      userId: "user-1",
      platform: "discord",
      platformUserId: "discord-1",
      displayName: "Player 1",
      role: "ADC",
    });

    queue.markReadyCheckEverywhereInGuild("guild-1", ["user-1"], "ready-1");

    expect(queue.hasActiveReadyCheck("user-1", "guild-1")).toBe(true);
    expect(queue.snapshot("channel-1").totalPlayers).toBe(0);
    expect(queue.snapshot("channel-2").totalPlayers).toBe(0);
    expect(queue.snapshot("channel-3").totalPlayers).toBe(1);
  });
});
