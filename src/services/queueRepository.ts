import type { QueuePlayer } from "../core/models/types.js";
import { supabase } from "./supabaseClient.js";

interface QueueEntryRow {
  guild_id: string;
  channel_id: string;
  user_id: string;
  role: QueuePlayer["role"];
  display_name: string;
  joined_at: string;
  duo_user_id: string | null;
  ready_check_id: string | null;
  platform: string;
  platform_user_id: string;
}

const mapQueueEntry = (row: QueueEntryRow): QueuePlayer => ({
  guildId: row.guild_id,
  channelId: row.channel_id,
  userId: row.user_id,
  platform: row.platform === "whatsapp" ? "whatsapp" : "discord",
  platformUserId: row.platform_user_id,
  displayName: row.display_name,
  role: row.role,
  duoUserId: row.duo_user_id,
  readyCheckId: row.ready_check_id,
  joinedAt: new Date(row.joined_at),
});

export class QueueRepository {
  async loadAll(): Promise<QueuePlayer[]> {
    const { data, error } = await supabase
      .from("queue_entries")
      .select(
        "guild_id, channel_id, user_id, role, display_name, joined_at, duo_user_id, ready_check_id, platform, platform_user_id",
      )
      .order("joined_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to load queue entries: ${error.message}`);
    }

    return data.map(mapQueueEntry);
  }

  async upsertPlayers(players: readonly QueuePlayer[]): Promise<void> {
    if (players.length === 0) {
      return;
    }

    const { error } = await supabase.from("queue_entries").upsert(
      players.map((player) => ({
        guild_id: player.guildId,
        channel_id: player.channelId,
        user_id: player.userId,
        role: player.role,
        display_name: player.displayName,
        joined_at: player.joinedAt.toISOString(),
        duo_user_id: player.duoUserId ?? null,
        ready_check_id: player.readyCheckId ?? null,
        platform: player.platform,
        platform_user_id: player.platformUserId,
      })),
      { onConflict: "channel_id,user_id,role" },
    );

    if (error) {
      throw new Error(`Failed to upsert queue entries: ${error.message}`);
    }
  }

  async removeUserFromChannel(channelId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from("queue_entries")
      .delete()
      .eq("channel_id", channelId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to remove queued user: ${error.message}`);
    }

    await this.detachDuoUser(userId, channelId);
  }

  async removeUsersFromChannel(channelId: string, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const { error } = await supabase
      .from("queue_entries")
      .delete()
      .eq("channel_id", channelId)
      .in("user_id", [...userIds]);

    if (error) {
      throw new Error(`Failed to remove queued users: ${error.message}`);
    }

    await this.detachDuoUsers(userIds, channelId);
  }

  async removeUsersEverywhereInGuild(guildId: string, userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const { error } = await supabase
      .from("queue_entries")
      .delete()
      .eq("guild_id", guildId)
      .in("user_id", [...userIds]);

    if (error) {
      throw new Error(`Failed to remove queued users from guild: ${error.message}`);
    }

    await this.detachDuoUsers(userIds);
  }

  async resetChannel(channelId: string): Promise<void> {
    const { error } = await supabase.from("queue_entries").delete().eq("channel_id", channelId);
    if (error) {
      throw new Error(`Failed to reset queue channel: ${error.message}`);
    }
  }

  async resetAll(): Promise<void> {
    const { error } = await supabase.from("queue_entries").delete().neq("channel_id", "");
    if (error) {
      throw new Error(`Failed to reset all queues: ${error.message}`);
    }
  }

  async markReadyCheck(channelId: string, userIds: readonly string[], readyCheckId: string): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const { error } = await supabase
      .from("queue_entries")
      .update({ ready_check_id: readyCheckId })
      .eq("channel_id", channelId)
      .in("user_id", [...userIds]);

    if (error) {
      throw new Error(`Failed to mark ready-check entries: ${error.message}`);
    }
  }

  async markReadyCheckEverywhereInGuild(
    guildId: string,
    userIds: readonly string[],
    readyCheckId: string,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const { error } = await supabase
      .from("queue_entries")
      .update({ ready_check_id: readyCheckId })
      .eq("guild_id", guildId)
      .in("user_id", [...userIds]);

    if (error) {
      throw new Error(`Failed to mark guild ready-check entries: ${error.message}`);
    }
  }

  async clearReadyCheck(readyCheckId: string): Promise<void> {
    const { error } = await supabase
      .from("queue_entries")
      .update({ ready_check_id: null })
      .eq("ready_check_id", readyCheckId);

    if (error) {
      throw new Error(`Failed to clear ready-check entries: ${error.message}`);
    }
  }

  async clearAllReadyChecks(): Promise<void> {
    const { error } = await supabase
      .from("queue_entries")
      .update({ ready_check_id: null })
      .not("ready_check_id", "is", null);

    if (error) {
      throw new Error(`Failed to clear all ready-check entries: ${error.message}`);
    }
  }

  private async detachDuoUser(userId: string, channelId?: string): Promise<void> {
    await this.detachDuoUsers([userId], channelId);
  }

  private async detachDuoUsers(userIds: readonly string[], channelId?: string): Promise<void> {
    let query = supabase.from("queue_entries").update({ duo_user_id: null }).in("duo_user_id", [...userIds]);
    if (channelId) {
      query = query.eq("channel_id", channelId);
    }

    const { error } = await query;
    if (error) {
      throw new Error(`Failed to detach duo queue entries: ${error.message}`);
    }
  }
}
