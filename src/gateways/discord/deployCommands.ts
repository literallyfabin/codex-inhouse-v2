import { REST, Routes } from "discord.js";
import { env } from "../../config/env.js";
import { discordCommands } from "./components.js";

if (!env.DISCORD_CLIENT_ID) {
  throw new Error("DISCORD_CLIENT_ID is required to deploy Discord slash commands.");
}

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

await rest.put(route, { body: discordCommands });

console.log(
  `Deployed ${discordCommands.length} Discord command(s) ${
    env.DISCORD_GUILD_ID ? `to guild ${env.DISCORD_GUILD_ID}` : "globally"
  }.`,
);
