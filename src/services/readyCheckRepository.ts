import type { Json } from "../core/models/database.js";
import type { QueuePlayer } from "../core/models/types.js";
import { supabase } from "./supabaseClient.js";

export type ReadyCheckStatus = "PENDING" | "ACCEPTED" | "CANCELLED" | "TIMEOUT";

export class ReadyCheckRepository {
  async create(params: {
    id: string;
    guildId: string;
    channelId: string;
    players: readonly QueuePlayer[];
    expiresAt: Date;
  }): Promise<void> {
    const { error } = await supabase.from("ready_checks").insert({
      id: params.id,
      guild_id: params.guildId,
      channel_id: params.channelId,
      status: "PENDING",
      candidate_players: params.players.map((player) => ({
        guildId: player.guildId,
        channelId: player.channelId,
        userId: player.userId,
        platform: player.platform,
        platformUserId: player.platformUserId,
        displayName: player.displayName,
        role: player.role,
        duoUserId: player.duoUserId ?? null,
        joinedAt: player.joinedAt.toISOString(),
      })) as Json,
      accepted_user_ids: [],
      expires_at: params.expiresAt.toISOString(),
    });

    if (error) {
      throw new Error(`Failed to create ready-check: ${error.message}`);
    }
  }

  async setMessageId(id: string, discordMessageId: string): Promise<void> {
    const { error } = await supabase
      .from("ready_checks")
      .update({ discord_message_id: discordMessageId })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to set ready-check message id: ${error.message}`);
    }
  }

  async setAcceptedUserIds(id: string, userIds: readonly string[]): Promise<void> {
    const { error } = await supabase
      .from("ready_checks")
      .update({ accepted_user_ids: [...userIds] })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update ready-check accepted users: ${error.message}`);
    }
  }

  async setStatus(
    id: string,
    status: ReadyCheckStatus,
    cancelledByUserId?: string,
  ): Promise<void> {
    const payload: {
      status: ReadyCheckStatus;
      cancelled_by_user_id?: string | null;
    } = { status };
    if (cancelledByUserId !== undefined) {
      payload.cancelled_by_user_id = cancelledByUserId;
    }

    const { error } = await supabase.from("ready_checks").update(payload).eq("id", id);

    if (error) {
      throw new Error(`Failed to update ready-check status: ${error.message}`);
    }
  }

  async cancelPendingOnStartup(): Promise<void> {
    const { error } = await supabase
      .from("ready_checks")
      .update({ status: "TIMEOUT" })
      .eq("status", "PENDING");

    if (error) {
      throw new Error(`Failed to cancel pending ready-checks: ${error.message}`);
    }
  }
}
