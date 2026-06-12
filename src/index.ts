import { env } from "./config/env.js";
import { DiscordGateway } from "./gateways/discord/DiscordGateway.js";
import { MatchService } from "./services/matchService.js";
import { WebhookServer } from "./server/webhookServer.js";

const main = async (): Promise<void> => {
  const matchService = new MatchService();
  const webhookServer = new WebhookServer(matchService);

  if (!env.DISCORD_GATEWAY_ENABLED) {
    console.log("No gateway enabled. Set DISCORD_GATEWAY_ENABLED=true to start Discord.");
    webhookServer.setStatusProvider(() => ({ discord: { enabled: false } }));
    webhookServer.start();
    return;
  }

  const discordGateway = new DiscordGateway(env.DISCORD_TOKEN);
  await discordGateway.start();
  webhookServer.setStatusProvider(() => ({
    discord: {
      enabled: true,
      ...discordGateway.getStatus(),
    },
  }));

  // After the Discord client is ready, register the notifier so users get a DM
  webhookServer.setDiscordNotifier(async (discordId, gameName, tagLine) => {
    await discordGateway.sendLinkSuccessDm(discordId, gameName, tagLine);
  });

  // Start the Webhook Server for Riot callbacks and OAuth after Discord is healthy.
  webhookServer.start();
};

main().catch((error: unknown) => {
  console.error("Application failed to start", error);
  process.exitCode = 1;
});
