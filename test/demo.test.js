const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDemo, makeWavBytes, CATALOG, GENRE_SPECS, TOKEN } = require('../demo/demo');
const { buildDemo, serveDir } = require('../scripts/build-demo');

function fresh() {
  let t = 1_700_000_000_000;
  const clock = { advance: (ms) => (t += ms) };
  const demo = createDemo({ now: () => t, random: () => 0.5 });
  const call = (method, p, ctx = {}) => demo.handle(method, p, { token: TOKEN, ...ctx });
  return { demo, call, clock };
}

test('catálogo: 24 faixas, ids únicos, 3 por gênero', () => {
  assert.equal(CATALOG.length, 24);
  assert.equal(new Set(CATALOG.map((t) => t.id)).size, 24);
  for (const genre of Object.keys(GENRE_SPECS)) {
    assert.equal(CATALOG.filter((t) => t.genre === genre).length, 3, genre);
  }
});

test('rotas autenticadas respondem 401 sem token, busca é pública', () => {
  const { demo } = fresh();
  assert.equal(demo.handle('GET', '/me', {}).status, 401);
  assert.equal(demo.handle('GET', '/search', { query: { q: 'rock' } }).status, 200);
  assert.equal(demo.handle('GET', '/public-stats', {}).body.guildCount, 0);
});

test('busca ignora acento e maiúscula, e acha por gênero, artista e nome', () => {
  const { call } = fresh();
  assert.equal(call('GET', '/search', { query: { q: 'ELETRONICA' } }).body.length, 3);
  assert.ok(call('GET', '/search', { query: { q: 'mc neblina' } }).body.length >= 2);
  assert.equal(call('GET', '/search', { query: { q: 'mare mansa' } }).body[0].name, 'Maré Mansa');
  assert.deepEqual(call('GET', '/search', { query: { q: 'nada disso existe' } }).body, []);
  assert.equal(call('GET', '/search', { query: {} }).status, 400);
});

test('player: fila, pausa, seek, skip e autoplay', () => {
  const { call, clock } = fresh();
  let st = call('GET', '/status').body;
  assert.ok(st.current);
  assert.equal(st.queueLength, 5);
  assert.equal(st.connected, true);

  const t0 = st.current.elapsedSeconds;
  clock.advance(5000);
  assert.ok(Math.abs(call('GET', '/status').body.current.elapsedSeconds - (t0 + 5)) < 0.01);

  call('POST', '/pause');
  const frozen = call('GET', '/status').body.current.elapsedSeconds;
  clock.advance(10_000);
  st = call('GET', '/status').body;
  assert.equal(st.current.paused, true);
  assert.equal(st.current.elapsedSeconds, frozen);

  call('POST', '/resume');
  call('POST', '/seek', { body: { seconds: 20 } });
  assert.equal(call('GET', '/status').body.current.elapsedSeconds, 20);

  const nextName = st.queue[0].name;
  st = call('POST', '/skip').body;
  assert.equal(st.current.track.name, nextName);
  assert.equal(st.queueLength, 4);

  const novo = CATALOG[10];
  st = call('POST', '/queue', { body: { track: novo, playNext: true } }).body;
  assert.equal(st.queue[0].id, novo.id);
  assert.equal(st.queue[0].addedBy, 'demo-me');
  assert.equal(call('POST', '/seek', { body: {} }).status, 400);

  assert.equal(call('POST', '/autoplay', { body: { enabled: true } }).body.autoplay, true);
});

test('player: ao acabar a faixa passa para a próxima, e sem fila nem autoplay para', () => {
  const { demo, call, clock } = fresh();
  call('DELETE', '/queue');
  clock.advance(10 * 60 * 1000);
  demo.tick();
  assert.equal(call('GET', '/status').body.current, null);

  call('POST', '/queue', { body: { track: CATALOG[1] } });
  assert.equal(call('GET', '/status').body.current.track.id, CATALOG[1].id);
  call('POST', '/autoplay', { body: { enabled: true } });
  clock.advance(10 * 60 * 1000);
  demo.tick();
  const st = call('GET', '/status').body;
  assert.ok(st.current, 'autoplay deve continuar sozinho');
  assert.notEqual(st.current.track.id, CATALOG[1].id);
});

test('fila: remover e reordenar validam índices', () => {
  const { call } = fresh();
  const before = call('GET', '/status', { query: { fullQueue: '1' } }).body.queue.map((t) => t.id);
  call('POST', '/queue/reorder', { body: { from: 0, to: 2 } });
  const after = call('GET', '/status', { query: { fullQueue: '1' } }).body.queue.map((t) => t.id);
  assert.deepEqual(after, [before[1], before[2], before[0], before[3], before[4]]);
  assert.equal(call('POST', '/queue/reorder', { body: { from: 9, to: 0 } }).status, 400);
  assert.equal(call('DELETE', '/queue/99').status, 404);
  assert.equal(call('DELETE', '/queue/0').body.queueLength, 4);
});

test('playlists: criar, adicionar faixa, tocar, apagar; as dos outros são só de leitura', () => {
  const { call } = fresh();
  const created = call('POST', '/playlists', { body: { name: 'Minha', visibility: 'private' } });
  assert.equal(created.status, 201);
  const id = created.body.id;

  assert.equal(call('POST', `/playlists/${id}/tracks`, { body: { track: CATALOG[3] } }).body.tracks.length, 1);
  assert.equal(call('GET', `/playlists/${id}`).body.tracks[0].id, CATALOG[3].id);
  assert.equal(call('PATCH', `/playlists/${id}`, { body: { name: 'Renomeada' } }).body.name, 'Renomeada');

  const antes = call('GET', '/status').body.queueLength;
  call('POST', `/playlists/${id}/play`);
  assert.equal(call('GET', '/status').body.queueLength, antes + 1);

  assert.equal(call('DELETE', `/playlists/${id}`).status, 204);
  assert.equal(call('GET', `/playlists/${id}`).status, 404);

  assert.equal(call('DELETE', '/playlists/pl-servidor').status, 403);
  assert.equal(call('POST', '/playlists/pl-publica/favorite').body.favoritedBy[0], 'demo-me');
  assert.equal(call('POST', '/playlists', { body: {} }).status, 400);
});

test('importar playlist cria uma playlist com faixas do catálogo fictício', () => {
  const { call } = fresh();
  const res = call('POST', '/playlists/import-spotify', { body: { url: 'https://open.spotify.com/playlist/x', visibility: 'private' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.tracks.length, 6);
  assert.ok(res.body.tracks.every((t) => CATALOG.some((c) => c.id === t.id)));
  assert.equal(call('POST', '/playlists/import-youtube', { body: {} }).status, 400);
});

test('playlists persistem no storage injetado', () => {
  const mem = {};
  const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v) };
  const a = createDemo({ storage });
  a.handle('POST', '/playlists', { token: TOKEN, body: { name: 'Persistida' } });
  const b = createDemo({ storage });
  const names = b.handle('GET', '/playlists', { token: TOKEN }).body.map((p) => p.name);
  assert.ok(names.includes('Persistida'));
});

test('histórico, servidores e retrospectiva têm o formato que o front espera', () => {
  const { call } = fresh();
  assert.equal(call('GET', '/guilds').body[0].id, 'demo-guild');
  assert.ok(call('GET', '/history').body.length >= 5);

  const months = call('GET', '/retrospective/months', { query: { guildId: 'demo-guild' } }).body;
  assert.equal(months.length, 3);
  assert.match(months[0], /^\d{4}-\d{2}$/);

  const q = { guildId: 'demo-guild', scope: 'server', month: months[1] };
  const r = call('GET', '/retrospective', { query: q }).body;
  assert.equal(r.month, months[1]);
  assert.equal(r.topTracks.length, 5);
  assert.equal(r.topArtists.length, 5);
  assert.equal(r.weeklyMinutes.length, 4);
  assert.equal(r.topDays.length, 3);
  assert.ok(r.topDays[0].date.startsWith(months[1]));
  assert.ok(r.side.title && r.side.name);
  assert.deepEqual(call('GET', '/retrospective', { query: q }).body, r, 'mesmo mês, mesmos números');
  assert.notEqual(call('GET', '/retrospective', { query: { ...q, scope: 'personal' } }).body.totalPlays, r.totalPlays);
});

test('rota desconhecida responde 404 em vez de quebrar', () => {
  const { call } = fresh();
  assert.equal(call('GET', '/nao-existe').status, 404);
});

test('áudio sintetizado: WAV válido, duração certa e determinístico', () => {
  const track = CATALOG[0];
  const wav = makeWavBytes(track, 8000);
  const text = (from, to) => Buffer.from(wav.subarray(from, to)).toString('ascii');
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 12), 'WAVE');
  assert.equal(text(36, 40), 'data');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true), (track.durationMs / 1000) * 8000 * 2);
  assert.equal(wav.length, 44 + view.getUint32(40, true));

  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
  assert.ok(peak > 1000, 'não pode ser silêncio');
  assert.ok(peak <= 32767);
  assert.deepEqual(makeWavBytes(track, 8000), wav);
  assert.notDeepEqual(makeWavBytes(CATALOG[9], 8000).subarray(44, 400), wav.subarray(44, 400));
});

test('build da demo: injeta o demo.js antes do app.js e não mexe em public/', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vitrola-demo-'));
  try {
    const dir = path.join(out, 'site');
    buildDemo({ outDir: dir });
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(html.indexOf('demo.js') !== -1);
    assert.ok(html.indexOf('demo.js') < html.indexOf('app.js'));
    assert.equal(html.match(/demo\.js/g).length, 1);
    for (const f of ['app.js', 'style.css', 'demo.js', '.nojekyll']) {
      assert.ok(fs.existsSync(path.join(dir, f)), f);
    }
    const original = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(!original.includes('demo.js'), 'public/index.html não deve conhecer a demo');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('servidor da demo: entrega a página, bloqueia "../" e responde 404', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vitrola-demo-serve-'));
  const dir = path.join(out, 'site');
  buildDemo({ outDir: dir });
  fs.writeFileSync(path.join(out, 'segredo.txt'), 'nao pode vazar');
  const server = serveDir(dir, 0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /demo\.js/);
    assert.equal((await fetch(`${base}/demo.js`)).status, 200);
    assert.equal((await fetch(`${base}/nao-existe.js`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/segredo.txt`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(out, { recursive: true, force: true });
  }
});
