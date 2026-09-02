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
  requireTrackOwnerOrAdmin,
} = require('../discord/guilds');
const bot = require('../discord/bot');
const playlists = require('../db/playlists');
const history = require('../discord/history');
const listeningLog = require('../discord/listeningLog');
const session = require('../discord/session');
const { requireAuth } = require('./authMiddleware');
const { badRequest, forbidden, notFound } = require('../httpError');
const { sanitizeTrack, sanitizeTrackList } = require('./trackSchema');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Middleware: valida o guildId e deixa req.guildId / req.player prontos.
function withPlayer(req, res, next) {
  const guildId = req.body?.guildId || req.query?.guildId;
  if (!guildId) return next(badRequest('guildId e obrigatorio'));
  if (!isMutualGuild(bot.client, req.user.guildIds, guildId)) {
    return next(forbidden('Voce nao esta nesse servidor, ou o bot nao esta'));
  }
  req.guildId = guildId;
  req.player = getPlayer(guildId);
  next();
}

// Middleware: so deixa passar quem esta no MESMO canal de voz que o bot.
//
// Antes isso era uma chamada solta no corpo de algumas rotas - e justamente
// por ser opcional, /pause, /resume, /volume, /autoplay e /reset ficaram sem
// nenhuma checagem: qualquer pessoa do servidor conseguia pausar ou resetar
// a musica de quem estava no canal. Como middleware a protecao fica visivel
// na propria declaracao da rota, entao da pra bater o olho e ver quais estao
// protegidas (e "esquecer" vira uma omissao obvia, nao invisivel).
function requireVoicePeer(req, res, next) {
  try {
    requireSameVoiceChannel(bot.client, req.guildId, req.user.id, req.player);
    next();
  } catch (err) {
    next(err);
  }
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

// ---- Ticket de curta duracao pro /listen (ver comentario la em cima) ----
router.post('/listen/ticket', requireAuth, (req, res) => {
  res.json({ ticket: session.createStreamTicket(req.user) });
});

// ---- Retrospectiva mensal (faixas/artistas mais ouvidos, tipo "capsula do tempo") ----
router.get('/retrospective/months', requireAuth, (req, res) => {
  res.json(listeningLog.listAvailableMonths(req.user.id));
});

router.get('/retrospective', requireAuth, (req, res) => {
  let reference;
  if (req.query.month) {
    const match = /^(\d{4})-(\d{2})$/.exec(req.query.month);
    if (!match) throw badRequest('month invalido, use o formato YYYY-MM');
    reference = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  }
  const { from, to } = listeningLog.monthRange(reference);
  res.json({
    month: listeningLog.monthKey(from),
    ...listeningLog.getRetrospective(req.user.id, { from, to }),
  });
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

// ---- Escutar pelo navegador (audio ao vivo, sem precisar do canal de voz) ----
// GET porque essa URL vira o "src" de uma tag <audio> - o navegador nao
// manda headers customizados nesse tipo de requisicao, entao nao da pra
// exigir x-session-token aqui. Usa um ticket de uso unico e vida curta (ver
// /listen/ticket, essa sim autenticada do jeito normal) em vez do token de
// sessao de 90 dias, que nunca aparece numa URL.
router.get(
  '/listen',
  asyncRoute(async (req, res, next) => {
    const user = session.consumeStreamTicket(req.query.ticket);
    if (!user) return next(forbidden('Ticket invalido ou expirado - peca um novo em /listen/ticket'));

    const guildId = req.query.guildId;
    if (!guildId || !isMutualGuild(bot.client, user.guildIds, guildId)) {
      return next(forbidden('Voce nao esta nesse servidor, ou o bot nao esta'));
    }

    const player = getPlayer(guildId);
    const started = player.attachHttpListener(res);
    if (!started) {
      res.status(404).json({ error: 'Nada tocando agora' });
    }
  })
);

router.use(requireAuth);

// ---- Status ----
// fullQueue=1 so quando o cliente realmente precisa da fila inteira (aba
// Fila aberta, painel "a seguir" expandido). O polling normal recebe so uma
// previa - ver comentario em getStatus.
// Sem requireVoicePeer de proposito: so leitura, e o front consulta isso a
// cada segundo pra montar a tela mesmo antes de entrar num canal de voz.
router.get('/status', withPlayer, (req, res) => {
  res.json(req.player.getStatus({ fullQueue: req.query.fullQueue === '1' }));
});

// ---- Fila ----
router.post(
  '/queue',
  withPlayer,
  asyncRoute(async (req, res) => {
    // ensureVoiceForUser ja faz a checagem de canal aqui (e conecta o bot se
    // for a primeira faixa), entao essa rota nao usa requireVoicePeer.
    const track = sanitizeTrack(req.body.track);

    // Nunca interrompe o que esta tocando: so entra na fila (na frente, se
    // playNext) e comeca a tocar sozinha se nao havia nada rodando.
    const player = await ensureVoiceForUser(bot.client, req.guildId, req.user.id);
    player.enqueue(track, Boolean(req.body.playNext), req.user.id);
    history.recordHistory(req.user.id, track);
    listeningLog.recordPlay(req.user.id, track);
    res.json(player.getStatus());
  })
);

router.delete(
  '/queue/:index',
  withPlayer,
  requireVoicePeer,
  asyncRoute(async (req, res) => {
    const index = Number(req.params.index);
    const target = req.player.getStatus({ fullQueue: true }).queue[index];
    if (!target) throw notFound('indice invalido');

    await requireTrackOwnerOrAdmin(bot.client, req.guildId, req.user.id, target.addedBy);

    req.player.removeFromQueue(index);
    res.json(req.player.getStatus());
  })
);

// Limpar a fila inteira nao tem um "dono" unico (pode ter faixa de varias
// pessoas misturada) - so exige confirmar posse/admin quando existe faixa de
// ALGUEM alem de quem esta pedindo; uma fila so com musicas suas (ou so
// autoplay, sem addedBy) continua liberada pra limpar sem admin.
router.delete(
  '/queue',
  withPlayer,
  requireVoicePeer,
  asyncRoute(async (req, res) => {
    const { queue } = req.player.getStatus({ fullQueue: true });
    const temFaixaDeOutraPessoa = queue.some((t) => t.addedBy && t.addedBy !== req.user.id);
    if (temFaixaDeOutraPessoa) {
      const admin = await isGuildAdmin(bot.client, req.guildId, req.user.id);
      if (!admin) {
        throw forbidden('Só um administrador pode limpar uma fila com músicas de outras pessoas.');
      }
    }

    req.player.clearQueue();
    res.json(req.player.getStatus());
  })
);

router.post(
  '/queue/reorder',
  withPlayer,
  requireVoicePeer,
  asyncRoute(async (req, res) => {
    const { from, to } = req.body;
    const fromIndex = Number(from);
    const target = req.player.getStatus({ fullQueue: true }).queue[fromIndex];
    if (!target) throw badRequest('from/to invalidos');

    await requireTrackOwnerOrAdmin(bot.client, req.guildId, req.user.id, target.addedBy);

    const ok = req.player.reorderQueue(fromIndex, Number(to));
    if (!ok) throw badRequest('from/to invalidos');
    res.json(req.player.getStatus());
  })
);

// ---- Controles de reproducao ----
// Todas exigem estar no mesmo canal de voz que o bot (requireVoicePeer).
router.post('/pause', withPlayer, requireVoicePeer, (req, res) => {
  req.player.pause();
  res.json(req.player.getStatus());
});

router.post('/resume', withPlayer, requireVoicePeer, (req, res) => {
  req.player.resume();
  res.json(req.player.getStatus());
});

router.post(
  '/skip',
  withPlayer,
  requireVoicePeer,
  asyncRoute(async (req, res) => {
    const status = req.player.getStatus();
    if (!status.current) throw badRequest('nada tocando');

    await requireTrackOwnerOrAdmin(bot.client, req.guildId, req.user.id, status.current.track.addedBy);

    req.player.skip();
    res.json(req.player.getStatus());
  })
);

router.post(
  '/seek',
  withPlayer,
  requireVoicePeer,
  asyncRoute(async (req, res) => {
    const { seconds } = req.body;
    if (typeof seconds !== 'number') throw badRequest('seconds e obrigatorio');
    await req.player.seek(seconds);
    res.json(req.player.getStatus());
  })
);

router.post('/volume', withPlayer, requireVoicePeer, (req, res) => {
  const { volume } = req.body;
  if (typeof volume !== 'number') throw badRequest('volume e obrigatorio');
  req.player.setVolume(volume);
  res.json(req.player.getStatus());
});

router.post('/autoplay', withPlayer, requireVoicePeer, (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') throw badRequest('enabled e obrigatorio');
  req.player.setAutoplay(enabled);
  res.json(req.player.getStatus());
});

// Botao de emergencia: desconecta o bot do canal de voz e para tudo, pra
// desempacar quando ele trava.
router.post('/reset', withPlayer, requireVoicePeer, (req, res) => {
  req.player.forceReset();
  res.json(req.player.getStatus());
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

    // As faixas importadas nao passam pela UI (vem direto do Spotify), mas
    // precisam do mesmo allowlist que qualquer outra faixa gravada no banco
    // (ver sanitizeTrackList) - senao ficam sem o limite de tamanho e a
    // normalizacao de URL que as demais rotas ja aplicam.
    const tracks = sanitizeTrackList(imported.tracks);
    if (!tracks.length) {
      return res.status(400).json({ error: 'Nao foi possivel ler nenhuma faixa valida dessa playlist' });
    }

    const playlist = playlists.createPlaylist({
      name: customName || imported.name || 'Playlist importada',
      visibility,
      guildId,
      ownerId: req.user.id,
      ownerName: req.user.username,
      tracks,
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

    // Titulo de video no YouTube e definido livremente por quem fez o
    // upload - sem passar pelo mesmo allowlist das demais rotas, campos
    // gigantes ou URLs fora do esquema http(s) iam parar direto no banco.
    const tracks = sanitizeTrackList(imported.tracks);
    if (!tracks.length) {
      return res.status(400).json({ error: 'Nao foi possivel ler nenhuma faixa valida dessa playlist' });
    }

    const playlist = playlists.createPlaylist({
      name: customName || imported.name || 'Playlist importada',
      visibility,
      guildId,
      ownerId: req.user.id,
      ownerName: req.user.username,
      tracks,
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
  res.json(playlists.addTrack(req.params.id, sanitizeTrack(req.body.track)));
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
  withPlayer,
  asyncRoute(async (req, res) => {
    const playlist = playlists.getPlaylist(req.params.id);
    if (!playlist || !playlists.canView(playlist, req.user)) {
      throw notFound('playlist nao encontrada');
    }

    // ensureVoiceForUser cuida da checagem de canal (e conecta o bot se for
    // a primeira faixa) - por isso essa rota nao usa requireVoicePeer.
    const player = await ensureVoiceForUser(bot.client, req.guildId, req.user.id);
    player.playPlaylistNext(playlist.tracks, req.user.id);
    res.json(player.getStatus());
  })
);

module.exports = router;
