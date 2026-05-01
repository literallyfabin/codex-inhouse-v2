# Codex Inhouse Matchmaking V2

Reescrita em Node.js + TypeScript do bot de inhouses, mantendo o legado Python
apenas como referencia de regras.

## Stack

- Node.js 20+
- TypeScript estrito
- Supabase/PostgreSQL
- discord.js v14
- ts-trueskill para rating
- Render Web Service para deploy

## Setup local

```bash
npm install
cp .env.example .env
npm run discord:commands
npm run dev
```

Antes de rodar o bot, aplique a migration SQL em `supabase/migrations`.

## Comandos Discord

- `/setup-inhouse`: cria a mensagem persistente com botoes de rota.
- `/setup-ranking`: define o canal oficial do ranking e cria o painel persistente.
- `/queue <rota> [duo] [rota_duo]`: entra na fila por slash command; duo fica no mesmo time.
- `/queue-status`: mostra o estado atual da fila no canal.
- `/leave-queue`: remove o usuario da fila do canal.
- `/won`: pede validacao de 6 jogadores para marcar vitoria do seu time.
- `/cancel`: pede validacao de 6 jogadores para cancelar a partida em andamento.
- `/stats [jogador]`: mostra rank, MMR e W/L por rota.
- `/ranking [rota]`: mostra ranking por MMR no servidor.
- `/history [jogador] [limite]`: mostra historico de partidas.
- `/champion <nome> [match_id]`: salva campeao usado na partida.
- `/admin-win <match_id> <team>`: fecha a partida e recalcula `mu/sigma`.
- `/admin-cancel <match_id>`: cancela uma partida ainda nao finalizada.
- `/admin-reset [jogador] [canal]`: remove jogador das filas em memoria ou reseta uma fila.
- `/admin-channel <acao>`: marca/desmarca canal como fila ou ranking.
- `/admin-config <chave> <opcao>`: altera `voice` ou `queue_reset`.
- `/link-account <nick> <tag>`: vincula Nick#Tag do LoL usando a Riot API configurada.

`/setup-inhouse` e `/setup-ranking` deixam o bot restrito aos canais oficiais
marcados para fila/ranking. Ao rodar um setup novo, canais antigos do mesmo tipo
sao desmarcados automaticamente.

Com chave de desenvolvimento da Riot, mantenha `RIOT_TOURNAMENT_CODES_ENABLED=false`.
Ative apenas quando a aplicacao tiver acesso oficial a codigos de torneio.

O core nao depende de Discord. O gateway apenas traduz interacoes para chamadas
em `QueueService`, `UserService`, `MatchService` e `MatchmakingService`.

Comandos de setup, admin e desenvolvimento so podem ser usados pelos Discord IDs
listados em `ADMIN_DISCORD_IDS` (separados por virgula).

Depois de adicionar ou alterar comandos, rode:

```bash
npm run discord:commands
```
