export const ROLES = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;
export type Role = (typeof ROLES)[number];

export const TEAMS = ["BLUE", "RED"] as const;
export type Team = (typeof TEAMS)[number];

export type WinningTeam = Team | "NONE";
export type MatchStatus = "PENDING" | "ONGOING" | "COMPLETED" | "CANCELLED";
export type Platform = "discord" | "whatsapp";

export interface PlatformIdentity {
  platform: Platform;
  platformUserId: string;
  displayName: string;
}

export interface QueuePlayer extends PlatformIdentity {
  guildId: string;
  channelId: string;
  userId: string;
  role: Role;
  duoUserId?: string | null;
  readyCheckId?: string | null;
  joinedAt: Date;
}

export interface PlayerRating {
  guildId: string;
  userId: string;
  role: Role;
  mu: number;
  sigma: number;
  mmr: number;
}

export interface RatedQueuePlayer extends QueuePlayer {
  rating: PlayerRating;
}

export interface TeamSlot {
  team: Team;
  role: Role;
  player: RatedQueuePlayer;
}

export interface BalancedMatch {
  teamBlue: TeamSlot[];
  teamRed: TeamSlot[];
  blueExpectedWinrate: number;
  muDifference: number;
  balanceScore: number;
}

export interface PersistedMatch {
  id: string;
  guildId: string;
  status: MatchStatus;
  teamBlue: string[];
  teamRed: string[];
  winningTeam: WinningTeam;
  blueExpectedWinrate: number;
  muDifference: number;
  createdAt: string;
  completedAt: string | null;
}

export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);

export const isTeam = (value: string): value is Team =>
  (TEAMS as readonly string[]).includes(value);
