/*
 * Vitrola - modo demonstracao (GitHub Pages)
 *
 * No site de demo nao existe backend: este arquivo e carregado ANTES do
 * app.js (ver scripts/build-demo.js) e responde as chamadas /api/* dentro do
 * proprio navegador, com um catalogo de faixas FICTICIAS e audio sintetizado
 * na hora. Nenhuma musica real, capa real ou conta do Discord e usada.
 *
 * O arquivo tem duas partes:
 *   1. createDemo(): a "API" simulada (pura, sem DOM - e o que os testes usam);
 *   2. o bloco do navegador no final, que pluga a API no fetch/<audio> da pagina.
 */
(function (root) {
  'use strict';

  const REPO_URL = 'https://github.com/ismash1598/Vitrola';
  const TOKEN = 'vitrola-demo';

  // ---------- utilidades ----------
  function hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // PRNG com semente (mulberry32): mesma semente, mesmos numeros.
  function rng(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalize(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  function art(seed) {
    const h = hash(seed) % 360;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      `<stop offset="0" stop-color="hsl(${h},58%,42%)"/>` +
      `<stop offset="1" stop-color="hsl(${(h + 55) % 360},62%,22%)"/>` +
      '</linearGradient></defs>' +
      '<rect width="120" height="120" fill="url(#g)"/>' +
      '<circle cx="60" cy="60" r="36" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="2"/>' +
      '<circle cx="60" cy="60" r="22" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>' +
      '<circle cx="60" cy="60" r="7" fill="rgba(255,255,255,.4)"/></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  // ---------- catalogo ficticio ----------
  // Nomes de artistas, albuns e faixas inventados. [genero, artista, faixa, album, segundos]
  const RAW_CATALOG = [
    ['MPB', 'Lua de Vidro', 'Maré Mansa', 'Janelas do Sul', 52],
    ['MPB', 'Lua de Vidro', 'Café com Chuva', 'Janelas do Sul', 44],
    ['MPB', 'Rio Abaixo', 'Cartas de Agosto', 'Margens', 58],
    ['Hip-Hop', 'Dani Quartz', 'Concreto e Tinta', 'Esquina 7', 46],
    ['Hip-Hop', 'Dani Quartz', 'Sem Pressa', 'Esquina 7', 40],
    ['Hip-Hop', 'Verso Livre', 'Rua Sem Nome', 'Rascunhos', 54],
    ['Funk', 'MC Neblina', 'Baile do Farol', 'Madrugada', 38],
    ['Funk', 'MC Neblina', 'Pista Cheia', 'Madrugada', 42],
    ['Funk', 'Duo Gelo', 'Ritmo de Domingo', 'Quente', 36],
    ['Trap', 'Sombra Azul', 'Neon Frio', 'Noite Longa', 50],
    ['Trap', 'Sombra Azul', 'Alto Mar', 'Noite Longa', 45],
    ['Trap', 'Pixel Sereno', 'Fase Bônus', 'Vidas Extras', 41],
    ['Rock', 'Banda Cobre', 'Estrada Vazia', 'Ferrugem', 56],
    ['Rock', 'Banda Cobre', 'Tempestade Mansa', 'Ferrugem', 60],
    ['Rock', 'Os Faróis', 'Volume Máximo', 'Garagem 12', 48],
    ['Sertanejo', 'Vento Sul', 'Violão na Varanda', 'Porteira', 55],
    ['Sertanejo', 'Vento Sul', 'Estrada de Terra', 'Porteira', 49],
    ['Sertanejo', 'Cida e Tonho', 'Saudade de Domingo', 'Pasto Verde', 52],
    ['Pagode', 'Samba de Quintal', 'Roda de Sábado', 'Cavaquinho', 47],
    ['Pagode', 'Samba de Quintal', 'Pandeiro Solto', 'Cavaquinho', 43],
    ['Pagode', 'Grupo Alvorada', 'Feijoada às Três', 'Mesa Posta', 51],
    ['Eletrônica', 'Pixel Sereno', 'Circuito Aberto', 'Vidas Extras', 57],
    ['Eletrônica', 'Onda Curta', 'Sinal Fraco', 'Frequências', 53],
    ['Eletrônica', 'Onda Curta', 'Hora Dourada', 'Frequências', 59],
  ];

  // Andamento e timbre de cada genero (so pra as faixas nao soarem todas iguais).
  const GENRE_SPECS = {
    MPB: { bpm: 84, wave: 'sine' },
    'Hip-Hop': { bpm: 90, wave: 'tri' },
    Funk: { bpm: 130, wave: 'tri' },
    Trap: { bpm: 140, wave: 'sine' },
    Rock: { bpm: 118, wave: 'saw' },
    Sertanejo: { bpm: 96, wave: 'tri' },
    Pagode: { bpm: 100, wave: 'sine' },
    Eletrônica: { bpm: 124, wave: 'square' },
  };

  const CATALOG = RAW_CATALOG.map(([genre, artist, name, album, seconds]) => ({
    id: 'demo:' + normalize(artist + '-' + name).replace(/[^a-z0-9]+/g, '-'),
    name,
    artists: [artist],
    album,
    albumArt: art(album),
    durationMs: seconds * 1000,
    spotifyUrl: null,
    genre,
  }));

  const byId = new Map(CATALOG.map((t) => [t.id, t]));

  // ---------- audio sintetizado ----------
  function midiHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function osc(wave, phase) {
    switch (wave) {
      case 'square':
        return phase < 0.5 ? 0.55 : -0.55;
      case 'saw':
        return 2 * phase - 1;
      case 'tri':
        return 4 * Math.abs(phase - 0.5) - 1;
      default:
        return Math.sin(2 * Math.PI * phase);
    }
  }

  function addNote(buf, sr, start, dur, freq, amp, wave) {
    const from = Math.floor(start * sr);
    const len = Math.min(Math.floor(dur * sr), buf.length - from);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.012) * Math.exp((-3.4 * t) / dur);
      buf[from + i] += osc(wave, (freq * t) % 1) * env * amp;
    }
  }

  // Devolve um WAV mono de 16 bits (Uint8Array) com uma melodia pentatonica
  // gerada a partir do id da faixa: mesma faixa, mesmo som.
  function makeWavBytes(track, sr) {
    sr = sr || 22050;
    const spec = GENRE_SPECS[track.genre] || { bpm: 100, wave: 'sine' };
    const secs = track.durationMs / 1000;
    const n = Math.floor(sr * secs);
    const buf = new Float32Array(n);
    const r = rng(hash(track.id));
    const beat = 60 / spec.bpm;
    const base = 45 + Math.floor(r() * 7);
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    let idx = 2;

    for (let b = 0; b * beat < secs; b++) {
      const t0 = b * beat;
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(r() * 5) - 2));
      if (r() > 0.18) addNote(buf, sr, t0, beat * 1.6, midiHz(base + 12 + scale[idx]), 0.22, spec.wave);
      if (r() > 0.55) addNote(buf, sr, t0 + beat / 2, beat, midiHz(base + 12 + scale[(idx + 2) % scale.length]), 0.13, spec.wave);
      if (b % 4 === 0) {
        addNote(buf, sr, t0, beat * 3.8, midiHz(base - 12), 0.2, 'sine');
        addNote(buf, sr, t0, beat * 4, midiHz(base + 7), 0.07, 'sine');
      }
    }

    const dataBytes = n * 2;
    const out = new Uint8Array(44 + dataBytes);
    const view = new DataView(out.buffer);
    const str = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, dataBytes, true);

    const fade = Math.floor(sr * 0.4);
    for (let i = 0; i < n; i++) {
      let v = buf[i];
      if (i > n - fade) v *= (n - i) / fade;
      v = Math.max(-1, Math.min(1, v * 0.9));
      view.setInt16(44 + i * 2, Math.round(v * 32767), true);
    }
    return out;
  }

  // ---------- a "API" simulada ----------
  function createDemo(opts) {
    opts = opts || {};
    const now = opts.now || Date.now;
    const storage = opts.storage || null; // { getItem, setItem } (localStorage) ou null
    const random = opts.random || Math.random;

    const ME = { id: 'demo-me', username: 'visitante', avatar: art('avatar-visitante'), guildIds: ['demo-guild'] };
    const OTHERS = {
      'demo-ana': 'Ana',
      'demo-bruno': 'Bruno',
    };
    const GUILD = { id: 'demo-guild', name: 'Vitrola Demo', icon: art('guild-demo') };

    const tracksOf = (...ids) => ids.map((i) => ({ ...CATALOG[i] }));

    // ----- player simulado (o "bot" do servidor de demonstracao) -----
    const player = {
      current: null,
      queue: [],
      paused: false,
      volume: 1,
      autoplay: false,
      elapsedBase: 0,
      syncedAt: now(),
    };
    const history = [];

    const asItem = (track, by, byName) => ({ ...track, addedBy: by, addedByUsername: byName });
    const durationOf = () => (player.current ? player.current.durationMs / 1000 : 0);
    function elapsed() {
      if (!player.current) return 0;
      const live = player.paused ? 0 : (now() - player.syncedAt) / 1000;
      return Math.min(durationOf(), player.elapsedBase + live);
    }

    function remember(track) {
      const i = history.findIndex((t) => t.id === track.id);
      if (i !== -1) history.splice(i, 1);
      history.unshift({ ...track });
      history.length = Math.min(history.length, 10);
    }

    function startTrack(item) {
      player.current = item;
      player.elapsedBase = 0;
      player.syncedAt = now();
      player.paused = false;
      remember(item);
    }

    function randomAutoTrack() {
      const pool = CATALOG.filter((t) => !player.current || t.id !== player.current.id);
      return asItem(pool[Math.floor(random() * pool.length)], null, null);
    }

    function advance() {
      const next = player.queue.shift();
      if (next) startTrack(next);
      else if (player.autoplay) startTrack(randomAutoTrack());
      else player.current = null;
    }

    function tick() {
      if (player.current && !player.paused && elapsed() >= durationOf() - 0.05) advance();
    }

    // Estado inicial: ja tem alguem ouvindo, pra tela nao abrir vazia.
    history.push(...tracksOf(5, 9, 14, 17, 1, 22).reverse());
    startTrack(asItem(CATALOG[0], 'demo-bruno', 'Bruno'));
    player.elapsedBase = 14;
    player.queue.push(
      asItem(CATALOG[4], 'demo-ana', 'Ana'),
      asItem(CATALOG[12], 'demo-bruno', 'Bruno'),
      asItem(CATALOG[21], ME.id, ME.username),
      asItem(CATALOG[7], 'demo-ana', 'Ana'),
      asItem(CATALOG[16], ME.id, ME.username)
    );

    function enqueue(track, playNext) {
      const item = asItem(clean(track), ME.id, ME.username);
      if (!player.current) startTrack(item);
      else if (playNext) player.queue.unshift(item);
      else player.queue.push(item);
    }

    // So guarda os campos que a faixa tem de verdade (a demo nao confia em nada vindo da tela).
    function clean(track) {
      const known = track && byId.get(track.id);
      if (known) return { ...known };
      if (!track || typeof track.name !== 'string') throw new HttpError(400, 'faixa invalida');
      return {
        id: String(track.id || 'demo:' + hash(track.name)),
        name: track.name.slice(0, 200),
        artists: Array.isArray(track.artists) ? track.artists.slice(0, 5).map(String) : [],
        album: track.album || null,
        albumArt: track.albumArt || art(track.name),
        durationMs: Number(track.durationMs) > 0 ? Number(track.durationMs) : 45000,
        spotifyUrl: null,
        genre: track.genre,
      };
    }

    function status(full) {
      const c = player.current;
      return {
        current: c
          ? {
              track: {
                id: c.id,
                name: c.name,
                artists: c.artists,
                album: c.album,
                albumArt: c.albumArt,
                durationMs: c.durationMs,
                spotifyUrl: null,
                addedBy: c.addedBy ?? null,
              },
              elapsedSeconds: elapsed(),
              durationSeconds: durationOf(),
              paused: player.paused,
            }
          : null,
        queue: full ? player.queue.map((t) => ({ ...t })) : player.queue.slice(0, 6).map((t) => ({ ...t })),
        queueLength: player.queue.length,
        volume: player.volume,
        autoplay: player.autoplay,
        connected: true,
      };
    }

    // ----- playlists (persistem no navegador de quem visita) -----
    const STORE_KEY = 'vitrolaDemo.playlists';
    let playlists = null;
    if (storage) {
      try {
        const saved = JSON.parse(storage.getItem(STORE_KEY) || 'null');
        if (Array.isArray(saved)) playlists = saved;
      } catch {
        playlists = null;
      }
    }
    if (!playlists) {
      const stamp = new Date(now()).toISOString();
      playlists = [
        { id: 'pl-estudo', name: 'Para focar (exemplo)', visibility: 'private', guildId: GUILD.id, ownerId: ME.id, ownerName: ME.username, tracks: tracksOf(0, 2, 15, 18, 22), favoritedBy: [], createdAt: stamp },
        { id: 'pl-servidor', name: 'Noite no servidor', visibility: 'server', guildId: GUILD.id, ownerId: 'demo-ana', ownerName: 'Ana', tracks: tracksOf(6, 9, 12, 20), favoritedBy: [], createdAt: stamp },
        { id: 'pl-publica', name: 'Pra começar o dia', visibility: 'public', guildId: GUILD.id, ownerId: 'demo-bruno', ownerName: 'Bruno', tracks: tracksOf(3, 14, 17, 23, 8, 1), favoritedBy: [], createdAt: stamp },
      ];
    }
    function savePlaylists() {
      if (!storage) return;
      try {
        storage.setItem(STORE_KEY, JSON.stringify(playlists));
      } catch {
        // sem localStorage (janela anonima etc.): as playlists valem so ate recarregar
      }
    }
    function findPlaylist(id) {
      const pl = playlists.find((p) => p.id === id);
      if (!pl) throw new HttpError(404, 'playlist nao encontrada');
      return pl;
    }
    function ownPlaylist(id) {
      const pl = findPlaylist(id);
      if (pl.ownerId !== ME.id) throw new HttpError(403, 'so o dono pode editar essa playlist (na demo, as playlists da Ana e do Bruno são só de leitura)');
      return pl;
    }
    function newPlaylist(name, visibility, tracks) {
      const pl = {
        id: 'pl-' + now().toString(36) + Math.floor(random() * 1e4).toString(36),
        name: String(name).slice(0, 80),
        visibility: ['private', 'server', 'public'].includes(visibility) ? visibility : 'private',
        guildId: GUILD.id,
        ownerId: ME.id,
        ownerName: ME.username,
        tracks: tracks || [],
        favoritedBy: [],
        createdAt: new Date(now()).toISOString(),
      };
      playlists.push(pl);
      savePlaylists();
      return pl;
    }

    // ----- retrospectiva ("Capsula do tempo") com numeros ficticios mas estaveis -----
    function monthsList() {
      const d = new Date(now());
      const out = [];
      for (let i = 0; i < 3; i++) {
        const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
        out.push(m.toISOString().slice(0, 7));
      }
      return out;
    }

    function retrospective(month, scope) {
      const r = rng(hash(month + '|' + scope));
      const server = scope === 'server';
      const totalPlays = (server ? 170 : 38) + Math.floor(r() * (server ? 110 : 40));
      const shuffled = CATALOG.map((t) => [r(), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const topTracks = shuffled.slice(0, 5).map((t, i) => ({
        id: t.id,
        name: t.name,
        artists: t.artists,
        albumArt: t.albumArt,
        count: Math.round((server ? 19 : 8) - i * (server ? 3 : 1.2)),
      }));
      const artists = [...new Set(shuffled.map((t) => t.artists[0]))].slice(0, 5);
      const topArtists = artists.map((name, i) => ({
        name,
        count: Math.round((server ? 31 : 13) - i * (server ? 5 : 2)),
        albumArt: shuffled.find((t) => t.artists[0] === name).albumArt,
      }));
      const weekly = [0, 1, 2, 3].map(() => 20 + Math.floor(r() * 60));
      const scale = totalPlays * 0.85;
      const wSum = weekly.reduce((a, b) => a + b, 0);
      const weeklyMinutes = weekly.map((m, i) => ({ week: i + 1, minutes: Math.round((m / wSum) * scale) }));
      const days = [3 + Math.floor(r() * 7), 11 + Math.floor(r() * 7), 20 + Math.floor(r() * 8)];
      const topDays = days.map((d, i) => ({
        date: `${month}-${String(d).padStart(2, '0')}`,
        minutes: Math.round((server ? 96 : 42) - i * (server ? 17 : 8)),
      }));
      const [y, m] = month.split('-').map(Number);
      return {
        month,
        from: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
        to: new Date(Date.UTC(y, m, 1)).toISOString(),
        scope,
        totalPlays,
        totalMinutes: Math.round(scale),
        distinctArtists: 7 + Math.floor(r() * 5),
        topArtists,
        topTracks,
        weeklyMinutes,
        topDays,
        side: server
          ? { title: 'Quem mais pediu', name: 'Ana', meta: '58 pedidos', note: 'Seguido por Bruno (41) e visitante (23).' }
          : { title: 'Sua posição no servidor', name: '3º lugar', meta: '23 de 122 pedidos', note: 'Atrás de Bruno, à frente de ninguém ainda.' },
      };
    }

    // ----- busca -----
    function search(q) {
      const needle = normalize(q);
      if (!needle) throw new HttpError(400, 'parametro q e obrigatorio');
      return CATALOG.filter((t) =>
        [t.name, t.artists.join(' '), t.album, t.genre].some((field) => normalize(field).includes(needle))
      ).map((t) => ({ ...t }));
    }

    // ----- tickets de audio (o front pede um ticket e depois aponta o <audio> pra ele) -----
    const tickets = new Map();
    function makeTicket(track) {
      const ticket = 'demo-' + Math.floor(random() * 1e9).toString(36) + tickets.size;
      tickets.set(ticket, track);
      return ticket;
    }

    function randomTracks(count) {
      return CATALOG.map((t) => [random(), t]).sort((a, b) => a[0] - b[0]).slice(0, count).map((x) => ({ ...x[1] }));
    }

    // ----- tabela de rotas -----
    const num = (v) => Number(v);
    const routes = [
      ['GET', /^\/me$/, () => ME],
      ['POST', /^\/logout$/, () => ({ status: 204 })],
      ['GET', /^\/guilds$/, () => [GUILD]],
      ['GET', /^\/history$/, () => history.map((t) => ({ ...t }))],
      ['GET', /^\/public-stats$/, () => ({ guildCount: 0 }), false],
      ['GET', /^\/search$/, ({ query }) => search(query.q), false],
      ['POST', /^\/listen\/ticket$/, () => ({ ticket: makeTicket(null) })],
      ['POST', /^\/browser-play\/ticket$/, ({ body }) => ({ ticket: makeTicket(clean(body.track)) })],
      ['GET', /^\/retrospective\/months$/, () => monthsList()],
      ['GET', /^\/retrospective$/, ({ query }) => retrospective(query.month || monthsList()[0], query.scope === 'server' ? 'server' : 'personal')],

      ['GET', /^\/status$/, ({ query }) => status(query.fullQueue === '1')],
      ['POST', /^\/queue$/, ({ body }) => (enqueue(body.track, Boolean(body.playNext)), status(false))],
      ['POST', /^\/queue\/reorder$/, ({ body }) => {
        const from = num(body.from);
        const to = num(body.to);
        if (!player.queue[from] || !Number.isInteger(to) || to < 0 || to >= player.queue.length) throw new HttpError(400, 'from/to invalidos');
        const [item] = player.queue.splice(from, 1);
        player.queue.splice(to, 0, item);
        return status(false);
      }],
      ['DELETE', /^\/queue\/(\d+)$/, ({ params }) => {
        if (!player.queue[num(params[0])]) throw new HttpError(404, 'indice invalido');
        player.queue.splice(num(params[0]), 1);
        return status(false);
      }],
      ['DELETE', /^\/queue$/, () => ((player.queue = []), status(false))],
      ['POST', /^\/pause$/, () => {
        player.elapsedBase = elapsed();
        player.paused = true;
        return status(false);
      }],
      ['POST', /^\/resume$/, () => {
        if (player.paused) player.syncedAt = now();
        player.paused = false;
        return status(false);
      }],
      ['POST', /^\/skip$/, () => {
        if (!player.current) throw new HttpError(400, 'nada tocando');
        advance();
        return status(false);
      }],
      ['POST', /^\/seek$/, ({ body }) => {
        if (typeof body.seconds !== 'number') throw new HttpError(400, 'seconds e obrigatorio');
        player.elapsedBase = Math.max(0, Math.min(durationOf(), body.seconds));
        player.syncedAt = now();
        return status(false);
      }],
      ['POST', /^\/volume$/, ({ body }) => {
        if (typeof body.volume !== 'number') throw new HttpError(400, 'volume e obrigatorio');
        player.volume = Math.max(0, Math.min(2, body.volume));
        return status(false);
      }],
      ['POST', /^\/autoplay$/, ({ body }) => {
        if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled e obrigatorio');
        player.autoplay = body.enabled;
        return status(false);
      }],
      ['POST', /^\/reset$/, () => {
        player.current = null;
        player.queue = [];
        player.paused = false;
        return status(false);
      }],

      ['GET', /^\/playlists$/, () => playlists.map((p) => ({ ...p }))],
      ['POST', /^\/playlists$/, ({ body }) => {
        if (!body.name) throw new HttpError(400, 'name e obrigatorio');
        return { status: 201, body: newPlaylist(body.name, body.visibility) };
      }],
      ['POST', /^\/playlists\/import-(spotify|youtube)$/, ({ body, params }) => {
        if (!body.url) throw new HttpError(400, 'url e obrigatorio');
        const origem = params[0] === 'spotify' ? 'Spotify' : 'YouTube';
        // Na demo nada e baixado de verdade: sorteia faixas do catalogo ficticio.
        return { status: 201, body: newPlaylist(body.name || `Importada do ${origem} (demo)`, body.visibility, randomTracks(6)) };
      }],
      ['GET', /^\/playlists\/([^/]+)$/, ({ params }) => ({ ...findPlaylist(params[0]) })],
      ['PATCH', /^\/playlists\/([^/]+)$/, ({ params, body }) => {
        const pl = ownPlaylist(params[0]);
        if (!body.name) throw new HttpError(400, 'name e obrigatorio');
        pl.name = String(body.name).slice(0, 80);
        savePlaylists();
        return { ...pl };
      }],
      ['DELETE', /^\/playlists\/([^/]+)$/, ({ params }) => {
        ownPlaylist(params[0]);
        playlists = playlists.filter((p) => p.id !== params[0]);
        savePlaylists();
        return { status: 204 };
      }],
      ['POST', /^\/playlists\/([^/]+)\/favorite$/, ({ params }) => {
        const pl = findPlaylist(params[0]);
        if (!pl.favoritedBy.includes(ME.id)) pl.favoritedBy.push(ME.id);
        savePlaylists();
        return { ...pl };
      }],
      ['DELETE', /^\/playlists\/([^/]+)\/favorite$/, ({ params }) => {
        const pl = findPlaylist(params[0]);
        pl.favoritedBy = pl.favoritedBy.filter((id) => id !== ME.id);
        savePlaylists();
        return { ...pl };
      }],
      ['POST', /^\/playlists\/([^/]+)\/tracks$/, ({ params, body }) => {
        const pl = ownPlaylist(params[0]);
        pl.tracks.push(clean(body.track));
        savePlaylists();
        return { ...pl };
      }],
      ['DELETE', /^\/playlists\/([^/]+)\/tracks\/(\d+)$/, ({ params }) => {
        const pl = ownPlaylist(params[0]);
        pl.tracks.splice(num(params[1]), 1);
        savePlaylists();
        return { ...pl };
      }],
      ['POST', /^\/playlists\/([^/]+)\/play$/, ({ params }) => {
        const pl = findPlaylist(params[0]);
        const items = pl.tracks.map((t) => asItem(clean(t), ME.id, ME.username));
        if (!player.current && items.length) startTrack(items.shift());
        player.queue.unshift(...items);
        return status(false);
      }],
    ];

    // method + caminho (sem o prefixo /api) + { query, body, token } -> { status, body }
    function handle(method, path, ctx) {
      ctx = ctx || {};
      try {
        const route = routes.find((r) => r[0] === method && r[1].test(path));
        if (!route) throw new HttpError(404, 'rota nao simulada na demo');
        const needsAuth = route[3] !== false;
        if (needsAuth && ctx.token !== TOKEN) throw new HttpError(401, 'nao autenticado');
        const params = route[1].exec(path).slice(1);
        const out = route[2]({ query: ctx.query || {}, body: ctx.body || {}, params });
        if (out && typeof out === 'object' && !Array.isArray(out) && 'status' in out && Object.keys(out).every((k) => k === 'status' || k === 'body')) {
          return { status: out.status, body: out.body ?? null };
        }
        return { status: 200, body: out };
      } catch (err) {
        if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
        throw err;
      }
    }

    return {
      handle,
      tick,
      track: (ticket) => tickets.get(ticket) ?? null,
      currentTrack: () => player.current,
      elapsed,
      ME,
    };
  }

  const api = { createDemo, makeWavBytes, CATALOG, GENRE_SPECS, TOKEN, REPO_URL };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  // =====================================================================
  // Parte do navegador: pluga a API simulada na pagina.
  // =====================================================================
  const win = root;
  const doc = win.document;
  const demo = createDemo({ storage: (() => { try { return win.localStorage; } catch { return null; } })() });
  setInterval(demo.tick, 500);

  // A tela inicial (landing) aparece sempre que alguem abre a demo numa aba
  // nova: a "sessao" falsa so vale enquanto a aba estiver aberta. Sem isso,
  // quem ja entrou uma vez cairia direto na escolha de modo e nunca mais veria
  // a pagina de apresentacao. Se o navegador nao deixar usar sessionStorage,
  // mantem como esta (senao "Entrar" recarregaria para a landing em loop).
  const STARTED_KEY = 'vitrolaDemoStarted';
  let started = true;
  try { started = win.sessionStorage.getItem(STARTED_KEY) === '1'; } catch { started = true; }
  if (!started) {
    try { win.localStorage.removeItem('sessionToken'); } catch { /* nada a limpar */ }
  }

  function goToLanding() {
    try { win.localStorage.removeItem('sessionToken'); } catch { /* ok */ }
    try { win.sessionStorage.removeItem(STARTED_KEY); } catch { /* ok */ }
    win.location.reload();
  }

  // --- fetch: qualquer /api/... e respondido aqui, nada sai da pagina ---
  const realFetch = win.fetch.bind(win);
  win.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, win.location.href);
    const match = /\/api(\/.*)$/.exec(url.pathname);
    if (!match) return realFetch(input, init);

    const headers = new Headers((init && init.headers) || (typeof input !== 'string' ? input.headers : undefined));
    let body = {};
    try {
      body = init && init.body ? JSON.parse(init.body) : {};
    } catch {
      body = {};
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();

    await new Promise((resolve) => setTimeout(resolve, match[1].startsWith('/search') ? 220 : 40));
    const res = demo.handle(method, match[1], { query, body, token: headers.get('x-session-token') });
    if (res.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  };

  // --- <audio>: troca a URL de stream do backend por um WAV gerado aqui ---
  const wavUrls = new Map();
  function wavUrlFor(track) {
    if (!wavUrls.has(track.id)) {
      wavUrls.set(track.id, URL.createObjectURL(new Blob([makeWavBytes(track)], { type: 'audio/wav' })));
    }
    return wavUrls.get(track.id);
  }

  function rewriteAudioSrc(el, value) {
    const text = String(value);
    let track = null;
    if (/\/api\/browser-play\?/.test(text)) {
      track = demo.track(new URL(text, win.location.href).searchParams.get('ticket'));
    } else if (/\/api\/listen\?/.test(text)) {
      track = demo.currentTrack();
      const startAt = demo.elapsed();
      el.addEventListener('loadedmetadata', () => { try { el.currentTime = startAt; } catch { /* sem seek */ } }, { once: true });
    }
    return track ? wavUrlFor(track) : value;
  }

  const srcDescriptor = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'src');
  Object.defineProperty(win.HTMLMediaElement.prototype, 'src', {
    configurable: true,
    enumerable: srcDescriptor.enumerable,
    get() { return srcDescriptor.get.call(this); },
    set(value) { srcDescriptor.set.call(this, rewriteAudioSrc(this, value)); },
  });

  // --- login: "Entrar" vira "entrar na demonstracao" ---
  function enterDemo(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    try { win.localStorage.setItem('sessionToken', TOKEN); } catch { /* segue mesmo assim */ }
    try { win.sessionStorage.setItem(STARTED_KEY, '1'); } catch { /* ok */ }
    win.location.reload();
  }
  ['landing-login-btn', 'discord-login-btn'].forEach((id) => {
    const btn = doc.getElementById(id);
    if (btn) btn.addEventListener('click', enterDemo, true);
  });

  function replaceText(rootEl, from, to) {
    const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replace(from, to);
    }
  }
  replaceText(doc.body, 'Entrar com Discord', 'Entrar na demonstração');
  replaceText(doc.body, 'Leva menos de 10 segundos. Só pedimos seu perfil e a lista de servidores.', 'Sem login de verdade: é só uma demonstração, nada é enviado ao Discord.');
  replaceText(doc.body, 'Spotify ou YouTube Music, tocando direto no canal de voz', 'Nesta demonstração, com faixas de exemplo');
  const badge = doc.getElementById('landing-guild-count');
  if (badge) badge.textContent = 'Demonstração ao vivo';
  doc.title = 'Vitrola · Demonstração';

  // --- faixa discreta avisando que e uma demo ---
  const style = doc.createElement('style');
  style.textContent = `
    #demo-banner{position:fixed;right:0;top:38%;transform:translateY(-50%);z-index:9999;white-space:nowrap;
      writing-mode:vertical-rl;display:flex;align-items:center;gap:6px;padding:8px 2px;border-radius:6px 0 0 6px;
      font:10px/1 system-ui,sans-serif;color:#e8e8e8;background:rgba(18,18,22,.92);
      border:1px solid rgba(255,255,255,.16);border-right:0;box-shadow:-2px 4px 16px rgba(0,0,0,.35)}
    #demo-banner b{color:#fff;letter-spacing:.08em}
    #demo-banner a{color:#9ad1ff;text-decoration:underline}
    #demo-banner button{all:unset;cursor:pointer;opacity:.7;width:14px;height:14px;text-align:center;font-size:14px;line-height:14px}
    #demo-banner button:hover{opacity:1}
    #demo-banner .nav{all:unset;cursor:pointer;color:#9ad1ff;text-decoration:underline;font:10px/1 system-ui,sans-serif}
    #demo-banner.collapsed .long,#demo-banner.collapsed .gh{display:none}
    html[data-demo-screen="landing"] #demo-banner .tour-open{display:none}
    @media (max-width:560px){#demo-banner .long{display:none}}`;
  doc.head.appendChild(style);

  // O "×" so recolhe o texto longo e o link do GitHub; "Tutorial" e "Início"
  // ficam sempre ao alcance, senao quem fechou o aviso perderia o caminho de volta.
  let collapsed = false;
  try { collapsed = win.sessionStorage.getItem('vitrolaDemoBannerClosed') === '1'; } catch { /* mostra o aviso */ }
  const banner = doc.createElement('div');
  banner.id = 'demo-banner';
  banner.setAttribute('role', 'note');
  if (collapsed) banner.classList.add('collapsed');
  banner.innerHTML =
    '<b>DEMO</b><span class="long">músicas fictícias, áudio gerado no navegador</span>' +
    '<button type="button" class="nav tour-open" title="Rever o passo a passo">Tutorial</button>' +
    '<button type="button" class="nav home" title="Voltar para a tela inicial da demonstração">Início</button>' +
    '<a class="gh" href="' + REPO_URL + '" target="_blank" rel="noopener">GitHub</a>' +
    '<button type="button" class="close" aria-label="Recolher aviso">×</button>';
  banner.querySelector('.close').addEventListener('click', () => {
    banner.classList.add('collapsed');
    try { win.sessionStorage.setItem('vitrolaDemoBannerClosed', '1'); } catch { /* ok */ }
  });
  banner.querySelector('.home').addEventListener('click', goToLanding);
  banner.querySelector('.tour-open').addEventListener('click', () => { if (win.VitrolaTour) win.VitrolaTour.restart(); });
  doc.body.appendChild(banner);
})(typeof window !== 'undefined' ? window : globalThis);
