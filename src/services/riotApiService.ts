import { env } from "../config/env.js";

// Basic interfaces based on Riot's Tournament API
export interface TournamentCodeParameters {
  allowedParticipants?: string[];
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
  // We can cache these if we want, but for now we'll fetch or require them
  private providerId?: number;
  private tournamentId?: number;

  constructor() {
    this.apiKey = env.RIOT_API_KEY || "";
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0 && !!env.WEBHOOK_URL;
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

  async getProviderId(): Promise<number> {
    if (this.providerId) return this.providerId;

    // Register a provider
    const providerId = await this.request<number>("/lol/tournament/v5/providers", "POST", {
      region: "BR",
      url: env.WEBHOOK_URL,
    });
    this.providerId = providerId;
    return providerId;
  }

  async getTournamentId(): Promise<number> {
    if (this.tournamentId) return this.tournamentId;

    const providerId = await this.getProviderId();
    const tournamentId = await this.request<number>("/lol/tournament/v5/tournaments", "POST", {
      name: "Inhouse Discord Matches",
      providerId: providerId,
    });
    this.tournamentId = tournamentId;
    return tournamentId;
  }

  async createTournamentCode(matchId: string, teamSize: number = 5): Promise<string> {
    if (!this.isConfigured) {
      throw new Error("Riot Tournament API is not configured (missing key or webhook url).");
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

    const codes = await this.request<string[]>(
      `/lol/tournament/v5/codes?count=1&tournamentId=${tournamentId}`,
      "POST",
      params,
    );

    return codes[0] || "";
  }
}

export const riotApiService = new RiotApiService();
