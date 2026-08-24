const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync(path.join(__dirname, '..', '..', 'data', 'playlists.json'));
const db = low(adapter);

db.defaults({ playlists: [] }).write();

const VALID_VISIBILITIES = ['private', 'server', 'public'];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// private: so o dono ve/toca. server: qualquer membro do servidor onde foi
// criada ve/toca. public: qualquer usuario logado, de qualquer servidor.
function canView(playlist, user) {
  if (playlist.visibility === 'public') return true;
  if (playlist.visibility === 'private') return playlist.ownerId === user.id;
  if (playlist.visibility === 'server') return user.guildIds.includes(playlist.guildId);
  return false;
}

function canEdit(playlist, user) {
  return playlist.ownerId === user.id;
}

function listPlaylists(user) {
  return db.get('playlists').value().filter((p) => canView(p, user));
}

function getPlaylist(id) {
  return db.get('playlists').find({ id }).value();
}

function createPlaylist({ name, visibility, guildId, ownerId, ownerName, tracks }) {
  const playlist = {
    id: genId(),
    name,
    visibility: VALID_VISIBILITIES.includes(visibility) ? visibility : 'private',
    guildId,
    ownerId,
    ownerName,
    tracks: Array.isArray(tracks) ? tracks : [],
    favoritedBy: [],
    createdAt: new Date().toISOString(),
  };
  db.get('playlists').push(playlist).write();
  return playlist;
}

// Favoritar uma playlist do servidor/publica de outra pessoa faz ela aparecer
// junto das playlists proprias do usuario (ver categorizePlaylistsForUser no
// front). Playlists antigas (de antes desse campo existir) nao tem
// favoritedBy - por isso o "|| []" ao ler em qualquer lugar.
function setFavorite(id, userId, favorited) {
  const playlist = getPlaylist(id);
  if (!playlist) return null;
  const current = new Set(playlist.favoritedBy || []);
  if (favorited) current.add(userId);
  else current.delete(userId);
  db.get('playlists').find({ id }).assign({ favoritedBy: [...current] }).write();
  return getPlaylist(id);
}

function renamePlaylist(id, name) {
  db.get('playlists').find({ id }).assign({ name }).write();
  return getPlaylist(id);
}

function deletePlaylist(id) {
  db.get('playlists').remove({ id }).write();
}

function addTrack(id, track) {
  db.get('playlists').find({ id }).get('tracks').push(track).write();
  return getPlaylist(id);
}

function removeTrack(id, index) {
  const playlist = getPlaylist(id);
  if (!playlist) return null;
  playlist.tracks.splice(index, 1);
  db.get('playlists').find({ id }).assign({ tracks: playlist.tracks }).write();
  return playlist;
}

module.exports = {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTrack,
  removeTrack,
  setFavorite,
  canView,
  canEdit,
};
