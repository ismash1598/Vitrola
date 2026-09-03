const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const AsyncFileAdapter = require('../db/asyncFileAdapter');

// Log de reproducoes por usuario/servidor, com data - alimenta a
// retrospectiva mensal ("Capsula do tempo", nos dois modos: do servidor
// inteiro, ou so as suas proprias).
//
// Diferente de history.js (que so guarda as ultimas 10 faixas, sem
// contagem/data, so pra tela inicial): aqui cada play vira um registro
// PROPRIO, com timestamp - sem isso nao da pra saber quantas vezes uma
// faixa tocou num mes especifico, so a ordem de recencia.
//
// Guarda o snapshot da faixa e do usuario (nome/artistas/capa/username) em
// vez de so os ids: assim uma retrospectiva de meses atras continua
// legivel mesmo se a faixa tiver sumido de qualquer fila/playlist, ou o
// apelido do usuario no Discord tiver mudado desde entao.
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const adapter = new AsyncFileAdapter(path.join(dataDir, 'listeningLog.json'), {
  defaultValue: { plays: [] },
});
const db = low(adapter);
db.defaults({ plays: [] }).write();

// requesterId/requesterUsername: quem ADICIONOU a faixa (pode ser null -
// autoplay, ou quem pediu ja tinha saido da call quando ela comecou a
// tocar) - alimenta so o ranking de "quem mais pediu"/"sua posicao".
//
// listeners: todo mundo que estava na call no instante em que a faixa
// comecou (array de { id, username }) - alimenta o historico PESSOAL de
// cada um: contou como ouvida pra quem estava la, pedida ou nao.
function recordPlay({ guildId, track, requesterId, requesterUsername, listeners }) {
  const plays = db.get('plays').value();
  plays.push({
    guildId,
    trackId: track.id,
    name: track.name,
    artists: track.artists || [],
    albumArt: track.albumArt || null,
    durationMs: track.durationMs || 0,
    playedAt: new Date().toISOString(),
    requesterId: requesterId || null,
    requesterUsername: requesterUsername || null,
    listeners: listeners || [],
  });
  db.write();
}

// Quem "ouviu" uma reproducao - todo mundo que estava presente. Registros
// antigos (de antes dessa mudanca) so tinham um userId/username unico (era
// tratado como "quem pediu" E "quem ouviu" ao mesmo tempo) - continuam
// contando como se essa pessoa tivesse ouvido, pra nao perder historico
// que ja existia.
function getListenerIds(play) {
  if (Array.isArray(play.listeners) && play.listeners.length) {
    return play.listeners.map((l) => l.id);
  }
  return play.userId ? [play.userId] : [];
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

// Meses (mais recente primeiro) em que o servidor tem pelo menos uma
// reproducao registrada - usado pra montar a lista de capsulas disponiveis.
// Guild-wide (nao por usuario): a capsula "do servidor" tem que aparecer
// pra qualquer membro, nao so pra quem tocou musica.
function listAvailableMonths(guildId) {
  const months = new Set();
  db.get('plays')
    .value()
    .forEach((p) => {
      if (p.guildId === guildId) months.add(monthKey(new Date(p.playedAt)));
    });
  return [...months].sort().reverse();
}

// "sem 1".."sem 4" dentro do mes - a ultima semana absorve os dias
// excedentes de meses com mais de 28 dias, pra sempre caber em 4 barras
// (mesmo formato do template visual).
function weekIndexInMonth(date) {
  return Math.min(Math.floor((date.getDate() - 1) / 7), 3);
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Ranking de quem mais pediu musica num servidor, no periodo - base tanto
// do card "Quem mais pediu" (modo servidor) quanto "Sua posicao no
// servidor" (modo pessoal), que por isso e sempre calculado no servidor
// INTEIRO, independente do modo escolhido na tela.
function buildRequesterRanking(guildPlays) {
  const byUser = new Map(); // userId -> { userId, username, count }
  for (const p of guildPlays) {
    // "?? p.userId": compatibilidade com registros gravados antes dessa
    // mudanca, que so tinham userId/username (era tratado como quem pediu).
    const requesterId = p.requesterId ?? p.userId;
    if (!requesterId) continue;
    const requesterUsername = p.requesterUsername ?? p.username;
    const entry = byUser.get(requesterId) || { userId: requesterId, username: requesterUsername || 'Alguém', count: 0 };
    entry.count += 1;
    entry.username = requesterUsername || entry.username; // fica com o apelido mais recente visto
    byUser.set(requesterId, entry);
  }
  return [...byUser.values()].sort((a, b) => b.count - a.count);
}

// Monta o texto do card lateral - "Quem mais pediu" no modo servidor,
// "Sua posicao no servidor" no modo pessoal.
function buildSideCard(scope, requesters, userId) {
  if (scope === 'server') {
    if (!requesters.length) {
      return { title: 'Quem mais pediu', name: '—', meta: '', note: 'Ninguém pediu música ainda esse mês.' };
    }
    const [first, second, third] = requesters;
    const followers = [second, third].filter(Boolean).map((r) => `${r.username} (${r.count})`);
    return {
      title: 'Quem mais pediu',
      name: first.username,
      meta: `${first.count} pedido${first.count === 1 ? '' : 's'}`,
      note: followers.length ? `Seguido por ${followers.join(' e ')}.` : 'Ninguém mais chegou perto.',
    };
  }

  const totalGuildPlays = requesters.reduce((sum, r) => sum + r.count, 0);
  const myIndex = requesters.findIndex((r) => r.userId === userId);
  if (myIndex === -1) {
    return { title: 'Sua posição no servidor', name: '—', meta: '', note: 'Você ainda não pediu música esse mês.' };
  }
  const me = requesters[myIndex];
  const above = requesters[myIndex - 1];
  const below = requesters[myIndex + 1];
  let note;
  if (above && below) note = `Atrás de ${above.username}, à frente de ${below.username}.`;
  else if (above) note = `Atrás de ${above.username}.`;
  else if (below) note = `Na frente de todo mundo! Próximo é ${below.username}.`;
  else note = 'Só você pediu música esse mês.';

  return {
    title: 'Sua posição no servidor',
    name: `${myIndex + 1}º lugar`,
    meta: `${me.count} de ${totalGuildPlays} pedido${totalGuildPlays === 1 ? '' : 's'}`,
    note,
  };
}

// Agrega a retrospectiva de um servidor (scope 'server') ou de um usuario
// dentro dele (scope 'personal') num periodo [from, to). Sem periodo, usa
// o mes atual.
function getRetrospective({ guildId, scope, userId, from, to } = {}) {
  const range = from && to ? { from, to } : monthRange();
  const rangeFrom = from || range.from;
  const rangeTo = to || range.to;

  const allPlays = db.get('plays').value();
  const guildPlays = allPlays.filter((p) => p.guildId === guildId && inRange(p, rangeFrom, rangeTo));
  // "Pessoal" = tudo que tocou enquanto EU estava na call, pedido por mim
  // ou nao - nao so o que eu mesmo adicionei (ver getListenerIds).
  const scopedPlays = scope === 'personal' ? guildPlays.filter((p) => getListenerIds(p).includes(userId)) : guildPlays;

  const trackStats = new Map();
  const artistStats = new Map();
  const dayStats = new Map();
  const weekMinutes = [0, 0, 0, 0];
  let totalMs = 0;

  for (const p of scopedPlays) {
    const playedAt = new Date(p.playedAt);
    const minutes = (p.durationMs || 0) / 60000;
    totalMs += p.durationMs || 0;

    weekMinutes[weekIndexInMonth(playedAt)] += minutes;

    const dKey = dayKey(playedAt);
    dayStats.set(dKey, (dayStats.get(dKey) || 0) + minutes);

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

  // Nao temos foto de artista de verdade (Spotify so da isso por artista,
  // via chamada extra que nao fazemos hoje) - usa a capa da faixa MAIS
  // tocada desse artista como aproximacao, em vez de deixar sem imagem.
  const artistArt = new Map();
  for (const t of trackStats.values()) {
    for (const artist of t.artists || []) {
      const current = artistArt.get(artist);
      if (!current || t.count > current.count) {
        artistArt.set(artist, { albumArt: t.albumArt, count: t.count });
      }
    }
  }

  const topArtists = [...artistStats.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((a) => ({ ...a, albumArt: artistArt.get(a.name)?.albumArt || null }));
  const topTracks = [...trackStats.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const topDays = [...dayStats.entries()]
    .map(([date, minutes]) => ({ date, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3);

  const requesters = buildRequesterRanking(guildPlays);
  const side = buildSideCard(scope, requesters, userId);

  return {
    from: rangeFrom.toISOString(),
    to: rangeTo.toISOString(),
    scope,
    totalPlays: scopedPlays.length,
    totalMinutes: Math.round(totalMs / 60000),
    distinctArtists: artistStats.size,
    topArtists,
    topTracks,
    weeklyMinutes: weekMinutes.map((m, i) => ({ week: i + 1, minutes: Math.round(m) })),
    topDays,
    side,
  };
}

function inRange(play, from, to) {
  const playedAt = new Date(play.playedAt);
  return playedAt >= from && playedAt < to;
}

module.exports = { recordPlay, getRetrospective, listAvailableMonths, monthKey, monthRange, getListenerIds };
