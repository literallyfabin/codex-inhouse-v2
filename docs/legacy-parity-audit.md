# Legacy Parity Audit

Analise feita contra `inhouse_bot-master` para guiar a migracao V2.

## Paridade implementada

- Rating TrueSkill por servidor e rota: `player_stats` agora usa `(guild_id, user_id, role)`.
- MMR conservador no mesmo formato do legado: `20 * (mu - 3 * sigma + 25)`.
- Historico de partidas com snapshots de `mu`, `sigma`, `mmr_before`, time e rota.
- Ranking por servidor, com filtro opcional por rota.
- Fila por rota com excedentes: o bot aceita mais de 2 jogadores por rota e escolhe 10 quando ha pelo menos 2 por rota.
- Duo queue via `/queue`, mantendo a dupla no mesmo time no balanceador.
- Resultado por usuario via `/won` e `/cancel`, com validacao por 6 jogadores da partida.
- Admin direto para win, cancel, reset, config e canais marcados.
- Champion tracking basico por nome.

## Diferencas importantes encontradas no legado

- O legado mantinha ratings por `server_id`; rating global misturaria MMR de servidores diferentes.
- O legado aceitava excedentes por rota e nao bloqueava o terceiro jogador.
- O legado puxava duos para o candidato de partida e rejeitava composicoes que separassem a dupla.
- O legado tinha ready-check antes de gravar a partida, e bloqueava o jogador de entrar em outra fila enquanto o ready-check estava aberto.
- O legado impedia queue se o ultimo jogo do jogador ainda estava sem resultado.
- O legado tinha canais marcados de fila/ranking com mensagens reescritas automaticamente.
- O legado tinha criacao/remocao opcional de canais de voz para Blue/Red.
- O legado resetava filas diariamente quando `queue_reset` estava ligado.

## Ainda nao migrado completamente

- Ready-check pre-match persistido em `ready_checks` e botoes de aceitar/cancelar antes de criar a partida.
- Persistencia real da fila em `queue_entries`; hoje a fila operacional ainda vive em memoria.
- Auto-refresh dos canais marcados como `QUEUE` e `RANKING`.
- Criacao e remocao de canais de voz quando `voice` estiver `ON`.
- Scheduler de reset diario quando `queue_reset` estiver `ON`.
- Validacao de campeao contra lista oficial/emoji; hoje salva texto livre.
- Recalculo historico completo caso uma partida antiga seja corrigida.
- Gateway WhatsApp.

## Supabase

Migration aplicada:

- `codex_inhouse_v2_initial_schema`
- `codex_inhouse_v2_legacy_parity_schema`

Tabelas/colunas novas da paridade:

- `guild_settings`
- `discord_channels`
- `queue_entries`
- `ready_checks`
- `player_stats.guild_id`
- `player_stats.mmr`
- `matches.guild_id`
- `matches.source_channel_id`
- `match_participants.champion_name`
- `match_participants.mmr_before`
