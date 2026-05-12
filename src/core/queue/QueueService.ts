import { EventEmitter } from "node:events";
import type { PlatformIdentity, QueuePlayer, QueueRole, Role } from "../models/types.js";
import { ROLES } from "../models/types.js";

export interface QueueSnapshot {
  queueId: string;
  totalPlayers: number;
  capacity: number;
  roles: Record<Role, QueuePlayer[]>;
  fillPlayers: QueuePlayer[];
  message: string;
  isReady: boolean;
}

export type QueueJoinStatus = "joined" | "updated" | "already_joined" | "role_full";

type QueueIdentity = PlatformIdentity & {
  guildId: string;
  channelId: string;
  userId: string;
  role: QueueRole;
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
    if (identity.role !== "FILL") {
      if ((queue.filter((player) => player.role === identity.role).length < 2) && snapshot.roles[identity.role].length === 2) {
        this.events.emit("roleFilled", { queueId, role: identity.role, snapshot });
      }
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
    const fillPlayers = visibleQueue.filter((player) => player.role === "FILL");

    const totalPlayers = visibleQueue.length;
    const roleSummary = ROLES.map((role) => `${role}: ${roles[role].length}/2`).join(", ");
    const fillSuffix = fillPlayers.length > 0 ? `, FILL: ${fillPlayers.length}` : "";

    return {
      queueId,
      totalPlayers,
      capacity: 10,
      roles,
      fillPlayers,
      message: `Fila atualizada: ${totalPlayers}/10. ${roleSummary}${fillSuffix}.`,
      isReady: this.canFormMatch(visibleQueue),
    };
  }

  /**
   * Returns true when the queue has enough players to form a complete 10-player match.
   * FILL players can cover any role that still needs players.
   */
  private canFormMatch(queue: readonly QueuePlayer[]): boolean {
    if (queue.length < 10) return false;
    const fillCount = queue.filter((p) => p.role === "FILL").length;
    let needed = 0;
    for (const role of ROLES) {
      const roleCount = queue.filter((p) => p.role === role).length;
      const missing = Math.max(0, 2 - roleCount);
      needed += missing;
    }
    return needed <= fillCount;
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

    // Try without FILL first (original logic)
    const withoutFill = this.selectMatchPlayersFromPool(
      selectableQueue.filter((p) => p.role !== "FILL"),
    );
    if (withoutFill) return withoutFill;

    // Try resolving FILL players into needed roles
    return this.selectMatchPlayersWithFill(selectableQueue);
  }

  private selectMatchPlayersFromPool(pool: readonly QueuePlayer[]): QueuePlayer[] | undefined {
    const roles = createEmptyRoles();
    for (const role of ROLES) {
      roles[role] = pool.filter((player) => player.role === role);
      if (roles[role].length < 2) {
        return undefined;
      }
    }

    for (let poolSize = 10; poolSize <= pool.length; poolSize += 1) {
      const subPool = pool.slice(0, poolSize);
      const rolePairs = ROLES.map((role) => this.twoPlayerCombinations(subPool.filter((player) => player.role === role)));
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

  /**
   * Resolve FILL players into roles that need them.
   * FILL players are assigned to the scarcest roles (fewest players first).
   * Never displaces existing role players.
   */
  private selectMatchPlayersWithFill(queue: readonly QueuePlayer[]): QueuePlayer[] | undefined {
    const rolePlayers = createEmptyRoles();
    const fillPlayers: QueuePlayer[] = [];

    for (const player of queue) {
      if (player.role === "FILL") {
        fillPlayers.push(player);
      } else {
        rolePlayers[player.role].push(player);
      }
    }

    // Count how many extra players each role needs
    const roleNeeds: { role: Role; needed: number }[] = ROLES.map((role) => ({
      role,
      needed: Math.max(0, 2 - rolePlayers[role].length),
    }))
      .filter((r) => r.needed > 0)
      .sort((a, b) => b.needed - a.needed); // most needed first

    let totalNeeded = roleNeeds.reduce((sum, r) => sum + r.needed, 0);
    if (totalNeeded > fillPlayers.length) return undefined;
    if (totalNeeded === 0 && fillPlayers.length === 0) return undefined;

    // Assign FILL players to needed roles (FIFO order — earliest fill gets first pick)
    const resolvedPlayers: QueuePlayer[] = [];
    let fillIndex = 0;

    for (const { role, needed } of roleNeeds) {
      for (let i = 0; i < needed && fillIndex < fillPlayers.length; i++) {
        const fillPlayer = fillPlayers[fillIndex]!;
        resolvedPlayers.push({ ...fillPlayer, role, joinedAsFill: true });
        fillIndex++;
      }
    }

    // If there are remaining fill players and some roles have <2 from resolved, they go to leftover roles
    // But we only need exactly 10 players total
    const combined = [
      ...ROLES.flatMap((role) => rolePlayers[role].slice(0, 2)),
      ...resolvedPlayers,
    ];

    // Trim to first 2 per role
    const finalRoles = createEmptyRoles();
    for (const player of combined) {
      if (player.role === "FILL") continue; // shouldn't happen after resolution
      if (finalRoles[player.role as Role].length < 2) {
        finalRoles[player.role as Role].push(player);
      }
    }

    const finalPlayers = ROLES.flatMap((role) => finalRoles[role]);
    if (this.isValidMatchSelection(finalPlayers)) {
      return finalPlayers;
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
        if (!duo || duo.role === "FILL") {
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
    // FILL players and overflow go at the end
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
