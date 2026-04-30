import type { Role } from "../core/models/types.js";
import { ROLES } from "../core/models/types.js";
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

  async ensureDefaultStats(guildId: string, userId: string, roles: readonly Role[] = ROLES): Promise<void> {
    const rows = roles.map((role) => ({
      guild_id: guildId,
      user_id: userId,
      role,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("player_stats")
      .upsert(rows, { onConflict: "guild_id,user_id,role", ignoreDuplicates: true });

    if (error) {
      throw new Error(`Failed to ensure player stats: ${error.message}`);
    }
  }
}
