/**
 * One-time migration script: replays all completed matches chronologically
 * to compute correct global TrueSkill ratings and write them to player_stats_global.
 *
 * Run: npx tsx src/scripts/replayMatchesGlobal.ts
 * Safe to re-run — always resets from default ratings before replaying.
 */

import { Rating, rate } from "ts-trueskill";
import { supabase } from "../services/supabaseClient.js";
import type { Team, WinningTeam } from "../core/models/types.js";

const DEFAULT_MU = 25;
const DEFAULT_SIGMA = 25 / 3;

interface GlobalRating {
  mu: number;
  sigma: number;
}

interface Participant {
  user_id: string;
  team: Team;
  mu_before: number;
  sigma_before: number;
}

interface Match {
  id: string;
  match_number: number | null;
  guild_id: string;
  winning_team: WinningTeam;
  completed_at: string;
  participants: Participant[];
}

async function loadCompletedMatches(): Promise<Match[]> {
  const { data: matchRows, error: matchError } = await supabase
    .from("matches")
    .select("id, match_number, guild_id, winning_team, completed_at")
    .eq("status", "COMPLETED")
    .neq("winning_team", "NONE")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: true });

  if (matchError) throw new Error(`Failed to load matches: ${matchError.message}`);
  if (!matchRows || matchRows.length === 0) {
    console.log("No completed matches found.");
    return [];
  }

  const matchIds = matchRows.map((m) => m.id);
  const { data: participantRows, error: partError } = await supabase
    .from("match_participants")
    .select("match_id, user_id, team, mu_before, sigma_before")
    .in("match_id", matchIds);

  if (partError) throw new Error(`Failed to load participants: ${partError.message}`);

  const byMatch = new Map<string, Participant[]>();
  for (const row of participantRows ?? []) {
    const list = byMatch.get(row.match_id) ?? [];
    list.push({
      user_id: row.user_id,
      team: row.team as Team,
      mu_before: row.mu_before,
      sigma_before: row.sigma_before,
    });
    byMatch.set(row.match_id, list);
  }

  return matchRows.map((m) => ({
    id: m.id,
    match_number: m.match_number,
    guild_id: m.guild_id,
    winning_team: m.winning_team as WinningTeam,
    completed_at: m.completed_at as string,
    participants: byMatch.get(m.id) ?? [],
  }));
}

function applyTrueSkill(
  ratings: Map<string, GlobalRating>,
  participants: Participant[],
  winningTeam: Exclude<WinningTeam, "NONE">,
): Map<string, GlobalRating> {
  const winners = participants.filter((p) => p.team === winningTeam);
  const losers = participants.filter((p) => p.team !== winningTeam);

  const winnerRatings = winners.map((p) => {
    const r = ratings.get(p.user_id) ?? { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA };
    return new Rating(r.mu, r.sigma);
  });
  const loserRatings = losers.map((p) => {
    const r = ratings.get(p.user_id) ?? { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA };
    return new Rating(r.mu, r.sigma);
  });

  const [updatedWinners, updatedLosers] = rate([winnerRatings, loserRatings]);

  const updated = new Map(ratings);
  for (let i = 0; i < winners.length; i++) {
    const w = updatedWinners?.[i];
    if (w && winners[i]) updated.set(winners[i]!.user_id, { mu: w.mu, sigma: w.sigma });
  }
  for (let i = 0; i < losers.length; i++) {
    const l = updatedLosers?.[i];
    if (l && losers[i]) updated.set(losers[i]!.user_id, { mu: l.mu, sigma: l.sigma });
  }
  return updated;
}

async function main() {
  console.log("Loading completed matches...");
  const matches = await loadCompletedMatches();
  console.log(`Found ${matches.length} completed match(es).`);

  // Group by guild, replay per guild independently
  const byGuild = new Map<string, Match[]>();
  for (const match of matches) {
    const list = byGuild.get(match.guild_id) ?? [];
    list.push(match);
    byGuild.set(match.guild_id, list);
  }

  for (const [guildId, guildMatches] of byGuild) {
    console.log(`\nGuild ${guildId}: replaying ${guildMatches.length} match(es)...`);

    // Collect all user IDs in this guild
    const allUserIds = new Set<string>();
    for (const match of guildMatches) {
      for (const p of match.participants) allUserIds.add(p.user_id);
    }

    // Start everyone at default rating
    let ratings = new Map<string, GlobalRating>();
    for (const userId of allUserIds) {
      ratings.set(userId, { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA });
    }

    // Replay matches in order, also tracking per-match mu_before for history
    const participantUpdates: Array<{
      match_id: string;
      user_id: string;
      mu_before: number;
      sigma_before: number;
    }> = [];

    for (const match of guildMatches) {
      if (match.participants.length !== 10) {
        console.warn(`  Match #${match.match_number ?? match.id.slice(0, 8)} has ${match.participants.length} participants — skipping.`);
        continue;
      }
      if (match.winning_team === "NONE") continue;

      // Record mu_before for each participant using current replayed rating
      for (const p of match.participants) {
        const r = ratings.get(p.user_id) ?? { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA };
        participantUpdates.push({
          match_id: match.id,
          user_id: p.user_id,
          mu_before: r.mu,
          sigma_before: r.sigma,
        });
      }

      ratings = applyTrueSkill(ratings, match.participants, match.winning_team as Exclude<WinningTeam, "NONE">);
      console.log(`  Replayed match #${String(match.match_number ?? "?").padStart(4, "0")}`);
    }

    // Write final ratings to player_stats_global
    const now = new Date().toISOString();
    const upsertRows = [...ratings.entries()].map(([userId, r]) => ({
      guild_id: guildId,
      user_id: userId,
      mu: r.mu,
      sigma: r.sigma,
      updated_at: now,
    }));

    const { error: upsertError } = await supabase
      .from("player_stats_global")
      .upsert(upsertRows, { onConflict: "guild_id,user_id" });

    if (upsertError) throw new Error(`Failed to write global ratings: ${upsertError.message}`);

    console.log(`  Wrote ${upsertRows.length} global rating(s) to player_stats_global.`);

    // Backfill match_participants.mu_before / sigma_before with replayed values
    console.log(`  Backfilling ${participantUpdates.length} participant mu_before rows...`);
    for (const row of participantUpdates) {
      const { error } = await supabase
        .from("match_participants")
        .update({ mu_before: row.mu_before, sigma_before: row.sigma_before })
        .eq("match_id", row.match_id)
        .eq("user_id", row.user_id);

      if (error) {
        console.warn(`    Failed to update participant ${row.user_id} in match ${row.match_id}: ${error.message}`);
      }
    }

    console.log(`  Done for guild ${guildId}.`);
  }

  console.log("\nReplay complete.");
}

main().catch((err) => {
  console.error("Replay failed:", err);
  process.exit(1);
});
