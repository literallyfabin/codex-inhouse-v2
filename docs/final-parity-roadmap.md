# Final Parity Roadmap

Revisao feita comparando a V2 TypeScript com o legado `inhouse_bot-master`.

## Veredito

A V2 ja tem comandos, ranking, historico, stats, duo basico e MMR por servidor, mas ainda nao esta no comportamento final do bot legado.

O maior problema e o ciclo de partida: hoje a V2 cria a partida assim que a fila fecha. No legado, fechar fila apenas cria um candidato de partida. A partida real so entra no banco depois de um ready-check aceito pelos 10 jogadores.

## Lacunas obrigatorias

### 1. Ready-check antes da partida

Legado:

- `queue_cog.py::run_matchmaking_logic`
- `common_utils/validation_dialog.py::checkmark_validation`
- `game_queue/queue_handler.py::start_ready_check`
- `game_queue/queue_handler.py::validate_ready_check`
- `game_queue/queue_handler.py::cancel_ready_check`

Comportamento esperado:

- Quando a fila fecha, enviar mensagem de partida encontrada com os 10 jogadores.
- Botoes: aceitar e recusar.
- Exigir 10 aceitacoes para criar a partida.
- Enquanto o ready-check esta aberto, esses jogadores nao podem gerar outro candidato em outra fila.
- Se alguem recusar, remover quem recusou apenas da fila do canal atual, liberar os outros e tentar matchmaking de novo.
- Se der timeout, remover quem nao respondeu de todas as filas do servidor, liberar os demais e tentar matchmaking de novo.
- Se todos aceitarem, criar `matches` e `match_participants`.

Estado atual:

- `DiscordGateway.replyToQueueResult` chama `createMatchFromQueue` imediatamente.
- `ready_checks` existe no Supabase, mas nao e usado pelo runtime.
- Nao existe timeout de aceite.

Prioridade: bloqueante para versao final.

### 2. Fila persistente

Legado:

- `queue_player` no banco.
- Restart do bot mantem a fila.
- Ready-checks sao cancelados no restart, mas jogadores voltam para fila.

Estado atual:

- `QueueService` guarda fila em memoria.
- Tabela `queue_entries` existe, mas ainda nao e usada.
- Restart do bot perde a fila.

Comportamento esperado:

- Todo join/leave/reset deve escrever em `queue_entries`.
- Ao iniciar o bot, carregar filas ativas do Supabase.
- Ready-check deve gravar `ready_check_id` ou equivalente em `queue_entries`.

Prioridade: bloqueante para deploy serio.

### 3. Bloqueio de jogador em partida aberta

Legado:

- `queue_handler.add_player` chama `get_last_game`.
- Se o ultimo jogo nao tem vencedor, o jogador nao pode entrar na fila.

Estado atual:

- Jogador pode entrar na fila mesmo se ja tem partida `ONGOING`.

Comportamento esperado:

- Antes de entrar na fila, checar se o jogador tem `matches.status = ONGOING`.
- Se tiver, responder que a partida precisa ser finalizada com `/won`, `/cancel` ou admin.

Prioridade: bloqueante.

### 4. Duo com aceite do outro jogador

Legado:

- Ao usar duo, o parceiro precisa aceitar antes da dupla entrar na fila.

Estado atual:

- `/queue rota:X duo:@user rota_duo:Y` coloca os dois direto.

Comportamento esperado:

- Abrir uma validacao simples para o parceiro.
- Se aceitar, inserir os dois.
- Se recusar ou expirar, nao inserir a dupla.

Prioridade: alta.

### 5. Matchmaking com threshold de qualidade

Legado:

- Se melhor partida tiver score ruim (`matchmaking_score >= 0.2`), o bot nao inicia.
- Mensagem avisa que um lado teria winrate previsto muito alto.

Estado atual:

- A V2 cria partida sempre que existe composicao valida.

Comportamento esperado:

- Aplicar limite de qualidade antes do ready-check.
- Se nao passar, manter fila aguardando mais jogadores.

Prioridade: alta.

### 6. Remocao de jogadores de todas as filas ao criar partida

Legado:

- Ao validar ready-check, `validate_ready_check` remove os 10 de todas as filas.

Estado atual:

- `createMatchFromQueue` remove jogadores apenas do `queueId` atual.

Comportamento esperado:

- Ao partida ser aceita, remover os 10 jogadores de todas as filas do servidor.

Prioridade: alta.

### 7. Canais marcados de fila e ranking atualizados automaticamente

Legado:

- `queue_channel_handler` reescreve canal de fila.
- Apaga mensagens que nao sao relacionadas a fila.
- `ranking_channel_handler` purga e recria mensagens de ranking.
- Comandos de fila usam `queue_channel_only`, ou seja, so funcionam em canal marcado como fila.

Estado atual:

- `/admin-channel` salva canal, mas o bot nao usa isso para auto-refresh.
- Comandos como `/queue`, `/leave-queue`, `/won` e `/cancel` funcionam em qualquer canal.

Comportamento esperado:

- Depois de join/leave/reset/ready-check/match, atualizar todos os canais `QUEUE` do servidor.
- Depois de score/cancel, atualizar canais `RANKING`.
- Opcionalmente limpar mensagens nao relacionadas no canal de fila.
- Bloquear comandos operacionais fora de canal marcado como `QUEUE`, ou decidir conscientemente abandonar essa regra.

Prioridade: alta.

### 8. Startup, ready-check cleanup e reset diario

Legado:

- No `on_ready`, cancela todos os ready-checks e atualiza canais de fila/ranking.
- `daily_jobs` reseta filas diariamente em `QUEUE_RESET_TIME` se `queue_reset` estiver ligado.

Estado atual:

- Nao ha rotina de startup para recarregar filas/cancelar ready-checks.
- `queue_reset` existe como config, mas nao executa nada.

Comportamento esperado:

- Ao iniciar, carregar `queue_entries` e cancelar/liberar ready-checks pendentes.
- Atualizar canais marcados de fila/ranking.
- Criar scheduler para reset diario quando `queue_reset` estiver `ON`.

Prioridade: alta.

### 9. Voice channels

Legado:

- Se `voice` esta ligado, cria canal publico e canais Blue/Red privados.
- Ao score/cancel, remove canais.

Estado atual:

- `/admin-config voice` existe, mas nao cria/remover canais.

Comportamento esperado:

- Criar canais apos partida aceita.
- Remover canais ao finalizar/cancelar.

Prioridade: media.

### 10. Cancelamento de partida pelo usuario com prioridade na proxima fila

Legado:

- Quando partida e cancelada, jogadores entram num mapa temporario.
- Se voltarem a fila em ate 1 hora, recebem `jump_ahead`.

Estado atual:

- `/cancel` cancela com validacao, mas nao marca prioridade temporaria.

Comportamento esperado:

- Guardar `cancelled_game_boost_until` por jogador, em memoria ou banco.
- Ao reentrar na fila, preservar prioridade.

Prioridade: media.

### 11. Champion validation e MMR history graph

Legado:

- `champion` valida nome via `lol_id_tools`.
- `mmr_history` gera grafico dos ultimos 30 dias.

Estado atual:

- `champion` salva texto livre.
- Nao existe grafico de MMR.

Comportamento esperado:

- Validar campeoes contra fonte fixa/API.
- Adicionar comando de historico grafico ou tabela evolutiva.

Prioridade: baixa/media.

## Ordem de implementacao recomendada

1. Implementar `ReadyCheckService` e alterar `replyToQueueResult` para abrir ready-check em vez de criar match direto.
2. Persistir fila em `queue_entries` e carregar filas no start do bot.
3. Bloquear jogador com partida `ONGOING` antes de entrar na fila.
4. Implementar aceite de duo.
5. Implementar refresh automatico dos canais marcados e restricao de canal de fila.
6. Implementar startup cleanup e reset diario.
7. Implementar voice channels.
8. Melhorar champion validation e historico de MMR.

## Arquivos V2 que devem mudar no proximo pacote

- `src/core/queue/QueueService.ts`
- `src/services/matchService.ts`
- `src/services/userService.ts`
- `src/services/guildService.ts`
- `src/gateways/discord/DiscordGateway.ts`
- `src/gateways/discord/components.ts`
- `src/core/models/database.ts`
- `tests/queue.test.ts`
- `tests/matchmaking.test.ts`
- novos testes para ready-check
