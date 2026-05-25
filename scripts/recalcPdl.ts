/**
 * Recalculate PDL for all completed matches using the current `computePdlDelta` formula.
 *
 * Usage:
 *   npm exec tsx scripts/recalcPdl.ts <guild_id> [--dry-run]
 *
 * What it does:
 *  - Walks every COMPLETED match in chronological order.
 *  - Re-computes each player's PDL delta with the current formula
 *    (passing the streak BEFORE that match, derived from prior matches).
 *  - Updates each row in pdl_history with new pdl_before / pdl_after / pdl_delta
 *    + tier_before / tier_after / division_before / division_after.
 *  - At the end, writes each user's final PDL/tier/division back to player_stats_global.
 *
 * Pass --dry-run to print summary without writing.
 *
 * MMR/mu/sigma rows are NOT touched. PDL only.
 */

import { computePdlDelta } from "../src/core/tier/pdl.js";
import { classifyByPdl, type Division, type Tier } from "../src/core/tier/tier.js";
import { supabase } from "../src/services/supabaseClient.js";

interface MatchRow {
  id: string;
  guild_id: string;
  status: string;
  winning_team: "BLUE" | "RED" | "NONE";
  blue_expected_winrate: number;
  created_at: string;
}

interface ParticipantRow {
  match_id: string;
  user_id: string;
  team: "BLUE" | "RED";
  mu_before: number;
  sigma_before: number;
  mmr_before: number;
}

async function loadCompletedMatches(guildId: string): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("id, guild_id, status, winning_team, blue_expected_winrate, created_at")
    .eq("guild_id", guildId)
    .eq("status", "COMPLETED")
    .neq("winning_team", "NONE")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load matches: ${error.message}`);
  return (data ?? []) as MatchRow[];
}

async function loadParticipants(matchIds: string[]): Promise<Map<string, ParticipantRow[]>> {
  const result = new Map<string, ParticipantRow[]>();
  if (matchIds.length === 0) return result;

  // Chunk to avoid URL length limits.
  const chunkSize = 200;
  for (let i = 0; i < matchIds.length; i += chunkSize) {
    const chunk = matchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("match_participants")
      .select("match_id, user_id, team, mu_before, sigma_before, mmr_before")
      .in("match_id", chunk);
    if (error) throw new Error(`Failed to load participants: ${error.message}`);
    for (const row of (data ?? []) as ParticipantRow[]) {
      const list = result.get(row.match_id) ?? [];
      list.push(row);
      result.set(row.match_id, list);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const guildId = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (!guildId) {
    console.error("Usage: npm exec tsx scripts/recalcPdl.ts <guild_id> [--dry-run]");
    process.exit(1);
  }

  console.log(`Recalc PDL for guild=${guildId} (dry-run=${dryRun})`);

  const matches = await loadCompletedMatches(guildId);
  console.log(`Found ${matches.length} completed matches.`);
  if (matches.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const participants = await loadParticipants(matches.map((m) => m.id));

  const pdlByUser = new Map<string, number>();
  const streakByUser = new Map<string, number>();
  let historyUpdates = 0;
  let unknownMatches = 0;

  for (const match of matches) {
    const matchParticipants = participants.get(match.id) ?? [];
    if (matchParticipants.length === 0) {
      unknownMatches += 1;
      continue;
    }

    for (const p of matchParticipants) {
      const won = match.winning_team === p.team;
      const expectedWinrate =
        p.team === "BLUE" ? match.blue_expected_winrate : 1 - match.blue_expected_winrate;
      const currentStreak = streakByUser.get(p.user_id) ?? 0;
      const { pdlDelta } = computePdlDelta({ won, expectedWinrate, currentStreak });

      const pdlBefore = pdlByUser.get(p.user_id) ?? 0;
      const pdlAfter = Math.max(0, pdlBefore + pdlDelta);
      const positionBefore = classifyByPdl(pdlBefore);
      const positionAfter = classifyByPdl(pdlAfter);

      if (!dryRun) {
        const { error } = await supabase
          .from("pdl_history")
          .update({
            pdl_before: pdlBefore,
            pdl_after: pdlAfter,
            pdl_delta: pdlDelta,
            tier_before: positionBefore.tier,
            tier_after: positionAfter.tier,
            division_before: positionBefore.division,
            division_after: positionAfter.division,
          })
          .eq("match_id", match.id)
          .eq("user_id", p.user_id);
        if (error) {
          console.error(`Failed to update pdl_history match=${match.id} user=${p.user_id}: ${error.message}`);
        } else {
          historyUpdates += 1;
        }
      }

      pdlByUser.set(p.user_id, pdlAfter);

      // Update streak for next iteration.
      const newStreak = won
        ? currentStreak > 0
          ? currentStreak + 1
          : 1
        : currentStreak < 0
          ? currentStreak - 1
          : -1;
      streakByUser.set(p.user_id, newStreak);
    }
  }

  console.log(`Processed: matches=${matches.length} historyUpdates=${historyUpdates} unknownMatches=${unknownMatches}`);

  // Final: persist player_stats_global PDL/tier/division.
  if (!dryRun) {
    const now = new Date().toISOString();
    const userIds = [...pdlByUser.keys()];
    let writes = 0;
    for (const userId of userIds) {
      const pdl = pdlByUser.get(userId)!;
      const pos = classifyByPdl(pdl);
      const { error } = await supabase
        .from("player_stats_global")
        .update({
          pdl,
          tier: pos.tier,
          division: pos.division,
          updated_at: now,
        })
        .eq("guild_id", guildId)
        .eq("user_id", userId);
      if (error) {
        console.error(`Failed to update player_stats_global user=${userId}: ${error.message}`);
      } else {
        writes += 1;
      }
    }
    console.log(`Wrote ${writes}/${userIds.length} player_stats_global rows.`);
  }

  // Print top 10 final ranking for sanity check.
  const sorted = [...pdlByUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("\nTop 10 after recalc:");
  for (const [userId, pdl] of sorted) {
    const pos = classifyByPdl(pdl);
    const divLabel = pos.division === 0 ? "" : ` ${["", "I", "II", "III", "IV"][pos.division] ?? ""}`;
    console.log(`  ${pos.tier}${divLabel}  ${pdl} PDL  user=${userId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
