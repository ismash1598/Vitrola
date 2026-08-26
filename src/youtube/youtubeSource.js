const ytdlp = require('yt-dlp-exec');

// Escolhe o melhor formato so-audio dentre os que o yt-dlp lista, com o
// mesmo criterio que 'bestaudio' usaria (maior bitrate). Confirmado na
// pratica que o resultado e equivalente ao de uma segunda chamada dedicada
// (mesmo format_id, url igualmente valida) - so custa mais uma resolucao
// desnecessaria pro yt-dlp, que sobe um processo Python inteiro por vez.
function pickBestAudioUrl(info) {
  const audios = (info.formats || []).filter(
    (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url
  );
  if (!audios.length) return null;
  return audios.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0].url;
}

// Busca no YouTube o video que melhor corresponde a faixa do Spotify
// (nome da musica + artistas). Usa yt-dlp (binario mantido ativamente e
// atualizado com frequencia) em vez de bibliotecas JS como ytdl-core/play-dl,
// que quebram com regularidade contra as protecoes anti-bot do YouTube.
async function findAudioForTrack(track) {
  const query = `${track.name} ${track.artists.join(' ')}`;

  // Sem skipDownload: precisamos da lista de formats (com url) que vem
  // junto do dumpJson - e assim que evitamos a segunda chamada de resolucao.
  const info = await ytdlp(`ytsearch1:${query}`, {
    dumpJson: true,
    noWarnings: true,
  });

  if (!info || !info.webpage_url) {
    throw new Error(`Nenhum video encontrado no YouTube para "${query}"`);
  }

  return {
    videoUrl: info.webpage_url,
    title: info.title,
    durationSec: info.duration,
    _resolvedAudioUrl: pickBestAudioUrl(info),
  };
}

// Resolve a URL direta (audio-only) para uso com ffmpeg. So chamada quando
// _youtube veio de outro lugar que nao a busca acima (ex: hint explicito do
// cliente) e ainda nao tem uma url resolvida. Expira depois de algumas
// horas, entao so e chamada sob demanda, na hora de tocar.
async function resolveDirectAudioUrl(videoUrl) {
  const url = await ytdlp(videoUrl, {
    format: 'bestaudio',
    getUrl: true,
    noWarnings: true,
  });

  if (!url) {
    throw new Error(`Nenhuma URL de audio encontrada para ${videoUrl}`);
  }

  return url.trim();
}

// Garante que a faixa tenha _youtube e _audioUrl resolvidos, evitando a
// segunda chamada ao yt-dlp sempre que a busca ja trouxe a url pronta.
// Usado nos 3 lugares que precisavam resolver audio (tocar, pre-buscar
// proxima faixa, pre-buscar autoplay) - antes cada um repetia o mesmo
// par de ifs.
async function resolveTrackAudio(track) {
  if (!track._youtube) {
    track._youtube = await findAudioForTrack(track);
  }
  if (!track._audioUrl) {
    track._audioUrl = track._youtube._resolvedAudioUrl || (await resolveDirectAudioUrl(track._youtube.videoUrl));
  }
  return track;
}

function extractVideoId(url) {
  const match = /[?&]v=([^&]+)/.exec(url) || /youtu\.be\/([^?&]+)/.exec(url);
  return match ? match[1] : null;
}

// Titulos do YouTube costumam vir como "Artista - Musica (Official Video)".
// Faixas vindas do autoplay usam esse titulo bruto como nome inteiro (sem
// artista separado), o que aparecia concatenado e cortado na barra do
// player - aqui limpa o ruido comum e separa artista/musica em duas linhas,
// igual as faixas que vem do Spotify.
function parseYoutubeTitle(rawTitle) {
  const cleaned = rawTitle
    .replace(/[([][^()[\]]*(official|oficial|lyric|letra|áudio|audio|vídeo|video|hq|hd|4k|clipe|ao vivo|live)[^()[\]]*[)\]]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const match = cleaned.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (match) {
    return { name: match[2].trim(), artists: [match[1].trim()] };
  }
  return { name: cleaned, artists: [] };
}

// Busca a playlist "Mix"/Radio que o proprio YouTube gera automaticamente
// para um video (a mesma usada pelo autoplay do YouTube). E a forma mais
// confiavel de achar "musicas parecidas", ja que endpoints de recomendacao
// do Spotify sao restritos para apps novos (mesma limitacao do parametro
// limit na busca).
async function getMixQueue(videoId, limit = 10) {
  const result = await ytdlp.exec(
    `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`,
    {
      flatPlaylist: true,
      dumpJson: true,
      noWarnings: true,
      playlistEnd: limit + 1,
    }
  );

  const lines = result.stdout.trim().split('\n').filter(Boolean);

  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.id && entry.id !== videoId)
    .map((entry) => ({
      videoUrl: `https://www.youtube.com/watch?v=${entry.id}`,
      title: entry.title,
      durationSec: entry.duration,
    }));
}

// Aceita link do YouTube ou do YouTube Music (mesma URL base, mesmo
// parametro "list="), URI curta, ou o ID puro da playlist.
function extractYoutubePlaylistId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{10,50}$/.test(trimmed)) return trimmed;
  return null;
}

// Playlists do YouTube Music usam a mesma infraestrutura/IDs de playlist do
// YouTube "normal" - o yt-dlp le as duas do mesmo jeito, sem precisar de
// tratamento especial pro dominio music.youtube.com.
async function getYoutubePlaylist(playlistId, limit = 200) {
  const result = await ytdlp.exec(
    `https://www.youtube.com/playlist?list=${playlistId}`,
    {
      flatPlaylist: true,
      dumpJson: true,
      noWarnings: true,
      playlistEnd: limit,
    }
  );

  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const entries = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.id);

  if (!entries.length) {
    throw new Error('Essa playlist do YouTube/YouTube Music esta vazia, e privada, ou nao existe');
  }

  const tracks = entries.map((entry) => {
    const { name, artists } = parseYoutubeTitle(entry.title || '');
    return {
      id: `yt:${entry.id}`,
      name,
      artists,
      album: null,
      albumArt: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
      durationMs: entry.duration ? Math.round(entry.duration * 1000) : null,
      spotifyUrl: null,
      // Ja guarda o video resolvido - o player pula a busca no YouTube na
      // hora de tocar (ver guildPlayers.js: so busca se nao tiver _youtube).
      _youtube: {
        videoUrl: `https://www.youtube.com/watch?v=${entry.id}`,
        title: entry.title || name,
        durationSec: entry.duration || null,
      },
    };
  });

  return { name: entries[0].playlist_title || entries[0].playlist || 'Playlist do YouTube', tracks };
}

module.exports = {
  findAudioForTrack,
  resolveDirectAudioUrl,
  resolveTrackAudio,
  getMixQueue,
  extractVideoId,
  parseYoutubeTitle,
  extractYoutubePlaylistId,
  getYoutubePlaylist,
};
