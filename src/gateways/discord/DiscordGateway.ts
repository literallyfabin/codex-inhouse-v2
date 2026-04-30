import { randomUUID } from "node:crypto";
import {
  ChannelType as DiscordChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type MessageEditOptions,
  type TextBasedChannel,
} from "discord.js";
import { env } from "../../config/env.js";
import { MatchmakingService } from "../../core/matchmaking/MatchmakingService.js";
import type { BalancedMatch, QueuePlayer, RatedQueuePlayer, Role, Team } from "../../core/models/types.js";
import { ROLES, isRole, isTeam } from "../../core/models/types.js";
import { QueueService, type QueueSnapshot } from "../../core/queue/QueueService.js";
import { GuildService, type GuildConfigKey } from "../../services/guildService.js";
import { MatchService } from "../../services/matchService.js";
import { QueueRepository } from "../../services/queueRepository.js";
import { ReadyCheckRepository } from "../../services/readyCheckRepository.js";
import { StatsService, type RankingEntry } from "../../services/statsService.js";
import { UserService } from "../../services/userService.js";
import { riotApiService } from "../../services/riotApiService.js";
import { riotOAuthService } from "../../services/riotOAuthService.js";
import {
  RANKING_PAGE_SIZE,
  ROLE_EMOJI_NAMES,
  buildCompareEmbed,
  buildDuoButtons,
  buildDuoInviteEmbed,
  buildHistoryEmbed,
  buildLinkAccountEmbed,
  buildAlreadyLinkedEmbed,
  buildMatchEmbed,
  buildMmrHistoryEmbed,
  buildQueueButtons,
  buildQueueEmbed,
  buildRankingButtons,
  buildRankingEmbed,
  buildReadyCheckButtons,
  buildReadyCheckEmbed,
  buildSetupEmbed,
  buildStatsEmbed,
  buildValidationButtons,
  buildValidationEmbed,
  leaveButtonId,
  parseDuoButtonId,
  parseRankingButtonId,
  parseReadyButtonId,
  renderTeamName,
  type DiscordPresentation,
} from "./components.js";

type PendingValidationAction = "WIN" | "CANCEL";
type QueueInteraction = ChatInputCommandInteraction | ButtonInteraction;

const READY_CHECK_TIMEOUT_MS = 120_000;
const DUO_INVITE_TIMEOUT_MS = 60_000;
const MATCHMAKING_QUALITY_THRESHOLD = 0.2;
const MANAGED_CHANNEL_FETCH_LIMIT = 50;
const CANCELLED_REQUEUE_PRIORITY_MS = 10 * 60_000;

interface PendingValidation {
  action: PendingValidationAction;
  matchId: string;
  winningTeam?: Team;
  participantUserIds: Set<string>;
  acceptedUserIds: Set<string>;
  requesterDisplayName: string;
  requesterAvatarUrl: string;
}

interface RankingSession {
  entries: RankingEntry[];
  page: number;
  createdAt: number;
  role?: Role;
}

interface PendingReadyCheck {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  match: BalancedMatch;
  players: QueuePlayer[];
  acceptedUserIds: Set<string>;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingDuoInvite {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string;
  requesterDiscordId: string;
  targetDiscordId: string;
  requester: QueuePlayer;
  target: QueuePlayer;
  timeout: ReturnType<typeof setTimeout>;
}

interface ReadyCheckCandidate {
  players: QueuePlayer[];
  match: BalancedMatch;
}

export class DiscordGateway {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private readonly pendingValidations = new Map<string, PendingValidation>();
  private readonly rankingSessions = new Map<string, RankingSession>();
  private readonly pendingReadyChecks = new Map<string, PendingReadyCheck>();
  private readonly pendingDuoInvites = new Map<string, PendingDuoInvite>();
  private readonly presentationsByGuild = new Map<string, DiscordPresentation>();
  private readonly cancelledBoosts = new Map<string, Date>();
  private lastQueueResetRun = "";

  constructor(
    private readonly token: string,
    private readonly queueService = new QueueService(),
    private readonly userService = new UserService(),
    private readonly matchService = new MatchService(),
    private readonly matchmakingService = new MatchmakingService(),
    private readonly statsService = new StatsService(),
    private readonly guildService = new GuildService(),
    private readonly queueRepository = new QueueRepository(),
    private readonly readyCheckRepository = new ReadyCheckRepository(),
  ) {}

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`Discord gateway logged in as ${readyClient.user.tag}.`);
      this.bootstrap().catch((error: unknown) => {
        console.error("Discord bootstrap failed", error);
      });
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      this.handleInteraction(interaction).catch((error: unknown) => {
        console.error("Discord interaction failed", error);
      });
    });

    await this.client.login(this.token);
  }

  private async bootstrap(): Promise<void> {
    await this.readyCheckRepository.cancelPendingOnStartup();
    await this.queueRepository.clearAllReadyChecks();
    this.queueService.loadQueues(await this.queueRepository.loadAll());

    for (const guild of this.client.guilds.cache.values()) {
      await this.refreshPresentation(guild);
      await this.refreshGuildSurfaces(guild.id);
    }

    setInterval(() => {
      this.runScheduledJobs().catch((error: unknown) => {
        console.error("Scheduled Discord job failed", error);
      });
    }, 60_000);
  }

  async sendLinkSuccessDm(discordId: string, gameName: string, tagLine: string): Promise<void> {
    try {
      const user = await this.client.users.fetch(discordId);
      const { buildLinkSuccessEmbed } = await import("./components.js");
      await user.send({ embeds: [buildLinkSuccessEmbed(gameName, tagLine)] });
    } catch {
      // DMs may be disabled — silently ignore
    }
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await this.handleButton(interaction);
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    switch (interaction.commandName) {
      case "setup-inhouse":
        await this.handleSetupInhouse(interaction);
        return;

      case "queue":
        await this.handleQueueCommand(interaction);
        return;

      case "queue-status":
        {
          const presentation = await this.presentationForGuild(interaction.guildId);
          await interaction.reply({
            embeds: [buildQueueEmbed(this.queueService.snapshot(interaction.channelId), presentation)],
            ephemeral: true,
          });
        }
        return;

      case "leave-queue":
        await this.handleLeaveQueue(interaction);
        return;

      case "admin-win":
        await this.handleAdminWin(interaction);
        return;

      case "stats":
      case "rank":
        await this.handleStats(interaction);
        return;

      case "ranking":
        await this.handleRanking(interaction);
        return;

      case "history":
        await this.handleHistory(interaction);
        return;

      case "mmr-history":
        await this.handleMmrHistory(interaction);
        return;

      case "champion":
        await this.handleChampion(interaction);
        return;

      case "won":
        await this.handleWonCommand(interaction);
        return;

      case "cancel":
      case "remake":
        await this.handleCancelCommand(interaction);
        return;

      case "compare":
        await this.handleCompare(interaction);
        return;

      case "link-account":
        await this.handleLinkAccount(interaction);
        return;

      case "admin-channel":
        await this.handleAdminChannel(interaction);
        return;

      case "admin-config":
        await this.handleAdminConfig(interaction);
        return;

      case "admin-reset":
        await this.handleAdminReset(interaction);
        return;

      case "admin-cancel":
        await this.handleAdminCancel(interaction);
        return;

      case "admin-win-user":
        await this.handleAdminWinUser(interaction);
        return;

      case "admin-cancel-user":
        await this.handleAdminCancelUser(interaction);
        return;

      case "dev-create-match":
        await this.handleDevCreateMatch(interaction);
        return;

      default:
        await interaction.reply({ content: "Comando nao reconhecido.", ephemeral: true });
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (await this.handleRankingButton(interaction)) {
      return;
    }

    if (await this.handleReadyButton(interaction)) {
      return;
    }

    if (await this.handleDuoButton(interaction)) {
      return;
    }

    if (await this.handleValidationButton(interaction)) {
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ content: "Use a fila dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!(await this.ensureQueueChannel(interaction))) {
      return;
    }

    if (interaction.customId === leaveButtonId) {
      await this.handleLeaveQueue(interaction);
      return;
    }

    const role = this.roleFromButton(interaction.customId);
    if (!role) {
      await interaction.reply({ content: "Botao de fila invalido.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await this.joinSinglePlayer(interaction, role);
  }

  private async handleSetupInhouse(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: "Apenas administradores podem criar o painel de inhouse.",
        ephemeral: true,
      });
      return;
    }

    await this.guildService.markChannel(interaction.guildId, interaction.channelId, "QUEUE");
    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.reply({
      embeds: [buildSetupEmbed()],
      components: buildQueueButtons(presentation),
    });
  }

  private async handleLeaveQueue(interaction: QueueInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    const user = await this.userService.upsertDiscordUser(
      interaction.user.id,
      interaction.user.displayName,
    );
    const snapshot = this.queueService.leave(interaction.channelId, user.id);
    await this.queueRepository.removeUserFromChannel(interaction.channelId, user.id);
    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.reply({ embeds: [buildQueueEmbed(snapshot, presentation)], ephemeral: true });
    await this.refreshQueueChannels(interaction.guildId);
  }

  private async handleAdminWin(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: "Apenas administradores podem registrar resultado.",
        ephemeral: true,
      });
      return;
    }

    const matchId = interaction.options.getString("match_id", true);
    const team = interaction.options.getString("team", true);
    if (!isTeam(team)) {
      await interaction.reply({ content: "Time vencedor invalido.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const matchContext = await this.matchService.getMatchContext(matchId);
    await this.matchService.completeMatch(matchId, team);
    await this.deleteVoiceChannels(interaction.guild, matchId);
    await this.refreshRankingChannels(matchContext.guildId);
    await interaction.editReply(`Partida ${matchId} finalizada com vitoria do time ${renderTeamName(team)}.`);
  }

  private async handleQueueCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!(await this.ensureQueueChannel(interaction))) {
      return;
    }

    const roleValue = interaction.options.getString("rota", true);
    if (!isRole(roleValue)) {
      await interaction.reply({ content: "Rota invalida.", ephemeral: true });
      return;
    }

    const duo = interaction.options.getUser("duo");
    const duoRoleValue = interaction.options.getString("rota_duo");
    if (!duo) {
      await interaction.deferReply({ ephemeral: true });
      await this.joinSinglePlayer(interaction, roleValue);
      return;
    }

    if (duo.bot) {
      await interaction.reply({ content: "Duo precisa ser outro jogador, nao um bot.", ephemeral: true });
      return;
    }

    if (duo.id === interaction.user.id) {
      await interaction.reply({ content: "Voce nao pode entrar em duo com voce mesmo.", ephemeral: true });
      return;
    }

    if (!duoRoleValue || !isRole(duoRoleValue)) {
      await interaction.reply({ content: "Informe a rota_duo para entrar em duo.", ephemeral: true });
      return;
    }

    if (roleValue === duoRoleValue) {
      await interaction.reply({ content: "Duo precisa usar rotas diferentes.", ephemeral: true });
      return;
    }

    await this.openDuoInvite(interaction, duo, roleValue, duoRoleValue);
  }

  private async joinSinglePlayer(interaction: QueueInteraction, role: Role): Promise<void> {
    if (!interaction.guildId) {
      await interaction.editReply("Use este comando dentro de um servidor.");
      return;
    }

    const user = await this.userService.upsertDiscordUser(
      interaction.user.id,
      interaction.user.displayName,
    );
    await this.userService.ensureDefaultStats(interaction.guildId, user.id);

    const blockedReason = await this.getQueueBlockedReason(interaction.guildId, user.id);
    if (blockedReason) {
      await interaction.editReply(blockedReason);
      return;
    }

    const result = this.queueService.join(interaction.channelId, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: user.id,
      platform: "discord",
      platformUserId: interaction.user.id,
      displayName: interaction.user.displayName,
      role,
      joinedAt: this.consumePriorityJoinedAt(user.id),
    });

    if (result.player) {
      await this.queueRepository.upsertPlayers([result.player]);
    }

    await this.replyToQueueResult(interaction, result.snapshot, result.matchPlayers);
    await this.refreshQueueChannels(interaction.guildId);
  }

  private async openDuoInvite(
    interaction: ChatInputCommandInteraction,
    duo: NonNullable<ReturnType<ChatInputCommandInteraction["options"]["getUser"]>>,
    requesterRole: Role,
    targetRole: Role,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const [requesterUser, targetUser] = await Promise.all([
      this.userService.upsertDiscordUser(interaction.user.id, interaction.user.displayName),
      this.userService.upsertDiscordUser(duo.id, duo.displayName),
    ]);
    await Promise.all([
      this.userService.ensureDefaultStats(interaction.guildId, requesterUser.id),
      this.userService.ensureDefaultStats(interaction.guildId, targetUser.id),
    ]);

    const requesterBlocked = await this.getQueueBlockedReason(interaction.guildId, requesterUser.id);
    if (requesterBlocked) {
      await interaction.editReply(requesterBlocked);
      return;
    }

    const targetBlocked = await this.getQueueBlockedReason(interaction.guildId, targetUser.id);
    if (targetBlocked) {
      await interaction.editReply(`${duo.displayName} nao pode entrar na fila agora: ${targetBlocked}`);
      return;
    }

    const inviteId = randomUUID();
    const requester: QueuePlayer = {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: requesterUser.id,
      platform: "discord",
      platformUserId: interaction.user.id,
      displayName: interaction.user.displayName,
      role: requesterRole,
      duoUserId: targetUser.id,
      readyCheckId: null,
      joinedAt: this.consumePriorityJoinedAt(requesterUser.id),
    };
    const target: QueuePlayer = {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: targetUser.id,
      platform: "discord",
      platformUserId: duo.id,
      displayName: duo.displayName,
      role: targetRole,
      duoUserId: requesterUser.id,
      readyCheckId: null,
      joinedAt: this.consumePriorityJoinedAt(targetUser.id),
    };

    const pending: PendingDuoInvite = {
      id: inviteId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      requesterDiscordId: interaction.user.id,
      targetDiscordId: duo.id,
      requester,
      target,
      timeout: setTimeout(() => {
        this.expireDuoInvite(inviteId).catch((error: unknown) => {
          console.error("Duo invite timeout failed", error);
        });
      }, DUO_INVITE_TIMEOUT_MS),
    };
    this.pendingDuoInvites.set(inviteId, pending);

    await interaction.editReply(`Convite enviado para ${duo.displayName}.`);
    if (interaction.channel?.isSendable()) {
      const presentation = await this.presentationForGuild(interaction.guildId);
      const message = await interaction.channel.send({
        content: this.mentionDiscordUsers([duo.id]),
        embeds: [
          buildDuoInviteEmbed({
            requesterName: interaction.user.displayName,
            requesterRole,
            targetName: duo.displayName,
            targetRole,
            presentation,
          }),
        ],
        components: buildDuoButtons(inviteId),
      });
      pending.messageId = message.id;
    }
  }

  private async handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser("jogador") ?? interaction.user;
    const user = await this.userService.upsertDiscordUser(target.id, target.displayName);
    await this.userService.ensureDefaultStats(interaction.guildId, user.id);
    const summaries = await this.statsService.getPlayerSummary(interaction.guildId, user.id);

    if (summaries.length === 0) {
      await interaction.editReply(`${target.displayName} ainda nao tem partidas finalizadas neste servidor.`);
      return;
    }

    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.editReply({ embeds: [buildStatsEmbed(target.displayName, summaries, presentation)] });
  }

  private async handleRanking(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    const roleValue = interaction.options.getString("rota");
    const role = roleValue && isRole(roleValue) ? roleValue : undefined;

    await interaction.deferReply();
    const entries = await this.statsService.getRanking(interaction.guildId, role, 100);
    if (entries.length === 0) {
      await interaction.editReply("Ainda nao ha partidas finalizadas para montar ranking.");
      return;
    }

    const sessionId = randomUUID();
    const session: RankingSession = {
      entries,
      page: 0,
      createdAt: Date.now(),
    };
    if (role) {
      session.role = role;
    }
    this.rankingSessions.set(sessionId, session);

    const totalPages = Math.max(1, Math.ceil(entries.length / RANKING_PAGE_SIZE));
    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.editReply({
      embeds: [buildRankingEmbed(entries, role, session.page, presentation)],
      components: buildRankingButtons(sessionId, session.page, totalPages),
    });
  }

  private async handleRankingButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseRankingButtonId(interaction.customId);
    if (!parsed) {
      return false;
    }

    const session = this.rankingSessions.get(parsed.sessionId);
    if (!session) {
      await interaction.reply({
        content: "Esse ranking expirou. Use /ranking novamente.",
        ephemeral: true,
      });
      return true;
    }

    const totalPages = Math.max(1, Math.ceil(session.entries.length / RANKING_PAGE_SIZE));
    session.page =
      parsed.direction === "next"
        ? Math.min(session.page + 1, totalPages - 1)
        : Math.max(session.page - 1, 0);

    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.update({
      embeds: [buildRankingEmbed(session.entries, session.role, session.page, presentation)],
      components: buildRankingButtons(parsed.sessionId, session.page, totalPages),
    });
    return true;
  }

  private async handleReadyButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseReadyButtonId(interaction.customId);
    if (!parsed) {
      return false;
    }

    const pending = this.pendingReadyChecks.get(parsed.readyCheckId);
    if (!pending) {
      await interaction.reply({ content: "Esse ready-check expirou ou ja foi fechado.", ephemeral: true });
      return true;
    }

    const user = await this.userService.upsertDiscordUser(
      interaction.user.id,
      interaction.user.displayName,
    );
    if (!pending.players.some((player) => player.userId === user.id)) {
      await interaction.reply({ content: "Somente jogadores desta partida podem responder.", ephemeral: true });
      return true;
    }

    if (parsed.action === "reject") {
      await interaction.deferUpdate();
      await this.cancelReadyCheck(parsed.readyCheckId, user.id, interaction.user.displayName);
      await interaction.followUp({ content: "Voce recusou a partida e saiu desta fila.", ephemeral: true });
      return true;
    }

    if (pending.acceptedUserIds.has(user.id)) {
      await interaction.reply({ content: "Voce ja aceitou esta partida.", ephemeral: true });
      return true;
    }

    pending.acceptedUserIds.add(user.id);
    await this.readyCheckRepository.setAcceptedUserIds(pending.id, [...pending.acceptedUserIds]);

    if (pending.acceptedUserIds.size < pending.players.length) {
      const presentation = await this.presentationForGuild(pending.guildId);
      await interaction.update({
        embeds: [buildReadyCheckEmbed(pending.id, pending.match, pending.acceptedUserIds, presentation)],
        components: buildReadyCheckButtons(pending.id),
      });
      return true;
    }

    await interaction.deferUpdate();
    await this.acceptReadyCheck(pending.id);
    await interaction.followUp({ content: "Partida confirmada.", ephemeral: true });
    return true;
  }

  private async handleDuoButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseDuoButtonId(interaction.customId);
    if (!parsed) {
      return false;
    }

    const pending = this.pendingDuoInvites.get(parsed.duoId);
    if (!pending) {
      await interaction.reply({ content: "Esse convite de duo expirou.", ephemeral: true });
      return true;
    }

    if (interaction.user.id !== pending.targetDiscordId) {
      await interaction.reply({ content: "Apenas o jogador convidado pode responder este duo.", ephemeral: true });
      return true;
    }

    clearTimeout(pending.timeout);
    this.pendingDuoInvites.delete(parsed.duoId);
    await interaction.deferUpdate();

    if (parsed.action === "reject") {
      await interaction.message.edit({
        content: `${interaction.user.displayName} recusou o duo.`,
        embeds: [],
        components: [],
      });
      return true;
    }

    const requesterBlocked = await this.getQueueBlockedReason(pending.guildId, pending.requester.userId);
    const targetBlocked = await this.getQueueBlockedReason(pending.guildId, pending.target.userId);
    if (requesterBlocked || targetBlocked) {
      await interaction.message.edit({
        content: `Duo cancelado: ${requesterBlocked ?? targetBlocked}`,
        embeds: [],
        components: [],
      });
      return true;
    }

    const result = this.queueService.joinGroup(pending.channelId, [pending.requester, pending.target]);
    if (result.players) {
      await this.queueRepository.upsertPlayers(result.players);
    }

    const presentation = await this.presentationForGuild(pending.guildId);
    await interaction.message.edit({
      content: "Duo aceito. Jogadores adicionados na fila.",
      embeds: [buildQueueEmbed(result.snapshot, presentation)],
      components: [],
    });
    await this.handleQueueJoinResult(
      pending.guildId,
      pending.channelId,
      interaction.channel,
      result.snapshot,
      result.matchPlayers,
    );
    await this.refreshQueueChannels(pending.guildId);
    return true;
  }

  private async handleHistory(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser("jogador") ?? interaction.user;
    const limit = interaction.options.getInteger("limite") ?? 10;
    const user = await this.userService.upsertDiscordUser(target.id, target.displayName);
    const history = await this.statsService.getHistory(interaction.guildId, user.id, limit);

    if (history.length === 0) {
      await interaction.editReply(`${target.displayName} ainda nao tem historico neste servidor.`);
      return;
    }

    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.editReply({ embeds: [buildHistoryEmbed(target.displayName, history, presentation)] });
  }

  private async handleCompare(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: false });

    const arg1 = interaction.options.getUser("jogador1");
    const arg2 = interaction.options.getUser("jogador2");
    
    if (!arg1) {
      await interaction.editReply("Especifique pelo menos um jogador.");
      return;
    }

    const discordUser1 = arg2 ? arg1 : interaction.user;
    const discordUser2 = arg2 ? arg2 : arg1;

    if (discordUser1.id === discordUser2.id) {
      await interaction.editReply("Você precisa escolher dois jogadores diferentes para comparar.");
      return;
    }

    const user1 = await this.userService.upsertDiscordUser(discordUser1.id, discordUser1.displayName);
    const user2 = await this.userService.upsertDiscordUser(discordUser2.id, discordUser2.displayName);

    const comparison = await this.statsService.getComparison(interaction.guildId, user1.id, user2.id);
    await interaction.editReply({ 
      embeds: [buildCompareEmbed(discordUser1.displayName, discordUser2.displayName, comparison)] 
    });
  }

  private async handleLinkAccount(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!riotApiService.isConfigured) {
      await interaction.reply({
        content: "❌ A integração com a Riot não está configurada. Contate o administrador.",
        ephemeral: true,
      });
      return;
    }

    const nick = interaction.options.getString("nick", true).trim();
    const tag = interaction.options.getString("tag", true).trim().replace(/^#/, "");

    await interaction.deferReply({ ephemeral: true });

    // Check if already linked
    const existing = await riotOAuthService.getRiotAccountForDiscordId(interaction.user.id);
    if (existing) {
      await interaction.editReply({
        embeds: [buildAlreadyLinkedEmbed(existing.gameName, existing.tagLine)],
      });
      return;
    }

    // Look up account via Riot API
    try {
      const account = await riotApiService.getAccountByRiotId(nick, tag);

      // Save to Supabase via riotOAuthService
      await riotOAuthService["saveRiotAccount"](interaction.user.id, account);

      const { buildLinkSuccessEmbed } = await import("./components.js");
      await interaction.editReply({
        embeds: [buildLinkSuccessEmbed(account.gameName, account.tagLine)],
      });
    } catch {
      await interaction.editReply(
        `❌ Conta **${nick}#${tag}** não encontrada. Verifique o nick e a tag e tente novamente.`,
      );
    }
  }

  private async handleMmrHistory(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    const roleValue = interaction.options.getString("rota");
    const role = roleValue && isRole(roleValue) ? roleValue : undefined;
    const limit = interaction.options.getInteger("limite") ?? 30;
    const target = interaction.options.getUser("jogador") ?? interaction.user;

    await interaction.deferReply({ ephemeral: true });
    const user = await this.userService.upsertDiscordUser(target.id, target.displayName);
    const history = await this.statsService.getMmrHistory(interaction.guildId, user.id, role, limit);
    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.editReply({
      embeds: [buildMmrHistoryEmbed(target.displayName, history, role, presentation)],
    });
  }

  private async handleChampion(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const championName = interaction.options.getString("nome", true).trim();
    const matchId = interaction.options.getString("match_id")?.trim();
    const user = await this.userService.upsertDiscordUser(
      interaction.user.id,
      interaction.user.displayName,
    );
    const updatedMatchId = await this.statsService.setChampionName(
      interaction.guildId,
      user.id,
      championName,
      matchId || undefined,
    );

    await interaction.editReply(`Campeao de ${interaction.user.displayName} salvo em ${updatedMatchId}: ${championName}.`);
  }

  private async handleWonCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.openMatchValidation(interaction, "WIN");
  }

  private async handleCancelCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.openMatchValidation(interaction, "CANCEL");
  }

  private async openMatchValidation(
    interaction: ChatInputCommandInteraction,
    action: PendingValidationAction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    const user = await this.userService.upsertDiscordUser(
      interaction.user.id,
      interaction.user.displayName,
    );
    const match = await this.matchService.getLatestOngoingMatchForUser(interaction.guildId, user.id);
    if (!match) {
      await interaction.reply({
        content: "Nao encontrei partida em andamento para voce neste servidor.",
        ephemeral: true,
      });
      return;
    }

    const validationId = randomUUID();
    const pendingValidation: PendingValidation = {
      action,
      matchId: match.matchId,
      participantUserIds: new Set(match.participantUserIds),
      acceptedUserIds: new Set(),
      requesterDisplayName: interaction.user.displayName,
      requesterAvatarUrl: interaction.user.displayAvatarURL(),
    };
    if (action === "WIN") {
      pendingValidation.winningTeam = match.team;
    }
    this.pendingValidations.set(validationId, pendingValidation);

    const participantUsers = await this.userService.getUsersByIds(Array.from(pendingValidation.participantUserIds));
    const discordIds = participantUsers
      .map((u) => u.discordId)
      .filter((id): id is string => id !== null);

    await interaction.reply({
      content: this.mentionDiscordUsers(discordIds),
      embeds: [this.renderValidationEmbed(validationId)],
      components: buildValidationButtons(validationId),
    });
  }

  private async handleValidationButton(interaction: ButtonInteraction): Promise<boolean> {
    const acceptPrefix = "inhouse:validation:accept:";
    const rejectPrefix = "inhouse:validation:reject:";
    const isAccept = interaction.customId.startsWith(acceptPrefix);
    const isReject = interaction.customId.startsWith(rejectPrefix);
    if (!isAccept && !isReject) {
      return false;
    }

    const validationId = interaction.customId.slice(isAccept ? acceptPrefix.length : rejectPrefix.length);
    const pending = this.pendingValidations.get(validationId);
    if (!pending) {
      await interaction.reply({ content: "Esta validacao expirou ou ja foi concluida.", ephemeral: true });
      return true;
    }

    const user = await this.userService.upsertDiscordUser(
      interaction.user.id,
      interaction.user.displayName,
    );
    if (!pending.participantUserIds.has(user.id)) {
      await interaction.reply({ content: "Somente jogadores desta partida podem validar.", ephemeral: true });
      return true;
    }

    if (isReject) {
      this.pendingValidations.delete(validationId);
      await interaction.deferUpdate();
      await interaction.message.edit({
        content: `Validacao da partida ${pending.matchId} recusada por ${interaction.user.displayName}.`,
        components: [],
      });
      return true;
    }

    if (pending.acceptedUserIds.has(user.id)) {
      await interaction.reply({ content: "Voce ja validou esta solicitacao.", ephemeral: true });
      return true;
    }

    pending.acceptedUserIds.add(user.id);
    if (pending.acceptedUserIds.size < 6) {
      await interaction.update({
        embeds: [this.renderValidationEmbed(validationId)],
        components: buildValidationButtons(validationId),
      });
      return true;
    }

    await interaction.deferUpdate();
    if (pending.action === "WIN") {
      if (!pending.winningTeam) {
        throw new Error("Missing winning team for win validation.");
      }
      await this.matchService.completeMatch(pending.matchId, pending.winningTeam);
      await this.deleteVoiceChannels(interaction.guild, pending.matchId);
      if (interaction.guildId) {
        await this.refreshRankingChannels(interaction.guildId);
      }
    } else {
      await this.matchService.cancelMatch(pending.matchId);
      this.prioritizeCancelledPlayers(pending.participantUserIds);
      await this.deleteVoiceChannels(interaction.guild, pending.matchId);
    }

    this.pendingValidations.delete(validationId);
    const actionText =
      pending.action === "WIN"
        ? `Partida ${pending.matchId} finalizada com vitoria do time ${renderTeamName(pending.winningTeam!)}.`
        : `Partida ${pending.matchId} cancelada.`;
    await interaction.message.edit({ content: actionText, embeds: [], components: [] });
    await interaction.followUp({ content: "Validacao concluida.", ephemeral: true });
    return true;
  }

  private async handleAdminChannel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Apenas administradores podem configurar canais.", ephemeral: true });
      return;
    }

    const action = interaction.options.getString("acao", true);
    if (action === "UNMARK") {
      await this.guildService.unmarkChannel(interaction.channelId);
      await interaction.reply({ content: "Canal desmarcado.", ephemeral: true });
      return;
    }

    const channelType = action === "MARK_QUEUE" ? "QUEUE" : "RANKING";
    await this.guildService.markChannel(interaction.guildId, interaction.channelId, channelType);
    await interaction.reply({
      content: `Canal marcado como ${channelType === "QUEUE" ? "fila" : "ranking"}.`,
      ephemeral: true,
    });

    if (channelType === "QUEUE") {
      await this.refreshQueueChannels(interaction.guildId);
    } else {
      await this.refreshRankingChannels(interaction.guildId);
    }
  }

  private async handleAdminConfig(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Apenas administradores podem alterar config.", ephemeral: true });
      return;
    }

    const key = interaction.options.getString("chave", true) as GuildConfigKey;
    const option = interaction.options.getString("opcao", true);
    const value =
      option === "STATUS"
        ? await this.guildService.getConfig(interaction.guildId, key)
        : await this.guildService.setConfig(interaction.guildId, key, option === "ON");

    await interaction.reply({
      content: `${key}: ${value ? "ON" : "OFF"}`,
      ephemeral: true,
    });
  }

  private async handleAdminReset(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Apenas administradores podem resetar filas.", ephemeral: true });
      return;
    }

    const target = interaction.options.getUser("jogador");
    if (target) {
      const user = await this.userService.upsertDiscordUser(target.id, target.displayName);
      const snapshots = this.queueService.removeUsersEverywhereInGuild(interaction.guildId, [user.id]);
      await this.queueRepository.removeUsersEverywhereInGuild(interaction.guildId, [user.id]);
      await this.refreshQueueChannels(interaction.guildId);
      await interaction.reply({
        content: `${target.displayName} removido das filas. Filas afetadas: ${snapshots.length}.`,
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel("canal");
    const queueId = channel?.id ?? interaction.channelId;
    this.queueService.reset(queueId);
    await this.queueRepository.resetChannel(queueId);
    await this.refreshQueueChannels(interaction.guildId);
    await interaction.reply({ content: `Fila resetada no canal <#${queueId}>.`, ephemeral: true });
  }

  private async handleAdminCancel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Apenas administradores podem cancelar partidas.", ephemeral: true });
      return;
    }

    const matchId = interaction.options.getString("match_id", true);
    await interaction.deferReply({ ephemeral: true });
    const matchContext = await this.matchService.getMatchContext(matchId);
    await this.matchService.cancelMatch(matchId);
    this.prioritizeCancelledPlayers(matchContext.participantUserIds);
    await this.deleteVoiceChannels(interaction.guild, matchId);
    await interaction.editReply(`Partida ${matchId} cancelada.`);
  }

  private async handleAdminWinUser(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Apenas administradores podem registrar resultado.", ephemeral: true });
      return;
    }

    const target = interaction.options.getUser("jogador", true);
    await interaction.deferReply({ ephemeral: true });
    const user = await this.userService.upsertDiscordUser(target.id, target.displayName);
    const match = await this.matchService.getLatestOngoingMatchForUser(interaction.guildId, user.id);
    if (!match) {
      await interaction.editReply(`Nao encontrei partida em andamento para ${target.displayName}.`);
      return;
    }

    await this.matchService.completeMatch(match.matchId, match.team);
    await this.deleteVoiceChannels(interaction.guild, match.matchId);
    await this.refreshRankingChannels(interaction.guildId);
    await interaction.editReply(
      `Partida ${match.matchId} finalizada com vitoria do time ${renderTeamName(match.team)}.`,
    );
  }

  private async handleAdminCancelUser(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Apenas administradores podem cancelar partidas.", ephemeral: true });
      return;
    }

    const target = interaction.options.getUser("jogador", true);
    await interaction.deferReply({ ephemeral: true });
    const user = await this.userService.upsertDiscordUser(target.id, target.displayName);
    const match = await this.matchService.getLatestOngoingMatchForUser(interaction.guildId, user.id);
    if (!match) {
      await interaction.editReply(`Nao encontrei partida em andamento para ${target.displayName}.`);
      return;
    }

    await this.matchService.cancelMatch(match.matchId);
    this.prioritizeCancelledPlayers(match.participantUserIds);
    await this.deleteVoiceChannels(interaction.guild, match.matchId);
    await interaction.editReply(`Partida ${match.matchId} cancelada.`);
  }

  private async handleDevCreateMatch(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Apenas administradores podem criar partidas fake.", ephemeral: true });
      return;
    }

    const roleValue = interaction.options.getString("rota", true);
    if (!isRole(roleValue)) {
      await interaction.reply({ content: "Rota invalida.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const realUser = await this.userService.upsertDiscordUser(
      interaction.user.id,
      interaction.user.displayName,
    );
    await this.userService.ensureDefaultStats(interaction.guildId, realUser.id);
    const blockedReason = await this.getQueueBlockedReason(interaction.guildId, realUser.id);
    if (blockedReason) {
      await interaction.editReply(blockedReason);
      return;
    }

    const players: QueuePlayer[] = [
      {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: realUser.id,
        platform: "discord",
        platformUserId: interaction.user.id,
        displayName: interaction.user.displayName,
        role: roleValue,
        joinedAt: new Date(),
      },
    ];

    let fakeIndex = 1;
    const fakeSessionId = randomUUID().slice(0, 8);
    for (const role of ["TOP", "JGL", "MID", "ADC", "SUP"] as const) {
      const needed = role === roleValue ? 1 : 2;
      for (let slot = 0; slot < needed; slot += 1) {
        const fakeDiscordId = `dev-${interaction.guildId}-${fakeSessionId}-${fakeIndex}`;
        const fakeDisplayName = `Teste ${fakeIndex}`;
        const fakeUser = await this.userService.upsertDiscordUser(fakeDiscordId, fakeDisplayName);
        await this.userService.ensureDefaultStats(interaction.guildId, fakeUser.id);
        players.push({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: fakeUser.id,
          platform: "discord",
          platformUserId: fakeDiscordId,
          displayName: fakeDisplayName,
          role,
          joinedAt: new Date(Date.now() + fakeIndex),
        });
        fakeIndex += 1;
      }
    }

    const ratedPlayers = await this.matchService.hydrateRatings(players);
    const balancedMatch = this.matchmakingService.balance(ratedPlayers);
    const fakeAcceptedUserIds = players
      .filter((player) => player.userId !== realUser.id)
      .map((player) => player.userId);

    await this.openReadyCheck(
      interaction.guildId,
      interaction.channelId,
      interaction.channel,
      players,
      balancedMatch,
      fakeAcceptedUserIds,
    );

    await interaction.editReply(
      [
        "Ready-check fake criado.",
        "Os 9 jogadores teste ja aparecem como aceitos. Use os botoes da mensagem publica para aceitar ou recusar.",
      ].join("\n"),
    );
  }

  private async replyToQueueResult(
    interaction: QueueInteraction,
    snapshot: QueueSnapshot,
    matchPlayers?: QueuePlayer[],
  ): Promise<void> {
    const presentation = await this.presentationForGuild(interaction.guildId);
    await interaction.editReply({ embeds: [buildQueueEmbed(snapshot, presentation)] });
    await this.handleQueueJoinResult(
      interaction.guildId,
      interaction.channelId,
      interaction.channel,
      snapshot,
      matchPlayers,
    );
  }

  private async handleQueueJoinResult(
    guildId: string | null,
    channelId: string,
    channel: TextBasedChannel | null,
    snapshot: QueueSnapshot,
    matchPlayers?: QueuePlayer[],
  ): Promise<void> {
    if (!guildId || !matchPlayers) {
      return;
    }

    if (!snapshot.isReady) {
      return;
    }

    const candidate = await this.findReadyCheckCandidate(guildId, channelId);
    if (!candidate) {
      return;
    }

    await this.openReadyCheck(guildId, channelId, channel, candidate.players, candidate.match);
  }

  private async openReadyCheck(
    guildId: string,
    channelId: string,
    channel: TextBasedChannel | null,
    players: readonly QueuePlayer[],
    prebalancedMatch?: BalancedMatch,
    preacceptedUserIds: readonly string[] = [],
  ): Promise<void> {
    const activePlayers = await this.findPlayersWithOngoingMatches(guildId, players);
    if (activePlayers.length > 0) {
      const activeUserIds = activePlayers.map((player) => player.userId);
      this.queueService.removeUsersEverywhereInGuild(guildId, activeUserIds);
      await this.queueRepository.removeUsersEverywhereInGuild(guildId, activeUserIds);
      await this.refreshQueueChannels(guildId);

      if (channel?.isSendable()) {
        await channel.send(
          `Nao abri ready-check porque ${this.formatPlayerList(activePlayers)} ja tem partida em andamento. Removi da fila para evitar duplicidade.`,
        );
      }
      return;
    }

    const balancedMatch =
      prebalancedMatch ?? this.matchmakingService.balance(await this.matchService.hydrateRatings(players));

    if (balancedMatch.balanceScore >= MATCHMAKING_QUALITY_THRESHOLD) {
      if (channel?.isSendable()) {
        await channel.send(
          `Fila chegou em 10, mas o balanceamento ficou ruim demais (${(balancedMatch.balanceScore * 100).toFixed(1)}%). Aguardando outro encaixe.`,
        );
      }
      return;
    }

    const readyCheckId = randomUUID();
    const playerIds = players.map((player) => player.userId);
    const timeout = setTimeout(() => {
      this.timeoutReadyCheck(readyCheckId).catch((error: unknown) => {
        console.error("Ready-check timeout failed", error);
      });
    }, READY_CHECK_TIMEOUT_MS);

    const pending: PendingReadyCheck = {
      id: readyCheckId,
      guildId,
      channelId,
      match: balancedMatch,
      players: [...players],
      acceptedUserIds: new Set(preacceptedUserIds),
      timeout,
    };

    this.pendingReadyChecks.set(readyCheckId, pending);
    await this.readyCheckRepository.create({
      id: readyCheckId,
      guildId,
      channelId,
      players,
      expiresAt: new Date(Date.now() + READY_CHECK_TIMEOUT_MS),
    });
    if (pending.acceptedUserIds.size > 0) {
      await this.readyCheckRepository.setAcceptedUserIds(readyCheckId, [...pending.acceptedUserIds]);
    }
    this.queueService.markReadyCheckEverywhereInGuild(guildId, playerIds, readyCheckId);
    await this.queueRepository.markReadyCheckEverywhereInGuild(guildId, playerIds, readyCheckId);
    await this.refreshQueueChannels(guildId);

    if (channel?.isSendable()) {
      const presentation = await this.presentationForGuild(guildId);
      const message = await channel.send({
        content: this.mentionDiscordUsers(players.map((player) => player.platformUserId)),
        embeds: [buildReadyCheckEmbed(readyCheckId, balancedMatch, pending.acceptedUserIds, presentation)],
        components: buildReadyCheckButtons(readyCheckId),
      });
      pending.messageId = message.id;
      await this.readyCheckRepository.setMessageId(readyCheckId, message.id);
    }
  }

  private async acceptReadyCheck(readyCheckId: string): Promise<void> {
    const pending = this.pendingReadyChecks.get(readyCheckId);
    if (!pending) {
      return;
    }

    const activePlayers = await this.findPlayersWithOngoingMatches(pending.guildId, pending.players);
    if (activePlayers.length > 0) {
      await this.abortReadyCheckForActiveMatches(pending, activePlayers);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingReadyChecks.delete(readyCheckId);
    await this.readyCheckRepository.setStatus(readyCheckId, "ACCEPTED");

    const persistedMatch = await this.matchService.createMatch(pending.match);
    
    let tournamentCode: string | undefined;
    try {
      if (riotApiService.isConfigured) {
        tournamentCode = await riotApiService.createTournamentCode(persistedMatch.id, pending.match.teamBlue.length);
      }
    } catch (err) {
      console.error("Failed to generate tournament code:", err);
    }

    const playerIds = pending.players.map((player) => player.userId);
    this.queueService.removeUsersEverywhereInGuild(pending.guildId, playerIds);
    await this.queueRepository.removeUsersEverywhereInGuild(pending.guildId, playerIds);

    if (pending.messageId) {
      const presentation = await this.presentationForGuild(pending.guildId);
      await this.editManagedMessage(pending.channelId, pending.messageId, {
        content: `Partida criada: ${persistedMatch.id}`,
        embeds: [buildMatchEmbed(persistedMatch.id, pending.match, presentation, tournamentCode)],
        components: [],
      });
      await this.matchService.setDiscordMessageId(persistedMatch.id, pending.messageId);
    }

    const guild = this.client.guilds.cache.get(pending.guildId);
    if (guild) {
      await this.createVoiceChannels(guild, persistedMatch.id, pending.match);
      await this.refreshQueueChannels(pending.guildId);
    }
  }

  private async cancelReadyCheck(
    readyCheckId: string,
    rejectedUserId: string,
    rejectedDisplayName: string,
  ): Promise<void> {
    const pending = this.pendingReadyChecks.get(readyCheckId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingReadyChecks.delete(readyCheckId);
    await this.readyCheckRepository.setStatus(readyCheckId, "CANCELLED", rejectedUserId);
    this.queueService.clearReadyCheck(readyCheckId);
    await this.queueRepository.clearReadyCheck(readyCheckId);
    this.queueService.removePlayers(pending.channelId, [rejectedUserId]);
    await this.queueRepository.removeUserFromChannel(pending.channelId, rejectedUserId);

    if (pending.messageId) {
      await this.editManagedMessage(pending.channelId, pending.messageId, {
        content: `${rejectedDisplayName} recusou. Ele saiu da fila e os outros jogadores voltaram automaticamente.`,
        embeds: [],
        components: [],
      });
    }

    await this.refreshQueueChannels(pending.guildId);
    await this.retryMatchmaking(pending.guildId, pending.channelId);
  }

  private async timeoutReadyCheck(readyCheckId: string): Promise<void> {
    const pending = this.pendingReadyChecks.get(readyCheckId);
    if (!pending) {
      return;
    }

    this.pendingReadyChecks.delete(readyCheckId);
    await this.readyCheckRepository.setStatus(readyCheckId, "TIMEOUT");
    this.queueService.clearReadyCheck(readyCheckId);
    await this.queueRepository.clearReadyCheck(readyCheckId);

    const notAccepted = pending.players
      .filter((player) => !pending.acceptedUserIds.has(player.userId))
      .map((player) => player.userId);
    this.queueService.removeUsersEverywhereInGuild(pending.guildId, notAccepted);
    await this.queueRepository.removeUsersEverywhereInGuild(pending.guildId, notAccepted);

    if (pending.messageId) {
      const names = pending.players
        .filter((player) => !pending.acceptedUserIds.has(player.userId))
        .map((player) => player.displayName)
        .join(", ");
      await this.editManagedMessage(pending.channelId, pending.messageId, {
        content: `Ready-check expirou. Removidos da fila: ${names || "ninguem"}.`,
        embeds: [],
        components: [],
      });
    }

    await this.refreshQueueChannels(pending.guildId);
    await this.retryMatchmaking(pending.guildId, pending.channelId);
  }

  private async abortReadyCheckForActiveMatches(
    pending: PendingReadyCheck,
    activePlayers: readonly QueuePlayer[],
  ): Promise<void> {
    clearTimeout(pending.timeout);
    this.pendingReadyChecks.delete(pending.id);
    await this.readyCheckRepository.setStatus(pending.id, "CANCELLED", activePlayers[0]?.userId);
    this.queueService.clearReadyCheck(pending.id);
    await this.queueRepository.clearReadyCheck(pending.id);

    const activeUserIds = activePlayers.map((player) => player.userId);
    this.queueService.removeUsersEverywhereInGuild(pending.guildId, activeUserIds);
    await this.queueRepository.removeUsersEverywhereInGuild(pending.guildId, activeUserIds);

    if (pending.messageId) {
      await this.editManagedMessage(pending.channelId, pending.messageId, {
        content: `Ready-check cancelado: ${this.formatPlayerList(activePlayers)} ja tem partida em andamento.`,
        embeds: [],
        components: [],
      });
    }

    await this.refreshQueueChannels(pending.guildId);
    await this.retryMatchmaking(pending.guildId, pending.channelId);
  }

  private async retryMatchmaking(guildId: string, channelId: string): Promise<void> {
    const candidate = await this.findReadyCheckCandidate(guildId, channelId);
    if (!candidate) {
      return;
    }

    const channel = await this.fetchTextChannel(channelId);
    await this.openReadyCheck(guildId, channelId, channel, candidate.players, candidate.match);
  }

  private async findReadyCheckCandidate(
    guildId: string,
    channelId: string,
  ): Promise<ReadyCheckCandidate | null> {
    const visibleQueue = this.queueService
      .getQueuedPlayers()
      .filter(
        (player) =>
          player.guildId === guildId &&
          player.channelId === channelId &&
          !player.readyCheckId,
      )
      .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime());

    if (visibleQueue.length < 10) {
      return null;
    }

    if (ROLES.some((role) => visibleQueue.filter((player) => player.role === role).length < 2)) {
      return null;
    }

    let bestCandidate: ReadyCheckCandidate | null = null;
    for (let poolSize = 10; poolSize <= visibleQueue.length; poolSize += 1) {
      const pool = visibleQueue.slice(0, poolSize);
      const ratedPool = await this.matchService.hydrateRatings(pool);
      const rolePairs = ROLES.map((role) =>
        this.twoPlayerCombinations(ratedPool.filter((player) => player.role === role)),
      );

      if (rolePairs.some((pairs) => pairs.length === 0)) {
        continue;
      }

      for (const selectedPlayers of this.rolePairProducts(rolePairs)) {
        if (new Set(selectedPlayers.map((player) => player.userId)).size !== 10) {
          continue;
        }

        if (!selectedPlayers.every(
          (player) =>
            !player.duoUserId ||
            selectedPlayers.some((candidate) => candidate.userId === player.duoUserId),
        )) {
          continue;
        }

        let match: BalancedMatch;
        try {
          match = this.matchmakingService.balance(selectedPlayers);
        } catch {
          continue;
        }

        if (
          !bestCandidate ||
          match.balanceScore < bestCandidate.match.balanceScore ||
          (match.balanceScore === bestCandidate.match.balanceScore &&
            match.muDifference < bestCandidate.match.muDifference)
        ) {
          bestCandidate = {
            players: selectedPlayers,
            match,
          };
        }
      }

      if (bestCandidate && bestCandidate.match.balanceScore < MATCHMAKING_QUALITY_THRESHOLD) {
        return bestCandidate;
      }
    }

    return bestCandidate;
  }

  private twoPlayerCombinations<T>(items: readonly T[]): [T, T][] {
    const combinations: [T, T][] = [];
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const left = items[leftIndex];
        const right = items[rightIndex];
        if (left === undefined || right === undefined) {
          continue;
        }

        combinations.push([left, right]);
      }
    }

    return combinations;
  }

  private rolePairProducts(
    pairSets: readonly [RatedQueuePlayer, RatedQueuePlayer][][],
  ): RatedQueuePlayer[][] {
    let products: RatedQueuePlayer[][] = [[]];
    for (const pairs of pairSets) {
      const nextProducts: RatedQueuePlayer[][] = [];
      for (const prefix of products) {
        for (const pair of pairs) {
          nextProducts.push([...prefix, ...pair]);
        }
      }
      products = nextProducts;
    }

    return products;
  }

  private async expireDuoInvite(inviteId: string): Promise<void> {
    const pending = this.pendingDuoInvites.get(inviteId);
    if (!pending) {
      return;
    }

    this.pendingDuoInvites.delete(inviteId);
    if (pending.messageId) {
      await this.editManagedMessage(pending.channelId, pending.messageId, {
        content: "Convite de duo expirou.",
        embeds: [],
        components: [],
      });
    }
  }

  private async getQueueBlockedReason(guildId: string, userId: string): Promise<string | null> {
    if (this.queueService.hasActiveReadyCheck(userId, guildId)) {
      return "Voce ja esta em um ready-check. Responda a partida antes de entrar em outra fila.";
    }

    if ([...this.pendingDuoInvites.values()].some(
      (invite) =>
        invite.guildId === guildId &&
        (invite.requester.userId === userId || invite.target.userId === userId),
    )) {
      return "Voce ja tem um convite de duo pendente.";
    }

    if (await this.matchService.hasOngoingMatchForUser(guildId, userId)) {
      return "Voce ja tem uma partida em andamento. Finalize ou cancele antes de entrar na fila.";
    }

    return null;
  }

  private async findPlayersWithOngoingMatches(
    guildId: string,
    players: readonly QueuePlayer[],
  ): Promise<QueuePlayer[]> {
    const ongoingUserIds = await this.matchService.findOngoingParticipantUserIds(
      guildId,
      players.map((player) => player.userId),
    );

    return players.filter((player) => ongoingUserIds.has(player.userId));
  }

  private formatPlayerList(players: readonly QueuePlayer[]): string {
    return players.map((player) => player.displayName).join(", ");
  }

  private consumePriorityJoinedAt(userId: string): Date {
    const priority = this.cancelledBoosts.get(userId);
    if (!priority) {
      return new Date();
    }

    this.cancelledBoosts.delete(userId);
    return priority;
  }

  private prioritizeCancelledPlayers(userIds: Iterable<string>): void {
    const priority = new Date(Date.now() - CANCELLED_REQUEUE_PRIORITY_MS);
    for (const userId of userIds) {
      this.cancelledBoosts.set(userId, priority);
    }
  }

  private async ensureQueueChannel(interaction: QueueInteraction): Promise<boolean> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
      return false;
    }

    const markedChannels = await this.guildService.getMarkedChannels(interaction.guildId, "QUEUE");
    if (markedChannels.length === 0) {
      return true;
    }

    if (markedChannels.some((channel) => channel.channelId === interaction.channelId)) {
      return true;
    }

    const channelList = markedChannels.map((channel) => `<#${channel.channelId}>`).join(", ");
    await interaction.reply({
      content: `Use um canal marcado como fila: ${channelList}.`,
      ephemeral: true,
    });
    return false;
  }

  private roleFromButton(customId: string): Role | null {
    const prefix = "inhouse:join:";
    if (!customId.startsWith(prefix)) {
      return null;
    }

    const role = customId.slice(prefix.length);
    return isRole(role) ? role : null;
  }

  private async presentationForGuild(guildId: string | null): Promise<DiscordPresentation> {
    if (!guildId) {
      return {};
    }

    const cached = this.presentationsByGuild.get(guildId);
    if (cached) {
      return cached;
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return {};
    }

    return this.refreshPresentation(guild);
  }

  private async refreshPresentation(guild: Guild): Promise<DiscordPresentation> {
    const emojis = await guild.emojis.fetch().catch(() => guild.emojis.cache);
    const roleEmojis: DiscordPresentation["roleEmojis"] = {};

    for (const role of ROLES) {
      const expectedName = ROLE_EMOJI_NAMES[role];
      const emoji = emojis.find((candidate) => candidate.name?.toUpperCase() === expectedName);
      if (emoji?.name) {
        roleEmojis[role] = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
      }
    }

    const presentation: DiscordPresentation = { roleEmojis };
    this.presentationsByGuild.set(guild.id, presentation);
    return presentation;
  }

  private async refreshGuildSurfaces(guildId: string): Promise<void> {
    await this.refreshQueueChannels(guildId);
    await this.refreshRankingChannels(guildId);
  }

  private async refreshQueueChannels(guildId: string): Promise<void> {
    const channels = await this.guildService.getMarkedChannels(guildId, "QUEUE");
    const presentation = await this.presentationForGuild(guildId);
    for (const marked of channels) {
      const channel = await this.fetchTextChannel(marked.channelId);
      if (!channel?.isSendable()) {
        continue;
      }

      await this.clearManagedMessages(channel, (title) => title.includes("Fila"));
      await channel.send({
        embeds: [buildQueueEmbed(this.queueService.snapshot(marked.channelId), presentation)],
        components: buildQueueButtons(presentation),
      });
    }
  }

  private async refreshRankingChannels(guildId: string): Promise<void> {
    const channels = await this.guildService.getMarkedChannels(guildId, "RANKING");
    if (channels.length === 0) {
      return;
    }

    const entries = await this.statsService.getRanking(guildId, undefined, 100);
    const presentation = await this.presentationForGuild(guildId);
    for (const marked of channels) {
      const channel = await this.fetchTextChannel(marked.channelId);
      if (!channel?.isSendable()) {
        continue;
      }

      await this.clearManagedMessages(channel, (title) => title.includes("Ranking"));
      if (entries.length === 0) {
        await channel.send("Ranking ainda vazio.");
        continue;
      }

      const sessionId = randomUUID();
      const session: RankingSession = {
        entries,
        page: 0,
        createdAt: Date.now(),
      };
      this.rankingSessions.set(sessionId, session);
      const totalPages = Math.max(1, Math.ceil(entries.length / RANKING_PAGE_SIZE));
      await channel.send({
        embeds: [buildRankingEmbed(entries, undefined, 0, presentation)],
        components: buildRankingButtons(sessionId, 0, totalPages),
      });
    }
  }

  private async clearManagedMessages(
    channel: TextBasedChannel,
    shouldDeleteTitle: (title: string) => boolean,
  ): Promise<void> {
    if (!("messages" in channel) || !this.client.user) {
      return;
    }

    const messages = await channel.messages.fetch({ limit: MANAGED_CHANNEL_FETCH_LIMIT });
    const deletions = messages
      .filter((message) => {
        if (message.author.id !== this.client.user?.id) {
          return false;
        }

        const title = message.embeds[0]?.title ?? "";
        return shouldDeleteTitle(title);
      })
      .map((message) => message.delete().catch(() => undefined));

    await Promise.all(deletions);
  }

  private async editManagedMessage(
    channelId: string,
    messageId: string,
    payload: MessageEditOptions,
  ): Promise<void> {
    const channel = await this.fetchTextChannel(channelId);
    if (!channel || !("messages" in channel)) {
      return;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => undefined);
    }
  }

  private async fetchTextChannel(channelId: string): Promise<TextBasedChannel | null> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return null;
    }

    return channel;
  }

  private async createVoiceChannels(guild: Guild | null, matchId: string, match: BalancedMatch): Promise<void> {
    if (!guild) {
      return;
    }

    const voiceEnabled = await this.guildService.getConfig(guild.id, "voice");
    if (!voiceEnabled) {
      return;
    }

    const token = this.matchChannelToken(matchId);
    const category = await guild.channels.create({
      name: `Inhouse ${token}`,
      type: DiscordChannelType.GuildCategory,
      reason: "Inhouse match created",
    });

    await Promise.all([
      guild.channels.create({
        name: `Blue ${token}`,
        type: DiscordChannelType.GuildVoice,
        parent: category.id,
        reason: "Inhouse match created",
      }),
      guild.channels.create({
        name: `Red ${token}`,
        type: DiscordChannelType.GuildVoice,
        parent: category.id,
        reason: "Inhouse match created",
      }),
    ]);

    void match;
  }

  private async deleteVoiceChannels(guild: Guild | null, matchId: string): Promise<void> {
    if (!guild) {
      return;
    }

    const token = this.matchChannelToken(matchId);
    const channels = await guild.channels.fetch().catch(() => null);
    const allChannels = channels ?? guild.channels.cache;
    const deletions = [...allChannels.values()]
      .filter((channel) => channel?.name.includes(token))
      .map((channel) => channel?.delete("Inhouse match closed").catch(() => undefined));

    await Promise.all(deletions);
  }

  private matchChannelToken(matchId: string): string {
    return matchId.slice(0, 8);
  }

  private mentionDiscordUsers(ids: readonly string[]): string {
    const mentions = ids
      .filter((id) => /^\d{17,20}$/.test(id))
      .map((id) => `||<@${id}>||`); // Use spoiler tags to hide the ping visually
    return mentions.join(" ");
  }

  private async runScheduledJobs(): Promise<void> {
    const now = new Date();
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    const currentTime = `${hour}:${minute}`;
    const runKey = `${now.toISOString().slice(0, 10)}:${currentTime}`;

    if (currentTime !== env.QUEUE_RESET_TIME || this.lastQueueResetRun === runKey) {
      return;
    }

    this.lastQueueResetRun = runKey;
    const settings = await this.guildService.getAllSettings();
    const resetGuildIds = settings
      .filter((setting) => setting.queueResetEnabled)
      .map((setting) => setting.guildId);
    if (resetGuildIds.length === 0) {
      return;
    }

    for (const guildId of resetGuildIds) {
      for (const queueId of this.queueService.getQueueIdsForGuild(guildId)) {
        this.queueService.reset(queueId);
        await this.queueRepository.resetChannel(queueId);
      }
      await this.refreshQueueChannels(guildId);
    }
  }

  private renderValidationEmbed(validationId: string) {
    const pending = this.pendingValidations.get(validationId);
    if (!pending) {
      return buildValidationEmbed({
        matchId: "expirada",
        action: "EXPIRED",
        accepted: 0,
        required: 6,
      });
    }

    return buildValidationEmbed({
      matchId: pending.matchId,
      action: pending.action,
      winningTeam: pending.winningTeam,
      accepted: pending.acceptedUserIds.size,
      required: 6,
      requesterDisplayName: pending.requesterDisplayName,
      requesterAvatarUrl: pending.requesterAvatarUrl,
    });
  }
}
