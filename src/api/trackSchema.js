const { badRequest } = require('../httpError');

// Normaliza uma faixa vinda do cliente.
//
// Antes, o objeto de "track" do corpo da requisicao ia direto pra fila do
// player e pro banco de playlists, do jeito que chegasse. Dois problemas:
//
// 1. Qualquer JSON era aceito e gravado - dava pra encher o playlists.json
//    de lixo (ou de campos gigantes) sem nenhum limite.
// 2. _youtube.videoUrl e repassado pro yt-dlp. Nao da pra injetar comando
//    (o yt-dlp-exec passa argumentos como array, nao via shell), mas uma URL
//    arbitraria faria o yt-dlp sair buscando qualquer endereco - por isso
//    aqui so passa link do proprio YouTube.
//
// A ideia e montar um objeto NOVO campo a campo (lista de permissao), em vez
// de tentar remover o que e ruim: assim nada inesperado passa por descuido.

const MAX_TEXT = 300;
const MAX_ARTISTS = 20;
const MAX_URL = 2000;

function text(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function httpUrl(value) {
  const raw = text(value, MAX_URL);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

function youtubeUrl(value) {
  const raw = httpUrl(value);
  if (!raw) return null;
  try {
    return YOUTUBE_HOSTS.has(new URL(raw).hostname) ? raw : null;
  } catch {
    return null;
  }
}

// _youtube guarda o video ja resolvido, pra o player nao ter que buscar de
// novo na hora de tocar. So e aproveitado se a URL for mesmo do YouTube;
// caso contrario vira null e o player resolve normalmente (nada quebra).
function sanitizeYoutubeHint(value) {
  if (!value || typeof value !== 'object') return null;
  const videoUrl = youtubeUrl(value.videoUrl);
  if (!videoUrl) return null;
  return {
    videoUrl,
    title: text(value.title) || '',
    durationSec: Number.isFinite(value.durationSec) ? value.durationSec : null,
  };
}

function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('track invalida');
  }
  const name = text(raw.name);
  if (!name) throw badRequest('track precisa de um nome');

  const artists = Array.isArray(raw.artists)
    ? raw.artists
        .map((a) => text(a))
        .filter(Boolean)
        .slice(0, MAX_ARTISTS)
    : [];

  return {
    id: text(raw.id, 200),
    name,
    artists,
    album: text(raw.album),
    albumArt: httpUrl(raw.albumArt),
    durationMs: Number.isFinite(raw.durationMs) && raw.durationMs >= 0 ? raw.durationMs : null,
    spotifyUrl: httpUrl(raw.spotifyUrl),
    _youtube: sanitizeYoutubeHint(raw._youtube),
  };
}

module.exports = { sanitizeTrack };
