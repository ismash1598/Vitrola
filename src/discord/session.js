const crypto = require('crypto');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Sessoes persistem em disco (mesmo esquema das playlists) - antes ficavam
// so em memoria e todo restart do servidor derrubava o login de todo mundo.
const adapter = new FileSync(path.join(__dirname, '..', '..', 'data', 'sessions.json'));
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

module.exports = { createSession, getSession, deleteSession };
