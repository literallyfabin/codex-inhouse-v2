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
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const formatPercent = (n: number) => `${Math.round(n * 100)}%`;

const COLOR_GOLD = 0xf1c40f;
const COLOR_BLUE = 0x3498db;
const COLOR_PURPLE = 0x9b59b6;
const COLOR_SLATE = 0x2c3e50;

export const buildMemorialHeaderEmbed = (overview: SeasonOverview): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLOR_SLATE)
    .setTitle("Memorial — Season 1 do Inhouse Fured Bubble")
    .setDescription(
      [
        "A primeira temporada chegou ao fim.",
        "Foram noites longas, viradas improvaveis, partidas que viraram historia entre nos.",
        "Esta mensagem registra oficialmente tudo que aconteceu na Season 1.",
        "",
        "**Resumo da temporada:**",
        `Inicio: ${formatDate(overview.firstMatchAt)}`,
        `Encerramento: ${formatDate(overview.lastMatchAt)}`,
        `Partidas finalizadas: **${overview.totalCompletedMatches}**`,
        `Partidas canceladas: ${overview.totalCancelledMatches}`,
        `Jogadores ativos: **${overview.totalPlayers}**`,
      ].join("\n"),
    );

export const buildMemorialPodiumEmbed = (ranking: readonly SeasonRankingEntry[]): EmbedBuilder => {
  const top3 = ranking.slice(0, 3);
  const lines = top3.length === 0
    ? ["*Sem dados de ranking para esta temporada.*"]
    : top3.map((entry) => {
        const medal = entry.rank === 1 ? "1º" : entry.rank === 2 ? "2º" : "3º";
        const total = entry.wins + entry.losses;
        const wr = total > 0 ? Math.round((entry.wins / total) * 100) : 0;
        return `**${medal} — ${entry.displayName}** • ${entry.mmr} MMR • ${entry.wins}V ${entry.losses}D (${wr}%)`;
      });

  const champion = top3[0]?.displayName;
  const description = [
    "**Podio oficial da Season 1**",
    "",
    ...lines,
    "",
    champion
      ? `Parabens a **${champion}**, campeao da primeira temporada do Inhouse Fured Bubble.`
      : "Sem campeao registrado.",
  ].join("\n");

  return new EmbedBuilder().setColor(COLOR_GOLD).setTitle("Podio").setDescription(description);
};

export const buildMemorialHighlightsEmbed = (highlights: SeasonHighlights | null): EmbedBuilder => {
  if (!highlights) {
    return new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setTitle("Hall da Fama")
      .setDescription("*Sem highlights registrados.*");
  }

  const lines: string[] = [];

  if (highlights.topMmr) {
    lines.push(`**Maior MMR da temporada:** ${highlights.topMmr.displayName} (${highlights.topMmr.mmr})`);
  }
  if (highlights.topWinrate) {
    lines.push(
      `**Melhor winrate:** ${highlights.topWinrate.displayName} — ${formatPercent(highlights.topWinrate.winrate)} em ${highlights.topWinrate.games} partidas`,
    );
  }
  if (highlights.topStreak) {
    lines.push(`**Maior streak de vitorias:** ${highlights.topStreak.displayName} — ${highlights.topStreak.streak} seguidas`);
  }
  if (highlights.mostActive) {
    lines.push(`**Mais ativo:** ${highlights.mostActive.displayName} — ${highlights.mostActive.games} partidas`);
  }
  if (highlights.bestDuo) {
    lines.push(
      `**Melhor dupla:** ${highlights.bestDuo.name1} + ${highlights.bestDuo.name2} — ${formatPercent(highlights.bestDuo.winrate)} em ${highlights.bestDuo.games} jogos juntos`,
    );
  }
  if (highlights.biggestRivalry) {
    lines.push(
      `**Maior rivalidade:** ${highlights.biggestRivalry.name1} vs ${highlights.biggestRivalry.name2} — ${highlights.biggestRivalry.games} confrontos`,
    );
  }
  if (highlights.bestFill) {
    lines.push(
      `**Melhor FILL:** ${highlights.bestFill.displayName} — ${formatPercent(highlights.bestFill.winrate)} em ${highlights.bestFill.games} preenchimentos`,
    );
  }
  if (highlights.worstFill) {
    lines.push(
      `**FILL mais sofrido:** ${highlights.worstFill.displayName} — ${formatPercent(highlights.worstFill.winrate)} em ${highlights.worstFill.games} preenchimentos`,
    );
  }

  if (lines.length === 0) lines.push("*Sem dados suficientes para highlights.*");

  return new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setTitle("Hall da Fama")
    .setDescription(lines.join("\n"));
};

export const buildMemorialComebackEmbed = (comeback: SeasonComeback | null): EmbedBuilder => {
  if (!comeback) {
    return new EmbedBuilder()
      .setColor(COLOR_PURPLE)
      .setTitle("Volta por Cima")
      .setDescription("*Sem reviravoltas suficientes para destacar nesta temporada.*");
  }

  const description = [
    `**${comeback.displayName}** deu a maior virada da Season 1.`,
    "",
    `Caiu para **${comeback.fromMmr} MMR**, encerrou a temporada com **${comeback.toMmr} MMR**.`,
    `Recuperacao total: **+${comeback.delta} MMR** ao longo de ${comeback.matchesPlayed} partidas.`,
    "",
    "Provou que ranking nao termina antes da ultima partida.",
  ].join("\n");

  return new EmbedBuilder().setColor(COLOR_PURPLE).setTitle("Volta por Cima").setDescription(description);
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
    return `\`#${rankStr}\` **${entry.displayName}** • ${entry.mmr} MMR • ${entry.wins}V ${entry.losses}D (${wr}%)`;
  });

  return new EmbedBuilder()
    .setColor(COLOR_SLATE)
    .setTitle("Ranking final — Season 1")
    .setDescription(rows.length > 0 ? rows.join("\n") : "*Sem entradas no ranking.*")
    .setFooter({ text: `Pagina ${normalizedPage + 1}/${totalPages} • ${ranking.length} jogadores no total` });
};

export const buildMemorialClosingEmbed = (): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLOR_SLATE)
    .setDescription(
      [
        "**Season 1 encerrada.**",
        "",
        "Obrigado a cada jogador que entrou na fila, segurou um FILL, aguentou uma derrota dificil e voltou pra fila no dia seguinte.",
        "Cada partida acima ficou registrada. Cada MMR. Cada rival. Cada duo.",
        "",
        "A Season 2 comeca em breve. Todo mundo volta do zero — menos a historia.",
      ].join("\n"),
    );

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
