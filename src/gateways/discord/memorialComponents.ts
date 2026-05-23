import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type {
  SeasonComeback,
  SeasonHighlights,
  SeasonOverview,
  SeasonRankingEntry,
} from "../../services/seasonArchiveService.js";
import { memorialNextButtonId, memorialPrevButtonId } from "./components.js";

export const MEMORIAL_RANKING_PAGE_SIZE = 15;

const formatDate = (iso: string | null): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const formatPercent = (n: number) => `${Math.round(n * 100)}%`;

const mention = (person: { displayName: string; discordId?: string | null }): string =>
  person.discordId ? `<@${person.discordId}>` : `**${person.displayName}**`;

const pairMention = (
  a: { displayName: string; discordId?: string | null },
  b: { displayName: string; discordId?: string | null },
): string => `${mention(a)} + ${mention(b)}`;

const COLOR_GOLD = 0xd4a72c;
const COLOR_BLUE = 0x5865f2;
const COLOR_PURPLE = 0x9b59b6;
const COLOR_SLATE = 0x2b2d31;

export const buildMemorialHeaderEmbed = (overview: SeasonOverview): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLOR_SLATE)
    .setTitle("Memorial da Season 1")
    .setDescription(
      [
        "**Inhouse Fured Bubble - Season 1 encerrada oficialmente.**",
        "",
        "A primeira temporada fica registrada aqui: partidas, viradas, duplas, rivalidades e aquela insistencia bonita de voltar para a fila depois de uma noite dificil.",
        "Obrigado a todo mundo que jogou, completou time, validou resultado e fez essa season acontecer.",
        "",
        `Periodo: **${formatDate(overview.firstMatchAt)}** ate **${formatDate(overview.lastMatchAt)}**`,
        `Partidas finalizadas: **${overview.totalCompletedMatches}**`,
        `Partidas canceladas: **${overview.totalCancelledMatches}**`,
        `Jogadores ativos: **${overview.totalPlayers}**`,
      ].join("\n"),
    );

export const buildMemorialPodiumEmbed = (ranking: readonly SeasonRankingEntry[]): EmbedBuilder => {
  const top3 = ranking.slice(0, 3);

  const embed = new EmbedBuilder()
    .setColor(COLOR_GOLD)
    .setTitle("Podio oficial")
    .setDescription(
      top3.length > 0
        ? "O topo da Season 1 ficou com quem sustentou resultado do inicio ao fim. Parabens ao Top 3."
        : "*Sem dados de ranking para esta temporada.*",
    );

  for (const entry of top3) {
    const total = entry.wins + entry.losses;
    const wr = total > 0 ? Math.round((entry.wins / total) * 100) : 0;
    const title = entry.rank === 1 ? "1. Campeao da Season 1" : entry.rank === 2 ? "2. Vice-campeao" : "3. Terceiro lugar";

    embed.addFields({
      name: title,
      value: [
        `${mention(entry)} - **${entry.mmr} MMR**`,
        `${entry.wins}V ${entry.losses}D - ${wr}% WR`,
      ].join("\n"),
      inline: false,
    });
  }

  const champion = top3[0];
  if (champion) {
    embed.addFields({
      name: "Reconhecimento",
      value: `${mention(champion)}, parabens pelo titulo. Voce fechou a primeira temporada no topo e deixou o nome marcado no historico do servidor.`,
      inline: false,
    });
  }

  return embed;
};

export const buildMemorialHighlightsEmbed = (highlights: SeasonHighlights | null): EmbedBuilder => {
  if (!highlights) {
    return new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setTitle("Destaques da Season")
      .setDescription("*Sem highlights registrados.*");
  }

  const lines: string[] = [];

  if (highlights.topMmr) {
    lines.push(`**Maior MMR:** ${mention(highlights.topMmr)} - ${highlights.topMmr.mmr}`);
  }
  if (highlights.topWinrate) {
    lines.push(
      `**Melhor winrate:** ${mention(highlights.topWinrate)} - ${formatPercent(highlights.topWinrate.winrate)} em ${highlights.topWinrate.games} partidas`,
    );
  }
  if (highlights.topStreak) {
    lines.push(`**Maior sequencia de vitorias:** ${mention(highlights.topStreak)} - ${highlights.topStreak.streak} seguidas`);
  }
  if (highlights.mostActive) {
    lines.push(`**Mais ativo:** ${mention(highlights.mostActive)} - ${highlights.mostActive.games} partidas`);
  }
  if (highlights.bestDuo) {
    lines.push(
      `**Melhor dupla:** ${pairMention(
        { displayName: highlights.bestDuo.name1, discordId: highlights.bestDuo.discordId1 },
        { displayName: highlights.bestDuo.name2, discordId: highlights.bestDuo.discordId2 },
      )} - ${formatPercent(highlights.bestDuo.winrate)} em ${highlights.bestDuo.games} jogos juntos`,
    );
  }
  if (highlights.biggestRivalry) {
    lines.push(
      `**Maior rivalidade:** ${mention({ displayName: highlights.biggestRivalry.name1, discordId: highlights.biggestRivalry.discordId1 })} vs ${mention(
        { displayName: highlights.biggestRivalry.name2, discordId: highlights.biggestRivalry.discordId2 },
      )} - ${highlights.biggestRivalry.games} confrontos`,
    );
  }
  if (highlights.bestFill) {
    lines.push(
      `**Melhor FILL:** ${mention(highlights.bestFill)} - ${formatPercent(highlights.bestFill.winrate)} em ${highlights.bestFill.games} preenchimentos`,
    );
  }
  if (highlights.worstFill) {
    lines.push(
      `**FILL mais sofrido:** ${mention(highlights.worstFill)} - ${formatPercent(highlights.worstFill.winrate)} em ${highlights.worstFill.games} preenchimentos`,
    );
  }

  if (lines.length === 0) lines.push("*Sem dados suficientes para highlights.*");

  return new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setTitle("Destaques da Season")
    .setDescription(lines.join("\n"));
};

export const buildMemorialComebackEmbed = (comeback: SeasonComeback | null): EmbedBuilder => {
  if (!comeback) {
    return new EmbedBuilder()
      .setColor(COLOR_PURPLE)
      .setTitle("Volta por cima")
      .setDescription("*Sem reviravoltas suficientes para destacar nesta temporada.*");
  }

  const description = [
    `${mention(comeback)} teve a maior recuperacao de MMR da Season 1.`,
    "",
    `Ponto mais baixo: **${comeback.fromMmr} MMR**`,
    `Fechamento da season: **${comeback.toMmr} MMR**`,
    `Recuperacao total: **+${comeback.delta} MMR** em ${comeback.matchesPlayed} partidas.`,
    "",
    "Essa foi a prova de que a season nao acaba na fase ruim. Acaba quando a ultima partida fecha.",
  ].join("\n");

  return new EmbedBuilder().setColor(COLOR_PURPLE).setTitle("Volta por cima").setDescription(description);
};

export const buildMemorialRankingEmbed = (
  ranking: readonly SeasonRankingEntry[],
  page: number,
  pageSize = MEMORIAL_RANKING_PAGE_SIZE,
): EmbedBuilder => {
  const totalPages = Math.max(1, Math.ceil(ranking.length / pageSize));
  const normalizedPage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = ranking.slice(normalizedPage * pageSize, (normalizedPage + 1) * pageSize);

  const rows = slice.map((entry) => {
    const total = entry.wins + entry.losses;
    const wr = total > 0 ? Math.round((entry.wins / total) * 100) : 0;
    const rankStr = String(entry.rank).padStart(2, "0");
    return `\`#${rankStr}\` ${mention(entry)} - **${entry.mmr} MMR** - ${entry.wins}V ${entry.losses}D (${wr}%)`;
  });

  return new EmbedBuilder()
    .setColor(COLOR_SLATE)
    .setTitle("Ranking final")
    .setDescription(rows.length > 0 ? rows.join("\n") : "*Sem entradas no ranking.*")
    .setFooter({ text: `Pagina ${normalizedPage + 1}/${totalPages} - ${ranking.length} jogadores no total` });
};

export const buildMemorialClosingEmbed = (ranking: readonly SeasonRankingEntry[]): EmbedBuilder => {
  const top3 = ranking.slice(0, 3).map(mention).join(", ");

  return new EmbedBuilder()
    .setColor(COLOR_SLATE)
    .setTitle("Fechamento")
    .setDescription(
      [
        "Season 1 encerrada.",
        "",
        top3 ? `Parabens novamente ao Top 3: ${top3}.` : "Obrigado a todos que participaram.",
        "A historia ficou salva. A Season 2 comeca com PDL zerado, mas com a memoria da primeira temporada intacta.",
        "",
        "Obrigado por jogar o Inhouse Fured Bubble.",
      ].join("\n"),
    );
};

export const buildMemorialButtons = (
  sessionId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder>[] => {
  if (totalPages <= 1) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(memorialPrevButtonId(sessionId))
        .setLabel("Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(memorialNextButtonId(sessionId))
        .setLabel("Proxima")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    ),
  ];
};
