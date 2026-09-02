const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const AsyncFileAdapter = require('../db/asyncFileAdapter');

// Log de reproducoes por usuario, com data - alimenta a retrospectiva
// mensal ("mais ouvidas do mes", tipo Cápsula Sonora do Spotify).
//
// Diferente de history.js (que so guarda as ultimas 10 faixas, sem
// contagem nem data, so pra tela inicial): aqui cada play vira um registro
// PROPRIO, com timestamp - sem isso nao da pra saber quantas vezes uma
// faixa tocou num mes especifico, so a ordem de recencia.
//
// Guarda o snapshot da faixa (nome/artistas/capa) em vez de so o id: assim
// uma retrospectiva de meses atras continua legivel mesmo se a faixa tiver
// sumido da fila/playlist ha muito tempo.
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const adapter = new AsyncFileAdapter(path.join(dataDir, 'listeningLog.json'), {
  defaultValue: { plays: [] },
});
const db = low(adapter);
db.defaults({ plays: [] }).write();

function recordPlay(userId, track) {
  const plays = db.get('plays').value();
  plays.push({
    userId,
    trackId: track.id,
    name: track.name,
    artists: track.artists || [],
    albumArt: track.albumArt || null,
    durationMs: track.durationMs || 0,
    playedAt: new Date().toISOString(),
  });
  db.write();
}

// "YYYY-MM" no fuso do servidor - identifica um mes de forma ordenavel
// (string) sem precisar reformatar depois.
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Primeiro e ultimo instante (exclusivo) do mes de referencia, no fuso do
// servidor. Sem argumento, usa o mes atual.
function monthRange(reference = new Date()) {
  const from = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const to = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
  return { from, to };
}

// Meses (mais recente primeiro) em que o usuario tem pelo menos uma
// reproducao registrada - usado pra montar a lista de capsulas disponiveis.
function listAvailableMonths(userId) {
  const months = new Set();
  db.get('plays')
    .value()
    .forEach((p) => {
      if (p.userId === userId) months.add(monthKey(new Date(p.playedAt)));
    });
  return [...months].sort().reverse();
}

// Agrega as faixas/artistas mais tocados de um usuario num periodo
// [from, to). Sem periodo, usa o mes atual.
function getRetrospective(userId, { from, to } = {}) {
  const range = from && to ? { from, to } : monthRange();
  const rangeFrom = from || range.from;
  const rangeTo = to || range.to;

  const plays = db
    .get('plays')
    .value()
    .filter((p) => p.userId === userId)
    .filter((p) => {
      const playedAt = new Date(p.playedAt);
      return playedAt >= rangeFrom && playedAt < rangeTo;
    });

  const trackStats = new Map(); // trackId -> { id, name, artists, albumArt, count }
  const artistStats = new Map(); // nome do artista -> { name, count }
  let totalMs = 0;

  for (const p of plays) {
    totalMs += p.durationMs || 0;

    const t = trackStats.get(p.trackId) || {
      id: p.trackId,
      name: p.name,
      artists: p.artists,
      albumArt: p.albumArt,
      count: 0,
    };
    t.count += 1;
    trackStats.set(p.trackId, t);

    for (const artist of p.artists || []) {
      const a = artistStats.get(artist) || { name: artist, count: 0 };
      a.count += 1;
      artistStats.set(artist, a);
    }
  }

  const topTracks = [...trackStats.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  const topArtists = [...artistStats.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  return {
    from: rangeFrom.toISOString(),
    to: rangeTo.toISOString(),
    totalPlays: plays.length,
    totalMinutes: Math.round(totalMs / 60000),
    topTracks,
    topArtists,
  };
}

module.exports = { recordPlay, getRetrospective, listAvailableMonths, monthKey, monthRange };
