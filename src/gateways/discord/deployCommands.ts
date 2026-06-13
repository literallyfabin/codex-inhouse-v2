import { REST, Routes } from "discord.js";
import { env } from "../../config/env.js";
import { supabase } from "../../services/supabaseClient.js";
import { discordCommands } from "./components.js";

if (!env.DISCORD_CLIENT_ID) {
  throw new Error("DISCORD_CLIENT_ID is required to deploy Discord slash commands.");
}

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
const COMMAND_DEPLOY_TIMEOUT_MS = 20_000;
const KNOWN_GUILD_IDS = ["1498053852627468460", "305152277465923594"] as const;

const withTimeout = async <T>(label: string, task: PromiseLike<T>): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${COMMAND_DEPLOY_TIMEOUT_MS}ms`)),
          COMMAND_DEPLOY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const loadKnownGuildIds = async (): Promise<string[]> => {
  const guildIds = new Set<string>(KNOWN_GUILD_IDS);
  if (env.DISCORD_GUILD_ID) {
    guildIds.add(env.DISCORD_GUILD_ID);
  }

  console.log("Loading known Discord guild ids...");
  for (const table of ["discord_channels", "guild_settings", "queue_entries"] as const) {
    console.log(`Reading guild ids from ${table}...`);
    const { data, error } = await withTimeout<{
      data: Array<{ guild_id: string | null }> | null;
      error: { message: string } | null;
    }>(
      `Supabase guild id query for ${table}`,
      supabase.from(table).select("guild_id").limit(1000),
    );
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
console.log(`Deploying ${discordCommands.length} command(s) to guilds: ${guildIds.join(", ") || "global"}`);

if (guildIds.length === 0) {
  await withTimeout(
    "Global Discord command deploy",
    rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: discordCommands }),
  );
  console.log(`Deployed ${discordCommands.length} Discord command(s) globally.`);
} else {
  for (const guildId of guildIds) {
    console.log(`Deploying Discord commands to guild ${guildId}...`);
    await withTimeout(
      `Discord command deploy for guild ${guildId}`,
      rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body: discordCommands }),
    );
    console.log(`Deployed ${discordCommands.length} Discord command(s) to guild ${guildId}.`);
  }
}
