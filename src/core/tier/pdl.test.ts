import { describe, expect, it } from "vitest";
import { computePdlDelta } from "./pdl.js";

describe("computePdlDelta", () => {
  describe("balanced match (expected=0.5)", () => {
    it("win with no streak = +35", () => {
      expect(computePdlDelta({ won: true, expectedWinrate: 0.5, currentStreak: 0 }).pdlDelta).toBe(35);
    });

    it("loss with no streak = -35", () => {
      expect(computePdlDelta({ won: false, expectedWinrate: 0.5, currentStreak: 0 }).pdlDelta).toBe(-35);
    });
  });

  describe("streak win bonus", () => {
    it("win on 1-win streak = +35 + 3 = +38", () => {
      expect(computePdlDelta({ won: true, expectedWinrate: 0.5, currentStreak: 1 }).pdlDelta).toBe(38);
    });

    it("win on 3-win streak = +35 + 9 = +44", () => {
      expect(computePdlDelta({ won: true, expectedWinrate: 0.5, currentStreak: 3 }).pdlDelta).toBe(44);
    });

    it("win on 5-win streak = +35 + 15 = +50", () => {
      expect(computePdlDelta({ won: true, expectedWinrate: 0.5, currentStreak: 5 }).pdlDelta).toBe(50);
    });

    it("win on 7-win streak still capped = +35 + 15 = +50", () => {
      expect(computePdlDelta({ won: true, expectedWinrate: 0.5, currentStreak: 7 }).pdlDelta).toBe(50);
    });

    it("loss does NOT get streak bonus from win streak", () => {
      expect(computePdlDelta({ won: false, expectedWinrate: 0.5, currentStreak: 5 }).pdlDelta).toBe(-35);
    });
  });

  describe("anti-tilt on loss streak", () => {
    it("loss after 1 loss = -35 (no anti-tilt yet)", () => {
      expect(computePdlDelta({ won: false, expectedWinrate: 0.5, currentStreak: -1 }).pdlDelta).toBe(-35);
    });

    it("loss after 2 losses = -35 (still no anti-tilt)", () => {
      expect(computePdlDelta({ won: false, expectedWinrate: 0.5, currentStreak: -2 }).pdlDelta).toBe(-35);
    });

    it("loss after 3 losses = -35 * 0.7 = -24.5 -> -24 (rounded)", () => {
      expect(computePdlDelta({ won: false, expectedWinrate: 0.5, currentStreak: -3 }).pdlDelta).toBe(-24);
    });

    it("loss after 5 losses = -25 (anti-tilt does not compound)", () => {
      expect(computePdlDelta({ won: false, expectedWinrate: 0.5, currentStreak: -5 }).pdlDelta).toBe(-24);
    });

    it("win on loss streak does NOT get anti-tilt", () => {
      expect(computePdlDelta({ won: true, expectedWinrate: 0.5, currentStreak: -5 }).pdlDelta).toBe(35);
    });
  });

  describe("upset balance", () => {
    it("underdog win (expected=0.2) = +41", () => {
      expect(computePdlDelta({ won: true, expectedWinrate: 0.2, currentStreak: 0 }).pdlDelta).toBe(41);
    });

    it("favorite loss (expected=0.8) = -41", () => {
      expect(computePdlDelta({ won: false, expectedWinrate: 0.8, currentStreak: 0 }).pdlDelta).toBe(-41);
    });
  });

  describe("clamps", () => {
    it("max win clamp at +60", () => {
      // expected=0, 10-streak, won
      expect(computePdlDelta({ won: true, expectedWinrate: 0, currentStreak: 10 }).pdlDelta).toBe(60);
    });

    it("min loss clamp at -60", () => {
      // expected=1, won=false
      expect(computePdlDelta({ won: false, expectedWinrate: 1, currentStreak: 0 }).pdlDelta).toBe(-45);
    });
  });
});
