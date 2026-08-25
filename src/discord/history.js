const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const AsyncFileAdapter = require('../db/asyncFileAdapter');

// Historico de faixas por usuario - alimenta o "Recomendado para voce" da
// tela inicial.
//
// Isso ficava so em memoria, entao sumia a cada restart do servidor (que na
// pratica acontece toda vez que o tunel cai e o processo e reiniciado),
// enquanto as playlists continuavam ali. Agora persiste em disco, igual
// playlists e sessoes, usando o mesmo adapter assincrono.
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const adapter = new AsyncFileAdapter(path.join(dataDir, 'history.json'), {
  defaultValue: { history: {} },
});
const db = low(adapter);
db.defaults({ history: {} }).write();

const HISTORY_LIMIT = 10;

function recordHistory(userId, track) {
  const todos = db.get('history').value();
  const lista = todos[userId] || [];
  // Se a faixa ja estava no historico, sobe pro topo em vez de duplicar.
  const semDuplicata = lista.filter((t) => t.id !== track.id);
  semDuplicata.unshift(track);
  todos[userId] = semDuplicata.slice(0, HISTORY_LIMIT);
  db.write();
}

function getHistory(userId) {
  return db.get('history').value()[userId] || [];
}

module.exports = { recordHistory, getHistory };
