import { REST, Routes } from "discord.js";
import { env } from "../../config/env.js";
import { supabase } from "../../services/supabaseClient.js";
import { discordCommands } from "./components.js";

if (!env.DISCORD_CLIENT_ID) {
  throw new Error("DISCORD_CLIENT_ID is required to deploy Discord slash commands.");
}

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

const loadKnownGuildIds = async (): Promise<string[]> => {
  const guildIds = new Set<string>();
  if (env.DISCORD_GUILD_ID) {
    guildIds.add(env.DISCORD_GUILD_ID);
  }

  for (const table of ["discord_channels", "guild_settings", "queue_entries"] as const) {
    const { data, error } = await supabase.from(table).select("guild_id");
    if (error) {
      console.warn(`Could not load guild ids from ${table}: ${error.message}`);
      continue;
    }

    for (const row of data ?? []) {
      if (typeof row.guild_id === "string" && /^\d+$/.test(row.guild_id)) {
        guildIds.add(row.guild_id);
      }
    }
  }

  return [...guildIds].sort();
};

const guildIds = await loadKnownGuildIds();

if (guildIds.length === 0) {
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: discordCommands });
  console.log(`Deployed ${discordCommands.length} Discord command(s) globally.`);
} else {
  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body: discordCommands });
    console.log(`Deployed ${discordCommands.length} Discord command(s) to guild ${guildId}.`);
  }
}
