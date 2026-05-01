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
  status: "joined";
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

const queueEntryKey = (player: Pick<QueuePlayer, "userId" | "role">): string =>
  `${player.userId}:${player.role}`;

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
    const existing = queue.find(
      (player) => player.userId === identity.userId && player.role === identity.role,
    );
    // Remove ALL entries for this user (not just same role) — a player can only hold one role at a time
    const nextQueueWithoutUser = queue.filter(
      (player) => player.userId !== identity.userId,
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
      joinedAt: identity.joinedAt ?? new Date(),
    };

    const nextQueue = [...nextQueueWithoutUser, player].sort(
      (left, right) => left.joinedAt.getTime() - right.joinedAt.getTime(),
    );
    this.queues.set(queueId, nextQueue);

    const snapshot = this.snapshot(queueId, nextQueue);
    const matchPlayers = this.selectMatchPlayers(nextQueue);
    if ((queue.filter((player) => player.role === identity.role).length < 2) && snapshot.roles[identity.role].length === 2) {
      this.events.emit("roleFilled", { queueId, role: identity.role, snapshot });
    }

    if (matchPlayers) {
      this.events.emit("matchReady", { queueId, players: matchPlayers, snapshot });
    }

    const joinResult: QueueJoinResult = {
      status: existing ? "updated" : "joined",
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
        joinedAt: identity.joinedAt ?? new Date(),
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

  getMatchmakingQueue(queueId: string): QueuePlayer[] {
    return this.buildLegacyOrderedQueue(this.queues.get(queueId) ?? []);
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
    const visibleQueue = this.buildLegacyOrderedQueue(sourceQueue);
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
    const byEntry = new Map<string, QueuePlayer>();
    for (const player of queue) {
      const existing = byEntry.get(queueEntryKey(player));
      if (!existing || player.joinedAt.getTime() >= existing.joinedAt.getTime()) {
        byEntry.set(queueEntryKey(player), player);
      }
    }

    return [...byEntry.values()].sort(
      (left, right) => left.joinedAt.getTime() - right.joinedAt.getTime(),
    );
  }

  private selectMatchPlayers(queue: readonly QueuePlayer[]): QueuePlayer[] | undefined {
    const selectableQueue = this.buildLegacyOrderedQueue(queue);
    const roles = createEmptyRoles();
    for (const role of ROLES) {
      roles[role] = selectableQueue.filter((player) => player.role === role);
      if (roles[role].length < 2) {
        return undefined;
      }
    }

    for (let poolSize = 10; poolSize <= selectableQueue.length; poolSize += 1) {
      const pool = selectableQueue.slice(0, poolSize);
      const rolePairs = ROLES.map((role) => this.twoPlayerCombinations(pool.filter((player) => player.role === role)));
      if (rolePairs.some((pairs) => pairs.length === 0)) {
        continue;
      }

      for (const selected of this.rolePairProducts(rolePairs)) {
        if (this.isValidMatchSelection(selected)) {
          return selected;
        }
      }
    }

    return undefined;
  }

  private buildLegacyOrderedQueue(queue: readonly QueuePlayer[]): QueuePlayer[] {
    const normalizedQueue = this.normalizeQueue(queue);
    const readyCheckedUserIds = new Set(
      normalizedQueue.filter((player) => player.readyCheckId).map((player) => player.userId),
    );
    const visibleQueue = normalizedQueue.filter((player) => !readyCheckedUserIds.has(player.userId));
    const byRole = createEmptyRoles();
    for (const role of ROLES) {
      byRole[role] = visibleQueue.filter((player) => player.role === role);
    }

    const startingQueue = createEmptyRoles();
    for (const role of ROLES) {
      for (const player of byRole[role]) {
        if (startingQueue[role].length >= 2) {
          continue;
        }

        if (!startingQueue[role].some((queuedPlayer) => queuedPlayer.userId === player.userId)) {
          startingQueue[role].push(player);
        }

        if (!player.duoUserId) {
          continue;
        }

        const duo = visibleQueue.find(
          (candidate) =>
            candidate.userId === player.duoUserId &&
            candidate.duoUserId === player.userId &&
            candidate.channelId === player.channelId,
        );
        if (!duo) {
          continue;
        }

        const duoQueue = startingQueue[duo.role];
        if (duoQueue.length >= 2) {
          duoQueue.pop();
        }

        if (!duoQueue.some((queuedPlayer) => queuedPlayer.userId === duo.userId)) {
          duoQueue.push(duo);
        }
      }
    }

    const startingPlayers = ROLES.flatMap((role) => startingQueue[role]);
    const startingKeys = new Set(startingPlayers.map(queueEntryKey));
    return [
      ...startingPlayers,
      ...visibleQueue.filter((player) => !startingKeys.has(queueEntryKey(player))),
    ];
  }

  private twoPlayerCombinations<T>(items: readonly T[]): [T, T][] {
    const combinations: [T, T][] = [];
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const left = items[leftIndex];
        const right = items[rightIndex];
        if (left && right) {
          combinations.push([left, right]);
        }
      }
    }

    return combinations;
  }

  private rolePairProducts(pairSets: readonly [QueuePlayer, QueuePlayer][][]): QueuePlayer[][] {
    let products: QueuePlayer[][] = [[]];
    for (const pairs of pairSets) {
      const nextProducts: QueuePlayer[][] = [];
      for (const prefix of products) {
        for (const pair of pairs) {
          nextProducts.push([...prefix, ...pair]);
        }
      }
      products = nextProducts;
    }

    return products;
  }

  private isValidMatchSelection(players: readonly QueuePlayer[]): boolean {
    return (
      players.length === 10 &&
      new Set(players.map((player) => player.userId)).size === 10 &&
      ROLES.every((role) => players.filter((player) => player.role === role).length === 2) &&
      players.every(
        (player) =>
          !player.duoUserId || players.some((candidate) => candidate.userId === player.duoUserId),
      )
    );
  }
}
