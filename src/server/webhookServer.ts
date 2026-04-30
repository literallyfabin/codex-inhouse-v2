import http from "node:http";
import { env } from "../config/env.js";
import { MatchService } from "../services/matchService.js";
import { riotApiService } from "../services/riotApiService.js";

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

export class WebhookServer {
  private server: http.Server;

  constructor(private matchService: MatchService) {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === "POST" && req.url === "/riot/callback") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

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
    } else {
      res.writeHead(404);
      res.end();
    }
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
    });
  }

  stop() {
    this.server.close();
  }
}
