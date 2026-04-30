import { env } from "../config/env.js";
import { supabase } from "./supabaseClient.js";

const RSO_AUTH_URL = "https://auth.riotgames.com/authorize";
const RSO_TOKEN_URL = "https://auth.riotgames.com/token";
const RIOT_ACCOUNT_URL = "https://americas.api.riotgames.com/riot/account/v1/accounts/me";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingOAuth {
  discordId: string;
  createdAt: number;
}

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export class RiotOAuthService {
  // In-memory store: state → discord user id
  // State is a random string used to prevent CSRF
  private pendingStates = new Map<string, PendingOAuth>();

  get isConfigured(): boolean {
    return !!(env.RIOT_CLIENT_ID && env.RIOT_CLIENT_SECRET && env.WEBHOOK_URL);
  }

  private get redirectUri(): string {
    const base = env.WEBHOOK_URL?.replace("/riot/callback", "") ?? "";
    return `${base}/riot/oauth/callback`;
  }

  /**
   * Generates a Riot OAuth2 authorization URL with a one-time state token.
   * The state links a pending Discord user to this OAuth request.
   */
  buildAuthUrl(discordId: string): string {
    const state = crypto.randomUUID();
    this.pendingStates.set(state, { discordId, createdAt: Date.now() });
    this.cleanupExpiredStates();

    const params = new URLSearchParams({
      client_id: env.RIOT_CLIENT_ID!,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid",
      state,
    });

    return `${RSO_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Handles the OAuth callback. Exchanges the authorization code for tokens,
   * fetches the Riot account info, and saves it to the database.
   * Returns the linked Riot account on success.
   */
  async handleCallback(code: string, state: string): Promise<{ discordId: string; account: RiotAccount }> {
    const pending = this.pendingStates.get(state);
    if (!pending) {
      throw new Error("Estado OAuth inválido ou expirado. Tente novamente com /link-account.");
    }
    if (Date.now() - pending.createdAt > STATE_TTL_MS) {
      this.pendingStates.delete(state);
      throw new Error("Tempo esgotado para vinculação. Tente novamente com /link-account.");
    }
    this.pendingStates.delete(state);

    // Exchange code for access token
    const credentials = Buffer.from(`${env.RIOT_CLIENT_ID}:${env.RIOT_CLIENT_SECRET}`).toString("base64");
    const tokenResponse = await fetch(RSO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new Error(`Falha ao obter token da Riot: ${text}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken: string = tokenData.access_token;

    // Fetch Riot account info using the access token
    const accountResponse = await fetch(RIOT_ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!accountResponse.ok) {
      const text = await accountResponse.text();
      throw new Error(`Falha ao buscar conta Riot: ${text}`);
    }

    const accountData = await accountResponse.json();
    const account: RiotAccount = {
      puuid: accountData.puuid,
      gameName: accountData.gameName,
      tagLine: accountData.tagLine,
    };

    // Save to Supabase
    await this.saveRiotAccount(pending.discordId, account);

    return { discordId: pending.discordId, account };
  }

  async getRiotAccountForDiscordId(discordId: string): Promise<RiotAccount | null> {
    const { data, error } = await (supabase as any)
      .from("user_riot_accounts")
      .select("puuid, game_name, tag_line")
      .eq("discord_id", discordId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch Riot account: ${error.message}`);
    if (!data) return null;

    return {
      puuid: data.puuid,
      gameName: data.game_name,
      tagLine: data.tag_line,
    };
  }

  async getRiotAccountsForDiscordIds(discordIds: string[]): Promise<Map<string, RiotAccount>> {
    if (discordIds.length === 0) return new Map();

    const { data, error } = await (supabase as any)
      .from("user_riot_accounts")
      .select("discord_id, puuid, game_name, tag_line")
      .in("discord_id", discordIds);

    if (error) throw new Error(`Failed to fetch Riot accounts: ${error.message}`);

    const result = new Map<string, RiotAccount>();
    for (const row of data) {
      result.set(row.discord_id, {
        puuid: row.puuid,
        gameName: row.game_name,
        tagLine: row.tag_line,
      });
    }
    return result;
  }

  private async saveRiotAccount(discordId: string, account: RiotAccount): Promise<void> {
    const { error } = await (supabase as any)
      .from("user_riot_accounts")
      .upsert(
        {
          discord_id: discordId,
          puuid: account.puuid,
          game_name: account.gameName,
          tag_line: account.tagLine,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "discord_id" },
      );

    if (error) throw new Error(`Failed to save Riot account: ${error.message}`);
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, pending] of this.pendingStates) {
      if (now - pending.createdAt > STATE_TTL_MS) {
        this.pendingStates.delete(state);
      }
    }
  }
}

export const riotOAuthService = new RiotOAuthService();
