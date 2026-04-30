# Codex Inhouse Matchmaking V2

Reescrita em Node.js + TypeScript do bot de inhouses, mantendo o legado Python
apenas como referencia de regras.

## Stack

- Node.js 20+
- TypeScript estrito
- Supabase/PostgreSQL
- discord.js v14
- ts-trueskill para rating
- Render worker para deploy

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

O core nao depende de Discord. O gateway apenas traduz interacoes para chamadas
em `QueueService`, `UserService`, `MatchService` e `MatchmakingService`.

Depois de adicionar ou alterar comandos, rode:

```bash
npm run discord:commands
```
