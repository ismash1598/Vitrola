// Historico de faixas adicionadas por usuario, em memoria (reseta se o
// servidor reiniciar - suficiente pra preencher a tela inicial, sem precisar
// de banco de dados para isso).
const HISTORY_LIMIT = 10;
const historyByUser = new Map();

function recordHistory(userId, track) {
  const list = historyByUser.get(userId) || [];
  const withoutDuplicate = list.filter((t) => t.id !== track.id);
  withoutDuplicate.unshift(track);
  if (withoutDuplicate.length > HISTORY_LIMIT) {
    withoutDuplicate.length = HISTORY_LIMIT;
  }
  historyByUser.set(userId, withoutDuplicate);
}

function getHistory(userId) {
  return historyByUser.get(userId) || [];
}

module.exports = { recordHistory, getHistory };
