import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { BalancedMatch, Role, Team } from "../../core/models/types.js";
import { ROLES } from "../../core/models/types.js";
import type { QueueSnapshot } from "../../core/queue/QueueService.js";
import type {
  HistoryEntry,
  MmrHistoryEntry,
  PlayerRoleSummary,
  RankingEntry,
} from "../../services/statsService.js";

export const RANKING_PAGE_SIZE = 15;

export interface DiscordPresentation {
  roleEmojis?: Partial<Record<Role, string>>;
}

export const roleButtonId = (role: Role): string => `inhouse:join:${role}`;
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

export const ROLE_EMOJI_NAMES: Record<Role, string> = {
  TOP: "TOP",
  JGL: "JGL",
  MID: "MID",
  ADC: "ADC",
  SUP: "SUP",
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

const playerLabel = (name?: string): string => (name && name.length > 0 ? name : "Livre");

const progressBar = (value: number, total: number): string => {
  const size = 10;
  const filled = Math.max(0, Math.min(size, Math.round((value / total) * size)));
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)}`;
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

const compactMatchId = (matchId: string): string => matchId.slice(0, 8);

export const setupCommand = new SlashCommandBuilder()
  .setName("setup-inhouse")
  .setDescription("Cria a mensagem persistente da fila de inhouse.");

export const queueCommand = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Entra na fila por slash command, com suporte a duo.")
  .addStringOption((option) =>
    option
      .setName("rota")
      .setDescription("Sua rota.")
      .setRequired(true)
      .addChoices(...ROLES.map((role) => ({ name: role, value: role }))),
  )
  .addUserOption((option) =>
    option.setName("duo").setDescription("Jogador que vai entrar junto com voce."),
  )
  .addStringOption((option) =>
    option
      .setName("rota_duo")
      .setDescription("Rota do duo.")
      .addChoices(...ROLES.map((role) => ({ name: role, value: role }))),
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
      .setDescription("ID da partida criada pelo bot.")
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
  .setDescription("Mostra rank, MMR e W/L por rota.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra seus stats."),
  );

export const rankCommand = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("Mostra seu rank, MMR e W/L por rota.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra seus stats."),
  );

export const rankingCommand = new SlashCommandBuilder()
  .setName("ranking")
  .setDescription("Mostra o ranking de MMR do servidor.")
  .addStringOption((option) =>
    option
      .setName("rota")
      .setDescription("Filtra por rota.")
      .addChoices(...ROLES.map((role) => ({ name: role, value: role }))),
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

export const mmrHistoryCommand = new SlashCommandBuilder()
  .setName("mmr-history")
  .setDescription("Mostra a evolucao de MMR do jogador.")
  .addUserOption((option) =>
    option.setName("jogador").setDescription("Jogador alvo. Vazio mostra voce."),
  )
  .addStringOption((option) =>
    option
      .setName("rota")
      .setDescription("Filtra por rota.")
      .addChoices(...ROLES.map((role) => ({ name: role, value: role }))),
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
    option.setName("match_id").setDescription("ID da partida. Vazio usa sua ultima partida."),
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
  .setDescription("Vincula sua conta do League of Legends ao Discord via login oficial da Riot.");

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
    option.setName("match_id").setDescription("ID da partida.").setRequired(true),
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

export const discordCommands = [
  setupCommand,
  queueCommand,
  queueStatusCommand,
  leaveQueueCommand,
  adminWinCommand,
  statsCommand,
  rankCommand,
  rankingCommand,
  historyCommand,
  mmrHistoryCommand,
  championCommand,
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
  devCreateMatchCommand,
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

  const leaveButton = new ButtonBuilder()
    .setCustomId(leaveButtonId)
    .setLabel("Sair da fila")
    .setStyle(ButtonStyle.Danger);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(routeButtons),
    new ActionRowBuilder<ButtonBuilder>().addComponents(leaveButton),
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
      .setLabel("Aceitar partida")
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
  const slotColumn = (slotIndex: number): string =>
    ROLES.map((role) => {
      const player = snapshot.roles[role][slotIndex];
      return `${roleIcon(role, presentation)} ${playerLabel(player?.displayName)}`;
    }).join("\n");

  const waitingPlayers = ROLES.flatMap((role) =>
    snapshot.roles[role]
      .slice(2)
      .map((player) => `${roleIcon(role, presentation)} ${player.displayName}`),
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

  return embed;
};

export const buildMatchEmbed = (
  matchId: string,
  match: BalancedMatch,
  presentation?: DiscordPresentation,
  tournamentCode?: string,
): EmbedBuilder => {
  const slots = [...match.teamBlue, ...match.teamRed];

  const renderTeam = (team: Team): string =>
    ROLES.map((role) => {
      const slot = slots.find((s) => s.team === team && s.role === role);
      return `${roleIcon(role, presentation)} **${slot?.player.displayName ?? "Livre"}**`;
    }).join("\n");

  let description = "Os times foram balanceados e o lobby está montado. Entrem no jogo e boa sorte!\n\n";
  if (tournamentCode) {
    description += `🏆 **CÓDIGO DE TORNEIO (Copie e cole no LoL):**\n\`\`\`\n${tournamentCode}\n\`\`\``;
  } else {
    description += `**ID da Partida (Cópia Manual):**\n\`\`\`\n${matchId}\n\`\`\``;
  }

  return new EmbedBuilder()
    .setColor(COLORS.green)
    .setTitle("🚀 Partida Pronta para Jogar!")
    .setDescription(description)
    .setImage("https://media.tenor.com/Zp9TWeBw2EwAAAAC/league-of-legends-lol.gif")
    .addFields(
      {
        name: "🔵 TIME AZUL",
        value: renderTeam("BLUE"),
        inline: true,
      },
      {
        name: "🔴 TIME VERMELHO",
        value: renderTeam("RED"),
        inline: true,
      },
      {
        name: "📊 Balanceamento",
        value: `Probabilidade Blue: **${(match.blueExpectedWinrate * 100).toFixed(1)}%** | Delta MMR: **${match.muDifference.toFixed(2)}**`,
        inline: false,
      }
    )
    .setFooter({
      text: "Que vença o melhor time!",
    });
};

export const buildReadyCheckEmbed = (
  readyCheckId: string,
  match: BalancedMatch,
  acceptedUserIds: ReadonlySet<string>,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const slots = [...match.teamBlue, ...match.teamRed];
  const renderTeam = (team: Team): string =>
    ROLES.map((role) => {
      const slot = slots.find((candidate) => candidate.team === team && candidate.role === role);
      const accepted = slot && acceptedUserIds.has(slot.player.userId);
      const status = accepted ? "✅" : "⏳";
      return `${status} ${roleIcon(role, presentation)} **${slot?.player.displayName ?? "Livre"}**`;
    }).join("\n");

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("⚔️ Partida Encontrada!")
    .setDescription("O matchmaking encontrou uma partida. Por favor, confirme sua presença clicando no botão abaixo.")
    .setThumbnail("https://media.tenor.com/Z1d2xMv4UeYAAAAi/alert-bell.gif")
    .addFields(
      {
        name: "Confirmacoes",
        value: `${acceptedUserIds.size}/10`,
        inline: true,
      },
      {
        name: "Balanceamento",
        value: `Blue ${(match.blueExpectedWinrate * 100).toFixed(1)}%`,
        inline: true,
      },
      {
        name: "\u200b", // Empty space to force a new row for the teams
        value: "\u200b",
        inline: true,
      },
      {
        name: "🔵 Blue Side",
        value: renderTeam("BLUE"),
        inline: true,
      },
      {
        name: "🔴 Red Side",
        value: renderTeam("RED"),
        inline: true,
      },
    )
    .setFooter({ text: `ID: ${readyCheckId.slice(0, 8)} | Timeout em 2 minutos` });
};

export const buildDuoInviteEmbed = (params: {
  requesterName: string;
  requesterRole: Role;
  targetName: string;
  targetRole: Role;
  presentation?: DiscordPresentation;
}): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle("🤝 Convite de Duo")
    .setDescription(`**${params.requesterName}** convidou **${params.targetName}** para entrarem na fila juntos.\nConfirme sua rota abaixo.`)
    .addFields(
      {
        name: `Líder: ${roleTitle(params.requesterRole, params.presentation)}`,
        value: `**${params.requesterName}**`,
        inline: true,
      },
      {
        name: `Convidado: ${roleTitle(params.targetRole, params.presentation)}`,
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
    
    return `${medal}${roleIcon(entry.role, presentation)} **${entry.displayName}** • ${Math.round(entry.mmr)} MMR \`[${entry.wins}W ${entry.losses}L | ${winrate}%]\``;
  }).join("\n");

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(role ? `Ranking - ${roleName[role]}` : "Ranking geral")
    .setDescription(rows || "*Nenhum jogador encontrado.*")
    .setFooter({ text: `Página ${normalizedPage + 1}/${totalPages}` });
};

export const buildStatsEmbed = (
  displayName: string,
  summaries: readonly PlayerRoleSummary[],
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`👤 Perfil do Jogador: ${displayName}`);

  if (summaries.length === 0) {
    return embed.setDescription("*Este jogador ainda não possui estatísticas.*");
  }

  let totalWins = 0;
  let totalLosses = 0;
  let highestMmr = 0;
  let mainRole: Role | null = null;
  
  const roleBlocks = summaries.map((row) => {
    const games = row.wins + row.losses;
    totalWins += row.wins;
    totalLosses += row.losses;
    
    if (row.mmr > highestMmr) {
      highestMmr = row.mmr;
      mainRole = row.role;
    }

    const winrate = games > 0 ? Math.round((row.wins / games) * 100) : 0;
    const rankText = row.rank ? `🏆 Rank **#${row.rank}**` : "Unranked";
    
    return `${roleIcon(row.role, presentation)} **${roleName[row.role]}**\n` +
           `└ MMR: **${Math.round(row.mmr)}** | ${rankText} | ${row.wins}V - ${row.losses}D (${winrate}%)`;
  });

  const totalGames = totalWins + totalLosses;
  const globalWinrate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  
  embed.setDescription(
    `**Partidas Totais:** ${totalGames}\n` +
    `**Taxa de Vitória (Geral):** ${globalWinrate}%\n` +
    `**Melhor Rota:** ${mainRole ? `${roleIcon(mainRole, presentation)} ${roleName[mainRole]}` : "N/A"}\n\n` +
    `### Desempenho por Rota\n` +
    roleBlocks.join("\n\n")
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
    
    return `${circle} **${resultText}** ${roleIcon(entry.role, presentation)}${championText} • MMR: **${Math.round(entry.mmrBefore)}**\n` +
           `└ ID: \`${entry.matchId}\``;
  }).join("\n\n");

  const embed = new EmbedBuilder()
    .setColor(COLORS.slate)
    .setTitle(`Histórico de Partidas - ${displayName}`)
    .setDescription(rows || "*Nenhuma partida encontrada.*");

  return embed;
};

export const buildMmrHistoryEmbed = (
  displayName: string,
  history: readonly MmrHistoryEntry[],
  role?: Role,
  presentation?: DiscordPresentation,
): EmbedBuilder => {
  const byRole = new Map<Role, MmrHistoryEntry[]>();
  for (const entry of history) {
    const rows = byRole.get(entry.role) ?? [];
    rows.push(entry);
    byRole.set(entry.role, rows);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.slate)
    .setTitle(role ? `📈 Histórico de MMR de ${displayName} - ${roleName[role]}` : `📈 Histórico de MMR de ${displayName}`);

  if (history.length === 0) {
    return embed.setDescription("*Sem histórico de MMR.*");
  }

  const datasets: any[] = [];
  const roleColors: Record<Role, string> = {
    TOP: "rgb(231, 76, 60)",
    JGL: "rgb(46, 204, 113)",
    MID: "rgb(52, 152, 219)",
    ADC: "rgb(241, 196, 15)",
    SUP: "rgb(155, 89, 182)"
  };

  let maxMatches = 0;

  for (const currentRole of ROLES) {
    const rows = byRole.get(currentRole);
    if (!rows || rows.length === 0) {
      continue;
    }

    const values = rows.map((entry) => Math.round(entry.mmr));
    if (values.length > maxMatches) {
      maxMatches = values.length;
    }

    datasets.push({
      label: roleName[currentRole],
      data: values,
      borderColor: roleColors[currentRole],
      backgroundColor: "transparent",
      borderWidth: 2,
      tension: 0.3,
      fill: false,
    });

    const first = values[0] ?? 0;
    const last = values[values.length - 1] ?? first;
    const diff = last - first;
    const emoji = diff > 0 ? "📈" : diff < 0 ? "📉" : "➖";
    const suffix = diff > 0 ? `+${diff}` : String(diff);
    
    const recentMatches = rows
      .filter((entry) => !entry.isCurrent)
      .slice(-3)
      .map((entry) => `\`${compactMatchId(entry.matchId)}\``)
      .join(", ");

    embed.addFields({
      name: `${roleIcon(currentRole, presentation)} ${roleName[currentRole]}`,
      value: [
        `${emoji} **${first} ➔ ${last}** (${suffix})`,
        `Últimas partidas: ${recentMatches || "Nenhuma"}`
      ].join("\n"),
      inline: false,
    });
  }

  // QuickChart.io V2 API Format for Chart.js 2.9
  const chartConfig = {
    type: 'line',
    data: {
      labels: Array.from({ length: maxMatches }, (_, i) => `${i + 1}`),
      datasets
    },
    options: {
      legend: { labels: { fontColor: 'white' } },
      scales: {
        xAxes: [{ ticks: { fontColor: 'white' }, gridLines: { color: 'rgba(255,255,255,0.1)' } }],
        yAxes: [{ ticks: { fontColor: 'white' }, gridLines: { color: 'rgba(255,255,255,0.1)' } }]
      }
    }
  };

  const chartUrl = `https://quickchart.io/chart?bkg=transparent&w=500&h=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  embed.setImage(chartUrl);

  return embed;
};

export const buildValidationEmbed = (params: {
  matchId: string;
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
        value: `\`${params.matchId.slice(0, 8)}\``,
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

