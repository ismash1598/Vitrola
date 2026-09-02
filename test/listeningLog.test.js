const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Mesma tecnica do history.test.js: copia o modulo (+ dependencias) pra um
// diretorio temporario isolado, pra cada teste ter seu proprio data/.
function carregarLogIsolado() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vitrola-log-'));
  const src = path.join(raiz, 'src', 'discord');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(path.join(raiz, 'src', 'db'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'node_modules'), { recursive: true });

  const base = path.join(__dirname, '..');
  fs.copyFileSync(path.join(base, 'src', 'discord', 'listeningLog.js'), path.join(src, 'listeningLog.js'));
  fs.copyFileSync(
    path.join(base, 'src', 'db', 'asyncFileAdapter.js'),
    path.join(raiz, 'src', 'db', 'asyncFileAdapter.js')
  );
  fs.symlinkSync(
    path.join(base, 'node_modules', 'lowdb'),
    path.join(raiz, 'node_modules', 'lowdb'),
    'junction'
  );

  const modulo = path.join(src, 'listeningLog.js');
  delete require.cache[require.resolve(modulo)];
  return require(modulo);
}

function faixa(id, overrides = {}) {
  return { id, name: `Faixa ${id}`, artists: ['Artista X'], albumArt: null, durationMs: 180000, ...overrides };
}

test('getRetrospective conta quantas vezes cada faixa tocou no mes atual', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', faixa('t1'));
  log.recordPlay('u1', faixa('t1'));
  log.recordPlay('u1', faixa('t2'));

  const retro = log.getRetrospective('u1');
  assert.equal(retro.totalPlays, 3);
  const t1 = retro.topTracks.find((t) => t.id === 't1');
  const t2 = retro.topTracks.find((t) => t.id === 't2');
  assert.equal(t1.count, 2);
  assert.equal(t2.count, 1);
  assert.equal(retro.topTracks[0].id, 't1', 'a mais tocada deveria vir primeiro');
});

test('getRetrospective agrega por artista, nao so por faixa', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', faixa('t1', { artists: ['Fulano'] }));
  log.recordPlay('u1', faixa('t2', { artists: ['Fulano'] }));
  log.recordPlay('u1', faixa('t3', { artists: ['Ciclano'] }));

  const retro = log.getRetrospective('u1');
  const fulano = retro.topArtists.find((a) => a.name === 'Fulano');
  assert.equal(fulano.count, 2, 'Fulano apareceu em duas faixas diferentes, mas e a mesma pessoa');
});

test('getRetrospective soma os minutos ouvidos', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', faixa('t1', { durationMs: 120000 })); // 2 min
  log.recordPlay('u1', faixa('t2', { durationMs: 180000 })); // 3 min
  assert.equal(log.getRetrospective('u1').totalMinutes, 5);
});

test('getRetrospective nao mistura reproducoes de fora do periodo pedido', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', faixa('t1'));

  const proximoMes = new Date();
  proximoMes.setMonth(proximoMes.getMonth() + 1);
  const from = new Date(proximoMes.getFullYear(), proximoMes.getMonth(), 1);
  const to = new Date(proximoMes.getFullYear(), proximoMes.getMonth() + 1, 1);

  const retroMesQueVem = log.getRetrospective('u1', { from, to });
  assert.equal(retroMesQueVem.totalPlays, 0, 'uma faixa tocada agora nao deveria aparecer no mes que vem');
});

test('getRetrospective nao mistura reproducoes de outro usuario', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', faixa('t1'));
  log.recordPlay('u2', faixa('t2'));
  assert.equal(log.getRetrospective('u1').totalPlays, 1);
  assert.equal(log.getRetrospective('u2').totalPlays, 1);
});

test('topTracks/topArtists vem cortados em 10', () => {
  const log = carregarLogIsolado();
  for (let i = 0; i < 15; i++) {
    log.recordPlay('u1', faixa(`t${i}`, { artists: [`Artista ${i}`] }));
  }
  const retro = log.getRetrospective('u1');
  assert.equal(retro.topTracks.length, 10);
  assert.equal(retro.topArtists.length, 10);
});

test('listAvailableMonths lista os meses com reproducao, mais recente primeiro', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', faixa('t1'));
  const meses = log.listAvailableMonths('u1');
  assert.equal(meses.length, 1);
  assert.equal(meses[0], log.monthKey(new Date()));
});

test('listAvailableMonths devolve vazio pra quem nunca ouviu nada', () => {
  const log = carregarLogIsolado();
  assert.deepEqual(log.listAvailableMonths('ninguem'), []);
});

test('monthRange devolve o primeiro e o ultimo instante (exclusivo) do mes', () => {
  const log = carregarLogIsolado();
  const { from, to } = log.monthRange(new Date(2026, 8, 15)); // 15 de setembro/2026
  assert.equal(from.getFullYear(), 2026);
  assert.equal(from.getMonth(), 8);
  assert.equal(from.getDate(), 1);
  assert.equal(to.getMonth(), 9); // outubro (exclusivo)
});
