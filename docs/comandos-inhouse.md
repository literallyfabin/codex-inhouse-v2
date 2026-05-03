# Comandos do Inhouse Bot

Este documento descreve todos os comandos disponiveis no bot de Inhouse, organizados por categoria.

## Comandos de Jogador

Estes comandos sao utilizados pelos jogadores para interagir com a fila e ver estatisticas.

### Fila e Partida
- **/queue [rota] [duo] [rota_duo]**: Entra na fila para a rota especificada. Opcionalmente, voce pode convidar um duo informando o jogador e a rota dele.
- **/leave-queue**: Remove voce da fila de inhouse no canal atual.
- **/queue-status**: Exibe o estado atual da fila, mostrando quem esta em cada slot e quem esta aguardando vaga.
- **/won [match_id] [vencedor]**: Abre uma votacao para validar o resultado de uma partida. Deve ser usado por um dos participantes da partida.

### Estatisticas e Perfil
- **/stats [jogador]**: Mostra o ranking, MMR, e historico de vitorias/derrotas por rota do jogador. Se omitido, mostra as suas estatisticas.
- **/rank [jogador]**: Atalho para o comando de estatisticas.
- **/ranking [rota]**: Exibe o quadro de lideres do servidor, podendo ser filtrado por uma rota especifica.
- **/history [jogador]**: Mostra o historico das ultimas partidas finalizadas.
- **/ultima-partida**: Exibe os detalhes da ultima partida finalizada no servidor.
- **/mmr-history [jogador]**: Gera um grafico com a evolucao do seu MMR nas ultimas partidas.
- **/synergy [jogador]**: Encontra o parceiro com quem voce tem a melhor taxa de vitoria (minimo de 3 partidas juntos).
- **/nemesis [jogador]**: Encontra o adversario que mais te derrotou em partidas de inhouse (minimo de 3 partidas contra).

## Comandos de Administracao

Estes comandos sao restritos a usuarios com permissao de administrador no servidor.

### Configuracao do Servidor
- **/setup-inhouse**: Define o canal atual como o canal oficial para a fila de inhouse.
- **/setup-ranking**: Define o canal atual como o canal oficial para exibicao do ranking.
- **/admin-channel [acao]**: Marca ou desmarca o canal atual para funcoes do bot (QUEUE, RANKING).
- **/admin-config [chave] [opcao]**: Configura recursos opcionais como criacao automatica de canais de voz.

### Gestao de Partidas e Jogadores
- **/admin-win [match_id] [time]**: Forca o registro de vitoria para um time especifico em uma partida.
- **/admin-cancel [match_id]**: Cancela uma partida em andamento pelo ID dela.
- **/admin-win-user [jogador]**: Registra vitoria na ultima partida em andamento de um jogador especifico.
- **/admin-cancel-user [jogador]**: Cancela a ultima partida em andamento de um jogador especifico.
- **/admin-reset [jogador] [canal]**: Reseta a fila de um canal ou remove um jogador de todas as filas ativas.

## Funcionamento da Fila

A fila de inhouse funciona com o preenchimento de slots para cada uma das 5 rotas (TOP, JGL, MID, ADC, SUP).

1. Quando a fila atinge o numero necessario de jogadores, o bot inicia um **Ready Check**.
2. Todos os jogadores devem clicar em "Confirmar" dentro do tempo limite.
3. Apos a confirmacao, o bot equilibra os times com base no MMR e cria a partida, informando os times.
4. Ao final da partida, utilize o comando **/won** para iniciar o processo de validacao do resultado.
5. Apos a validacao pela maioria dos participantes, o MMR e atualizado automaticamente.
