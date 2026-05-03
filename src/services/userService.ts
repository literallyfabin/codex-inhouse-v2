import { supabase } from "./supabaseClient.js";

export interface AppUser {
  id: string;
  discordId: string | null;
  whatsappId: string | null;
  displayName: string;
}

const mapUser = (row: {
  id: string;
  discord_id: string | null;
  whatsapp_id: string | null;
  display_name: string;
}): AppUser => ({
  id: row.id,
  discordId: row.discord_id,
  whatsappId: row.whatsapp_id,
  displayName: row.display_name,
});

export class UserService {
  async upsertDiscordUser(discordId: string, displayName: string): Promise<AppUser> {
    const { data, error } = await supabase
      .from("users")
      .upsert(
        {
          discord_id: discordId,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "discord_id" },
      )
      .select("id, discord_id, whatsapp_id, display_name")
      .single();

    if (error) {
      throw new Error(`Failed to upsert Discord user: ${error.message}`);
    }

    return mapUser(data);
  }

  async upsertWhatsAppUser(whatsappId: string, displayName: string): Promise<AppUser> {
    const { data, error } = await supabase
      .from("users")
      .upsert(
        {
          whatsapp_id: whatsappId,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "whatsapp_id" },
      )
      .select("id, discord_id, whatsapp_id, display_name")
      .single();

    if (error) {
      throw new Error(`Failed to upsert WhatsApp user: ${error.message}`);
    }

    return mapUser(data);
  }

  async getUserByPlatformId(platform: "discord" | "whatsapp", platformId: string): Promise<AppUser | null> {
    const field = platform === "discord" ? "discord_id" : "whatsapp_id";
    const { data, error } = await supabase
      .from("users")
      .select("id, discord_id, whatsapp_id, display_name")
      .eq(field, platformId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get user by platform ID: ${error.message}`);
    }

    return data ? mapUser(data) : null;
  }

  async getUsersByIds(userIds: string[]): Promise<AppUser[]> {
    if (userIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("users")
      .select("id, discord_id, whatsapp_id, display_name")
      .in("id", userIds);

    if (error) {
      throw new Error(`Failed to load users: ${error.message}`);
    }

    return data.map(mapUser);
  }

  async ensureDefaultStats(guildId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from("player_stats_global")
      .upsert(
        { guild_id: guildId, user_id: userId, updated_at: new Date().toISOString() },
        { onConflict: "guild_id,user_id", ignoreDuplicates: true },
      );

    if (error) {
      throw new Error(`Failed to ensure player stats: ${error.message}`);
    }
  }
}
