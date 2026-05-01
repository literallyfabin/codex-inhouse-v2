import { supabase } from "./supabaseClient.js";

export type ChannelType = "QUEUE" | "RANKING";
export type GuildConfigKey = "voice" | "queue_reset";

export interface MarkedChannel {
  guildId: string;
  channelId: string;
  channelType: ChannelType;
}

export interface GuildSettings {
  guildId: string;
  voiceEnabled: boolean;
  queueResetEnabled: boolean;
}

export class GuildService {
  async markChannel(guildId: string, channelId: string, channelType: ChannelType): Promise<void> {
    const { error } = await supabase.from("discord_channels").upsert(
      {
        guild_id: guildId,
        channel_id: channelId,
        channel_type: channelType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );

    if (error) {
      throw new Error(`Failed to mark channel: ${error.message}`);
    }
  }

  async setExclusiveChannel(guildId: string, channelId: string, channelType: ChannelType): Promise<void> {
    await this.markChannel(guildId, channelId, channelType);

    const { error } = await supabase
      .from("discord_channels")
      .delete()
      .eq("guild_id", guildId)
      .eq("channel_type", channelType)
      .neq("channel_id", channelId);

    if (error) {
      throw new Error(`Failed to clear previous ${channelType} channels: ${error.message}`);
    }
  }

  async unmarkChannel(channelId: string): Promise<void> {
    const { error } = await supabase.from("discord_channels").delete().eq("channel_id", channelId);

    if (error) {
      throw new Error(`Failed to unmark channel: ${error.message}`);
    }
  }

  async setConfig(guildId: string, key: GuildConfigKey, value: boolean): Promise<boolean> {
    const payload =
      key === "voice"
        ? { guild_id: guildId, voice_enabled: value, updated_at: new Date().toISOString() }
        : { guild_id: guildId, queue_reset_enabled: value, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from("guild_settings")
      .upsert(payload, { onConflict: "guild_id" })
      .select("voice_enabled, queue_reset_enabled")
      .single();

    if (error) {
      throw new Error(`Failed to update guild config: ${error.message}`);
    }

    return key === "voice" ? data.voice_enabled : data.queue_reset_enabled;
  }

  async getConfig(guildId: string, key: GuildConfigKey): Promise<boolean> {
    const { data, error } = await supabase
      .from("guild_settings")
      .select("voice_enabled, queue_reset_enabled")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load guild config: ${error.message}`);
    }

    if (!data) {
      return false;
    }

    return key === "voice" ? data.voice_enabled : data.queue_reset_enabled;
  }

  async getMarkedChannels(guildId: string, channelType?: ChannelType): Promise<MarkedChannel[]> {
    let query = supabase
      .from("discord_channels")
      .select("guild_id, channel_id, channel_type")
      .eq("guild_id", guildId);

    if (channelType) {
      query = query.eq("channel_type", channelType);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load marked channels: ${error.message}`);
    }

    return data.map((row) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      channelType: row.channel_type,
    }));
  }

  async isMarkedChannel(guildId: string, channelId: string, channelType: ChannelType): Promise<boolean> {
    const { data, error } = await supabase
      .from("discord_channels")
      .select("channel_id")
      .eq("guild_id", guildId)
      .eq("channel_id", channelId)
      .eq("channel_type", channelType)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check marked channel: ${error.message}`);
    }

    return Boolean(data);
  }

  async getAllSettings(): Promise<GuildSettings[]> {
    const { data, error } = await supabase
      .from("guild_settings")
      .select("guild_id, voice_enabled, queue_reset_enabled");

    if (error) {
      throw new Error(`Failed to load guild settings: ${error.message}`);
    }

    return data.map((row) => ({
      guildId: row.guild_id,
      voiceEnabled: row.voice_enabled,
      queueResetEnabled: row.queue_reset_enabled,
    }));
  }
}
