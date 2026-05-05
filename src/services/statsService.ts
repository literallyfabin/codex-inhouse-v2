import type { MatchStatus, Role, Team, WinningTeam } from "../core/models/types.js";
import { ROLES } from "../core/models/types.js";
import { conservativeMmr } from "../core/matchmaking/trueskillMath.js";
import { supabase } from "./supabaseClient.js";

interface MatchRow {
  id: string;
  match_number: number | null;
  guild_id: string;
  status: MatchStatus;
  winning_team: WinningTeam;
  created_at: string;
  completed_at: string | null;
}

interface ParticipantRow {
  match_id: string;
  user_id: string;
  role: Role;
  team: Team;
  mu_before: number;
  sigma_before: number;
  mmr_before: number;
  champion_name: string | null;
  display_name: string | null;
}

interface GlobalStatRow {
  guild_id: string;
  user_id: string;
  mu: number;
  sigma: number;
  mmr: number;
}

// Per-role W/L breakdown (no MMR — MMR is global)
export interface PlayerRoleSummary {
  role: Role;
  games: number;
  wins: number;
  losses: number;
}

// Global rating info for a player
export interface GlobalPlayerStats {
  mu: number;
  sigma: number;
  mmr: number;
  rank: number | null;
  totalGames: number;
  totalWins: number;
  totalLosses: number;
}

// Combined response for /stats
export interface PlayerSummary {
  global: GlobalPlayerStats;
  roles: PlayerRoleSummary[];
}

export interface SynergyNemesisResult {
  userId: string;
  displayName: string;
  games: number;
  wins: number;
  winrate: number;
}

// Ranking entry — role is optional (set only when filtering by role)
export interface RankingEntry {
  userId: string;
  displayName: string;
  role?: Role;
  mu: number;
  sigma: number;
  mmr: number;
  games: number;
  wins: number;
  losses: number;
  rank: number | null;
}

export interface HistoryEntry {
  matchId: string;
  matchNumber: number | null;
  role: Role;
  team: Team;
  result: "WIN" | "LOSS" | "ONGOING" | "CANCELLED" | "UNKNOWN";
  championName: string | null;
  mmrBefore: number;
  createdAt: string;
}

export interface MmrHistoryEntry {
  role: Role;
  matchId: string;
  matchNumber: number | null;
  mmr: number;
  createdAt: string;
  isCurrent: boolean;
}

export interface RoleDistribution {
  role: Role;
  games: number;
  wins: number;
  losses: number;
  percentage: number;
}

export interface RoleReportResult {
  totalGames: number;
  roles: RoleDistribution[];
  versatility: number;
}

export interface ServerHighlights {
  topMmr: { displayName: string; mmr: number } | null;
  topWinrate: { displayName: string; winrate: number; games: number } | null;
  topStreak: { displayName: string; streak: number } | null;
  bestDuo: { name1: string; name2: string; winrate: number; games: number } | null;
  biggestRivalry: { name1: string; name2: string; games: number } | null;
  mostActive: { displayName: string; games: number } | null;
}

const displayMmr = (stat: Pick<GlobalStatRow, "mu" | "sigma" | "mmr">): number =>
  Number.isFinite(stat.mmr) ? stat.mmr : conservativeMmr(stat.mu, stat.sigma);

export class StatsService {
  async getPlayerSummary(guildId: string, userId: string): Promise<PlayerSummary | null> {
    const [globalStat, participantRows] = await Promise.all([
      this.getGlobalStat(guildId, userId),
      this.getParticipantRowsForUser(userId),
    ]);

    const matchIds = participantRows.map((row) => row.match_id);
    const matches = await this.getMatchesByIds(guildId, matchIds);
    const roleRecords = this.recordsByRole(participantRows, matches);

    let totalGames = 0;
    let totalWins = 0;
    let totalLosses = 0;

    const roles: PlayerRoleSummary[] = ROLES
      .map((role) => {
        const record = roleRecords.get(role) ?? { games: 0, wins: 0, losses: 0 };
        totalGames += record.games;
        totalWins += record.wins;
        totalLosses += record.losses;
        return { role, ...record };
      })
      .filter((r) => r.games > 0);

    if (!globalStat && roles.length === 0) {
      return null;
    }

    const mu = globalStat?.mu ?? 25;
    const sigma = globalStat?.sigma ?? 25 / 3;
    const mmr = globalStat ? displayMmr(globalStat) : conservativeMmr(25, 25 / 3);

    const rank = await this.getGlobalRank(guildId, mmr);

    return {
      global: { mu, sigma, mmr, rank, totalGames, totalWins, totalLosses },
      roles,
    };
  }

  async getRanking(guildId: string, role?: Role, limit = 30): Promise<RankingEntry[]> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) return [];

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);

    // Build W/L records — keyed by userId (global) or userId+role (filtered)
    const records = new Map<string, { games: number; wins: number; losses: number }>();

    for (const p of participants) {
      if (role && p.role !== role) continue;

      const match = matches.get(p.match_id);
      if (!match) continue;

      const key = p.user_id;
      const current = records.get(key) ?? { games: 0, wins: 0, losses: 0 };
      current.games += 1;
      if (match.winning_team === p.team) {
        current.wins += 1;
      } else {
        current.losses += 1;
      }
      records.set(key, current);
    }

    if (records.size === 0) return [];

    // Load global stats for users who have records
    const userIds = [...records.keys()];
    const { data: stats, error } = await supabase
      .from("player_stats_global")
      .select("guild_id, user_id, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .in("user_id", userIds);

    if (error) throw new Error(`Failed to load global ranking stats: ${error.message}`);

    const names = await this.getDisplayNames(userIds);
    const entries: RankingEntry[] = [];

    for (const stat of stats) {
      const record = records.get(stat.user_id);
      if (!record) continue;

      entries.push({
        userId: stat.user_id,
        displayName: names.get(stat.user_id) ?? stat.user_id,
        ...(role !== undefined ? { role } : {}),
        mu: stat.mu,
        sigma: stat.sigma,
        mmr: displayMmr(stat),
        games: record.games,
        wins: record.wins,
        losses: record.losses,
        rank: null,
      });
    }

    return entries
      .sort((a, b) => b.mmr - a.mmr)
      .slice(0, limit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  async getHistory(guildId: string, userId: string, limit = 10): Promise<HistoryEntry[]> {
    const participants = await this.getParticipantRowsForUser(userId);
    const matches = await this.getMatchesByIds(
      guildId,
      participants.map((row) => row.match_id),
    );

    return participants
      .map((participant) => {
        const match = matches.get(participant.match_id);
        if (!match) return null;

        return {
          matchId: participant.match_id,
          matchNumber: match.match_number,
          role: participant.role,
          team: participant.team,
          result: this.resultFor(participant, match),
          championName: participant.champion_name,
          mmrBefore: participant.mmr_before,
          createdAt: match.created_at,
        } satisfies HistoryEntry;
      })
      .filter((entry): entry is HistoryEntry => entry !== null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async getMmrHistory(
    guildId: string,
    userId: string,
    role?: Role,
    limit = 30,
  ): Promise<MmrHistoryEntry[]> {
    const participants = await this.getParticipantRowsForUser(userId);
    const matches = await this.getMatchesByIds(
      guildId,
      participants.map((row) => row.match_id),
    );

    const history: MmrHistoryEntry[] = [];
    for (const participant of participants) {
      const match = matches.get(participant.match_id);
      if (!match || (role && participant.role !== role)) continue;

      history.push({
        role: participant.role,
        matchId: participant.match_id,
        matchNumber: match.match_number,
        mmr: participant.mmr_before,
        createdAt: match.created_at,
        isCurrent: false,
      });
    }

    history.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    // Append current global MMR as the final point
    const globalStat = await this.getGlobalStat(guildId, userId);
    if (globalStat) {
      const now = new Date().toISOString();
      const currentMmr = displayMmr(globalStat);

      if (!role) {
        // One single current point for global view
        history.push({
          role: ROLES[0],
          matchId: "current",
          matchNumber: null,
          mmr: currentMmr,
          createdAt: now,
          isCurrent: true,
        });
      } else {
        history.push({
          role,
          matchId: "current",
          matchNumber: null,
          mmr: currentMmr,
          createdAt: now,
          isCurrent: true,
        });
      }
    }

    return history.slice(-limit);
  }

  async getComparison(
    guildId: string,
    user1Id: string,
    user2Id: string,
  ): Promise<{
    allies: { games: number; wins: number; losses: number };
    enemies: { games: number; user1Wins: number; user2Wins: number };
  }> {
    const [participants1, participants2] = await Promise.all([
      this.getParticipantRowsForUser(user1Id),
      this.getParticipantRowsForUser(user2Id),
    ]);

    const matchIds2 = new Set(participants2.map((p) => p.match_id));
    const commonMatchIds = participants1
      .filter((p) => matchIds2.has(p.match_id))
      .map((p) => p.match_id);

    const matches = await this.getMatchesByIds(guildId, commonMatchIds);

    const result = {
      allies: { games: 0, wins: 0, losses: 0 },
      enemies: { games: 0, user1Wins: 0, user2Wins: 0 },
    };

    for (const matchId of commonMatchIds) {
      const match = matches.get(matchId);
      if (!match || match.status !== "COMPLETED" || match.winning_team === "NONE") continue;

      const p1 = participants1.find((p) => p.match_id === matchId)!;
      const p2 = participants2.find((p) => p.match_id === matchId)!;

      if (p1.team === p2.team) {
        result.allies.games++;
        if (match.winning_team === p1.team) {
          result.allies.wins++;
        } else {
          result.allies.losses++;
        }
      } else {
        result.enemies.games++;
        if (match.winning_team === p1.team) {
          result.enemies.user1Wins++;
        } else {
          result.enemies.user2Wins++;
        }
      }
    }

    return result;
  }

  async setChampionName(
    guildId: string,
    userId: string,
    championName: string,
    matchId?: string,
  ): Promise<string> {
    const targetMatchId = matchId ?? (await this.getLatestMatchIdForUser(guildId, userId));
    if (!targetMatchId) {
      throw new Error("No match found for this player in this guild.");
    }

    const matches = await this.getMatchesByIds(guildId, [targetMatchId]);
    if (!matches.has(targetMatchId)) {
      throw new Error("The match does not belong to this guild.");
    }

    const { error } = await supabase
      .from("match_participants")
      .update({ champion_name: championName })
      .eq("match_id", targetMatchId)
      .eq("user_id", userId);

    if (error) throw new Error(`Failed to set champion: ${error.message}`);

    return targetMatchId;
  }

  async getSynergy(guildId: string, userId: string, minGames = 2): Promise<SynergyNemesisResult | null> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) return null;

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);

    const userMatches = new Map<string, Team>();
    for (const p of participants) {
      if (p.user_id === userId) userMatches.set(p.match_id, p.team);
    }
    if (userMatches.size === 0) return null;

    const partnerStats = new Map<string, { games: number; wins: number; displayName: string }>();
    for (const p of participants) {
      if (p.user_id === userId) continue;
      const userTeam = userMatches.get(p.match_id);
      if (!userTeam || p.team !== userTeam) continue;
      const match = matches.get(p.match_id);
      if (!match) continue;

      const stats = partnerStats.get(p.user_id) ?? { games: 0, wins: 0, displayName: p.display_name ?? "Desconhecido" };
      stats.games += 1;
      if (match.winning_team === userTeam) stats.wins += 1;
      partnerStats.set(p.user_id, stats);
    }

    let best: SynergyNemesisResult | null = null;
    let highestScore = -1;
    for (const [partnerId, stats] of partnerStats) {
      if (stats.games < minGames || stats.wins === 0) continue;
      const winrate = stats.wins / stats.games;
      const score = winrate * 1000 + stats.games;
      if (score > highestScore) {
        highestScore = score;
        best = { userId: partnerId, displayName: stats.displayName, games: stats.games, wins: stats.wins, winrate };
      }
    }
    return best;
  }

  async getNemesis(guildId: string, userId: string, minGames = 2): Promise<SynergyNemesisResult | null> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) return null;

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);

    const userMatches = new Map<string, Team>();
    for (const p of participants) {
      if (p.user_id === userId) userMatches.set(p.match_id, p.team);
    }
    if (userMatches.size === 0) return null;

    const enemyStats = new Map<string, { games: number; winsAgainstUser: number; displayName: string }>();
    for (const p of participants) {
      if (p.user_id === userId) continue;
      const userTeam = userMatches.get(p.match_id);
      if (!userTeam || p.team === userTeam) continue;
      const match = matches.get(p.match_id);
      if (!match) continue;

      const stats = enemyStats.get(p.user_id) ?? { games: 0, winsAgainstUser: 0, displayName: p.display_name ?? "Desconhecido" };
      stats.games += 1;
      if (match.winning_team === p.team) stats.winsAgainstUser += 1;
      enemyStats.set(p.user_id, stats);
    }

    let worst: SynergyNemesisResult | null = null;
    let highestScore = -1;
    for (const [enemyId, stats] of enemyStats) {
      if (stats.games < minGames || stats.winsAgainstUser === 0) continue;
      const winrate = stats.winsAgainstUser / stats.games;
      const score = winrate * 1000 + stats.games;
      if (score > highestScore) {
        highestScore = score;
        worst = { userId: enemyId, displayName: stats.displayName, games: stats.games, wins: stats.winsAgainstUser, winrate };
      }
    }
    return worst;
  }

  async getRoleReport(guildId: string, userId: string): Promise<RoleReportResult | null> {
    const participants = await this.getParticipantRowsForUser(userId);
    const matches = await this.getMatchesByIds(
      guildId,
      participants.map((row) => row.match_id),
    );
    const roleRecords = this.recordsByRole(participants, matches);

    let totalGames = 0;
    for (const record of roleRecords.values()) totalGames += record.games;
    if (totalGames === 0) return null;

    const roles: RoleDistribution[] = ROLES
      .map((role) => {
        const record = roleRecords.get(role) ?? { games: 0, wins: 0, losses: 0 };
        return {
          role,
          ...record,
          percentage: totalGames > 0 ? record.games / totalGames : 0,
        };
      })
      .filter((r) => r.games > 0)
      .sort((a, b) => b.games - a.games);

    const rolesPlayed = roles.length;
    const versatility = rolesPlayed / ROLES.length;

    return { totalGames, roles, versatility };
  }

  async getServerHighlights(guildId: string): Promise<ServerHighlights | null> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) return null;

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);
    const allUserIds = new Set(participants.map((p) => p.user_id));
    const names = await this.getDisplayNames([...allUserIds]);
    const name = (userId: string) => names.get(userId) ?? "Desconhecido";

    // --- Top MMR ---
    const { data: topStat } = await supabase
      .from("player_stats_global")
      .select("user_id, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .order("mmr", { ascending: false })
      .limit(1);

    const topMmr = topStat?.[0]
      ? { displayName: name(topStat[0].user_id), mmr: displayMmr(topStat[0]) }
      : null;

    // --- Per-user W/L ---
    const userRecords = new Map<string, { games: number; wins: number; losses: number }>();
    for (const p of participants) {
      const match = matches.get(p.match_id);
      if (!match || match.winning_team === "NONE") continue;
      const current = userRecords.get(p.user_id) ?? { games: 0, wins: 0, losses: 0 };
      current.games += 1;
      if (match.winning_team === p.team) current.wins += 1;
      else current.losses += 1;
      userRecords.set(p.user_id, current);
    }

    // --- Top Winrate (min 3 games) ---
    let topWinrate: ServerHighlights["topWinrate"] = null;
    let bestWr = -1;
    for (const [userId, record] of userRecords) {
      if (record.games < 3) continue;
      const wr = record.wins / record.games;
      if (wr > bestWr) {
        bestWr = wr;
        topWinrate = { displayName: name(userId), winrate: wr, games: record.games };
      }
    }

    // --- Most Active ---
    let mostActive: ServerHighlights["mostActive"] = null;
    let maxGames = 0;
    for (const [userId, record] of userRecords) {
      if (record.games > maxGames) {
        maxGames = record.games;
        mostActive = { displayName: name(userId), games: record.games };
      }
    }

    // --- Top Current Win Streak ---
    const sortedMatches = [...matches.entries()]
      .filter(([, m]) => m.winning_team !== "NONE")
      .sort(([, a], [, b]) => Date.parse(a.completed_at ?? a.created_at) - Date.parse(b.completed_at ?? b.created_at));

    const streaks = new Map<string, number>();
    for (const [matchId, match] of sortedMatches) {
      for (const p of participants.filter((pp) => pp.match_id === matchId)) {
        const won = match.winning_team === p.team;
        const current = streaks.get(p.user_id) ?? 0;
        streaks.set(p.user_id, won ? (current > 0 ? current + 1 : 1) : (current < 0 ? current - 1 : -1));
      }
    }

    let topStreak: ServerHighlights["topStreak"] = null;
    let bestStreak = 0;
    for (const [userId, streak] of streaks) {
      if (streak > bestStreak) {
        bestStreak = streak;
        topStreak = { displayName: name(userId), streak };
      }
    }

    // --- Best Duo (allies) ---
    const duoKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const duoStats = new Map<string, { id1: string; id2: string; games: number; wins: number }>();

    for (const [matchId, match] of matches) {
      if (match.winning_team === "NONE") continue;
      const matchParticipants = participants.filter((p) => p.match_id === matchId);
      const teams = new Map<string, string>();
      for (const p of matchParticipants) teams.set(p.user_id, p.team);

      for (let i = 0; i < matchParticipants.length; i++) {
        for (let j = i + 1; j < matchParticipants.length; j++) {
          const p1 = matchParticipants[i]!;
          const p2 = matchParticipants[j]!;
          if (p1.team !== p2.team) continue;
          const key = duoKey(p1.user_id, p2.user_id);
          const stat = duoStats.get(key) ?? { id1: p1.user_id, id2: p2.user_id, games: 0, wins: 0 };
          stat.games += 1;
          if (match.winning_team === p1.team) stat.wins += 1;
          duoStats.set(key, stat);
        }
      }
    }

    let bestDuo: ServerHighlights["bestDuo"] = null;
    let bestDuoScore = -1;
    for (const stat of duoStats.values()) {
      if (stat.games < 2 || stat.wins === 0) continue;
      const wr = stat.wins / stat.games;
      const score = wr * 1000 + stat.games;
      if (score > bestDuoScore) {
        bestDuoScore = score;
        bestDuo = { name1: name(stat.id1), name2: name(stat.id2), winrate: wr, games: stat.games };
      }
    }

    // --- Biggest Rivalry (enemies) ---
    const rivalryStats = new Map<string, { id1: string; id2: string; games: number }>();
    for (const [matchId] of matches) {
      const matchParticipants = participants.filter((p) => p.match_id === matchId);
      for (let i = 0; i < matchParticipants.length; i++) {
        for (let j = i + 1; j < matchParticipants.length; j++) {
          const p1 = matchParticipants[i]!;
          const p2 = matchParticipants[j]!;
          if (p1.team === p2.team) continue;
          const key = duoKey(p1.user_id, p2.user_id);
          const stat = rivalryStats.get(key) ?? { id1: p1.user_id, id2: p2.user_id, games: 0 };
          stat.games += 1;
          rivalryStats.set(key, stat);
        }
      }
    }

    let biggestRivalry: ServerHighlights["biggestRivalry"] = null;
    let maxRivalryGames = 0;
    for (const stat of rivalryStats.values()) {
      if (stat.games > maxRivalryGames) {
        maxRivalryGames = stat.games;
        biggestRivalry = { name1: name(stat.id1), name2: name(stat.id2), games: stat.games };
      }
    }

    return { topMmr, topWinrate, topStreak, bestDuo, biggestRivalry, mostActive };
  }

  // ---------- private helpers ----------

  private async getGlobalStat(guildId: string, userId: string): Promise<GlobalStatRow | null> {
    const { data, error } = await supabase
      .from("player_stats_global")
      .select("guild_id, user_id, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load global stat: ${error.message}`);
    return data;
  }

  private async getGlobalRank(guildId: string, mmr: number): Promise<number | null> {
    const { count, error } = await supabase
      .from("player_stats_global")
      .select("*", { count: "exact", head: true })
      .eq("guild_id", guildId)
      .gt("mmr", mmr);

    if (error) return null;
    return (count ?? 0) + 1;
  }

  private async getParticipantRowsForUser(userId: string): Promise<ParticipantRow[]> {
    const { data, error } = await supabase
      .from("match_participants")
      .select("match_id, user_id, role, team, mu_before, sigma_before, mmr_before, champion_name, display_name")
      .eq("user_id", userId);

    if (error) throw new Error(`Failed to load match participants: ${error.message}`);
    return data;
  }

  private async getParticipantsByMatchIds(matchIds: readonly string[]): Promise<ParticipantRow[]> {
    if (matchIds.length === 0) return [];

    const { data, error } = await supabase
      .from("match_participants")
      .select("match_id, user_id, role, team, mu_before, sigma_before, mmr_before, champion_name, display_name")
      .in("match_id", [...matchIds]);

    if (error) throw new Error(`Failed to load match participants: ${error.message}`);
    return data;
  }

  private async getMatchesByIds(guildId: string, matchIds: readonly string[]): Promise<Map<string, MatchRow>> {
    if (matchIds.length === 0) return new Map();

    const { data, error } = await supabase
      .from("matches")
      .select("id, match_number, guild_id, status, winning_team, created_at, completed_at")
      .eq("guild_id", guildId)
      .in("id", [...new Set(matchIds)]);

    if (error) throw new Error(`Failed to load matches: ${error.message}`);
    return new Map(data.map((row) => [row.id, row]));
  }

  private async getCompletedMatches(guildId: string): Promise<Map<string, MatchRow>> {
    const { data, error } = await supabase
      .from("matches")
      .select("id, match_number, guild_id, status, winning_team, created_at, completed_at")
      .eq("guild_id", guildId)
      .eq("status", "COMPLETED");

    if (error) throw new Error(`Failed to load completed matches: ${error.message}`);
    return new Map(data.map((row) => [row.id, row]));
  }

  private async getDisplayNames(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();

    const { data, error } = await supabase
      .from("users")
      .select("id, display_name")
      .in("id", [...new Set(userIds)]);

    if (error) throw new Error(`Failed to load display names: ${error.message}`);
    return new Map(data.map((row) => [row.id, row.display_name]));
  }

  private recordsByRole(
    participants: readonly ParticipantRow[],
    matches: Map<string, MatchRow>,
  ): Map<Role, { games: number; wins: number; losses: number }> {
    const records = new Map<Role, { games: number; wins: number; losses: number }>();

    for (const participant of participants) {
      const match = matches.get(participant.match_id);
      if (!match || match.status !== "COMPLETED") continue;

      const current = records.get(participant.role) ?? { games: 0, wins: 0, losses: 0 };
      current.games += 1;
      if (match.winning_team === participant.team) {
        current.wins += 1;
      } else {
        current.losses += 1;
      }
      records.set(participant.role, current);
    }

    return records;
  }

  private resultFor(participant: ParticipantRow, match: MatchRow): HistoryEntry["result"] {
    if (match.status === "ONGOING" || match.status === "PENDING") return "ONGOING";
    if (match.status === "CANCELLED") return "CANCELLED";
    if (match.winning_team === "NONE") return "UNKNOWN";
    return match.winning_team === participant.team ? "WIN" : "LOSS";
  }

  private async getLatestMatchIdForUser(guildId: string, userId: string): Promise<string | null> {
    const history = await this.getHistory(guildId, userId, 1);
    return history[0]?.matchId ?? null;
  }
}
