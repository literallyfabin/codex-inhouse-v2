import { env } from "../config/env.js";

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

// Basic interfaces based on Riot's Tournament Stub API
export interface TournamentCodeParameters {
  enoughPlayers: boolean;
  mapType: "SUMMONERS_RIFT" | "HOWLING_ABYSS";
  metadata: string;
  pickType: "BLIND_PICK" | "DRAFT_MODE" | "ALL_RANDOM" | "TOURNAMENT_DRAFT";
  spectatorType: "NONE" | "LOBBYONLY" | "ALL";
  teamSize: number;
}

export class RiotApiService {
  private apiKey: string;
  private baseUrl = "https://americas.api.riotgames.com";
  private providerId?: number;
  private tournamentId?: number;

  constructor() {
    this.apiKey = env.RIOT_API_KEY || "";
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async request<T>(endpoint: string, method = "GET", body?: any): Promise<T> {
    if (!this.apiKey) throw new Error("RIOT_API_KEY is not configured.");

    const url = `${this.baseUrl}${endpoint}`;
    const init: RequestInit = {
      method,
      headers: {
        "X-Riot-Token": this.apiKey,
        "Content-Type": "application/json",
      },
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Riot API Error (${response.status}): ${text}`);
    }

    return response.json();
  }

  /**
   * Look up a Riot account by Nick#Tag using the account-v1 API.
   * This works with a Development API Key.
   */
  async getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotAccount> {
    const data = await this.request<{ puuid: string; gameName: string; tagLine: string }>(
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );
    return { puuid: data.puuid, gameName: data.gameName, tagLine: data.tagLine };
  }

  /**
   * Look up a Riot account by PUUID.
   */
  async getAccountByPuuid(puuid: string): Promise<RiotAccount> {
    const data = await this.request<{ puuid: string; gameName: string; tagLine: string }>(
      `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`
    );
    return { puuid: data.puuid, gameName: data.gameName, tagLine: data.tagLine };
  }

  // ─── Tournament Stub (works with Dev Key) ───────────────────────────────────

  private async getProviderId(): Promise<number> {
    if (this.providerId) return this.providerId;

    // tournament-stub-v5 providers — works with dev key
    const providerId = await this.request<number>("/lol/tournament-stub/v5/providers", "POST", {
      region: "BR",
      url: env.WEBHOOK_URL ?? "https://codex-inhouse-v2.onrender.com/riot/callback",
    });
    this.providerId = providerId;
    return providerId;
  }

  private async getTournamentId(): Promise<number> {
    if (this.tournamentId) return this.tournamentId;

    const providerId = await this.getProviderId();
    // tournament-stub-v5 tournaments
    const tournamentId = await this.request<number>("/lol/tournament-stub/v5/tournaments", "POST", {
      name: "Inhouse Discord Matches",
      providerId,
    });
    this.tournamentId = tournamentId;
    return tournamentId;
  }

  async createTournamentCode(matchId: string, teamSize = 5): Promise<string> {
    if (!this.isConfigured) {
      throw new Error("RIOT_API_KEY is not configured.");
    }

    const tournamentId = await this.getTournamentId();
    const params: TournamentCodeParameters = {
      enoughPlayers: false,
      mapType: "SUMMONERS_RIFT",
      metadata: JSON.stringify({ matchId }),
      pickType: "TOURNAMENT_DRAFT",
      spectatorType: "LOBBYONLY",
      teamSize,
    };

    // tournament-stub-v5 codes — works with dev key!
    const codes = await this.request<string[]>(
      `/lol/tournament-stub/v5/codes?count=1&tournamentId=${tournamentId}`,
      "POST",
      params,
    );

    return codes[0] || "";
  }
}

export const riotApiService = new RiotApiService();
