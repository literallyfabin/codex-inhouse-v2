import type { MatchStatus, Role, Team, WinningTeam } from "./types.js";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          discord_id: string | null;
          whatsapp_id: string | null;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          discord_id?: string | null;
          whatsapp_id?: string | null;
          display_name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          discord_id?: string | null;
          whatsapp_id?: string | null;
          display_name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_riot_accounts: {
        Row: {
          discord_id: string;
          puuid: string;
          game_name: string;
          tag_line: string;
          updated_at: string;
        };
        Insert: {
          discord_id: string;
          puuid: string;
          game_name: string;
          tag_line: string;
          updated_at?: string;
        };
        Update: {
          puuid?: string;
          game_name?: string;
          tag_line?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      player_stats_global: {
        Row: {
          guild_id: string;
          user_id: string;
          mu: number;
          sigma: number;
          mmr: number;
          updated_at: string;
        };
        Insert: {
          guild_id: string;
          user_id: string;
          mu?: number;
          sigma?: number;
          updated_at?: string;
        };
        Update: {
          mu?: number;
          sigma?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      player_stats: {
        Row: {
          guild_id: string;
          user_id: string;
          role: Role;
          mu: number;
          sigma: number;
          mmr: number;
          updated_at: string;
        };
        Insert: {
          guild_id: string;
          user_id: string;
          role: Role;
          mu?: number;
          sigma?: number;
          updated_at?: string;
        };
        Update: {
          mu?: number;
          sigma?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          match_number: number;
          guild_id: string;
          status: MatchStatus;
          team_blue: Json;
          team_red: Json;
          winning_team: WinningTeam;
          blue_expected_winrate: number;
          mu_difference: number;
          source_channel_id: string | null;
          discord_message_id: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          match_number?: number;
          guild_id: string;
          status?: MatchStatus;
          team_blue: Json;
          team_red: Json;
          winning_team?: WinningTeam;
          blue_expected_winrate?: number;
          mu_difference?: number;
          source_channel_id?: string | null;
          discord_message_id?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          match_number?: number;
          status?: MatchStatus;
          winning_team?: WinningTeam;
          discord_message_id?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      match_participants: {
        Row: {
          match_id: string;
          user_id: string;
          role: Role;
          team: Team;
          mu_before: number;
          sigma_before: number;
          mmr_before: number;
          display_name: string | null;
          champion_name: string | null;
        };
        Insert: {
          match_id: string;
          user_id: string;
          role: Role;
          team: Team;
          mu_before: number;
          sigma_before: number;
          display_name?: string | null;
          champion_name?: string | null;
        };
        Update: {
          mu_before?: number;
          sigma_before?: number;
          champion_name?: string | null;
        };
        Relationships: [];
      };
      guild_settings: {
        Row: {
          guild_id: string;
          queue_reset_enabled: boolean;
          voice_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          guild_id: string;
          queue_reset_enabled?: boolean;
          voice_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          queue_reset_enabled?: boolean;
          voice_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      discord_channels: {
        Row: {
          channel_id: string;
          guild_id: string;
          channel_type: "QUEUE" | "RANKING" | "TOP";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          guild_id: string;
          channel_type: "QUEUE" | "RANKING" | "TOP";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          channel_type?: "QUEUE" | "RANKING" | "TOP";
          updated_at?: string;
        };
        Relationships: [];
      };
      queue_entries: {
        Row: {
          guild_id: string;
          channel_id: string;
          user_id: string;
          role: Role;
          display_name: string;
          joined_at: string;
          duo_user_id: string | null;
          ready_check_id: string | null;
          platform: string;
          platform_user_id: string;
        };
        Insert: {
          guild_id: string;
          channel_id: string;
          user_id: string;
          role: Role;
          display_name: string;
          joined_at?: string;
          duo_user_id?: string | null;
          ready_check_id?: string | null;
          platform?: string;
          platform_user_id: string;
        };
        Update: {
          display_name?: string;
          duo_user_id?: string | null;
          ready_check_id?: string | null;
        };
        Relationships: [];
      };
      ready_checks: {
        Row: {
          id: string;
          guild_id: string;
          channel_id: string;
          discord_message_id: string | null;
          status: "PENDING" | "ACCEPTED" | "CANCELLED" | "TIMEOUT";
          candidate_players: Json;
          accepted_user_ids: Json;
          cancelled_by_user_id: string | null;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          guild_id: string;
          channel_id: string;
          discord_message_id?: string | null;
          status?: "PENDING" | "ACCEPTED" | "CANCELLED" | "TIMEOUT";
          candidate_players?: Json;
          accepted_user_ids?: Json;
          cancelled_by_user_id?: string | null;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          discord_message_id?: string | null;
          status?: "PENDING" | "ACCEPTED" | "CANCELLED" | "TIMEOUT";
          accepted_user_ids?: Json;
          cancelled_by_user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      player_role: Role;
      match_status: MatchStatus;
      match_team: Team;
      winning_team: WinningTeam;
      channel_type: "QUEUE" | "RANKING" | "TOP";
      ready_check_status: "PENDING" | "ACCEPTED" | "CANCELLED" | "TIMEOUT";
    };
    CompositeTypes: Record<string, never>;
  };
}
