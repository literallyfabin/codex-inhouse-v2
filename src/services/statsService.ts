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

interface StatRow {
  guild_id: string;
  user_id: string;
  role: Role;
  mu: number;
  sigma: number;
  mmr: number;
}

export interface PlayerRoleSummary {
  role: Role;
  mu: number;
  sigma: number;
  mmr: number;
  games: number;
  wins: number;
  losses: number;
  rank: number | null;
}

export interface RankingEntry extends PlayerRoleSummary {
  userId: string;
  displayName: string;
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

const keyFor = (userId: string, role: Role): string => `${userId}:${role}`;

const displayMmr = (stat: Pick<StatRow, "mu" | "sigma" | "mmr">): number =>
  Number.isFinite(stat.mmr) ? stat.mmr : conservativeMmr(stat.mu, stat.sigma);

export class StatsService {
  async getPlayerSummary(guildId: string, userId: string): Promise<PlayerRoleSummary[]> {
    const [{ data: stats, error: statsError }, participantRows] = await Promise.all([
      supabase
        .from("player_stats")
        .select("guild_id, user_id, role, mu, sigma, mmr")
        .eq("guild_id", guildId)
        .eq("user_id", userId),
      this.getParticipantRowsForUser(userId),
    ]);

    if (statsError) {
      throw new Error(`Failed to load player stats: ${statsError.message}`);
    }

    const matchIds = participantRows.map((row) => row.match_id);
    const matches = await this.getMatchesByIds(guildId, matchIds);
    const records = this.recordsByRole(participantRows, matches);
    const ranks = await this.rankByRole(guildId, stats);

    return ROLES.map((role) => {
      const stat = stats.find((row) => row.role === role);
      const record = records.get(role) ?? { games: 0, wins: 0, losses: 0 };

      return {
        role,
        mu: stat?.mu ?? 25,
        sigma: stat?.sigma ?? 25 / 3,
        mmr: stat ? displayMmr(stat) : conservativeMmr(25, 25 / 3),
        games: record.games,
        wins: record.wins,
        losses: record.losses,
        rank: ranks.get(role) ?? null,
      };
    }).filter((row) => row.games > 0 || row.mmr !== conservativeMmr(25, 25 / 3));
  }

  async getRanking(guildId: string, role?: Role, limit = 30): Promise<RankingEntry[]> {
    const matches = await this.getCompletedMatches(guildId);
    if (matches.size === 0) {
      return [];
    }

    const participants = await this.getParticipantsByMatchIds([...matches.keys()]);
    const records = new Map<string, { games: number; wins: number; losses: number }>();

    for (const participant of participants) {
      if (role && participant.role !== role) {
        continue;
      }

      const match = matches.get(participant.match_id);
      if (!match) {
        continue;
      }

      const key = keyFor(participant.user_id, participant.role);
      const current = records.get(key) ?? { games: 0, wins: 0, losses: 0 };
      current.games += 1;
      if (match.winning_team === participant.team) {
        current.wins += 1;
      } else {
        current.losses += 1;
      }
      records.set(key, current);
    }

    if (records.size === 0) {
      return [];
    }

    let statsQuery = supabase
      .from("player_stats")
      .select("guild_id, user_id, role, mu, sigma, mmr")
      .eq("guild_id", guildId);

    if (role) {
      statsQuery = statsQuery.eq("role", role);
    }

    const { data: stats, error: statsError } = await statsQuery;
    if (statsError) {
      throw new Error(`Failed to load ranking stats: ${statsError.message}`);
    }

    const userIds = [...new Set(stats.map((row) => row.user_id))];
    const names = await this.getDisplayNames(userIds);

    const entries: RankingEntry[] = [];

    for (const stat of stats) {
      const record = records.get(keyFor(stat.user_id, stat.role));
      if (!record) {
        continue;
      }

      entries.push({
        userId: stat.user_id,
        displayName: names.get(stat.user_id) ?? stat.user_id,
        role: stat.role,
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
      .sort((left, right) => right.mmr - left.mmr)
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
        if (!match) {
          return null;
        }

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
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
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
      if (!match || (role && participant.role !== role)) {
        continue;
      }

      history.push({
        role: participant.role,
        matchId: participant.match_id,
        matchNumber: match.match_number,
        mmr: participant.mmr_before,
        createdAt: match.created_at,
        isCurrent: false,
      });
    }

    history.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

    const statsQuery = supabase
      .from("player_stats")
      .select("guild_id, user_id, role, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .eq("user_id", userId);
    const { data: stats, error: statsError } = role ? await statsQuery.eq("role", role) : await statsQuery;

    if (statsError) {
      throw new Error(`Failed to load current MMR history point: ${statsError.message}`);
    }

    const now = new Date().toISOString();
    const currentPoints = stats.map((stat) => ({
      role: stat.role,
      matchId: "current",
      matchNumber: null,
      mmr: displayMmr(stat),
      createdAt: now,
      isCurrent: true,
    } satisfies MmrHistoryEntry));

    return [...history.slice(-limit), ...currentPoints]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(-limit);
  }

  async getComparison(
    guildId: string,
    user1Id: string,
    user2Id: string,
  ): Promise<{
    allies: { games: number; wins: number; losses: number };
    enemies: { games: number; user1Wins: number; user2Wins: number };
  }> {
    const participants1 = await this.getParticipantRowsForUser(user1Id);
    const participants2 = await this.getParticipantRowsForUser(user2Id);

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
      if (!match || match.status !== "COMPLETED" || match.winning_team === "NONE") {
        continue;
      }

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

    if (error) {
      throw new Error(`Failed to set champion: ${error.message}`);
    }

    return targetMatchId;
  }

  private async getParticipantRowsForUser(userId: string): Promise<ParticipantRow[]> {
    const { data, error } = await supabase
      .from("match_participants")
      .select("match_id, user_id, role, team, mu_before, sigma_before, mmr_before, champion_name, display_name")
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to load match participants: ${error.message}`);
    }

    return data;
  }

  private async getParticipantsByMatchIds(matchIds: readonly string[]): Promise<ParticipantRow[]> {
    if (matchIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("match_participants")
      .select("match_id, user_id, role, team, mu_before, sigma_before, mmr_before, champion_name, display_name")
      .in("match_id", [...matchIds]);

    if (error) {
      throw new Error(`Failed to load match participants: ${error.message}`);
    }

    return data;
  }

  private async getMatchesByIds(guildId: string, matchIds: readonly string[]): Promise<Map<string, MatchRow>> {
    if (matchIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabase
      .from("matches")
      .select("id, match_number, guild_id, status, winning_team, created_at, completed_at")
      .eq("guild_id", guildId)
      .in("id", [...new Set(matchIds)]);

    if (error) {
      throw new Error(`Failed to load matches: ${error.message}`);
    }

    return new Map(data.map((row) => [row.id, row]));
  }

  private async getCompletedMatches(guildId: string): Promise<Map<string, MatchRow>> {
    const { data, error } = await supabase
      .from("matches")
      .select("id, match_number, guild_id, status, winning_team, created_at, completed_at")
      .eq("guild_id", guildId)
      .eq("status", "COMPLETED");

    if (error) {
      throw new Error(`Failed to load completed matches: ${error.message}`);
    }

    return new Map(data.map((row) => [row.id, row]));
  }

  private async getDisplayNames(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabase
      .from("users")
      .select("id, display_name")
      .in("id", [...new Set(userIds)]);

    if (error) {
      throw new Error(`Failed to load display names: ${error.message}`);
    }

    return new Map(data.map((row) => [row.id, row.display_name]));
  }

  private recordsByRole(
    participants: readonly ParticipantRow[],
    matches: Map<string, MatchRow>,
  ): Map<Role, { games: number; wins: number; losses: number }> {
    const records = new Map<Role, { games: number; wins: number; losses: number }>();

    for (const participant of participants) {
      const match = matches.get(participant.match_id);
      if (!match || match.status !== "COMPLETED") {
        continue;
      }

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

  private async rankByRole(guildId: string, ownStats: readonly StatRow[]): Promise<Map<Role, number>> {
    const rankings = await Promise.all(
      ROLES.map(async (role) => {
        const own = ownStats.find((stat) => stat.role === role);
        if (!own) {
          return null;
        }

        const entries = await this.getRanking(guildId, role, 500);
        const rank = entries.findIndex((entry) => entry.userId === own.user_id);
        return rank >= 0 ? ([role, rank + 1] as const) : null;
      }),
    );

    return new Map(rankings.filter((row): row is readonly [Role, number] => row !== null));
  }

  private resultFor(participant: ParticipantRow, match: MatchRow): HistoryEntry["result"] {
    if (match.status === "ONGOING" || match.status === "PENDING") {
      return "ONGOING";
    }

    if (match.status === "CANCELLED") {
      return "CANCELLED";
    }

    if (match.winning_team === "NONE") {
      return "UNKNOWN";
    }

    return match.winning_team === participant.team ? "WIN" : "LOSS";
  }

  private async getLatestMatchIdForUser(guildId: string, userId: string): Promise<string | null> {
    const history = await this.getHistory(guildId, userId, 1);
    return history[0]?.matchId ?? null;
  }
}
