import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { BalancedMatch, QueuePlayer, QueueRole, Role, Team } from "../../core/models/types.js";
import { ROLES } from "../../core/models/types.js";
import {
  TIERS,
  TIER_EMOJI_NAMES,
  TIER_LABEL,
  formatTier,
  tierIcon,
  type Division,
  type Tier,
} from "../../core/tier/tier.js";
import type { QueueSnapshot } from "../../core/queue/QueueService.js";
import type {
  HistoryEntry,
  PdlHistoryEntry,
  PlayerProfile,
  PlayerSummary,
  RankingEntry,
  RoleDemand,
  RoleReportResult,
  ServerHighlights,
  SynergyNemesisResult,
} from "../../services/statsService.js";
import type { MatchSummary } from "../../services/matchService.js";

export const RANKING_PAGE_SIZE = 15;

export interface DiscordPresentation {
  roleEmojis?: Partial<Record<QueueRole, string>>;
  tierEmojis?: Partial<Record<Tier, string>>;
}

export const roleButtonId = (role: QueueRole): string => `inhouse:join:${role}`;
export const leaveButtonId = "inhouse:leave";
export const validationAcceptButtonId = (validationId: string): string =>
  `inhouse:validation:accept:${validationId}`;
export const validationRejectButtonId = (validationId: string): string =>
  `inhouse:validation:reject:${validationId}`;
export const readyAcceptButtonId = (readyCheckId: string): string =>
  `inhouse:ready:accept:${readyCheckId}`;
export const readyRejectButtonId = (readyCheckId: string): string =>
  `inhouse:ready:reject:${readyCheckId}`;
export const duoAcceptButtonId = (duoId: string): string =>
  `inhouse:duo:accept:${duoId}`;
export const duoRejectButtonId = (duoId: string): string =>
  `inhouse:duo:reject:${duoId}`;
export const rankingPrevButtonId = (sessionId: string): string =>
  `inhouse:ranking:prev:${sessionId}`;
export const rankingNextButtonId = (sessionId: string): string =>
  `inhouse:ranking:next:${sessionId}`;

export type RankingButtonDirection = "prev" | "next";

export const parseRankingButtonId = (
  customId: string,
): { direction: RankingButtonDirection; sessionId: string } | null => {
  const prefix = "inhouse:ranking:";
  if (!customId.startsWith(prefix)) {
    return null;
  }

  const [direction, sessionId] = customId.slice(prefix.length).split(":");
  if ((direction !== "prev" && direction !== "next") || !sessionId) {
    return null;
  }

  return { direction, sessionId };
};

export const parseReadyButtonId = (
  customId: string,
): { action: "accept" | "reject"; readyCheckId: string } | null => {
  const prefix = "inhouse:ready:";
  if (!customId.startsWith(prefix)) {
    return null;
  }

  const [action, readyCheckId] = customId.slice(prefix.length).split(":");
  if ((action !== "accept" && action !== "reject") || !readyCheckId) {
    return null;
  }

  return { action, readyCheckId };
};

export const parseDuoButtonId = (
  customId: string,
): { action: "accept" | "reject"; duoId: string } | null => {
  const prefix = "inhouse:duo:";
  if (!customId.startsWith(prefix)) {
    return null;
  }

  const [action, duoId] = customId.slice(prefix.length).split(":");
  if ((action !== "accept" && action !== "reject") || !duoId) {
    return null;
  }

  return { action, duoId };
};

const COLORS = {
  blue: 0x5865f2,
  green: 0x2fb875,
  gold: 0xd4a72c,
  slate: 0x2b2d31,
  softRed: 0xb85c5c,
};

const roleName: Record<Role, string> = {
  TOP: "Top",
  JGL: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUP: "Support",
};

export const ROLE_EMOJI_NAMES: Record<QueueRole, string> = {
  TOP: "TOP",
  JGL: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUP: "SUP",
  FILL: "FILL",
};

const queueRoleName: Record<QueueRole, string> = {
  TOP: "Top",
  JGL: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUP: "Support",
  FILL: "Fill",
};

const roleTag: Record<Role, string> = {
  TOP: "TOP",
  JGL: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUP: "SUP",
};

const roleIcon = (role: Role, presentation?: DiscordPresentation): string =>
  presentation?.roleEmojis?.[role] ?? `\`${roleTag[role]}\``;

const roleTitle = (role: Role, presentation?: DiscordPresentation): string =>
  `${roleIcon(role, presentation)} ${roleName[role]}`;

const EMPTY_SLOT_LABEL = "--";

const playerLabel = (name?: string): string => (name && name.length > 0 ? name : EMPTY_SLOT_LABEL);

const progressBar = (value: number, total: number): string => {
  const size = 10;
  const filled = Math.max(0, Math.min(size, Math.round((value / total) * size)));
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)}`;
};

const tierColors: Record<Tier, number> = {
  BRONZE: 0xcd7f32,
  PRATA: 0x95a5a6,
  OURO: 0xd4a72c,
  PLATINA: 0x1abc9c,
  ESMERALDA: 0x2fb875,
  DIAMANTE: 0x3498db,
  MESTRE: 0x9b59b6,
  GRAOMESTRE: 0xe74c3c,
  CHALLENGER: 0xf1c40f,
};

const tierColor = (tier: Tier): number => tierColors[tier] ?? COLORS.gold;

const rankTag = (
  value: { tier: Tier | null; division: Division | null; pdl: number | null },
  presentation?: DiscordPresentation,
): string => {
  if (!value.tier || value.division === null || value.pdl === null) return "";
  return `${tierIcon(value.tier, presentation?.tierEmojis)} ${formatTier(value.tier, value.division)} \`${value.pdl} PDL\``;
};

const pdlProgressBar = (pdl: number, tier: Tier, division: Division): string => {
  if (division === 0) {
    const apexBase = tier === "CHALLENGER" ? 1400 : tier === "GRAOMESTRE" ? 1100 : 800;
    return progressBar(Math.max(0, pdl - apexBase), 300);
  }

  const tierBase: Record<Exclude<Tier, "MESTRE" | "GRAOMESTRE" | "CHALLENGER">, number> = {
    BRONZE: 0,
    PRATA: 100,
    OURO: 200,
    PLATINA: 300,
    ESMERALDA: 400,
    DIAMANTE: 500,
  };
  const divisionSize = tier === "DIAMANTE" ? 75 : 25;
  const base = tierBase[tier as keyof typeof tierBase] ?? 0;
  const divisionStart = base + (4 - division) * divisionSize;
  return progressBar(pdl - divisionStart, divisionSize);
};

const resultLabel: Record<HistoryEntry["result"], string> = {
  WIN: "Win",
  LOSS: "Loss",
  ONGOING: "Ongoing",
  CANCELLED: "Cancelled",
  UNKNOWN: "Unknown",
};

const truncate = (value: string, size: number): string =>
  value.length <= size ? value : `${value.slice(0, Math.max(0, size - 1))}.`;

const tableLine = (values: readonly string[], widths: readonly number[]): string =>
  values
    .map((value, index) => truncate(value, widths[index] ?? value.length).padEnd(widths[index] ?? value.length))
    .join(" ");

export const formatMatchCode = (matchNumber?: number | null): string | null =>
  typeof matchNumber === "number" && Number.isFinite(matchNumber)
    ? String(matchNumber).padStart(4, "0")
    : null;

export const formatMatchLabel = (matchNumber?: number | null, matchId?: string): string => {
  const code = formatMatchCode(matchNumber);
  if (code) {
    return `#${code}`;
  }

  return matchId ? `#${matchId.slice(0, 8)}` : "#----";
};

export const setupCommand = new SlashCommandBuilder()
  .setName("setup-inhouse")
  .setDescription("Define este canal como a fila oficial de inhouse.");

export const setupRankingCommand = new SlashCommandBuilder()
  .setName("setup-ranking")
  .setDescription("Define este canal como o ranking oficial de inhouse.");

export const queueCommand = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Entra na fila por slash command, com suporte a duo.")
  .addStringOption((option) =>
    option
      .setName("rota")
      .setDescription("Sua rota.")
      .setRequired(true)
      .addChoices(
        ...ROLES.map((role) => ({ name: role, value: role })),
        { name: "FILL", value: "FILL" },
      ),
  )
  .addUserOption((option) =>
    option.setName("duo").setDescription("Jogador que vai entrar junto com voce."),
  )
  .addStringOption((option) =>
    option
      .setName("rota_duo")
      .setDescription("Rota do duo.")
      .addChoices(
        ...ROLES.map((role) => ({ name: role, value: role })),
        { name: "FILL", value: "FILL" },
      ),
  );

export const queueStatusCommand = new SlashCommandBuilder()
  .setName("queue-status")
  .setDescription("Mostra o estado atual da fila deste canal.");

export const leaveQueueCommand = new SlashCommandBuilder()
  .setName("leave-queue")
  .setDescription("Sai da fila de inhouse deste canal.");

export const adminWinCommand = new SlashCommandBuilder()
  .setName("admin-win")
  .setDescription("Registra o vencedor de uma partida e recalcula o rating.")
  .addStringOption((option) =>
    option
      .setName("match_id")
      .setDescription("Numero da partida (#0001) ou UUID.")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("team")
      .setDescription("Time vencedor.")
      .setRequired(true)
      .addChoices({ name: "Blue", value: "BLUE" }, { name: "Red", value: "RED" }),
  );

export const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Mostra elo, PDL e W/L por rota.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra seus stats."),
  );

export const rankCommand = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("Mostra seu elo, PDL e W/L por rota.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra seus stats."),
  );

export const rankingCommand = new SlashCommandBuilder()
  .setName("ranking")
  .setDescription("Mostra o ranking de PDL do servidor.")
  .addStringOption((option) =>
    option
      .setName("rota")
      .setDescription("Filtra por rota.")
      .addChoices(...ROLES.map((role) => ({ name: role, value: role }))),
  );

export const synergyCommand = new SlashCommandBuilder()
  .setName("synergy")
  .setDescription("Encontra o parceiro com quem voce tem a melhor taxa de vitoria.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Ver a sinergia de outro jogador."),
  );

export const nemesisCommand = new SlashCommandBuilder()
  .setName("nemesis")
  .setDescription("Encontra o jogador que mais te derrotou.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Ver o nemesis de outro jogador."),
  );

export const topCommand = new SlashCommandBuilder()
  .setName("top")
  .setDescription("Mostra os destaques e recordes do servidor.");

export const roleReportCommand = new SlashCommandBuilder()
  .setName("role-report")
  .setDescription("Mostra a distribuicao de roles que voce joga.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra voce."),
  );

export const demandCommand = new SlashCommandBuilder()
  .setName("demanda")
  .setDescription("Mostra a distribuicao de roles do servidor e quais precisam de mais jogadores.");

export const profileCommand = new SlashCommandBuilder()
  .setName("perfil")
  .setDescription("Mostra o perfil completo de um jogador.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra voce."),
  );

export const historyCommand = new SlashCommandBuilder()
  .setName("history")
  .setDescription("Mostra o historico de partidas.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra seu historico."),
  )
  .addIntegerOption((option) =>
    option
      .setName("limite")
      .setDescription("Quantidade de jogos.")
      .setMinValue(1)
      .setMaxValue(20),
  );

export const lastMatchCommand = new SlashCommandBuilder()
  .setName("ultima-partida")
  .setDescription("Mostra a ultima partida do servidor ou de um jogador.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra a ultima partida do servidor."),
  );

export const pdlHistoryCommand = new SlashCommandBuilder()
  .setName("pdl-history")
  .setDescription("Mostra a evolucao de PDL do jogador.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra voce."),
  )
  .addIntegerOption((option) =>
    option
      .setName("limite")
      .setDescription("Quantidade de pontos.")
      .setMinValue(5)
      .setMaxValue(40),
  );

export const championCommand = new SlashCommandBuilder()
  .setName("champion")
  .setDescription("Salva o campeao usado em uma partida.")
  .addStringOption((option) =>
    option.setName("nome").setDescription("Nome do campeao.").setRequired(true),
  )
  .addStringOption((option) =>
    option.setName("match_id").setDescription("Numero da partida (#0001) ou UUID. Vazio usa sua ultima partida."),
  );

export const wonCommand = new SlashCommandBuilder()
  .setName("won")
  .setDescription("Pede validacao para marcar sua ultima partida em andamento como vitoria.");

export const cancelCommand = new SlashCommandBuilder()
  .setName("cancel")
  .setDescription("Pede validacao para cancelar sua partida em andamento.");

export const remakeCommand = new SlashCommandBuilder()
  .setName("remake")
  .setDescription("Pede validacao para cancelar sua partida em andamento (alias de /cancel).");

export const compareCommand = new SlashCommandBuilder()
  .setName("compare")
  .setDescription("Compara suas estatísticas e histórico direto com outro jogador.")
  .addUserOption((option) =>
    option.setName("jogador1").setDescription("Primeiro jogador a comparar.").setRequired(true),
  )
  .addUserOption((option) =>
    option.setName("jogador2").setDescription("Segundo jogador (opcional). Se vazio, compara com você."),
  );

export const linkAccountCommand = new SlashCommandBuilder()
  .setName("link-account")
  .setDescription("Vincula sua conta do League of Legends (Nick#Tag) ao Discord.")
  .addStringOption((option) =>
    option
      .setName("nick")
      .setDescription("Seu nick do LoL (ex: Faker).")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("tag")
      .setDescription("Sua tag do LoL sem o # (ex: BR1).")
      .setRequired(true),
  );

export const adminChannelCommand = new SlashCommandBuilder()
  .setName("admin-channel")
  .setDescription("Marca ou desmarca o canal atual para funcoes do bot.")
  .addStringOption((option) =>
    option
      .setName("acao")
      .setDescription("O que fazer com este canal.")
      .setRequired(true)
      .addChoices(
        { name: "Marcar como fila", value: "MARK_QUEUE" },
        { name: "Marcar como ranking", value: "MARK_RANKING" },
        { name: "Marcar como top/destaques", value: "MARK_TOP" },
        { name: "Desmarcar", value: "UNMARK" },
      ),
  );

export const adminConfigCommand = new SlashCommandBuilder()
  .setName("admin-config")
  .setDescription("Configura recursos opcionais do servidor.")
  .addStringOption((option) =>
    option
      .setName("chave")
      .setDescription("Configuracao.")
      .setRequired(true)
      .addChoices(
        { name: "voice", value: "voice" },
        { name: "queue_reset", value: "queue_reset" },
      ),
  )
  .addStringOption((option) =>
    option
      .setName("opcao")
      .setDescription("Valor.")
      .setRequired(true)
      .addChoices(
        { name: "on", value: "ON" },
        { name: "off", value: "OFF" },
        { name: "status", value: "STATUS" },
      ),
  );

export const adminResetCommand = new SlashCommandBuilder()
  .setName("admin-reset")
  .setDescription("Reseta fila do canal ou remove um jogador de todas as filas em memoria.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador a remover de todas as filas."),
  )
  .addChannelOption((option) =>
    option.setName("canal").setDescription("Canal de fila a resetar. Vazio usa o canal atual."),
  );

export const adminCancelCommand = new SlashCommandBuilder()
  .setName("admin-cancel")
  .setDescription("Cancela uma partida ainda nao finalizada.")
  .addStringOption((option) =>
    option.setName("match_id").setDescription("Numero da partida (#0001) ou UUID.").setRequired(true),
  );

export const adminWinUserCommand = new SlashCommandBuilder()
  .setName("admin-win-user")
  .setDescription("Registra vitoria na ultima partida em andamento de um jogador.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador da partida vencedora.").setRequired(true),
  );

export const adminCancelUserCommand = new SlashCommandBuilder()
  .setName("admin-cancel-user")
  .setDescription("Cancela a ultima partida em andamento de um jogador.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador com partida em andamento.").setRequired(true),
  );

export const adminShowMmrCommand = new SlashCommandBuilder()
  .setName("admin-show-mmr")
  .setDescription("Admin: mostra MMR/mu/sigma internos de um jogador (debug).")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo.").setRequired(true),
  );

export const devCreateMatchCommand = new SlashCommandBuilder()
  .setName("dev-create-match")
  .setDescription("Cria uma partida fake com voce + 9 jogadores teste.")
  .addStringOption((option) =>
    option
      .setName("rota")
      .setDescription("Rota do seu jogador nesta partida fake.")
      .setRequired(true)
      .addChoices(...ROLES.map((role) => ({ name: role, value: role }))),
  );

export const memorialSeason1Command = new SlashCommandBuilder()
  .setName("memorial-season-1")
  .setDescription("Encerra a Season 1 com podio, highlights, volta por cima e ranking completo.");

export const memorialPrevButtonId = (sessionId: string) => `inhouse:memorial-s1:prev:${sessionId}`;
export const memorialNextButtonId = (sessionId: string) => `inhouse:memorial-s1:next:${sessionId}`;
export const parseMemorialButtonId = (
  customId: string,
): { sessionId: string; direction: "prev" | "next" } | null => {
  const prevPrefix = "inhouse:memorial-s1:prev:";
  const nextPrefix = "inhouse:memorial-s1:next:";
  if (customId.startsWith(prevPrefix)) return { sessionId: customId.slice(prevPrefix.length), direction: "prev" };
  if (customId.startsWith(nextPrefix)) return { sessionId: customId.slice(nextPrefix.length), direction: "next" };
  return null;
};

export const discordCommands = [
  setupCommand,
  setupRankingCommand,
  queueCommand,
  queueStatusCommand,
  leaveQueueCommand,
  adminWinCommand,
  statsCommand,
  rankCommand,
  rankingCommand,
  historyCommand,
  lastMatchCommand,
  pdlHistoryCommand,
  championCommand,
  synergyCommand,
  nemesisCommand,
  topCommand,
  roleReportCommand,
  profileCommand,
  demandCommand,
  wonCommand,
  cancelCommand,
  remakeCommand,
  compareCommand,
  linkAccountCommand,
  adminChannelCommand,
  adminConfigCommand,
  adminResetCommand,
  adminCancelCommand,
  adminWinUserCommand,
  adminCancelUserCommand,
  adminShowMmrCommand,
  devCreateMatchCommand,
  memorialSeason1Command,
].map((command) => command.toJSON());

export const buildQueueButtons = (
  presentation?: DiscordPresentation,
): ActionRowBuilder<ButtonBuilder>[] => {
  const routeButtons = ROLES.map((role) => {
    const button = new ButtonBuilder()
      .setCustomId(roleButtonId(role))
      .setLabel(roleName[role])
      .setStyle(ButtonStyle.Secondary);
    const emoji = presentation?.roleEmojis?.[role];
    if (emoji) {
      button.setEmoji(emoji);
    }

    return button;
  });

  const fillButton = new ButtonBuilder()
    .setCustomId(roleButtonId("FILL"))
    .setLabel("Fill")
    .setStyle(ButtonStyle.Primary);
  const fillEmoji = presentation?.roleEmojis?.FILL;
  if (fillEmoji) {
    fillButton.setEmoji(fillEmoji);
  }

  const leaveButton = new ButtonBuilder()
    .setCustomId(leaveButtonId)
    .setLabel("Sair da fila")
    .setStyle(ButtonStyle.Danger);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(routeButtons),
    new ActionRowBuilder<ButtonBuilder>().addComponents(fillButton, leaveButton),
  ];
};

export const buildValidationButtons = (validationId: string): ActionRowBuilder<ButtonBuilder>[] => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(validationAcceptButtonId(validationId))
      .setLabel("Validar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(validationRejectButtonId(validationId))
      .setLabel("Recusar")
      .setStyle(ButtonStyle.Secondary),
  ),
];

export const buildReadyCheckButtons = (readyCheckId: string): ActionRowBuilder<ButtonBuilder>[] => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(readyAcceptButtonId(readyCheckId))
      .setLabel("Confirmar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(readyRejectButtonId(readyCheckId))
      .setLabel("Recusar")
      .setStyle(ButtonStyle.Secondary),
  ),
];

export const buildDuoButtons = (duoId: string): ActionRowBuilder<ButtonBuilder>[] => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(duoAcceptButtonId(duoId))
      .setLabel("Aceitar duo")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(duoRejectButtonId(duoId))
      .setLabel("Recusar")
      .setStyle(ButtonStyle.Secondary),
  ),
];

export const buildRankingButtons = (
  sessionId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder>[] => {
  if (totalPages <= 1) {
    return [];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(rankingPrevButtonId(sessionId))
        .setLabel("Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(rankingNextButtonId(sessionId))
        .setLabel("Proxima")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    ),
  ];
};

export const renderTeamName = (team: Team): string => (team === "BLUE" ? "Blue" : "Red");

export const buildSetupEmbed = (): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle("⚔️ Fila de Inhouse")
    .setDescription("Seja bem-vindo ao sistema de Inhouse! Clique nos botões abaixo de acordo com sua **Rota Principal** para entrar no lobby de matchmaking.\n\nPara jogar em dupla, utilize o comando `/queue` informando o seu @duo e as rotas.");

export const buildQueueEmbed = (
  snapshot: QueueSnapshot,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  // Find all duos and assign them a unique emoji pair
  const duoEmojis = ["🔵", "🟡", "🟢", "🟣", "🟤"];
  const duoMap = new Map<string, string>(); // userId -> emoji
  let duoIndex = 0;

  const allPlayers = [...ROLES.flatMap((role) => snapshot.roles[role]), ...snapshot.fillPlayers];

  for (const player of allPlayers) {
    if (player.duoUserId && !duoMap.has(player.userId)) {
      // Check if their duo partner is also in the queue
      const partner = allPlayers.find((p) => p.userId === player.duoUserId);
      if (partner) {
        const emoji = duoEmojis[duoIndex % duoEmojis.length] || "🔗";
        duoMap.set(player.userId, emoji);
        duoMap.set(partner.userId, emoji);
        duoIndex++;
      }
    }
  }

  const formatPlayerName = (player?: QueuePlayer): string => {
    if (!player) return playerLabel(undefined);
    const duoIndicator = duoMap.get(player.userId);
    const name = playerLabel(player.displayName);
    return duoIndicator ? `${name} ${duoIndicator}` : name;
  };

  const slotColumn = (slotIndex: number): string =>
    ROLES.map((role) => {
      const player = snapshot.roles[role][slotIndex];
      return `${roleIcon(role, presentation)} ${formatPlayerName(player)}`;
    }).join("\n");

  const waitingPlayers = ROLES.flatMap((role) =>
    snapshot.roles[role]
      .slice(2)
      .map((player) => `${roleIcon(role, presentation)} ${formatPlayerName(player)}`),
  );

  const status = snapshot.isReady ? "✅ Pronta para ready-check" : "⏳ Aguardando jogadores...";
  const embed = new EmbedBuilder()
    .setColor(snapshot.isReady ? COLORS.green : COLORS.slate)
    .setTitle("Fila de Inhouse")
    .setThumbnail(
      snapshot.isReady
        ? "https://media.tenor.com/bm8Q6yAlsHcAAAAj/verified.gif"
        : "https://media.tenor.com/On7kvXhzmV4AAAAj/loading-gif.gif"
    )
    .setDescription(
      [
        `**${status}**`,
        `${progressBar(snapshot.totalPlayers, snapshot.capacity)} **${snapshot.totalPlayers}/${snapshot.capacity}**`,
      ].join("\n"),
    )
    .addFields(
      { name: "Slot 1", value: slotColumn(0), inline: true },
      { name: "Slot 2", value: slotColumn(1), inline: true },
    )
    .setFooter({ text: "Clique em uma rota para entrar. Use Sair da fila para remover seu nome." });

  if (waitingPlayers.length > 0) {
    embed.addFields({
      name: "Aguardando vaga",
      value: waitingPlayers.join("\n"),
      inline: false,
    });
  }

  if (snapshot.fillPlayers.length > 0) {
    const fillIcon = presentation?.roleEmojis?.FILL ?? "🔄";
    const fillLines = snapshot.fillPlayers.map((player) => `${fillIcon} ${formatPlayerName(player)}`);
    embed.addFields({
      name: `🔄 Fill (${snapshot.fillPlayers.length})`,
      value: fillLines.join("\n"),
      inline: false,
    });
  }

  return embed;
};

export const buildMatchEmbed = (
  matchId: string,
  matchNumber: number | null | undefined,
  match: BalancedMatch,
  presentation?: DiscordPresentation,
  tournamentCode?: string,
): EmbedBuilder => {
  const slots = [...match.teamBlue, ...match.teamRed];
  const matchLabel = formatMatchLabel(matchNumber, matchId);

  const renderTeam = (team: Team): string =>
    ROLES.map((role) => {
      const slot = slots.find((s) => s.team === team && s.role === role);
      return `${roleIcon(role, presentation)} ${slot ? `**${slot.player.displayName}**` : EMPTY_SLOT_LABEL}`;
    }).join("\n");

  let description = [
    `Partida ${matchLabel} confirmada.`,
    "Lobby pronto. Usem os times abaixo e registrem o resultado ao final.",
  ].join("\n");
  if (tournamentCode) {
    description += `\n\n**Codigo de torneio**\n\`\`\`\n${tournamentCode}\n\`\`\``;
  } else {
    description += `\n\n**ID da partida:** \`${matchLabel}\``;
  }

  return new EmbedBuilder()
    .setColor(COLORS.green)
    .setTitle(`Partida ${matchLabel}`)
    .setDescription(description)
    .addFields(
      {
        name: "Blue Side",
        value: renderTeam("BLUE"),
        inline: true,
      },
      {
        name: "Red Side",
        value: renderTeam("RED"),
        inline: true,
      },
      {
        name: "Balanceamento",
        value: `Equilibrio estimado: **${(match.blueExpectedWinrate * 100).toFixed(1)}%** chance Blue`,
        inline: false,
      }
    )
    .setFooter({
      text: `UUID interno: ${matchId}`,
    });
};

export const buildReadyCheckEmbed = (
  readyCheckId: string,
  match: BalancedMatch,
  acceptedUserIds: ReadonlySet<string>,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const slots = [...match.teamBlue, ...match.teamRed];
  const acceptedCount = acceptedUserIds.size;
  const renderTeam = (team: Team): string =>
    ROLES.map((role) => {
      const slot = slots.find((candidate) => candidate.team === team && candidate.role === role);
      const accepted = slot && acceptedUserIds.has(slot.player.userId);
      const status = accepted ? "`OK`" : "`--`";
      return `${status} ${roleIcon(role, presentation)} ${slot ? `**${slot.player.displayName}**` : EMPTY_SLOT_LABEL}`;
    }).join("\n");
  const pendingPlayers = slots
    .filter((slot) => !acceptedUserIds.has(slot.player.userId))
    .map((slot) => `${roleIcon(slot.role, presentation)} ${slot.player.displayName}`)
    .join("\n");

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("Ready-check")
    .setDescription(
      [
        "Partida encontrada. Confirme para travar o lobby.",
        `${progressBar(acceptedCount, 10)} **${acceptedCount}/10**`,
      ].join("\n"),
    )
    .addFields(
      {
        name: "Confirmados",
        value: `${acceptedCount}/10`,
        inline: true,
      },
      {
        name: "Balanceamento",
        value: `Blue ${(match.blueExpectedWinrate * 100).toFixed(1)}% | Delta ${match.muDifference.toFixed(2)}`,
        inline: true,
      },
      {
        name: "Pendentes",
        value: pendingPlayers || "Todos confirmaram.",
        inline: false,
      },
      {
        name: "Blue Side",
        value: renderTeam("BLUE"),
        inline: true,
      },
      {
        name: "Red Side",
        value: renderTeam("RED"),
        inline: true,
      },
    )
    .setFooter({ text: `Ready-check ${readyCheckId.slice(0, 8)} | Fecha em 2 minutos` });
};

const queueRoleIcon = (role: QueueRole, presentation?: DiscordPresentation): string => {
  if (role === "FILL") return presentation?.roleEmojis?.FILL ?? "🔄";
  return roleIcon(role, presentation);
};

const queueRoleTitle = (role: QueueRole, presentation?: DiscordPresentation): string =>
  `${queueRoleIcon(role, presentation)} ${queueRoleName[role]}`;

export const buildDuoInviteEmbed = (params: {
  requesterName: string;
  requesterRole: QueueRole;
  targetName: string;
  targetRole: QueueRole;
  presentation?: DiscordPresentation;
}): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("🤝 Convite de Duo")
    .setDescription(`**${params.requesterName}** convidou **${params.targetName}** para entrarem na fila juntos.\nConfirme sua rota abaixo.`)
    .addFields(
      {
        name: `Líder: ${queueRoleTitle(params.requesterRole, params.presentation)}`,
        value: `**${params.requesterName}**`,
        inline: true,
      },
      {
        name: `Convidado: ${queueRoleTitle(params.targetRole, params.presentation)}`,
        value: `**${params.targetName}**`,
        inline: true,
      },
    );

export const buildRankingEmbed = (
  entries: readonly RankingEntry[],
  role: Role | undefined,
  page: number,
  presentation?: DiscordPresentation,
  pageSize = RANKING_PAGE_SIZE,
): EmbedBuilder => {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const normalizedPage = Math.max(0, Math.min(page, totalPages - 1));
  const pageEntries = entries.slice(normalizedPage * pageSize, (normalizedPage + 1) * pageSize);

  const rows = pageEntries.map((entry, index) => {
    const globalRank = normalizedPage * pageSize + index + 1;
    const rankNum = entry.rank ?? globalRank;
    
    let medal = `\`#${String(rankNum).padStart(2, "0")}\` `;
    if (rankNum === 1) medal = "🥇 ";
    if (rankNum === 2) medal = "🥈 ";
    if (rankNum === 3) medal = "🥉 ";

    const winrate = entry.wins + entry.losses > 0 ? Math.round((entry.wins / (entry.wins + entry.losses)) * 100) : 0;
    const rolePrefix = entry.role ? `${roleIcon(entry.role, presentation)} ` : "";
    const tIcon = tierIcon(entry.tier, presentation?.tierEmojis);
    const tStr = formatTier(entry.tier, entry.division);

    return `${medal}${rolePrefix}**${entry.displayName}** • ${tIcon} ${tStr} \`${entry.pdl} PDL\` \`[${entry.wins}W ${entry.losses}L | ${winrate}%]\``;
  }).join("\n");

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(role ? `Ranking - ${roleName[role]}` : "Ranking geral")
    .setDescription(rows || "*Nenhum jogador encontrado.*")
    .setFooter({ text: `Página ${normalizedPage + 1}/${totalPages}` });
};

export const buildStatsEmbed = (
  displayName: string,
  summary: PlayerSummary,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const { global: g, roles } = summary;
  const tIcon = tierIcon(g.tier, presentation?.tierEmojis);
  const tStr = formatTier(g.tier, g.division);
  const embed = new EmbedBuilder()
    .setColor(tierColor(g.tier))
    .setTitle(`${tIcon} ${displayName} - ${tStr}`);

  const rankText = g.rank ? `🏆 Rank **#${g.rank}**` : "Sem ranking";
  const globalWinrate = g.totalGames > 0 ? Math.round((g.totalWins / g.totalGames) * 100) : 0;

  const mainRole = roles.reduce<(typeof roles)[number] | null>(
    (best, r) => (r.games > (best?.games ?? 0) ? r : best),
    null,
  );

  const roleBlocks = roles.map((row) => {
    const winrate = row.games > 0 ? Math.round((row.wins / row.games) * 100) : 0;
    return `${roleIcon(row.role, presentation)} **${roleName[row.role]}** — ${row.wins}V ${row.losses}D (${winrate}%)`;
  });

  embed.setDescription(
    [
      `**Elo:** ${tIcon} **${tStr}** — ${g.pdl} PDL | ${rankText}`,
      `**Partidas Totais:** ${g.totalGames} | **Taxa de Vitória:** ${globalWinrate}%`,
      `**Rota Principal:** ${mainRole ? `${roleIcon(mainRole.role, presentation)} ${roleName[mainRole.role]}` : "N/A"}`,
      "",
      "**Desempenho por Rota**",
      ...(roleBlocks.length > 0 ? roleBlocks : ["*Nenhuma partida registrada.*"]),
    ].join("\n"),
  );

  return embed;
};

export const buildHistoryEmbed = (
  displayName: string,
  history: readonly HistoryEntry[],
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const rows = history.map((entry) => {
    let circle = "⚪";
    let resultText = "Desconhecido";
    
    if (entry.result === "WIN") { circle = "🟢"; resultText = "Vitória"; }
    else if (entry.result === "LOSS") { circle = "🔴"; resultText = "Derrota"; }
    else if (entry.result === "ONGOING") { circle = "🟡"; resultText = "Em andamento"; }
    else if (entry.result === "CANCELLED") { circle = "⚪"; resultText = "Cancelada"; }

    const championText = entry.championName ? ` como **${entry.championName}**` : "";
    
    return `${circle} **${resultText}** ${roleIcon(entry.role, presentation)}${championText}\n` +
           `└ Partida: \`${formatMatchLabel(entry.matchNumber, entry.matchId)}\``;
  }).join("\n\n");

  const embed = new EmbedBuilder()
    .setColor(COLORS.slate)
    .setTitle(`Histórico de Partidas - ${displayName}`)
    .setDescription(rows || "*Nenhuma partida encontrada.*");

  return embed;
};

const discordTimestamp = (isoDate: string): string => {
  const time = Date.parse(isoDate);
  return Number.isFinite(time) ? `<t:${Math.floor(time / 1000)}:f>` : isoDate;
};

const sortedParticipants = (summary: MatchSummary, team: Team) =>
  summary.participants
    .filter((participant) => participant.team === team)
    .sort((left, right) => ROLES.indexOf(left.role) - ROLES.indexOf(right.role));

const matchStatusLabel = (summary: MatchSummary): string => {
  if (summary.status === "ONGOING") {
    return "Em andamento";
  }

  if (summary.status === "CANCELLED") {
    return "Cancelada";
  }

  if (summary.status === "COMPLETED" && summary.winningTeam !== "NONE") {
    return `Vitoria ${renderTeamName(summary.winningTeam)}`;
  }

  return "Pendente";
};

const renderSummaryTeam = (
  summary: MatchSummary,
  team: Team,
  presentation?: DiscordPresentation,
): string => {
  const rows = sortedParticipants(summary, team).map((participant) => {
    const champion = participant.championName ? ` | ${participant.championName}` : "";
    const elo = rankTag(participant, presentation);
    return `${roleIcon(participant.role, presentation)} **${participant.displayName ?? participant.userId}**${elo ? ` - ${elo}` : ""}${champion}`;
  });

  return rows.join("\n") || "Sem jogadores.";
};

const renderCompactTeam = (
  summary: MatchSummary,
  team: Team,
  presentation?: DiscordPresentation,
): string =>
  sortedParticipants(summary, team)
    .map((participant) => {
      const elo = rankTag(participant, presentation);
      return `${roleIcon(participant.role, presentation)} ${participant.displayName ?? participant.userId}${elo ? ` (${elo})` : ""}`;
    })
    .join(" | ") || "Sem jogadores";

export const buildMatchSummaryEmbed = (
  summary: MatchSummary,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const matchLabel = formatMatchLabel(summary.matchNumber, summary.id);

  return new EmbedBuilder()
    .setColor(summary.status === "ONGOING" ? COLORS.green : summary.status === "CANCELLED" ? COLORS.softRed : COLORS.gold)
    .setTitle(`Ultima partida ${matchLabel}`)
    .setDescription(`${matchStatusLabel(summary)} | Criada em ${discordTimestamp(summary.createdAt)}`)
    .addFields(
      {
        name: "Blue Side",
        value: renderSummaryTeam(summary, "BLUE", presentation),
        inline: true,
      },
      {
        name: "Red Side",
        value: renderSummaryTeam(summary, "RED", presentation),
        inline: true,
      },
      {
        name: "Balanceamento",
        value: `Chance estimada Blue: ${(summary.blueExpectedWinrate * 100).toFixed(1)}%`,
        inline: false,
      },
    )
    .setFooter({ text: `UUID interno: ${summary.id}` });
};

export const buildActiveMatchesEmbed = (
  matches: readonly MatchSummary[],
  presentation?: DiscordPresentation,
): EmbedBuilder | null => {
  if (matches.length === 0) {
    return null;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.green)
    .setTitle(`⚔️ ${matches.length} partida${matches.length > 1 ? "s" : ""} em andamento`);

  for (const match of matches) {
    embed.addFields({
      name: formatMatchLabel(match.matchNumber, match.id),
      value: [
        `🔵 ${renderCompactTeam(match, "BLUE", presentation)}`,
        `🔴 ${renderCompactTeam(match, "RED", presentation)}`,
      ].join("\n"),
      inline: false,
    });
  }

  return embed;
};

export const buildPdlHistoryEmbed = (
  displayName: string,
  history: readonly PdlHistoryEntry[],
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.slate)
    .setTitle(`Historico de PDL de ${displayName}`);

  if (history.length === 0) {
    return embed.setDescription("*Sem historico de PDL.*");
  }

  const values = history.map((entry) => entry.pdlAfter);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? first;
  const diff = last - first;
  const emoji = diff > 0 ? "📈" : diff < 0 ? "📉" : "➖";
  const suffix = diff > 0 ? `+${diff}` : String(diff);

  const current = history[history.length - 1]!;
  const tIcon = tierIcon(current.tierAfter, presentation?.tierEmojis);
  const tStr = formatTier(current.tierAfter, current.divisionAfter);

  // Recent matches list with deltas.
  const recent = history
    .filter((e) => !e.isCurrent)
    .slice(-5)
    .map((e) => {
      const sign = e.pdlDelta >= 0 ? `+${e.pdlDelta}` : String(e.pdlDelta);
      return `\`${formatMatchLabel(e.matchNumber, e.matchId)}\` ${sign} PDL`;
    })
    .join("\n");

  embed.addFields(
    {
      name: "Elo atual",
      value: `${tIcon} **${tStr}** — ${current.pdlAfter} PDL`,
      inline: false,
    },
    {
      name: "Evolucao",
      value: `${emoji} **${first} → ${last}** (${suffix} PDL no periodo)`,
      inline: false,
    },
    {
      name: "Ultimas partidas",
      value: recent || "Nenhuma",
      inline: false,
    },
  );

  const chartConfig = {
    type: "line",
    data: {
      labels: values.map((_, i) => `${i + 1}`),
      datasets: [
        {
          label: "PDL",
          data: values,
          borderColor: "rgb(212, 167, 44)",
          backgroundColor: "transparent",
          borderWidth: 2,
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      legend: { labels: { fontColor: "white" } },
      scales: {
        xAxes: [{ ticks: { fontColor: "white" }, gridLines: { color: "rgba(255,255,255,0.1)" } }],
        yAxes: [{ ticks: { fontColor: "white" }, gridLines: { color: "rgba(255,255,255,0.1)" } }],
      },
    },
  };

  const chartUrl = `https://quickchart.io/chart?bkg=transparent&w=500&h=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  embed.setImage(chartUrl);

  return embed;
};

export const buildSynergyEmbed = (
  displayName: string,
  result: SynergyNemesisResult | null,
): EmbedBuilder => {
  const embed = new EmbedBuilder().setTitle(`🤝 Sinergia de ${displayName}`);

  if (!result) {
    return embed
      .setColor(COLORS.slate)
      .setDescription("Ainda nao temos dados suficientes para encontrar sua sinergia. Jogue mais partidas!");
  }

  return embed
    .setColor(COLORS.green)
    .setDescription(
      `Seu melhor parceiro e **${result.displayName}**!\n\n` +
      `Voces jogaram **${result.games}** partidas juntos e venceram **${result.wins}** delas.\n` +
      `Uma taxa de vitoria impressionante de **${(result.winrate * 100).toFixed(1)}%**.`
    );
};

export const buildNemesisEmbed = (
  displayName: string,
  result: SynergyNemesisResult | null,
): EmbedBuilder => {
  const embed = new EmbedBuilder().setTitle(`💀 Nemesis de ${displayName}`);

  if (!result) {
    return embed
      .setColor(COLORS.slate)
      .setDescription("Ainda nao temos dados suficientes para encontrar seu nemesis. Jogue mais partidas!");
  }

  return embed
    .setColor(COLORS.softRed)
    .setDescription(
      `Seu maior inimigo e **${result.displayName}**.\n\n` +
      `Voces se enfrentaram **${result.games}** vezes e **${result.displayName}** venceu **${result.wins}** delas.\n` +
      `Taxa de vitoria contra voce: **${(result.winrate * 100).toFixed(1)}%**`
    );
};

export const buildRoleReportEmbed = (
  displayName: string,
  report: RoleReportResult,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const barLength = 12;
  const roleLines = report.roles.map((r) => {
    const filled = Math.max(0, Math.min(barLength, Math.round(r.percentage * barLength)));
    const bar = `${"█".repeat(filled)}${"░".repeat(barLength - filled)}`;
    const winrate = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
    return `${roleIcon(r.role, presentation)} **${roleName[r.role]}** ${bar} **${Math.round(r.percentage * 100)}%** (${r.games} jogos, ${winrate}% WR)`;
  });

  const versatilityBar = `${progressBar(report.roles.length, ROLES.length)}`;
  let versatilityLabel = "Especialista";
  if (report.versatility >= 0.8) versatilityLabel = "Flexivel";
  else if (report.versatility >= 0.6) versatilityLabel = "Variado";
  else if (report.versatility >= 0.4) versatilityLabel = "Moderado";

  return new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle(`🎭 Role Pool — ${displayName}`)
    .setDescription(
      [
        `**Total de partidas:** ${report.totalGames}`,
        `**Roles jogadas:** ${report.roles.length}/${ROLES.length}`,
        "",
        ...roleLines,
        "",
        `**Versatilidade:** ${versatilityBar} ${Math.round(report.versatility * 100)}% — ${versatilityLabel}`,
      ].join("\n"),
    );
};

export const buildTopEmbed = (
  highlights: ServerHighlights,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const lines: string[] = [];

  if (highlights.topPdl) {
    const icon = tierIcon(highlights.topPdl.tier, presentation?.tierEmojis);
    const tierStr = formatTier(highlights.topPdl.tier, highlights.topPdl.division);
    lines.push(
      `🏆 **Topo do Ranking:** ${highlights.topPdl.displayName} — ${icon} **${tierStr}** (${highlights.topPdl.pdl} PDL)`,
    );
  }

  if (highlights.topWinrate) {
    lines.push(
      `🎯 **Maior Winrate:** ${highlights.topWinrate.displayName} — **${Math.round(highlights.topWinrate.winrate * 100)}%** (${highlights.topWinrate.games} jogos)`,
    );
  }

  if (highlights.topStreak) {
    lines.push(`🔥 **Maior Streak:** ${highlights.topStreak.displayName} — **${highlights.topStreak.streak}W** seguidas`);
  }

  if (highlights.mostActive) {
    lines.push(`⚡ **Mais Ativo:** ${highlights.mostActive.displayName} — **${highlights.mostActive.games}** partidas`);
  }

  if (highlights.bestDuo) {
    lines.push(
      `🤝 **Melhor Dupla:** ${highlights.bestDuo.name1} + ${highlights.bestDuo.name2} — **${Math.round(highlights.bestDuo.winrate * 100)}%** WR (${highlights.bestDuo.games} jogos)`,
    );
  }

  if (highlights.biggestRivalry) {
    lines.push(
      `⚔️ **Maior Rivalidade:** ${highlights.biggestRivalry.name1} vs ${highlights.biggestRivalry.name2} — **${highlights.biggestRivalry.games}** confrontos`,
    );
  }

  if (highlights.bestFill) {
    lines.push(
      `🌟 **Melhor Fill:** ${highlights.bestFill.displayName} — **${Math.round(highlights.bestFill.winrate * 100)}%** WR (${highlights.bestFill.games} fills)`,
    );
  }

  if (highlights.worstFill) {
    lines.push(
      `💀 **Pior Fill:** ${highlights.worstFill.displayName} — **${Math.round(highlights.worstFill.winrate * 100)}%** WR (${highlights.worstFill.games} fills)`,
    );
  }

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("📊 Destaques do Servidor")
    .setDescription(lines.length > 0 ? lines.join("\n\n") : "*Ainda nao ha partidas suficientes.*");
};

export const buildValidationEmbed = (params: {
  matchId: string;
  matchNumber?: number | null;
  action: "WIN" | "CANCEL" | "EXPIRED";
  winningTeam?: Team | undefined;
  accepted: number;
  required: number;
  requesterDisplayName?: string;
  requesterAvatarUrl?: string;
}): EmbedBuilder => {
  const isWin = params.action === "WIN";
  const isExpired = params.action === "EXPIRED";
  const color = isExpired ? COLORS.slate : isWin ? COLORS.green : COLORS.softRed;
  
  const title = isExpired 
    ? "⏳ Validação Expirada" 
    : isWin 
      ? `🏆 Vitória do Time ${renderTeamName(params.winningTeam!)}`
      : "🛑 Cancelamento de Partida";

  const description = isExpired
    ? "O tempo para validar esta partida esgotou. Nenhum resultado foi registrado."
    : isWin
      ? `Confirme se o resultado está correto. A partida será finalizada assim que ${params.required} jogadores concordarem.`
      : `Confirme se a partida deve ser abortada. Ela será cancelada assim que ${params.required} jogadores concordarem.`;

  const thumbnail = isExpired
    ? undefined
    : isWin
      ? "https://media.tenor.com/bm8Q6yAlsHcAAAAj/verified.gif"
      : "https://media.tenor.com/tHqgU_2k7x8AAAAj/error.gif";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      {
        name: "Confirmações",
        value: `${params.accepted}/${params.required}`,
        inline: true,
      },
      {
        name: "ID da Partida",
        value: `\`${formatMatchLabel(params.matchNumber, params.matchId)}\``,
        inline: true,
      },
    )
    .setFooter({ text: "Somente jogadores desta partida podem validar." });

  if (params.requesterDisplayName) {
    embed.setAuthor({ 
      name: `Solicitado por ${params.requesterDisplayName}`,
      ...(params.requesterAvatarUrl ? { iconURL: params.requesterAvatarUrl } : {})
    });
  }

  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  return embed;
};

export const buildCompareEmbed = (
  user1Name: string,
  user2Name: string,
  stats: {
    allies: { games: number; wins: number; losses: number };
    enemies: { games: number; user1Wins: number; user2Wins: number };
  }
): EmbedBuilder => {
  const alliesWinrate = stats.allies.games > 0 
    ? Math.round((stats.allies.wins / stats.allies.games) * 100) 
    : 0;

  let enemiesText = "*Nunca se enfrentaram em times opostos.*";
  if (stats.enemies.games > 0) {
    const u1w = stats.enemies.user1Wins;
    const u2w = stats.enemies.user2Wins;
    let advantage = "Empate";
    if (u1w > u2w) advantage = `Vantagem para **${user1Name}**`;
    else if (u2w > u1w) advantage = `Vantagem para **${user2Name}**`;

    enemiesText = `Jogaram contra **${stats.enemies.games}** vezes.\n` +
      `**${user1Name}:** ${u1w} Vitórias\n` +
      `**${user2Name}:** ${u2w} Vitórias\n` +
      `└ ${advantage}`;
  }

  let alliesText = "*Nunca jogaram no mesmo time.*";
  if (stats.allies.games > 0) {
    alliesText = `Jogaram juntos **${stats.allies.games}** vezes.\n` +
      `**${stats.allies.wins}** Vitórias - **${stats.allies.losses}** Derrotas\n` +
      `└ Win Rate: **${alliesWinrate}%**`;
  }

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`⚔️ Comparativo: ${user1Name} vs ${user2Name}`)
    .setDescription(`Histórico direto de partidas entre **${user1Name}** e **${user2Name}** neste servidor.`)
    .addFields(
      {
        name: "🤝 Como Aliados (Mesmo Time)",
        value: alliesText,
        inline: false
      },
      {
        name: "⚔️ Como Inimigos (Times Opostos)",
        value: enemiesText,
        inline: false
      }
    )
    .setThumbnail("https://media.tenor.com/T0T_T1Hk0wAAAAAj/league-of-legends-esports.gif");
};

export const buildLinkAccountEmbed = (authUrl: string): {
  embed: EmbedBuilder;
  row: ActionRowBuilder<MessageActionRowComponentBuilder>;
} => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("🔗 Vinculação de Conta Riot")
    .setDescription(
      "Para vincular sua conta do League of Legends, clique no botão abaixo.\n\n" +
      "Você será redirecionado para o **site oficial da Riot Games** para fazer login com segurança.\n\n" +
      "> 🔒 Nenhuma senha é compartilhada conosco. O login ocorre 100% nos servidores da Riot.",
    )
    .setFooter({ text: "O link expira em 10 minutos." })
    .setThumbnail("https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Riot_Games_Logo_2022.svg/240px-Riot_Games_Logo_2022.svg.png");

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("🎮 Entrar com Riot")
      .setStyle(ButtonStyle.Link)
      .setURL(authUrl),
  );

  return { embed, row };
};

export const buildLinkSuccessEmbed = (gameName: string, tagLine: string): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLORS.green)
    .setTitle("✅ Conta Vinculada com Sucesso!")
    .setDescription(`Sua conta **${gameName}#${tagLine}** foi vinculada ao seu Discord.\n\nAgora você participa de Inhouses com autenticação verificada pela Riot!`)
    .setThumbnail("https://media.tenor.com/bm8Q6yAlsHcAAAAj/verified.gif");

export const buildAlreadyLinkedEmbed = (gameName: string, tagLine: string): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle("🔗 Conta Já Vinculada")
    .setDescription(`Sua conta atual é **${gameName}#${tagLine}**.\n\nSe quiser trocar de conta, use \`/link-account\` novamente.`);

// ── Role Demand Embed ──────────────────────────────────────────────

export const buildDemandEmbed = (
  demand: RoleDemand,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const maxPlayers = Math.max(...demand.roles.map((r) => r.uniquePlayers), 1);

  const roleLines = demand.roles.map((r) => {
    const barLen = 15;
    const filled = Math.max(0, Math.round((r.uniquePlayers / maxPlayers) * barLen));
    const bar = `${"█".repeat(filled)}${"░".repeat(barLen - filled)}`;
    const wr = Math.round(r.avgWinrate * 100);
    const heat = r.role === demand.scarcest ? "🔴" : r.role === demand.mostPopular ? "🟢" : "🟡";
    return `${heat} ${roleIcon(r.role, presentation)} **${roleName[r.role]}** ${bar} **${r.uniquePlayers}** jogadores\n> ${r.totalPicks} picks · ${wr}% WR média`;
  });

  // Already sorted scarcest → most popular in service
  const scarceLine = `🔴 **Menos jogadores:** ${roleIcon(demand.scarcest, presentation)} **${roleName[demand.scarcest]}**`;
  const popularLine = `🟢 **Mais jogadores:** ${roleIcon(demand.mostPopular, presentation)} **${roleName[demand.mostPopular]}**`;

  return new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle("🗺️ Mapa de Demanda — Roles do Servidor")
    .setDescription(
      [
        `**${demand.totalPlayers}** jogadores únicos no servidor`,
        "",
        ...roleLines,
        "",
        scarceLine,
        popularLine,
        "",
        `> 💡 O servidor precisa de mais jogadores de **${roleName[demand.scarcest]}**! Entrar como **Fill** ajuda a equilibrar.`,
      ].join("\n"),
    )
    .setFooter({ text: "Baseado em jogadores únicos por role em partidas finalizadas." });
};

// ── Profile Embed ──────────────────────────────────────────────────

const streakText = (streak: number): string => {
  if (streak === 0) return "Nenhuma sequência";
  if (streak > 0) return `🔥 **${streak}** vitória${streak > 1 ? "s" : ""} seguida${streak > 1 ? "s" : ""}`;
  const abs = Math.abs(streak);
  return `❄️ **${abs}** derrota${abs > 1 ? "s" : ""} seguida${abs > 1 ? "s" : ""}`;
};

export const buildProfileEmbed = (
  profile: PlayerProfile,
  presentation?: DiscordPresentation,
): EmbedBuilder[] => {
  const { global: g, roles } = profile;
  const color = tierColor(g.tier);
  const icon = tierIcon(g.tier, presentation?.tierEmojis);
  const tierName = formatTier(g.tier, g.division);
  const rankDisplay = g.rank ? `#${g.rank}` : "Sem ranking";
  const mainRoleText = profile.mainRole
    ? `${roleIcon(profile.mainRole, presentation)} ${roleName[profile.mainRole]}`
    : "Sem rota principal";
  const record = `${g.totalWins}V ${g.totalLosses}D`;

  const mainEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${icon} ${profile.displayName} - ${tierName}`)
    .setDescription(
      [
        `**${g.pdl} PDL** - Ranking **${rankDisplay}**`,
        pdlProgressBar(g.pdl, g.tier, g.division),
        "",
        `**Partidas:** ${g.totalGames} | **Recorde:** ${record} | **WR:** ${profile.winrate}%`,
        `**Rota principal:** ${mainRoleText}`,
        `**Sequencia atual:** ${streakText(profile.streak)}`,
      ].join("\n"),
    )
    .setFooter({ text: "MMR segue oculto e e usado apenas para balanceamento." });

  if (profile.avatarUrl) {
    mainEmbed.setThumbnail(profile.avatarUrl);
  }

  if (roles.length > 0) {
    const roleLines = roles.map((r) => {
      const wr = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
      const bar = progressBar(r.games, g.totalGames);
      return `${roleIcon(r.role, presentation)} **${roleName[r.role]}** ${bar} ${r.games} jogos - ${wr}% WR`;
    });

    mainEmbed.addFields({
      name: "Desempenho por rota",
      value: roleLines.join("\n"),
      inline: false,
    });
  }

  if (profile.roleReport) {
    const vBar = progressBar(profile.roleReport.roles.length, ROLES.length);
    let label = "Especialista";
    if (profile.roleReport.versatility >= 0.8) label = "Flexível";
    else if (profile.roleReport.versatility >= 0.6) label = "Variado";
    else if (profile.roleReport.versatility >= 0.4) label = "Moderado";

    mainEmbed.addFields({
      name: "Versatilidade",
      value: `${vBar} **${label}** (${profile.roleReport.roles.length}/${ROLES.length} roles)`,
      inline: false,
    });
  }

  const socialLines: string[] = [];

  if (profile.synergy) {
    const wr = Math.round(profile.synergy.winrate * 100);
    socialLines.push(
      `**Melhor duo:** ${profile.synergy.displayName}`,
      `${profile.synergy.games} jogos juntos - ${wr}% WR - ${profile.synergy.wins}V`,
    );
  }

  if (profile.nemesis) {
    const wr = Math.round(profile.nemesis.winrate * 100);
    socialLines.push(
      `**Nemesis:** ${profile.nemesis.displayName}`,
      `${profile.nemesis.games} confrontos - ${wr}% vitorias do rival`,
    );
  }

  const socialEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Resumo competitivo - ${profile.displayName}`);

  if (socialLines.length > 0) socialEmbed.setDescription(socialLines.join("\n"));

  if (profile.recentMatches.length > 0) {
    const matchLines = profile.recentMatches.map((entry) => {
      const icon = entry.result === "WIN" ? "V" : entry.result === "LOSS" ? "D" : "-";
      const champion = entry.championName ? ` (${entry.championName})` : "";
      return `\`${icon}\` ${roleIcon(entry.role, presentation)} ${formatMatchLabel(entry.matchNumber, entry.matchId)}${champion}`;
    });

    socialEmbed.addFields({
      name: "Ultimas partidas",
      value: matchLines.join("\n"),
      inline: false,
    });
  }

  if (profile.avatarUrl) {
    socialEmbed.setThumbnail(profile.avatarUrl);
  }
  socialEmbed.setFooter({ text: `${tierName} - ${g.pdl} PDL` });

  const embeds = [mainEmbed];
  if (socialLines.length > 0 || profile.recentMatches.length > 0) {
    embeds.push(socialEmbed);
  }
  return embeds;
};
