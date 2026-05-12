import type {
  BalancedMatch,
  MatchStatus,
  PersistedMatch,
  PlayerRating,
  QueuePlayer,
  RatedQueuePlayer,
  Role,
  Team,
  WinningTeam,
} from "../core/models/types.js";
import type { Json } from "../core/models/database.js";
import { conservativeMmr } from "../core/matchmaking/trueskillMath.js";
import { MatchmakingService } from "../core/matchmaking/MatchmakingService.js";
import { supabase } from "./supabaseClient.js";

const jsonStringArray = (value: Json): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
};

const participantPayload = (matchId: string, match: BalancedMatch) =>
  [...match.teamBlue, ...match.teamRed].map((slot) => ({
    match_id: matchId,
    user_id: slot.player.userId,
    role: slot.role,
    team: slot.team,
    mu_before: slot.player.rating.mu,
    sigma_before: slot.player.rating.sigma,
    display_name: slot.player.displayName,
    joined_as_fill: slot.player.joinedAsFill ?? false,
  }));

const mapPersistedMatch = (row: {
  id: string;
  match_number: number;
  guild_id: string;
  status: PersistedMatch["status"];
  team_blue: Json;
  team_red: Json;
  winning_team: WinningTeam;
  blue_expected_winrate: number;
  mu_difference: number;
  created_at: string;
  completed_at: string | null;
}): PersistedMatch => ({
  id: row.id,
  matchNumber: row.match_number,
  guildId: row.guild_id,
  status: row.status,
  teamBlue: jsonStringArray(row.team_blue),
  teamRed: jsonStringArray(row.team_red),
  winningTeam: row.winning_team,
  blueExpectedWinrate: row.blue_expected_winrate,
  muDifference: row.mu_difference,
  createdAt: row.created_at,
  completedAt: row.completed_at,
});

export interface OngoingMatchForUser {
  matchId: string;
  matchNumber: number | null;
  team: Team;
  participantUserIds: string[];
}

export interface MatchContext {
  guildId: string;
  matchNumber: number | null;
  participantUserIds: string[];
  sourceChannelId: string | null;
}

export interface MatchParticipantSummary {
  userId: string;
  role: Role;
  team: Team;
  displayName: string | null;
  mmrBefore: number;
  championName: string | null;
}

export interface MatchSummary {
  id: string;
  matchNumber: number | null;
  guildId: string;
  status: MatchStatus;
  winningTeam: WinningTeam;
  createdAt: string;
  completedAt: string | null;
  blueExpectedWinrate: number;
  muDifference: number;
  participants: MatchParticipantSummary[];
}

export class MatchService {
  constructor(private readonly matchmaking = new MatchmakingService()) {}

  async hydrateRatings(players: readonly QueuePlayer[]): Promise<RatedQueuePlayer[]> {
    const guildIds = new Set(players.map((player) => player.guildId));
    if (guildIds.size !== 1) {
      throw new Error("All players in a match must belong to the same guild.");
    }

    const guildId = players[0]?.guildId;
    if (!guildId) {
      throw new Error("Cannot hydrate ratings without a guild id.");
    }

    const userIds = [...new Set(players.map((player) => player.userId))];
    const defaultRows = userIds.map((userId) => ({
      guild_id: guildId,
      user_id: userId,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from("player_stats_global")
      .upsert(defaultRows, { onConflict: "guild_id,user_id", ignoreDuplicates: true });

    if (upsertError) {
      throw new Error(`Failed to prepare player ratings: ${upsertError.message}`);
    }

    const { data, error } = await supabase
      .from("player_stats_global")
      .select("guild_id, user_id, mu, sigma, mmr")
      .eq("guild_id", guildId)
      .in("user_id", userIds);

    if (error) {
      throw new Error(`Failed to load player ratings: ${error.message}`);
    }

    const ratingsByUserId = new Map<string, PlayerRating>();
    for (const row of data) {
      ratingsByUserId.set(row.user_id, {
        guildId: row.guild_id,
        userId: row.user_id,
        role: "TOP",
        mu: row.mu,
        sigma: row.sigma,
        mmr: row.mmr,
      });
    }

    // Load streaks for streak protection
    const streaks = await this.computeStreaks(guildId, userIds);

    return players.map((player) => {
      const base = ratingsByUserId.get(player.userId);
      if (!base) {
        throw new Error(`Missing rating for user ${player.userId}.`);
      }

      return {
        ...player,
        rating: { ...base, role: player.role as Role },
        streak: streaks.get(player.userId) ?? 0,
      };
    });
  }

  /**
   * Compute current streak for each user: positive = wins, negative = losses.
   * Looks at recent completed matches chronologically.
   */
  private async computeStreaks(guildId: string, userIds: string[]): Promise<Map<string, number>> {
    const { data: matches } = await supabase
      .from("matches")
      .select("id, winning_team, completed_at")
      .eq("guild_id", guildId)
      .eq("status", "COMPLETED")
      .neq("winning_team", "NONE")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(50);

    if (!matches || matches.length === 0) return new Map();

    const matchIds = matches.map((m) => m.id);
    const { data: participants } = await supabase
      .from("match_participants")
      .select("match_id, user_id, team")
      .in("match_id", matchIds)
      .in("user_id", userIds);

    if (!participants) return new Map();

    const matchMap = new Map(matches.map((m) => [m.id, m.winning_team as string]));
    // Group participants by user, ordered by match recency (matches already desc)
    const userMatches = new Map<string, { won: boolean }[]>();
    for (const m of matches) {
      for (const p of participants.filter((pp) => pp.match_id === m.id)) {
        const list = userMatches.get(p.user_id) ?? [];
        list.push({ won: matchMap.get(p.match_id) === p.team });
        userMatches.set(p.user_id, list);
      }
    }

    const streaks = new Map<string, number>();
    for (const [userId, results] of userMatches) {
      if (results.length === 0) continue;
      const dir = results[0]!.won ? 1 : -1;
      let count = 1;
      for (let i = 1; i < results.length; i++) {
        if ((dir > 0 && results[i]!.won) || (dir < 0 && !results[i]!.won)) {
          count++;
        } else {
          break;
        }
      }
      streaks.set(userId, count * dir);
    }
    return streaks;
  }

  async createMatch(match: BalancedMatch): Promise<PersistedMatch> {
    const guildId = match.teamBlue[0]?.player.guildId ?? match.teamRed[0]?.player.guildId;
    if (!guildId) {
      throw new Error("Cannot create match without a guild id.");
    }

    const teamBlueIds = match.teamBlue.map((slot) => slot.player.userId);
    const teamRedIds = match.teamRed.map((slot) => slot.player.userId);
    const participantUserIds = [...teamBlueIds, ...teamRedIds];
    const ongoingUserIds = await this.findOngoingParticipantUserIds(guildId, participantUserIds);
    if (ongoingUserIds.size > 0) {
      throw new Error(
        `Cannot create match: ${ongoingUserIds.size} participant(s) already have an ongoing match.`,
      );
    }

    const { data, error } = await supabase
      .from("matches")
      .insert({
        guild_id: guildId,
        status: "ONGOING",
        team_blue: teamBlueIds,
        team_red: teamRedIds,
        winning_team: "NONE",
        blue_expected_winrate: match.blueExpectedWinrate,
        mu_difference: match.muDifference,
        source_channel_id: match.teamBlue[0]?.player.channelId ?? null,
      })
      .select(
        "id, match_number, guild_id, status, team_blue, team_red, winning_team, blue_expected_winrate, mu_difference, created_at, completed_at",
      )
      .single();

    if (error) {
      throw new Error(`Failed to create match: ${error.message}`);
    }

    const { error: participantsError } = await supabase
      .from("match_participants")
      .insert(participantPayload(data.id, match));

    if (participantsError) {
      throw new Error(`Failed to create match participants: ${participantsError.message}`);
    }

    return mapPersistedMatch(data);
  }

  async completeMatch(matchId: string, winningTeam: Exclude<WinningTeam, "NONE">): Promise<void> {
    const { data: matchRow, error: matchLoadError } = await supabase
      .from("matches")
      .select("guild_id, status")
      .eq("id", matchId)
      .single();

    if (matchLoadError) {
      throw new Error(`Failed to load match ${matchId}: ${matchLoadError.message}`);
    }

    if (matchRow.status !== "ONGOING") {
      throw new Error(`Match ${matchId} cannot be completed from status ${matchRow.status}.`);
    }

    const { data: participantRows, error: participantsError } = await supabase
      .from("match_participants")
      .select("user_id, role, team, mu_before, sigma_before, display_name, joined_as_fill")
      .eq("match_id", matchId);

    if (participantsError) {
      throw new Error(`Failed to load match participants: ${participantsError.message}`);
    }

    if (participantRows.length !== 10) {
      throw new Error(`Match ${matchId} has ${participantRows.length} participants; expected 10.`);
    }

    const match = this.rebuildBalancedMatch(participantRows);
    const updates = this.matchmaking.calculateUpdatedRatings(match, winningTeam);
    const now = new Date().toISOString();

    const { error: statsError } = await supabase.from("player_stats_global").upsert(
      updates.map((rating) => ({
        guild_id: matchRow.guild_id,
        user_id: rating.userId,
        mu: rating.mu,
        sigma: rating.sigma,
        updated_at: now,
      })),
      { onConflict: "guild_id,user_id" },
    );

    if (statsError) {
      throw new Error(`Failed to update player stats: ${statsError.message}`);
    }

    const { error: matchError } = await supabase
      .from("matches")
      .update({
        status: "COMPLETED",
        winning_team: winningTeam,
        completed_at: now,
      })
      .eq("id", matchId);

    if (matchError) {
      throw new Error(`Failed to complete match: ${matchError.message}`);
    }
  }

  async cancelMatch(matchId: string): Promise<void> {
    const { data: matchRow, error: matchLoadError } = await supabase
      .from("matches")
      .select("status")
      .eq("id", matchId)
      .single();

    if (matchLoadError) {
      throw new Error(`Failed to load match ${matchId}: ${matchLoadError.message}`);
    }

    if (matchRow.status === "COMPLETED") {
      throw new Error(`Match ${matchId} is already completed and cannot be cancelled.`);
    }

    const { error } = await supabase
      .from("matches")
      .update({
        status: "CANCELLED",
        winning_team: "NONE",
        completed_at: new Date().toISOString(),
      })
      .eq("id", matchId);

    if (error) {
      throw new Error(`Failed to cancel match: ${error.message}`);
    }
  }

  async getMatchContext(matchId: string): Promise<MatchContext> {
    const { data: matchRow, error: matchError } = await supabase
      .from("matches")
      .select("guild_id, match_number, source_channel_id")
      .eq("id", matchId)
      .single();

    if (matchError) {
      throw new Error(`Failed to load match context: ${matchError.message}`);
    }

    const { data: participantRows, error: participantError } = await supabase
      .from("match_participants")
      .select("user_id")
      .eq("match_id", matchId);

    if (participantError) {
      throw new Error(`Failed to load match participants: ${participantError.message}`);
    }

    return {
      guildId: matchRow.guild_id,
      matchNumber: matchRow.match_number,
      participantUserIds: participantRows.map((row) => row.user_id),
      sourceChannelId: matchRow.source_channel_id,
    };
  }

  async setDiscordMessageId(matchId: string, discordMessageId: string): Promise<void> {
    const { error } = await supabase
      .from("matches")
      .update({ discord_message_id: discordMessageId })
      .eq("id", matchId);

    if (error) {
      throw new Error(`Failed to save Discord message id: ${error.message}`);
    }
  }

  async hasOngoingMatchForUser(guildId: string, userId: string): Promise<boolean> {
    return (await this.findOngoingParticipantUserIds(guildId, [userId])).size > 0;
  }

  async findOngoingParticipantUserIds(
    guildId: string,
    userIds: readonly string[],
  ): Promise<Set<string>> {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) {
      return new Set();
    }

    const { data: participantRows, error: participantError } = await supabase
      .from("match_participants")
      .select("match_id, user_id")
      .in("user_id", uniqueUserIds);

    if (participantError) {
      throw new Error(`Failed to check ongoing match participants: ${participantError.message}`);
    }

    const matchIds = participantRows.map((row) => row.match_id);
    if (matchIds.length === 0) {
      return new Set();
    }

    const { data, error } = await supabase
      .from("matches")
      .select("id")
      .eq("guild_id", guildId)
      .eq("status", "ONGOING")
      .in("id", [...new Set(matchIds)]);

    if (error) {
      throw new Error(`Failed to check ongoing matches: ${error.message}`);
    }

    const ongoingMatchIds = new Set(data.map((row) => row.id));
    return new Set(
      participantRows
        .filter((row) => ongoingMatchIds.has(row.match_id))
        .map((row) => row.user_id),
    );
  }

  async getLatestOngoingMatchForUser(
    guildId: string,
    userId: string,
  ): Promise<OngoingMatchForUser | null> {
    const { data: userParticipantRows, error: participantLoadError } = await supabase
      .from("match_participants")
      .select("match_id, team")
      .eq("user_id", userId);

    if (participantLoadError) {
      throw new Error(`Failed to load user matches: ${participantLoadError.message}`);
    }

    const matchIds = userParticipantRows.map((row) => row.match_id);
    if (matchIds.length === 0) {
      return null;
    }

    const { data: matchRows, error: matchLoadError } = await supabase
      .from("matches")
      .select("id, match_number")
      .eq("guild_id", guildId)
      .eq("status", "ONGOING")
      .in("id", matchIds)
      .order("created_at", { ascending: false })
      .limit(1);

    if (matchLoadError) {
      throw new Error(`Failed to load ongoing match: ${matchLoadError.message}`);
    }

    const matchId = matchRows[0]?.id;
    if (!matchId) {
      return null;
    }
    const matchNumber = matchRows[0]?.match_number ?? null;

    const { data: participantRows, error: participantsError } = await supabase
      .from("match_participants")
      .select("user_id, team")
      .eq("match_id", matchId);

    if (participantsError) {
      throw new Error(`Failed to load match participants: ${participantsError.message}`);
    }

    const requesterParticipant = participantRows.find((row) => row.user_id === userId);
    if (!requesterParticipant) {
      return null;
    }

    return {
      matchId,
      matchNumber,
      team: requesterParticipant.team,
      participantUserIds: participantRows.map((row) => row.user_id),
    };
  }

  async resolveMatchId(guildId: string, identifier: string): Promise<string> {
    const value = identifier.trim();
    const numericValue = value.replace(/^#/, "");

    if (/^\d+$/.test(numericValue)) {
      const matchNumber = Number.parseInt(numericValue, 10);
      if (!Number.isSafeInteger(matchNumber) || matchNumber <= 0) {
        throw new Error("Invalid match number.");
      }

      const { data, error } = await supabase
        .from("matches")
        .select("id")
        .eq("guild_id", guildId)
        .eq("match_number", matchNumber)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to resolve match number: ${error.message}`);
      }

      if (!data) {
        throw new Error(`Match #${numericValue.padStart(4, "0")} was not found in this guild.`);
      }

      return data.id;
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error("Use a match number like #0001 or the full UUID.");
    }

    const { data, error } = await supabase
      .from("matches")
      .select("id")
      .eq("guild_id", guildId)
      .eq("id", value)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve match id: ${error.message}`);
    }

    if (!data) {
      throw new Error("Match was not found in this guild.");
    }

    return data.id;
  }

  async getOngoingMatchSummaries(guildId: string, limit = 5): Promise<MatchSummary[]> {
    const { data, error } = await supabase
      .from("matches")
      .select("id, match_number, guild_id, status, winning_team, blue_expected_winrate, mu_difference, created_at, completed_at")
      .eq("guild_id", guildId)
      .eq("status", "ONGOING")
      .order("match_number", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to load ongoing matches: ${error.message}`);
    }

    return this.withParticipantSummaries(data);
  }

  async getLatestMatchSummary(guildId: string, userId?: string): Promise<MatchSummary | null> {
    let matchIds: string[] | undefined;

    if (userId) {
      const { data: participantRows, error: participantError } = await supabase
        .from("match_participants")
        .select("match_id")
        .eq("user_id", userId);

      if (participantError) {
        throw new Error(`Failed to load user matches: ${participantError.message}`);
      }

      matchIds = [...new Set(participantRows.map((row) => row.match_id))];
      if (matchIds.length === 0) {
        return null;
      }
    }

    let query = supabase
      .from("matches")
      .select("id, match_number, guild_id, status, winning_team, blue_expected_winrate, mu_difference, created_at, completed_at")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (matchIds) {
      query = query.in("id", matchIds);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load latest match: ${error.message}`);
    }

    const summaries = await this.withParticipantSummaries(data);
    return summaries[0] ?? null;
  }

  private rebuildBalancedMatch(
    rows: readonly {
      user_id: string;
      role: Role;
      team: Team;
      mu_before: number;
      sigma_before: number;
      display_name: string | null;
      joined_as_fill?: boolean;
    }[],
  ): BalancedMatch {
    const toSlot = (row: (typeof rows)[number]) => ({
      team: row.team,
      role: row.role,
      player: {
        userId: row.user_id,
        guildId: "loaded-from-match",
        channelId: "loaded-from-match",
        platform: "discord" as const,
        platformUserId: row.user_id,
        displayName: row.display_name ?? row.user_id,
        role: row.role,
        joinedAt: new Date(0),
        joinedAsFill: row.joined_as_fill ?? false,
        rating: {
          guildId: "loaded-from-match",
          userId: row.user_id,
          role: row.role,
          mu: row.mu_before,
          sigma: row.sigma_before,
          mmr: conservativeMmr(row.mu_before, row.sigma_before),
        },
      },
    });

    const teamBlue = rows.filter((row) => row.team === "BLUE").map(toSlot);
    const teamRed = rows.filter((row) => row.team === "RED").map(toSlot);

    return {
      teamBlue,
      teamRed,
      blueExpectedWinrate: 0.5,
      muDifference: 0,
      balanceScore: 0,
    };
  }

  private async withParticipantSummaries(
    rows: readonly {
      id: string;
      match_number: number | null;
      guild_id: string;
      status: MatchStatus;
      winning_team: WinningTeam;
      blue_expected_winrate: number;
      mu_difference: number;
      created_at: string;
      completed_at: string | null;
    }[],
  ): Promise<MatchSummary[]> {
    const participantMap = await this.getParticipantSummariesByMatchIds(rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      matchNumber: row.match_number,
      guildId: row.guild_id,
      status: row.status,
      winningTeam: row.winning_team,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      blueExpectedWinrate: row.blue_expected_winrate,
      muDifference: row.mu_difference,
      participants: participantMap.get(row.id) ?? [],
    }));
  }

  private async getParticipantSummariesByMatchIds(
    matchIds: readonly string[],
  ): Promise<Map<string, MatchParticipantSummary[]>> {
    if (matchIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabase
      .from("match_participants")
      .select("match_id, user_id, role, team, display_name, mmr_before, champion_name")
      .in("match_id", [...new Set(matchIds)]);

    if (error) {
      throw new Error(`Failed to load match participants: ${error.message}`);
    }

    const byMatch = new Map<string, MatchParticipantSummary[]>();
    for (const row of data) {
      const entries = byMatch.get(row.match_id) ?? [];
      entries.push({
        userId: row.user_id,
        role: row.role,
        team: row.team,
        displayName: row.display_name,
        mmrBefore: row.mmr_before,
        championName: row.champion_name,
      });
      byMatch.set(row.match_id, entries);
    }

    return byMatch;
  }
}
