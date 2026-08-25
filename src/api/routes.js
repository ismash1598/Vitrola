const express = require('express');
const spotify = require('../spotify/spotifyClient');
const youtube = require('../youtube/youtubeSource');
const { getPlayer } = require('../discord/guildPlayers');
const {
  listMutualGuilds,
  isMutualGuild,
  ensureVoiceForUser,
  requireSameVoiceChannel,
  isGuildAdmin,
} = require('../discord/guilds');
const bot = require('../discord/bot');
const playlists = require('../db/playlists');
const history = require('../discord/history');
const session = require('../discord/session');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireGuildId(req, res) {
  const guildId = req.body?.guildId || req.query?.guildId;
  if (!guildId) {
    res.status(400).json({ error: 'guildId e obrigatorio' });
    return null;
  }
  if (!isMutualGuild(bot.client, req.user.guildIds, guildId)) {
    res.status(403).json({ error: 'Voce nao esta nesse servidor, ou o bot nao esta' });
    return null;
  }
  return guildId;
}

// ---- Sessao ----
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

router.post('/logout', requireAuth, (req, res) => {
  session.deleteSession(req.header('x-session-token'));
  res.status(204).end();
});

// ---- Servidores em comum (bot + usuario) ----
router.get('/guilds', requireAuth, (req, res) => {
  res.json(listMutualGuilds(bot.client, req.user.guildIds));
});

// ---- Historico (preenche a tela inicial) ----
router.get('/history', requireAuth, (req, res) => {
  res.json(history.getHistory(req.user.id));
});

// ---- Estatisticas publicas (pra landing page, antes do login) ----
router.get('/public-stats', (req, res) => {
  res.json({ guildCount: bot.client.guilds?.cache.size ?? 0 });
});

// ---- Busca (publica, nao precisa de login) ----
router.get(
  '/search',
  asyncRoute(async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'parametro q e obrigatorio' });
    const tracks = await spotify.searchTracks(q);
    res.json(tracks);
  })
);

router.use(requireAuth);

// ---- Status ----
// fullQueue=1 so quando o cliente realmente precisa da fila inteira (aba
// Fila aberta, painel "a seguir" expandido). O polling normal recebe so uma
// previa - ver comentario em getStatus.
router.get('/status', (req, res) => {
  const guildId = requireGuildId(req, res);
  if (!guildId) return;
  res.json(getPlayer(guildId).getStatus({ fullQueue: req.query.fullQueue === '1' }));
});

// ---- Fila ----
router.post(
  '/queue',
  asyncRoute(async (req, res) => {
    const guildId = requireGuildId(req, res);
    if (!guildId) return;
    const { track, playNext } = req.body;
    if (!track) return res.status(400).json({ error: 'track e obrigatorio' });

    // Nunca interrompe o que esta tocando: so entra na fila (na frente, se
    // playNext) e comeca a tocar sozinha se nao havia nada rodando.
    const player = await ensureVoiceForUser(bot.client, guildId, req.user.id);
    player.enqueue(track, Boolean(playNext), req.user.id);
    history.recordHistory(req.user.id, track);
    res.json(player.getStatus());
  })
);

router.delete(
  '/queue/:index',
  asyncRoute(async (req, res) => {
    const guildId = requireGuildId(req, res);
    if (!guildId) return;
    const player = getPlayer(guildId);
    requireSameVoiceChannel(bot.client, guildId, req.user.id, player);
    const ok = player.removeFromQueue(Number(req.params.index));
    if (!ok) return res.status(404).json({ error: 'indice invalido' });
    res.json(player.getStatus());
  })
);

router.delete(
  '/queue',
  asyncRoute(async (req, res) => {
    const guildId = requireGuildId(req, res);
    if (!guildId) return;
    const player = getPlayer(guildId);
    requireSameVoiceChannel(bot.client, guildId, req.user.id, player);
    player.clearQueue();
    res.json(player.getStatus());
  })
);

router.post(
  '/queue/reorder',
  asyncRoute(async (req, res) => {
    const guildId = requireGuildId(req, res);
    if (!guildId) return;
    const player = getPlayer(guildId);
    requireSameVoiceChannel(bot.client, guildId, req.user.id, player);
    const { from, to } = req.body;
    const ok = player.reorderQueue(Number(from), Number(to));
    if (!ok) return res.status(400).json({ error: 'from/to invalidos' });
    res.json(player.getStatus());
  })
);

// ---- Controles de reproducao ----
router.post('/pause', (req, res) => {
  const guildId = requireGuildId(req, res);
  if (!guildId) return;
  const player = getPlayer(guildId);
  player.pause();
  res.json(player.getStatus());
});

router.post('/resume', (req, res) => {
  const guildId = requireGuildId(req, res);
  if (!guildId) return;
  const player = getPlayer(guildId);
  player.resume();
  res.json(player.getStatus());
});

router.post(
  '/skip',
  asyncRoute(async (req, res) => {
    const guildId = requireGuildId(req, res);
    if (!guildId) return;
    const player = getPlayer(guildId);
    const status = player.getStatus();
    if (!status.current) return res.status(400).json({ error: 'nada tocando' });

    const addedBy = status.current.track.addedBy;
    if (addedBy && addedBy !== req.user.id) {
      const admin = await isGuildAdmin(bot.client, guildId, req.user.id);
      if (!admin) {
        return res.status(403).json({ error: 'Só quem colocou essa música ou um administrador pode pular.' });
      }
    }

    player.skip();
    res.json(player.getStatus());
  })
);

router.post(
  '/seek',
  asyncRoute(async (req, res) => {
    const guildId = requireGuildId(req, res);
    if (!guildId) return;
    const { seconds } = req.body;
    if (typeof seconds !== 'number') return res.status(400).json({ error: 'seconds e obrigatorio' });
    const player = getPlayer(guildId);
    await player.seek(seconds);
    res.json(player.getStatus());
  })
);

router.post('/volume', (req, res) => {
  const guildId = requireGuildId(req, res);
  if (!guildId) return;
  const { volume } = req.body;
  if (typeof volume !== 'number') return res.status(400).json({ error: 'volume e obrigatorio' });
  const player = getPlayer(guildId);
  player.setVolume(volume);
  res.json(player.getStatus());
});

router.post('/autoplay', (req, res) => {
  const guildId = requireGuildId(req, res);
  if (!guildId) return;
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled e obrigatorio' });
  const player = getPlayer(guildId);
  player.setAutoplay(enabled);
  res.json(player.getStatus());
});

// Botao de emergencia: desconecta o bot do canal de voz e para tudo, pra
// desempacar quando ele trava.
router.post('/reset', (req, res) => {
  const guildId = requireGuildId(req, res);
  if (!guildId) return;
  const player = getPlayer(guildId);
  player.forceReset();
  res.json(player.getStatus());
});

// ---- Playlists ----
router.get('/playlists', (req, res) => {
  res.json(playlists.listPlaylists(req.user));
});

router.post('/playlists', (req, res) => {
  const { name, visibility, guildId } = req.body;
  if (!name) return res.status(400).json({ error: 'name e obrigatorio' });
  if (visibility !== 'private' && !isMutualGuild(bot.client, req.user.guildIds, guildId)) {
    return res.status(400).json({ error: 'guildId invalido para essa visibilidade' });
  }
  const playlist = playlists.createPlaylist({
    name,
    visibility,
    guildId,
    ownerId: req.user.id,
    ownerName: req.user.username,
  });
  res.status(201).json(playlist);
});

// Clona uma playlist publica do Spotify pra dentro do Vitrola. Le a pagina
// de embed publica da playlist (ver spotifyClient.getPlaylist) - so falha
// mesmo se a playlist for privada, nao existir, ou tiver sido removida.
router.post(
  '/playlists/import-spotify',
  asyncRoute(async (req, res) => {
    const { url, visibility, guildId, name: customName } = req.body;
    if (!url) return res.status(400).json({ error: 'url e obrigatorio' });
    if (visibility !== 'private' && !isMutualGuild(bot.client, req.user.guildIds, guildId)) {
      return res.status(400).json({ error: 'guildId invalido para essa visibilidade' });
    }

    const playlistId = spotify.extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'Link de playlist do Spotify invalido' });

    let imported;
    try {
      imported = await spotify.getPlaylist(playlistId);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!imported.tracks.length) {
      return res.status(400).json({ error: 'Essa playlist esta vazia ou nao foi possivel ler as faixas' });
    }

    const playlist = playlists.createPlaylist({
      name: customName || imported.name || 'Playlist importada',
      visibility,
      guildId,
      ownerId: req.user.id,
      ownerName: req.user.username,
      tracks: imported.tracks,
    });
    res.status(201).json(playlist);
  })
);

// Clona uma playlist publica do YouTube ou do YouTube Music (mesma URL base
// e mesmo parametro "list=" nos dois - o yt-dlp le as duas igual).
router.post(
  '/playlists/import-youtube',
  asyncRoute(async (req, res) => {
    const { url, visibility, guildId, name: customName } = req.body;
    if (!url) return res.status(400).json({ error: 'url e obrigatorio' });
    if (visibility !== 'private' && !isMutualGuild(bot.client, req.user.guildIds, guildId)) {
      return res.status(400).json({ error: 'guildId invalido para essa visibilidade' });
    }

    const playlistId = youtube.extractYoutubePlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'Link de playlist do YouTube/YouTube Music invalido' });

    let imported;
    try {
      imported = await youtube.getYoutubePlaylist(playlistId);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!imported.tracks.length) {
      return res.status(400).json({ error: 'Essa playlist esta vazia ou nao foi possivel ler as faixas' });
    }

    const playlist = playlists.createPlaylist({
      name: customName || imported.name || 'Playlist importada',
      visibility,
      guildId,
      ownerId: req.user.id,
      ownerName: req.user.username,
      tracks: imported.tracks,
    });
    res.status(201).json(playlist);
  })
);

router.get('/playlists/:id', (req, res) => {
  const playlist = playlists.getPlaylist(req.params.id);
  if (!playlist || !playlists.canView(playlist, req.user)) {
    return res.status(404).json({ error: 'playlist nao encontrada' });
  }
  res.json(playlist);
});

router.patch('/playlists/:id', (req, res) => {
  const playlist = playlists.getPlaylist(req.params.id);
  if (!playlist || !playlists.canView(playlist, req.user)) {
    return res.status(404).json({ error: 'playlist nao encontrada' });
  }
  if (!playlists.canEdit(playlist, req.user)) {
    return res.status(403).json({ error: 'so o dono pode editar essa playlist' });
  }
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name e obrigatorio' });
  res.json(playlists.renamePlaylist(req.params.id, name));
});

router.delete('/playlists/:id', (req, res) => {
  const playlist = playlists.getPlaylist(req.params.id);
  if (!playlist || !playlists.canView(playlist, req.user)) {
    return res.status(404).json({ error: 'playlist nao encontrada' });
  }
  if (!playlists.canEdit(playlist, req.user)) {
    return res.status(403).json({ error: 'so o dono pode apagar essa playlist' });
  }
  playlists.deletePlaylist(req.params.id);
  res.status(204).end();
});

// Favoritar uma playlist do servidor/publica (que nao e sua) faz ela aparecer
// junto das suas na aba Playlists e na tela inicial.
router.post('/playlists/:id/favorite', (req, res) => {
  const playlist = playlists.getPlaylist(req.params.id);
  if (!playlist || !playlists.canView(playlist, req.user)) {
    return res.status(404).json({ error: 'playlist nao encontrada' });
  }
  res.json(playlists.setFavorite(req.params.id, req.user.id, true));
});

router.delete('/playlists/:id/favorite', (req, res) => {
  const playlist = playlists.getPlaylist(req.params.id);
  if (!playlist || !playlists.canView(playlist, req.user)) {
    return res.status(404).json({ error: 'playlist nao encontrada' });
  }
  res.json(playlists.setFavorite(req.params.id, req.user.id, false));
});

router.post('/playlists/:id/tracks', (req, res) => {
  const playlist = playlists.getPlaylist(req.params.id);
  if (!playlist || !playlists.canView(playlist, req.user)) {
    return res.status(404).json({ error: 'playlist nao encontrada' });
  }
  if (!playlists.canEdit(playlist, req.user)) {
    return res.status(403).json({ error: 'so o dono pode editar essa playlist' });
  }
  const { track } = req.body;
  if (!track) return res.status(400).json({ error: 'track e obrigatorio' });
  res.json(playlists.addTrack(req.params.id, track));
});

router.delete('/playlists/:id/tracks/:index', (req, res) => {
  const playlist = playlists.getPlaylist(req.params.id);
  if (!playlist || !playlists.canView(playlist, req.user)) {
    return res.status(404).json({ error: 'playlist nao encontrada' });
  }
  if (!playlists.canEdit(playlist, req.user)) {
    return res.status(403).json({ error: 'so o dono pode editar essa playlist' });
  }
  res.json(playlists.removeTrack(req.params.id, Number(req.params.index)));
});

router.post(
  '/playlists/:id/play',
  asyncRoute(async (req, res) => {
    const guildId = requireGuildId(req, res);
    if (!guildId) return;

    const playlist = playlists.getPlaylist(req.params.id);
    if (!playlist || !playlists.canView(playlist, req.user)) {
      return res.status(404).json({ error: 'playlist nao encontrada' });
    }

    const player = await ensureVoiceForUser(bot.client, guildId, req.user.id);
    player.playPlaylistNext(playlist.tracks, req.user.id);
    res.json(player.getStatus());
  })
);

module.exports = router;
