import { describe, it, expect, beforeEach } from "vitest";
import { QueueService } from "./QueueService.js";
import type { Role } from "../models/types.js";

const makeIdentity = (userId: string, role: Role | "FILL", joinedAt?: Date) => ({
  guildId: "g1",
  channelId: "c1",
  userId,
  platform: "discord" as const,
  platformUserId: userId,
  displayName: userId,
  role,
  joinedAt: joinedAt ?? new Date(),
});

describe("QueueService — FILL role", () => {
  let service: QueueService;
  const ROLES: Role[] = ["TOP", "JGL", "MID", "ADC", "SUP"];

  beforeEach(() => {
    service = new QueueService();
  });

  it("snapshot includes fillPlayers array", () => {
    service.join("c1", makeIdentity("u1", "FILL"));
    const snap = service.snapshot("c1");
    expect(snap.fillPlayers).toHaveLength(1);
    expect(snap.fillPlayers[0]!.userId).toBe("u1");
    expect(snap.totalPlayers).toBe(1);
  });

  it("FILL doesn't appear in roles record", () => {
    service.join("c1", makeIdentity("u1", "FILL"));
    const snap = service.snapshot("c1");
    for (const role of ROLES) {
      expect(snap.roles[role]).toHaveLength(0);
    }
  });

  it("9 role players + 1 FILL = match ready", () => {
    let i = 0;
    for (const role of ROLES) {
      service.join("c1", makeIdentity(`u${i++}`, role));
      service.join("c1", makeIdentity(`u${i++}`, role));
    }
    // Leave one to create gap
    service.leave("c1", "u9");
    const snap1 = service.snapshot("c1");
    expect(snap1.isReady).toBe(false);

    service.join("c1", makeIdentity("filler", "FILL"));
    const snap2 = service.snapshot("c1");
    expect(snap2.isReady).toBe(true);
  });

  it("FILL with both SUP missing fills SUP slots", () => {
    const roles: Role[] = ["TOP", "JGL", "MID", "ADC"];
    let i = 0;
    for (const role of roles) {
      service.join("c1", makeIdentity(`u${i++}`, role));
      service.join("c1", makeIdentity(`u${i++}`, role));
    }
    service.join("c1", makeIdentity("f1", "FILL"));
    service.join("c1", makeIdentity("f2", "FILL"));

    const snap = service.snapshot("c1");
    expect(snap.isReady).toBe(true);
    const match = service.findMatchPlayers("c1");
    expect(match).toBeDefined();
    expect(match!).toHaveLength(10);
    const supPlayers = match!.filter((p) => p.role === "SUP");
    expect(supPlayers).toHaveLength(2);
    // Both filled by FILL players
    const supIds = supPlayers.map((p) => p.userId).sort();
    expect(supIds).toEqual(["f1", "f2"]);
  });

  it("FILL never displaces existing role players (priority)", () => {
    // 2 TOP players already queued, 1 FILL joins later
    service.join("c1", makeIdentity("top1", "TOP", new Date(1)));
    service.join("c1", makeIdentity("top2", "TOP", new Date(2)));
    service.join("c1", makeIdentity("filler", "FILL", new Date(3)));

    // Add remaining roles to allow match
    let t = 10;
    for (const role of ["JGL", "MID", "ADC", "SUP"] as Role[]) {
      service.join("c1", makeIdentity(`${role}_1`, role, new Date(t++)));
      service.join("c1", makeIdentity(`${role}_2`, role, new Date(t++)));
    }

    // Force scarcity: remove one MID
    service.leave("c1", "MID_2");
    // Now FILL should fill MID
    const match = service.findMatchPlayers("c1");
    expect(match).toBeDefined();
    const midPlayers = match!.filter((p) => p.role === "MID");
    expect(midPlayers).toHaveLength(2);
    // Original TOP players still in TOP
    const topPlayers = match!.filter((p) => p.role === "TOP");
    expect(topPlayers.map((p) => p.userId).sort()).toEqual(["top1", "top2"]);
  });

  it("Player joining as FILL then specific role swaps correctly", () => {
    service.join("c1", makeIdentity("u1", "FILL"));
    let snap = service.snapshot("c1");
    expect(snap.fillPlayers).toHaveLength(1);

    service.join("c1", makeIdentity("u1", "TOP"));
    snap = service.snapshot("c1");
    expect(snap.fillPlayers).toHaveLength(0);
    expect(snap.roles.TOP).toHaveLength(1);
  });

  it("totalPlayers counts FILL players", () => {
    service.join("c1", makeIdentity("u1", "FILL"));
    service.join("c1", makeIdentity("u2", "TOP"));
    expect(service.snapshot("c1").totalPlayers).toBe(2);
  });
});
