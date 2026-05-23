import { ROLES, type Role } from "../core/models/types.js";
import { supabase } from "./supabaseClient.js";

// ---------- Types ----------

export interface SeasonRankingEntry {
  userId: string;
  displayName: string;
  discordId: string | null;
  mmr: number;
  games: number;
  wins: number;
  losses: number;
  rank: number;
}

export interface SeasonHighlights {
  topMmr: { displayName: string; discordId: string | null; mmr: number } | null;
  topWinrate: { displayName: string; discordId: string | null; winrate: number; games: number } | null;
  topStreak: { displayName: string; discordId: string | null; streak: number } | null;
  mostActive: { displayName: string; discordId: string | null; games: number } | null;
  bestDuo: {
    name1: string;
    name2: string;
    discordId1: string | null;
    discordId2: string | null;
    winrate: number;
    games: number;
  } | null;
  biggestRivalry: {
    name1: string;
    name2: string;
    discordId1: string | null;
    discordId2: string | null;
    games: number;
  } | null;
  bestFill: { displayName: string; discordId: string | null; winrate: number; games: number } | null;
  worstFill: { displayName: string; discordId: string | null; winrate: number; games: number } | null;
}

export interface SeasonComeback {
  displayName: string;
  discordId: string | null;
  fromMmr: number;
  toMmr: number;
  delta: number;
  matchesPlayed: number;
}

export interface SeasonOverview {
  totalMatches: number;
  totalCompletedMatches: number;
  totalCancelledMatches: number;
  totalPlayers: number;
  firstMatchAt: string | null;
  lastMatchAt: string | null;
}

interface MatchRow {
  id: string;
  match_number: number | null;
  guild_id: string;
  status: "PENDING" | "ONGOING" | "COMPLETED" | "CANCELLED";
  winning_team: "BLUE" | "RED" | "NONE";
  created_at: string;
  completed_at: string | null;
}

interface ParticipantRow {
  match_id: string;
  user_id: string;
  role: Role;
  team: "BLUE" | "RED";
  mu_before: number;
  sigma_before: number;
  mmr_before: number;
  display_name: string | null;
  joined_as_fill: boolean;
}

interface GlobalStatRow {
  guild_id: string;
  user_id: string;
  mu: number;
  sigma: number;
  mmr: number;
}

interface UserProfile {
  displayName: string;
  discordId: string | null;
}

// ---------- Service ----------

const conservativeMmr = (mu: number, sigma: number) => Math.round((mu - 3 * sigma) * 40 + 1000);
const displayMmr = (s: Pick<GlobalStatRow, "mu" | "sigma" | "mmr">) =>
  Number.isFinite(s.mmr) && s.mmr > 0 ? Math.round(s.mmr) : conservativeMmr(s.mu, s.sigma);

export class SeasonArchiveService {
  async resolveArchiveGuildId(guildId: string): Promise<string> {
    const { count, error } = await supabase
      .from("matches_s1" as never)
      .select("id", { count: "exact", head: true })
      .eq("guild_id", guildId)
      .eq("status", "COMPLETED");

    if (error) throw new Error(`Failed to check S1 archive guild: ${error.message}`);
    if ((count ?? 0) > 0) return guildId;

    const { data, error: fallbackError } = await supabase
      .from("matches_s1" as never)
      .select("guild_id")
      .eq("status", "COMPLETED");

    if (fallbackError) throw new Error(`Failed to find S1 archive guild: ${fallbackError.message}`);

    const byGuild = new Map<string, number>();
    for (const row of (data ?? []) as { guild_id: string }[]) {
      byGuild.set(row.guild_id, (byGuild.get(row.guild_id) ?? 0) + 1);
    }

    const best = [...byGuild.entries()].sort((a, b) => b[1] - a[1])[0];
    return best?.[0] ?? guildId;
  }

  /**
   * Top-N ranking for Season 1 (reads matches_s1 + match_participants_s1 + player_stats_global_s1).
   */
  async getRanking(guildId: string, limit = 200): Promise<SeasonRankingEntry[]> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) return [];

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);

    const records = new Map<string, { games: number; wins: number; losses: number }>();
    for (const p of participants) {
      const match = matches.get(p.match_id);
      if (!match) continue;
      const cur = records.get(p.user_id) ?? { games: 0, wins: 0, losses: 0 };
      cur.games += 1;
      if (match.winning_team === p.team) cur.wins += 1;
      else cur.losses += 1;
      records.set(p.user_id, cur);
    }

    if (records.size === 0) return [];

    const userIds = [...records.keys()];
    const { data: stats, error } = await supabase
      .from("player_stats_global_s1" as never)
      .select("guild_id, user_id, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .in("user_id", userIds);

    if (error) throw new Error(`Failed to load S1 stats: ${error.message}`);

    const profiles = await this.getUserProfiles(userIds);
    const entries: SeasonRankingEntry[] = [];

    for (const stat of (stats ?? []) as GlobalStatRow[]) {
      const rec = records.get(stat.user_id);
      if (!rec) continue;
      const profile = profiles.get(stat.user_id);
      entries.push({
        userId: stat.user_id,
        displayName: profile?.displayName ?? "Desconhecido",
        discordId: profile?.discordId ?? null,
        mmr: displayMmr(stat),
        games: rec.games,
        wins: rec.wins,
        losses: rec.losses,
        rank: 0,
      });
    }

    return entries
      .sort((a, b) => b.mmr - a.mmr)
      .slice(0, limit)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }

  async getOverview(guildId: string): Promise<SeasonOverview> {
    const { data: allMatches, error } = await supabase
      .from("matches_s1" as never)
      .select("id, status, created_at, completed_at")
      .eq("guild_id", guildId);

    if (error) throw new Error(`Failed to load S1 overview: ${error.message}`);

    type Row = { id: string; status: string; created_at: string; completed_at: string | null };
    const rows = (allMatches ?? []) as Row[];
    const completed = rows.filter((m) => m.status === "COMPLETED");
    const cancelled = rows.filter((m) => m.status === "CANCELLED");

    const sortedByCreated = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const firstMatchAt = sortedByCreated[0]?.created_at ?? null;
    const lastCompletedDate = completed
      .map((m) => m.completed_at ?? m.created_at)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

    let totalPlayers = 0;
    if (completed.length > 0) {
      const { data: distinctUsers } = await supabase
        .from("match_participants_s1" as never)
        .select("user_id")
        .in("match_id", completed.map((m) => m.id));
      const set = new Set(((distinctUsers ?? []) as { user_id: string }[]).map((r) => r.user_id));
      totalPlayers = set.size;
    }

    return {
      totalMatches: rows.length,
      totalCompletedMatches: completed.length,
      totalCancelledMatches: cancelled.length,
      totalPlayers,
      firstMatchAt,
      lastMatchAt: lastCompletedDate,
    };
  }

  async getHighlights(guildId: string): Promise<SeasonHighlights | null> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) return null;

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);
    const allUserIds = new Set(participants.map((p) => p.user_id));
    const profiles = await this.getUserProfiles([...allUserIds]);
    const profile = (uid: string): UserProfile => profiles.get(uid) ?? { displayName: "Desconhecido", discordId: null };

    // Top MMR
    const { data: topStat } = await supabase
      .from("player_stats_global_s1" as never)
      .select("user_id, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .order("mmr", { ascending: false })
      .limit(1);
    const topMmr = topStat?.[0] ? (() => {
      const stat = topStat[0] as GlobalStatRow;
      const user = profile(stat.user_id);
      return { displayName: user.displayName, discordId: user.discordId, mmr: displayMmr(stat) };
    })() : null;

    // W/L per user
    const userRec = new Map<string, { games: number; wins: number; losses: number }>();
    for (const p of participants) {
      const m = matches.get(p.match_id);
      if (!m || m.winning_team === "NONE") continue;
      const cur = userRec.get(p.user_id) ?? { games: 0, wins: 0, losses: 0 };
      cur.games += 1;
      if (m.winning_team === p.team) cur.wins += 1;
      else cur.losses += 1;
      userRec.set(p.user_id, cur);
    }

    // Top winrate (min 3)
    let topWinrate: SeasonHighlights["topWinrate"] = null;
    let bestWr = -1;
    for (const [uid, r] of userRec) {
      if (r.games < 3) continue;
      const wr = r.wins / r.games;
      if (wr > bestWr) {
        bestWr = wr;
        const user = profile(uid);
        topWinrate = { displayName: user.displayName, discordId: user.discordId, winrate: wr, games: r.games };
      }
    }

    // Most active
    let mostActive: SeasonHighlights["mostActive"] = null;
    let maxGames = 0;
    for (const [uid, r] of userRec) {
      if (r.games > maxGames) {
        maxGames = r.games;
        const user = profile(uid);
        mostActive = { displayName: user.displayName, discordId: user.discordId, games: r.games };
      }
    }

    // Top historical win streak
    const sortedMatches = [...matches.entries()]
      .filter(([, m]) => m.winning_team !== "NONE")
      .sort(([, a], [, b]) => Date.parse(a.completed_at ?? a.created_at) - Date.parse(b.completed_at ?? b.created_at));

    const currentStreaks = new Map<string, number>();
    let topStreak: SeasonHighlights["topStreak"] = null;
    let bestStreak = 0;
    for (const [matchId, match] of sortedMatches) {
      for (const p of participants.filter((pp) => pp.match_id === matchId)) {
        const won = match.winning_team === p.team;
        const next = won ? (currentStreaks.get(p.user_id) ?? 0) + 1 : 0;
        currentStreaks.set(p.user_id, next);

        if (next > bestStreak) {
          bestStreak = next;
          const user = profile(p.user_id);
          topStreak = { displayName: user.displayName, discordId: user.discordId, streak: next };
        }
      }
    }

    // Best duo + biggest rivalry
    const duoKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const duoStats = new Map<string, { id1: string; id2: string; games: number; wins: number }>();
    const rivalryStats = new Map<string, { id1: string; id2: string; games: number }>();

    for (const [matchId, match] of matches) {
      const mp = participants.filter((p) => p.match_id === matchId);
      for (let i = 0; i < mp.length; i++) {
        for (let j = i + 1; j < mp.length; j++) {
          const p1 = mp[i]!;
          const p2 = mp[j]!;
          const key = duoKey(p1.user_id, p2.user_id);
          if (p1.team === p2.team && match.winning_team !== "NONE") {
            const s = duoStats.get(key) ?? { id1: p1.user_id, id2: p2.user_id, games: 0, wins: 0 };
            s.games += 1;
            if (match.winning_team === p1.team) s.wins += 1;
            duoStats.set(key, s);
          } else if (p1.team !== p2.team) {
            const s = rivalryStats.get(key) ?? { id1: p1.user_id, id2: p2.user_id, games: 0 };
            s.games += 1;
            rivalryStats.set(key, s);
          }
        }
      }
    }

    let bestDuo: SeasonHighlights["bestDuo"] = null;
    let bestDuoScore = -1;
    for (const s of duoStats.values()) {
      if (s.games < 2 || s.wins === 0) continue;
      const wr = s.wins / s.games;
      const score = wr * 1000 + s.games;
      if (score > bestDuoScore) {
        bestDuoScore = score;
        const user1 = profile(s.id1);
        const user2 = profile(s.id2);
        bestDuo = {
          name1: user1.displayName,
          name2: user2.displayName,
          discordId1: user1.discordId,
          discordId2: user2.discordId,
          winrate: wr,
          games: s.games,
        };
      }
    }

    let biggestRivalry: SeasonHighlights["biggestRivalry"] = null;
    let maxRivalryGames = 0;
    for (const s of rivalryStats.values()) {
      if (s.games > maxRivalryGames) {
        maxRivalryGames = s.games;
        const user1 = profile(s.id1);
        const user2 = profile(s.id2);
        biggestRivalry = {
          name1: user1.displayName,
          name2: user2.displayName,
          discordId1: user1.discordId,
          discordId2: user2.discordId,
          games: s.games,
        };
      }
    }

    // Best/worst FILL
    const fillRec = new Map<string, { games: number; wins: number }>();
    for (const p of participants) {
      if (!p.joined_as_fill) continue;
      const m = matches.get(p.match_id);
      if (!m || m.winning_team === "NONE") continue;
      const r = fillRec.get(p.user_id) ?? { games: 0, wins: 0 };
      r.games += 1;
      if (m.winning_team === p.team) r.wins += 1;
      fillRec.set(p.user_id, r);
    }

    let bestFill: SeasonHighlights["bestFill"] = null;
    let worstFill: SeasonHighlights["worstFill"] = null;
    let bestFillScore = -1;
    let worstFillScore = 2;
    for (const [uid, r] of fillRec) {
      if (r.games < 2) continue;
      const wr = r.wins / r.games;
      const bScore = wr * 1000 + r.games;
      if (bScore > bestFillScore && r.wins > 0) {
        bestFillScore = bScore;
        const user = profile(uid);
        bestFill = { displayName: user.displayName, discordId: user.discordId, winrate: wr, games: r.games };
      }
      const wScore = wr - r.games / 1000;
      if (wScore < worstFillScore && r.wins < r.games) {
        worstFillScore = wScore;
        const user = profile(uid);
        worstFill = { displayName: user.displayName, discordId: user.discordId, winrate: wr, games: r.games };
      }
    }

    return { topMmr, topWinrate, topStreak, mostActive, bestDuo, biggestRivalry, bestFill, worstFill };
  }

  /**
   * "Volta por cima": player with biggest MMR recovery from in-season trough back to current.
   * Requires trough to occur AFTER at least 3 matches (so it's a real drop, not starting point).
   */
  async getComeback(guildId: string): Promise<SeasonComeback | null> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) return null;

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);
    const userIds = [...new Set(participants.map((p) => p.user_id))];
    if (userIds.length === 0) return null;

    const { data: stats, error } = await supabase
      .from("player_stats_global_s1" as never)
      .select("user_id, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .in("user_id", userIds);

    if (error) throw new Error(`Failed to load S1 stats for comeback: ${error.message}`);

    const currentMmr = new Map<string, number>();
    for (const s of (stats ?? []) as GlobalStatRow[]) {
      currentMmr.set(s.user_id, displayMmr(s));
    }

    const profiles = await this.getUserProfiles(userIds);

    // Group participations by user, sorted chronologically.
    const byUser = new Map<string, { mmr: number; createdAt: number }[]>();
    for (const p of participants) {
      const m = matches.get(p.match_id);
      if (!m) continue;
      const list = byUser.get(p.user_id) ?? [];
      list.push({ mmr: Math.round(p.mmr_before), createdAt: Date.parse(m.created_at) });
      byUser.set(p.user_id, list);
    }

    let best: SeasonComeback | null = null;
    for (const [uid, raw] of byUser) {
      const series = raw.sort((a, b) => a.createdAt - b.createdAt).map((r) => r.mmr);
      const cur = currentMmr.get(uid);
      if (!cur || series.length < 5) continue;

      // Trough must occur AFTER first 3 matches to count as actual drop.
      let minMmr = Infinity;
      for (let i = 3; i < series.length; i++) {
        if (series[i]! < minMmr) minMmr = series[i]!;
      }
      if (!Number.isFinite(minMmr)) continue;

      const delta = cur - minMmr;
      if (delta <= 0) continue;

      if (!best || delta > best.delta) {
        const profile = profiles.get(uid);
        best = {
          displayName: profile?.displayName ?? "Desconhecido",
          discordId: profile?.discordId ?? null,
          fromMmr: minMmr,
          toMmr: cur,
          delta,
          matchesPlayed: series.length,
        };
      }
    }

    return best;
  }

  // ---------- private helpers ----------

  private async getCompletedMatches(guildId: string): Promise<Map<string, MatchRow>> {
    const { data, error } = await supabase
      .from("matches_s1" as never)
      .select("id, match_number, guild_id, status, winning_team, created_at, completed_at")
      .eq("guild_id", guildId)
      .eq("status", "COMPLETED");

    if (error) throw new Error(`Failed to load S1 matches: ${error.message}`);
    return new Map(((data ?? []) as MatchRow[]).map((row) => [row.id, row]));
  }

  private async getParticipantsByMatchIds(matchIds: readonly string[]): Promise<ParticipantRow[]> {
    if (matchIds.length === 0) return [];
    const { data, error } = await supabase
      .from("match_participants_s1" as never)
      .select("match_id, user_id, role, team, mu_before, sigma_before, mmr_before, display_name, joined_as_fill")
      .in("match_id", [...matchIds]);

    if (error) throw new Error(`Failed to load S1 participants: ${error.message}`);
    return (data ?? []) as ParticipantRow[];
  }

  private async getUserProfiles(userIds: readonly string[]): Promise<Map<string, UserProfile>> {
    if (userIds.length === 0) return new Map();
    const { data, error } = await supabase
      .from("users")
      .select("id, display_name, discord_id")
      .in("id", [...new Set(userIds)]);

    if (error) throw new Error(`Failed to load display names: ${error.message}`);
    return new Map((data ?? []).map((row) => [
      row.id,
      { displayName: row.display_name, discordId: row.discord_id ?? null },
    ]));
  }

  // Used by ROLES iteration helpers (kept here so we can import a sealed module).
  static readonly roles = ROLES;
}

export const seasonArchiveService = new SeasonArchiveService();
