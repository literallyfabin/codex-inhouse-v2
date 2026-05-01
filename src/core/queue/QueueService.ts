import { EventEmitter } from "node:events";
import type { PlatformIdentity, QueuePlayer, Role } from "../models/types.js";
import { ROLES } from "../models/types.js";

export interface QueueSnapshot {
  queueId: string;
  totalPlayers: number;
  capacity: number;
  roles: Record<Role, QueuePlayer[]>;
  message: string;
  isReady: boolean;
}

export type QueueJoinStatus = "joined" | "updated" | "already_joined" | "role_full";

type QueueIdentity = PlatformIdentity & {
  guildId: string;
  channelId: string;
  userId: string;
  role: Role;
  duoUserId?: string | null;
  joinedAt?: Date;
};

export interface QueueJoinResult {
  status: QueueJoinStatus;
  player?: QueuePlayer;
  snapshot: QueueSnapshot;
  matchPlayers?: QueuePlayer[];
}

export interface QueueGroupJoinResult {
  status: "joined" | "role_full";
  players?: QueuePlayer[];
  snapshot: QueueSnapshot;
  matchPlayers?: QueuePlayer[];
}

interface QueueEvents {
  roleFilled: { queueId: string; role: Role; snapshot: QueueSnapshot };
  matchReady: { queueId: string; players: QueuePlayer[]; snapshot: QueueSnapshot };
}

type QueueEventName = keyof QueueEvents;

const createEmptyRoles = (): Record<Role, QueuePlayer[]> => ({
  TOP: [],
  JGL: [],
  MID: [],
  ADC: [],
  SUP: [],
});

export class QueueService {
  private readonly queues = new Map<string, QueuePlayer[]>();
  private readonly events = new EventEmitter();

  on<TEvent extends QueueEventName>(
    event: TEvent,
    listener: (payload: QueueEvents[TEvent]) => void,
  ): void {
    this.events.on(event, listener);
  }

  join(
    queueId: string,
    identity: QueueIdentity,
  ): QueueJoinResult {
    const queue = this.normalizeQueue(this.queues.get(queueId) ?? []);
    const existing = queue.find((player) => player.userId === identity.userId);
    const sameRole = existing?.role === identity.role;
    const nextQueueWithoutEntry = this.detachDuoLinks(
      queue.filter((player) => player.userId !== identity.userId),
      new Set([identity.userId]),
    );

    const player: QueuePlayer = {
      guildId: identity.guildId,
      channelId: identity.channelId,
      userId: identity.userId,
      platform: identity.platform,
      platformUserId: identity.platformUserId,
      displayName: identity.displayName,
      role: identity.role,
      duoUserId: identity.duoUserId ?? null,
      readyCheckId: null,
      joinedAt: existing?.joinedAt ?? identity.joinedAt ?? new Date(),
    };

    const nextQueue = [...nextQueueWithoutEntry, player].sort(
      (left, right) => left.joinedAt.getTime() - right.joinedAt.getTime(),
    );
    this.queues.set(queueId, nextQueue);

    const snapshot = this.snapshot(queueId, nextQueue);
    const matchPlayers = this.selectMatchPlayers(nextQueue);
    if (snapshot.roles[identity.role].length === 2 && !sameRole) {
      this.events.emit("roleFilled", { queueId, role: identity.role, snapshot });
    }

    if (matchPlayers) {
      this.events.emit("matchReady", { queueId, players: matchPlayers, snapshot });
    }

    const joinResult: QueueJoinResult = {
      status: existing ? (sameRole ? "already_joined" : "updated") : "joined",
      player,
      snapshot,
    };

    if (matchPlayers) {
      joinResult.matchPlayers = matchPlayers;
    }

    return joinResult;
  }

  joinGroup(queueId: string, identities: readonly QueueIdentity[]): QueueGroupJoinResult {
    if (identities.length === 0) {
      return { status: "joined", snapshot: this.snapshot(queueId), players: [] };
    }

    const userIds = new Set(identities.map((identity) => identity.userId));
    if (userIds.size !== identities.length) {
      throw new Error("Queue group requires unique users.");
    }

    const currentQueue = this.normalizeQueue(this.queues.get(queueId) ?? []);
    const existingByUserId = new Map(currentQueue.map((player) => [player.userId, player]));
    const baseQueue = this.detachDuoLinks(
      currentQueue.filter((player) => !userIds.has(player.userId)),
      userIds,
    );

    const players: QueuePlayer[] = identities.map((identity) => ({
      guildId: identity.guildId,
      channelId: identity.channelId,
      userId: identity.userId,
      platform: identity.platform,
      platformUserId: identity.platformUserId,
      displayName: identity.displayName,
      role: identity.role,
      duoUserId: identity.duoUserId ?? null,
      readyCheckId: null,
      joinedAt: identity.joinedAt ?? existingByUserId.get(identity.userId)?.joinedAt ?? new Date(),
    }));

    const nextQueue = [...baseQueue, ...players].sort(
      (left, right) => left.joinedAt.getTime() - right.joinedAt.getTime(),
    );
    this.queues.set(queueId, nextQueue);

    const snapshot = this.snapshot(queueId, nextQueue);
    const matchPlayers = this.selectMatchPlayers(nextQueue);
    for (const role of ROLES) {
      const before = baseQueue.filter((player) => player.role === role).length;
      if (before < 2 && snapshot.roles[role].length === 2) {
        this.events.emit("roleFilled", { queueId, role, snapshot });
      }
    }

    if (matchPlayers) {
      this.events.emit("matchReady", { queueId, players: matchPlayers, snapshot });
    }

    const groupResult: QueueGroupJoinResult = {
      status: "joined",
      players,
      snapshot,
    };
    if (matchPlayers) {
      groupResult.matchPlayers = matchPlayers;
    }

    return groupResult;
  }

  leave(queueId: string, userId: string): QueueSnapshot {
    const queue = this.queues.get(queueId) ?? [];
    const nextQueue = this.detachDuoLinks(
      queue.filter((player) => player.userId !== userId),
      new Set([userId]),
    );
    this.queues.set(queueId, nextQueue);
    return this.snapshot(queueId, nextQueue);
  }

  removePlayers(queueId: string, userIds: readonly string[]): QueueSnapshot {
    const removeSet = new Set(userIds);
    const queue = this.queues.get(queueId) ?? [];
    const nextQueue = this.detachDuoLinks(
      queue.filter((player) => !removeSet.has(player.userId)),
      removeSet,
    );
    this.queues.set(queueId, nextQueue);
    return this.snapshot(queueId, nextQueue);
  }

  removeUserEverywhere(userId: string): QueueSnapshot[] {
    const snapshots: QueueSnapshot[] = [];
    for (const queueId of this.queues.keys()) {
      snapshots.push(this.leave(queueId, userId));
    }

    return snapshots;
  }

  removeUsersEverywhereInGuild(guildId: string, userIds: readonly string[]): QueueSnapshot[] {
    const removeSet = new Set(userIds);
    const snapshots: QueueSnapshot[] = [];

    for (const [queueId, queue] of this.queues.entries()) {
      const guildQueue = queue.filter((player) => player.guildId === guildId);
      if (guildQueue.length === 0) {
        continue;
      }

      const nextQueue = this.detachDuoLinks(
        queue.filter((player) => !(player.guildId === guildId && removeSet.has(player.userId))),
        removeSet,
      );
      this.queues.set(queueId, nextQueue);
      snapshots.push(this.snapshot(queueId, nextQueue));
    }

    return snapshots;
  }

  loadQueues(players: readonly QueuePlayer[]): void {
    this.queues.clear();
    for (const player of players) {
      const queue = this.normalizeQueue(this.queues.get(player.channelId) ?? []);
      queue.push(player);
      this.queues.set(
        player.channelId,
        this.normalizeQueue(queue),
      );
    }
  }

  getQueueIdsForGuild(guildId: string): string[] {
    return [...this.queues.entries()]
      .filter(([, players]) => players.some((player) => player.guildId === guildId))
      .map(([queueId]) => queueId);
  }

  getQueuedPlayers(): QueuePlayer[] {
    return [...this.queues.values()].flat();
  }

  findMatchPlayers(queueId: string): QueuePlayer[] | undefined {
    return this.selectMatchPlayers(this.queues.get(queueId) ?? []);
  }

  hasActiveReadyCheck(userId: string, guildId?: string): boolean {
    return this.getQueuedPlayers().some(
      (player) =>
        player.userId === userId &&
        Boolean(player.readyCheckId) &&
        (!guildId || player.guildId === guildId),
    );
  }

  markReadyCheck(queueId: string, userIds: readonly string[], readyCheckId: string): QueueSnapshot {
    const markSet = new Set(userIds);
    const queue = this.queues.get(queueId) ?? [];
    const nextQueue = queue.map((player) =>
      markSet.has(player.userId) ? { ...player, readyCheckId } : player,
    );
    this.queues.set(queueId, nextQueue);
    return this.snapshot(queueId, nextQueue);
  }

  markReadyCheckEverywhereInGuild(
    guildId: string,
    userIds: readonly string[],
    readyCheckId: string,
  ): QueueSnapshot[] {
    const markSet = new Set(userIds);
    const snapshots: QueueSnapshot[] = [];

    for (const [queueId, queue] of this.queues.entries()) {
      if (!queue.some((player) => player.guildId === guildId && markSet.has(player.userId))) {
        continue;
      }

      const nextQueue = queue.map((player) =>
        player.guildId === guildId && markSet.has(player.userId)
          ? { ...player, readyCheckId }
          : player,
      );
      this.queues.set(queueId, nextQueue);
      snapshots.push(this.snapshot(queueId, nextQueue));
    }

    return snapshots;
  }

  clearReadyCheck(readyCheckId: string): QueueSnapshot[] {
    const snapshots: QueueSnapshot[] = [];
    for (const [queueId, queue] of this.queues.entries()) {
      if (!queue.some((player) => player.readyCheckId === readyCheckId)) {
        continue;
      }

      const nextQueue = queue.map((player) =>
        player.readyCheckId === readyCheckId ? { ...player, readyCheckId: null } : player,
      );
      this.queues.set(queueId, nextQueue);
      snapshots.push(this.snapshot(queueId, nextQueue));
    }

    return snapshots;
  }

  snapshot(queueId: string, sourceQueue = this.queues.get(queueId) ?? []): QueueSnapshot {
    const roles = createEmptyRoles();
    const visibleQueue = this.normalizeQueue(sourceQueue).filter((player) => !player.readyCheckId);
    for (const role of ROLES) {
      roles[role] = visibleQueue.filter((player) => player.role === role);
    }

    const totalPlayers = visibleQueue.length;
    const roleSummary = ROLES.map((role) => `${role}: ${roles[role].length}/2`).join(", ");

    return {
      queueId,
      totalPlayers,
      capacity: 10,
      roles,
      message: `Fila atualizada: ${totalPlayers}/10. ${roleSummary}.`,
      isReady: totalPlayers >= 10 && ROLES.every((role) => roles[role].length >= 2),
    };
  }

  reset(queueId?: string): void {
    if (queueId) {
      this.queues.delete(queueId);
      return;
    }

    this.queues.clear();
  }

  private detachDuoLinks(queue: readonly QueuePlayer[], removedUserIds: ReadonlySet<string>): QueuePlayer[] {
    return queue.map((player) =>
      player.duoUserId && removedUserIds.has(player.duoUserId)
        ? { ...player, duoUserId: null }
        : player,
    );
  }

  private normalizeQueue(queue: readonly QueuePlayer[]): QueuePlayer[] {
    const byUserId = new Map<string, QueuePlayer>();
    for (const player of queue) {
      const existing = byUserId.get(player.userId);
      if (!existing || player.joinedAt.getTime() >= existing.joinedAt.getTime()) {
        byUserId.set(player.userId, player);
      }
    }

    return [...byUserId.values()].sort(
      (left, right) => left.joinedAt.getTime() - right.joinedAt.getTime(),
    );
  }

  private selectMatchPlayers(queue: readonly QueuePlayer[]): QueuePlayer[] | undefined {
    const selectableQueue = this.normalizeQueue(queue).filter((player) => !player.readyCheckId);
    const roles = createEmptyRoles();
    for (const role of ROLES) {
      roles[role] = selectableQueue.filter((player) => player.role === role);
      if (roles[role].length < 2) {
        return undefined;
      }
    }

    const selectedByRole = createEmptyRoles();
    const selectedByUserId = new Map<string, QueuePlayer>();
    const addSelected = (player: QueuePlayer): void => {
      if (selectedByUserId.has(player.userId)) {
        return;
      }

      const bucket = selectedByRole[player.role];
      if (bucket.some((selected) => selected.userId === player.userId)) {
        return;
      }

      if (bucket.length >= 2) {
        const removed = bucket.pop();
        if (removed) {
          selectedByUserId.delete(removed.userId);
        }
      }

      bucket.push(player);
      selectedByUserId.set(player.userId, player);
    };

    for (const role of ROLES) {
      for (const player of roles[role]) {
        addSelected(player);
        if (selectedByRole[player.role].length === 2) {
          break;
        }
      }
    }

    let changed = true;
    let guard = 0;
    while (changed && guard < queue.length * 2) {
      guard += 1;
      changed = false;
      for (const player of [...selectedByUserId.values()]) {
        if (!player.duoUserId || selectedByUserId.has(player.duoUserId)) {
          continue;
        }

        const duo = selectableQueue.find((candidate) => candidate.userId === player.duoUserId);
        if (duo) {
          addSelected(duo);
          changed = true;
        }
      }
    }

    const selected = ROLES.flatMap((role) => selectedByRole[role]);
    const hasValidShape =
      selected.length === 10 &&
      new Set(selected.map((player) => player.userId)).size === 10 &&
      ROLES.every((role) => selectedByRole[role].length === 2);
    const keepsDuosTogether = selected.every(
      (player) =>
        !player.duoUserId || selected.some((candidate) => candidate.userId === player.duoUserId),
    );

    return hasValidShape && keepsDuosTogether ? selected : undefined;
  }
}
