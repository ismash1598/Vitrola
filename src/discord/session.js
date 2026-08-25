const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const low = require('lowdb');
const AsyncFileAdapter = require('../db/asyncFileAdapter');

// Sessoes persistem em disco (mesmo esquema das playlists) - antes ficavam
// so em memoria e todo restart do servidor derrubava o login de todo mundo.
// data/ nao vai pro git, entao num clone novo a pasta ainda nao existe.
const dataDir = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const adapter = new AsyncFileAdapter(path.join(dataDir, 'sessions.json'), {
  defaultValue: { sessions: {} },
});
const db = low(adapter);
db.defaults({ sessions: {} }).write();

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = db.get('sessions').value();
  sessions[token] = { user, expiresAt: Date.now() + SESSION_TTL_MS };
  db.write();
  return token;
}

function getSession(token) {
  const sessions = db.get('sessions').value();
  const session = sessions[token];
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    delete sessions[token];
    db.write();
    return null;
  }
  return session.user;
}

function deleteSession(token) {
  const sessions = db.get('sessions').value();
  delete sessions[token];
  db.write();
}

// A lista de servidores do usuario e capturada no login (OAuth) e ficava
// congelada pelos 90 dias da sessao - quem saisse de um servidor continuava
// vendo as playlists "do servidor" dele por todo esse tempo. Isso permite
// atualizar a lista depois (ver guildMembership.js).
//
// Atualiza TODAS as sessoes do mesmo usuario: ele pode estar logado no
// celular e no PC ao mesmo tempo, e deixar so uma delas correta seria pior
// que nao atualizar nenhuma (comportamento dependeria do dispositivo).
function updateUserGuilds(userId, guildIds) {
  const sessions = db.get('sessions').value();
  let changed = false;
  Object.values(sessions).forEach((entry) => {
    if (entry.user?.id === userId) {
      entry.user.guildIds = guildIds;
      changed = true;
    }
  });
  if (changed) db.write();
  return changed;
}

module.exports = { createSession, getSession, deleteSession, updateUserGuilds };
