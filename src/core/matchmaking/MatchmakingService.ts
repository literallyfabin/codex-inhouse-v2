import { Rating, rate } from "ts-trueskill";
import type {
  BalancedMatch,
  PlayerRating,
  RatedQueuePlayer,
  Role,
  Team,
  TeamSlot,
  WinningTeam,
} from "../models/types.js";
import { ROLES } from "../models/types.js";
import { conservativeMmr, expectedBlueWinrate, teamMu } from "./trueskillMath.js";

export interface UpdatedPlayerRating extends PlayerRating {
  previousMu: number;
  previousSigma: number;
}

const assertCompleteRoleSet = (players: readonly RatedQueuePlayer[]): Map<Role, RatedQueuePlayer[]> => {
  if (players.length !== 10) {
    throw new Error(`Matchmaking requires exactly 10 players. Received ${players.length}.`);
  }

  const byRole = new Map<Role, RatedQueuePlayer[]>();
  for (const role of ROLES) {
    const rolePlayers = players.filter((player) => player.role === role);
    if (rolePlayers.length !== 2) {
      throw new Error(`Role ${role} requires exactly 2 players. Received ${rolePlayers.length}.`);
    }
    byRole.set(role, rolePlayers);
  }

  const uniqueUserIds = new Set(players.map((player) => player.userId));
  if (uniqueUserIds.size !== players.length) {
    throw new Error("Matchmaking requires 10 unique users.");
  }

  return byRole;
};

const allRoleAssignments = (byRole: Map<Role, RatedQueuePlayer[]>): BalancedMatch[] => {
  let candidates: BalancedMatch[] = [
    {
      teamBlue: [],
      teamRed: [],
      blueExpectedWinrate: 0.5,
      muDifference: 0,
      balanceScore: 0,
    },
  ];

  for (const role of ROLES) {
    const rolePlayers = byRole.get(role);
    if (!rolePlayers || rolePlayers.length !== 2) {
      throw new Error(`Invalid role bucket for ${role}.`);
    }

    const first = rolePlayers[0];
    const second = rolePlayers[1];
    if (!first || !second) {
      throw new Error(`Role ${role} requires two players.`);
    }

    candidates = candidates.flatMap((candidate) => [
      addRoleToCandidate(candidate, role, first, second),
      addRoleToCandidate(candidate, role, second, first),
    ]);
  }

  return candidates.filter(candidateKeepsDuosTogether).map(finalizeCandidate);
};

const addRoleToCandidate = (
  candidate: BalancedMatch,
  role: Role,
  bluePlayer: RatedQueuePlayer,
  redPlayer: RatedQueuePlayer,
): BalancedMatch => ({
  ...candidate,
  teamBlue: [...candidate.teamBlue, { team: "BLUE", role, player: bluePlayer }],
  teamRed: [...candidate.teamRed, { team: "RED", role, player: redPlayer }],
});

const finalizeCandidate = (candidate: BalancedMatch): BalancedMatch => {
  const bluePlayers = candidate.teamBlue.map((slot) => slot.player);
  const redPlayers = candidate.teamRed.map((slot) => slot.player);
  const blueExpectedWinrate = expectedBlueWinrate(bluePlayers, redPlayers);
  const muDifference = Math.abs(teamMu(candidate.teamBlue) - teamMu(candidate.teamRed));

  return {
    ...candidate,
    blueExpectedWinrate,
    muDifference,
    balanceScore: Math.abs(0.5 - blueExpectedWinrate),
  };
};

const candidateKeepsDuosTogether = (candidate: BalancedMatch): boolean => {
  const slots = [...candidate.teamBlue, ...candidate.teamRed];

  return slots.every((slot) => {
    const duoUserId = slot.player.duoUserId;
    if (!duoUserId) {
      return true;
    }

    return slots.some(
      (candidateSlot) =>
        candidateSlot.team === slot.team && candidateSlot.player.userId === duoUserId,
    );
  });
};

const getWinningAndLosingSlots = (
  match: BalancedMatch,
  winningTeam: Exclude<WinningTeam, "NONE">,
): [TeamSlot[], TeamSlot[]] =>
  winningTeam === "BLUE"
    ? [match.teamBlue, match.teamRed]
    : [match.teamRed, match.teamBlue];

/** Streak protection: mu boost per loss beyond threshold. */
const STREAK_PROTECTION_THRESHOLD = 3;
const STREAK_PROTECTION_MU_BOOST_PER_LOSS = 0.5;

/** FILL players get amplified MMR changes. Win more, lose more. */
const FILL_MULTIPLIER = 1.5;

const applyStreakProtection = (
  players: readonly RatedQueuePlayer[],
): RatedQueuePlayer[] =>
  players.map((player) => {
    const streak = player.streak ?? 0;
    if (streak >= -STREAK_PROTECTION_THRESHOLD + 1) return player;
    // Loss streak beyond threshold → SUBTRACT mu for balancing purposes only.
    // Algorithm sees player as weaker → pairs them with STRONGER teammates → wins more.
    const lossesOverThreshold = Math.abs(streak) - STREAK_PROTECTION_THRESHOLD + 1;
    const penalty = lossesOverThreshold * STREAK_PROTECTION_MU_BOOST_PER_LOSS;
    const adjustedMu = player.rating.mu - penalty;
    return {
      ...player,
      rating: {
        ...player.rating,
        mu: adjustedMu,
        mmr: conservativeMmr(adjustedMu, player.rating.sigma),
      },
    };
  });

const restoreOriginalRatings = (
  match: BalancedMatch,
  originals: ReadonlyMap<string, RatedQueuePlayer>,
): BalancedMatch => ({
  ...match,
  teamBlue: match.teamBlue.map((slot) => {
    const orig = originals.get(slot.player.userId);
    return orig ? { ...slot, player: { ...slot.player, rating: orig.rating } } : slot;
  }),
  teamRed: match.teamRed.map((slot) => {
    const orig = originals.get(slot.player.userId);
    return orig ? { ...slot, player: { ...slot.player, rating: orig.rating } } : slot;
  }),
});

export class MatchmakingService {
  balance(players: readonly RatedQueuePlayer[]): BalancedMatch {
    // Save originals before streak boost
    const originals = new Map(players.map((p) => [p.userId, p]));

    // Apply streak protection: boosted mu for balancing only
    const boostedPlayers = applyStreakProtection(players);

    const candidates = allRoleAssignments(assertCompleteRoleSet(boostedPlayers));
    const best = candidates.sort((left, right) => {
      const byMu = left.muDifference - right.muDifference;
      if (byMu !== 0) {
        return byMu;
      }

      return left.balanceScore - right.balanceScore;
    })[0];

    if (!best) {
      throw new Error("No valid match candidate found.");
    }

    // Restore original ratings so persisted data isn't affected
    const restored = restoreOriginalRatings(best, originals);
    // Recalculate stats with real ratings
    return finalizeCandidate(restored);
  }

  calculateUpdatedRatings(
    match: BalancedMatch,
    winningTeam: Exclude<WinningTeam, "NONE">,
  ): UpdatedPlayerRating[] {
    const [winningSlots, losingSlots] = getWinningAndLosingSlots(match, winningTeam);
    const winnerRatings = winningSlots.map(
      (slot) => new Rating(slot.player.rating.mu, slot.player.rating.sigma),
    );
    const loserRatings = losingSlots.map(
      (slot) => new Rating(slot.player.rating.mu, slot.player.rating.sigma),
    );
    const updatedRatings = rate([winnerRatings, loserRatings]);
    const updatedWinners = updatedRatings[0];
    const updatedLosers = updatedRatings[1];
    if (!updatedWinners || !updatedLosers) {
      throw new Error("TrueSkill returned an unexpected team rating shape.");
    }

    return [
      ...this.mapUpdatedRatings(winningSlots, updatedWinners),
      ...this.mapUpdatedRatings(losingSlots, updatedLosers),
    ];
  }

  private mapUpdatedRatings(slots: readonly TeamSlot[], ratings: readonly Rating[]): UpdatedPlayerRating[] {
    return slots.map((slot, index) => {
      const nextRating = ratings[index];
      if (!nextRating) {
        throw new Error("TrueSkill returned an unexpected number of ratings.");
      }

      const prevMu = slot.player.rating.mu;
      const prevSigma = slot.player.rating.sigma;
      let finalMu = nextRating.mu;
      let finalSigma = nextRating.sigma;

      // FILL bonus: amplify mu delta by FILL_MULTIPLIER.
      // Win as FILL = bigger mu gain. Loss as FILL = bigger mu loss.
      if (slot.player.joinedAsFill) {
        const muDelta = nextRating.mu - prevMu;
        const sigmaDelta = nextRating.sigma - prevSigma;
        finalMu = prevMu + muDelta * FILL_MULTIPLIER;
        // Sigma also moves more (FILL playing off-role = more uncertainty/information)
        finalSigma = prevSigma + sigmaDelta * FILL_MULTIPLIER;
      }

      return {
        guildId: slot.player.guildId,
        userId: slot.player.userId,
        role: slot.role,
        previousMu: prevMu,
        previousSigma: prevSigma,
        mu: finalMu,
        sigma: finalSigma,
        mmr: conservativeMmr(finalMu, finalSigma),
      };
    });
  }
}
