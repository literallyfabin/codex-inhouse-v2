import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.RIOT_API_KEY;

async function fetchMatchHistory() {
  try {
    const gameName = "princesa saueka";
    const tagLine = "00000";

    // 1. Get PUUID
    console.log(`Buscando PUUID para ${gameName}#${tagLine}...`);
    const accountUrl = `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const accountRes = await fetch(accountUrl, {
      headers: { "X-Riot-Token": API_KEY }
    });
    
    if (!accountRes.ok) {
      console.error(`Erro ao buscar conta: ${accountRes.status} ${accountRes.statusText}`);
      const text = await accountRes.text();
      console.error(text);
      return;
    }
    const accountData = await accountRes.json();
    const puuid = accountData.puuid;
    console.log(`PUUID encontrado: ${puuid}`);

    // 2. Get Match History
    console.log(`\nBuscando as ultimas 5 partidas...`);
    // Note: To get custom games we might just fetch the recent matches and filter, 
    // or specify queue type if applicable. Let's get the last 5 of any type first.
    const matchesUrl = `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=20&type=tourney`;
    const matchesRes = await fetch(matchesUrl, {
      headers: { "X-Riot-Token": API_KEY }
    });

    if (!matchesRes.ok) {
      console.error(`Erro ao buscar histórico: ${matchesRes.status} ${matchesRes.statusText}`);
      return;
    }
    const matchIds = await matchesRes.json();
    console.log(`Partidas encontradas:`, matchIds);

    // 3. Get Match Details
    for (const matchId of matchIds) {
      console.log(`\nAnalisando partida ${matchId}...`);
      const matchUrl = `https://americas.api.riotgames.com/lol/match/v5/matches/${matchId}`;
      const matchRes = await fetch(matchUrl, {
        headers: { "X-Riot-Token": API_KEY }
      });
      
      if (!matchRes.ok) {
        console.error(`Erro na partida ${matchId}: ${matchRes.status}`);
        continue;
      }
      
      const matchData = await matchRes.json();
      const info = matchData.info;
      console.log(`Modo: ${info.gameMode}, Tipo: ${info.gameType}, QueueID: ${info.queueId}`);
      console.log(`Torneio Code: ${info.tournamentCode || 'Nenhum'}`);
      
      const participant = info.participants.find(p => p.puuid === puuid);
      if (participant) {
        console.log(`Campeao jogado: ${participant.championName}, KDA: ${participant.kills}/${participant.deaths}/${participant.assists}, Ganhou: ${participant.win}`);
      }
    }
  } catch (error) {
    console.error("Erro no script:", error);
  }
}

fetchMatchHistory();
