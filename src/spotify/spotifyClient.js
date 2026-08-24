const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET nao configurados no .env');
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao autenticar no Spotify: ${response.status} ${text}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  // Renova um pouco antes de expirar de verdade
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

  return cachedToken;
}

function mapTrack(item) {
  return {
    id: item.id,
    name: item.name,
    artists: item.artists.map((a) => a.name),
    album: item.album.name,
    albumArt: item.album.images?.[0]?.url || null,
    durationMs: item.duration_ms,
    spotifyUrl: item.external_urls?.spotify || null,
  };
}

// Apps do Spotify em modo de desenvolvimento (sem Extended Quota Mode aprovado)
// tem o parametro limit do endpoint de busca restrito a no maximo 10.
async function searchTracks(query, limit = 10) {
  const token = await getAccessToken();

  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('type', 'track');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao buscar no Spotify: ${response.status} ${text}`);
  }

  const data = await response.json();
  return (data.tracks?.items || []).map(mapTrack);
}

// Aceita link (open.spotify.com/playlist/ID), URI (spotify:playlist:ID) ou o
// ID puro.
function extractPlaylistId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9]{10,30}$/.test(trimmed)) return trimmed;
  return null;
}

// Roda promises em lotes, sem estourar o rate limit do Spotify.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const index = i++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Busca uma faixa avulsa (nome/artistas/capa/album). Usada pra completar os
// dados da pagina de embed, que nao tem capa por faixa.
async function getTrackById(trackId) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const item = await res.json();
  return mapTrack(item);
}

// A partir de novembro/2024 o Spotify passou a exigir login de usuario (nao
// so Client Credentials) pra ler o conteudo de qualquer playlist via API -
// mesmo publica (GET /playlists/{id}/tracks responde 403). Como alternativa,
// lemos a pagina de embed publica (open.spotify.com/embed/playlist/{id}),
// que e uma pagina normal, sem autenticacao, e ja tem a lista de faixas
// embutida no HTML pra tocar o preview. So falta a capa por faixa, que
// completamos com uma busca avulsa por faixa (endpoint que continua livre).
async function getPlaylist(playlistId) {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`);
  if (!res.ok) {
    throw new Error(`Falha ao carregar a playlist do Spotify: ${res.status}`);
  }
  const html = await res.text();

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Nao foi possivel ler os dados dessa playlist (ela pode ser privada ou ter sido removida)');
  }

  let entity;
  try {
    entity = JSON.parse(match[1]).props.pageProps.state.data.entity;
  } catch {
    throw new Error('Formato inesperado ao ler a playlist do Spotify');
  }

  const embedTracks = (entity.trackList || []).filter((t) => t.uri?.startsWith('spotify:track:'));

  const tracks = await mapWithConcurrency(embedTracks, 8, async (t) => {
    const id = t.uri.split(':')[2];
    const full = await getTrackById(id);
    if (full) return full;
    // Se a busca avulsa falhar (raro), usa so o que a pagina de embed tinha.
    return {
      id,
      name: t.title,
      artists: (t.subtitle || '').split(',').map((s) => s.trim()).filter(Boolean),
      album: null,
      albumArt: null,
      durationMs: t.duration,
      spotifyUrl: `https://open.spotify.com/track/${id}`,
    };
  });

  return { name: entity.name, tracks };
}

module.exports = { searchTracks, extractPlaylistId, getPlaylist };
