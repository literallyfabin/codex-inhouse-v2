import http from "node:http";
import { env } from "../config/env.js";
import { MatchService } from "../services/matchService.js";
import { riotOAuthService } from "../services/riotOAuthService.js";

// Basic structure of Riot's tournament callback
interface RiotCallbackPayload {
  startTime: number;
  shortCode: string;
  metaData: string;
  gameId: number;
  gameName: string;
  gameType: string;
  gameMap: number;
  gameMode: string;
  region: string;
}

type DiscordNotifier = (discordId: string, gameName: string, tagLine: string) => Promise<void>;
type StatusProvider = () => Record<string, unknown>;

export class WebhookServer {
  private server: http.Server;
  private discordNotifier?: DiscordNotifier;
  private statusProvider?: StatusProvider;

  constructor(private matchService: MatchService) {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  /**
   * Registers a callback that sends a Discord DM when a Riot account is linked.
   */
  setDiscordNotifier(notifier: DiscordNotifier): void {
    this.discordNotifier = notifier;
  }

  setStatusProvider(provider: StatusProvider): void {
    this.statusProvider = provider;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const path = req.url ? new URL(req.url, "http://localhost").pathname : "/";
    // Route: GET / — Health check (required by Render)
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "codex-inhouse-bot",
        commit: process.env.RENDER_GIT_COMMIT ?? null,
        ...(this.statusProvider?.() ?? {}),
      }));
      return;
    }

    // Route: GET /riot.txt — Riot domain ownership verification
    if (req.method === "GET" && path === "/riot.txt") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(process.env.RIOT_VERIFICATION_TOKEN ?? "");
      return;
    }

    // Route: POST /riot/callback — Riot tournament match result
    if (req.method === "POST" && path === "/riot/callback") {
      let body = "";
      req.on("data", (chunk) => { body += chunk.toString(); });
      req.on("end", async () => {
        try {
          const payload: RiotCallbackPayload = JSON.parse(body);
          await this.processRiotCallback(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "success" }));
        } catch (error) {
          console.error("Error processing Riot callback:", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "error", message: "Failed to process" }));
        }
      });
      return;
    }

    // Route: GET /riot/oauth/callback — RSO OAuth2 redirect from Riot
    if (req.method === "GET" && path === "/riot/oauth/callback") {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.htmlPage("❌ Erro", "Parâmetros inválidos. Tente novamente com /link-account."));
        return;
      }

      try {
        const { discordId, account } = await riotOAuthService.handleCallback(code, state);
        // Notify the user on Discord via DM if possible
        if (this.discordNotifier) {
          await this.discordNotifier(discordId, account.gameName, account.tagLine).catch(console.error);
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.htmlPage(
          "✅ Conta Vinculada!",
          `Sua conta <strong>${account.gameName}#${account.tagLine}</strong> foi vinculada com sucesso ao seu Discord!<br><br>Pode fechar esta aba e voltar ao Discord.`
        ));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido.";
        console.error("OAuth callback error:", err);
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.htmlPage("❌ Falha na Vinculação", msg));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  }

  private async processRiotCallback(payload: RiotCallbackPayload) {
    console.log(`Received Riot callback for gameId: ${payload.gameId}`);
    
    // metaData contains what we passed when generating the code: {"matchId": "..."}
    let matchId: string;
    try {
      const meta = JSON.parse(payload.metaData);
      matchId = meta.matchId;
    } catch {
      console.warn("Invalid metaData in Riot callback:", payload.metaData);
      return;
    }

    if (!matchId) return;

    // To know who won, we need to fetch the match from Riot Match API
    // Since we don't have account linking yet, we assume TEAM_A is Blue (100) and TEAM_B is Red (200).
    const matchData = await fetch(`https://americas.api.riotgames.com/lol/match/v5/matches/${payload.region}_${payload.gameId}`, {
      headers: {
        "X-Riot-Token": env.RIOT_API_KEY!
      }
    });

    if (!matchData.ok) {
      console.error(`Failed to fetch match data from Riot API for gameId ${payload.gameId}`);
      return;
    }

    const matchJson = await matchData.json();
    const teams: any[] = matchJson.info?.teams || [];

    // teamId 100 is Blue, 200 is Red
    const blueTeam = teams.find((t) => t.teamId === 100);
    const redTeam = teams.find((t) => t.teamId === 200);

    let winningTeam: "BLUE" | "RED" | undefined;

    if (blueTeam?.win) {
      winningTeam = "BLUE";
    } else if (redTeam?.win) {
      winningTeam = "RED";
    }

    if (winningTeam) {
      console.log(`Match ${matchId} finished. Winner: ${winningTeam}`);
      // Automatic validation since it came from Riot API
      await this.matchService.completeMatch(matchId, winningTeam);
    } else {
      console.log(`Match ${matchId} was a remake or invalid result.`);
      await this.matchService.cancelMatch(matchId);
    }
  }

  start() {
    if (!env.PORT) return;
    this.server.listen(env.PORT, () => {
      console.log(`Webhook server listening on port ${env.PORT}`);
      this.keepAlive();
    });
  }

  private keepAlive() {
    const url = env.WEBHOOK_URL
      ? env.WEBHOOK_URL.replace("/riot/callback", "/health")
      : `http://localhost:${env.PORT}/health`;

    const TEN_MINUTES = 10 * 60 * 1000;
    setInterval(async () => {
      try {
        await fetch(url);
        console.log(`[KeepAlive] Pinged ${url}`);
      } catch {
        console.warn(`[KeepAlive] Failed to ping ${url}`);
      }
    }, TEN_MINUTES);
  }

  stop() {
    this.server.close();
  }

  private htmlPage(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Inhouse Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f14;
      color: #e8e0d0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a24;
      border: 1px solid #2a2a3a;
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 480px;
      text-align: center;
    }
    h1 { font-size: 24px; margin-bottom: 16px; }
    p { color: #a0a0b0; line-height: 1.6; }
    .riot-badge {
      display: inline-block;
      background: #d13639;
      color: white;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="riot-badge">RIOT GAMES</div>
    <h1>${title}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
  }
}
