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

test('scope "personal" so conta as reproducoes do proprio usuario, no servidor certo', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t1'));
  log.recordPlay('u2', 'Ciclano', 'g1', faixa('t2'));
  log.recordPlay('u1', 'Fulano', 'g2', faixa('t3')); // outro servidor, nao deveria contar

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u1' });
  assert.equal(retro.totalPlays, 1);
  assert.equal(retro.topTracks[0].id, 't1');
});

test('scope "server" conta todo mundo do servidor, nao so quem pediu', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t1'));
  log.recordPlay('u2', 'Ciclano', 'g1', faixa('t2'));
  log.recordPlay('u1', 'Fulano', 'g2', faixa('t3')); // outro servidor, nao deveria contar

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.totalPlays, 2);
});

test('distinctArtists conta artistas unicos, mesmo com varias faixas do mesmo', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t1', { artists: ['Legião Urbana'] }));
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t2', { artists: ['Legião Urbana'] }));
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t3', { artists: ['Taylor Swift'] }));

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.distinctArtists, 2);
});

// recordPlay sempre usa o instante ATUAL (sem parametro pra data fixa), e o
// modulo nao expoe acesso direto ao db - entao o teste de semana so valida
// que a reproducao de "agora" cai em alguma das 4 semanas, com o total de
// minutos certo (o mapeamento exato dia->semana esta coberto indiretamente
// por sempre somar 4 entradas, nunca perder minuto nenhum).
test('weeklyMinutes soma em 4 semanas, sem perder nenhum minuto', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t1', { durationMs: 600000 })); // 10 min
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.weeklyMinutes.length, 4);
  const total = retro.weeklyMinutes.reduce((sum, w) => sum + w.minutes, 0);
  assert.equal(total, 10);
});

test('topDays identifica o dia com mais minutos ouvidos', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t1', { durationMs: 300000 })); // 5 min hoje
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.topDays.length, 1);
  assert.equal(retro.topDays[0].minutes, 5);
});

test('side card "quem mais pediu" (modo servidor) aponta o maior requisitante e os proximos', () => {
  const log = carregarLogIsolado();
  for (let i = 0; i < 5; i++) log.recordPlay('u1', 'Lider', 'g1', faixa(`a${i}`));
  for (let i = 0; i < 3; i++) log.recordPlay('u2', 'Segundo', 'g1', faixa(`b${i}`));
  log.recordPlay('u3', 'Terceiro', 'g1', faixa('c0'));

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.side.title, 'Quem mais pediu');
  assert.equal(retro.side.name, 'Lider');
  assert.match(retro.side.note, /Segundo/);
  assert.match(retro.side.note, /Terceiro/);
});

test('side card "sua posicao" (modo pessoal) calcula o rank certo, com vizinhos', () => {
  const log = carregarLogIsolado();
  for (let i = 0; i < 5; i++) log.recordPlay('u1', 'Lider', 'g1', faixa(`a${i}`));
  for (let i = 0; i < 3; i++) log.recordPlay('u2', 'Segundo', 'g1', faixa(`b${i}`));
  log.recordPlay('u3', 'Terceiro', 'g1', faixa('c0'));

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u2' });
  assert.equal(retro.side.title, 'Sua posição no servidor');
  assert.equal(retro.side.name, '2º lugar');
  assert.match(retro.side.note, /Lider/);
  assert.match(retro.side.note, /Terceiro/);
});

test('side card lida com usuario que nao pediu nada esse mes', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t1'));
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'ninguem' });
  assert.match(retro.side.note, /ainda não pediu/);
});

test('listAvailableMonths e por servidor, nao por usuario', () => {
  const log = carregarLogIsolado();
  log.recordPlay('u1', 'Fulano', 'g1', faixa('t1'));
  const meses = log.listAvailableMonths('g1');
  assert.equal(meses.length, 1);
  assert.equal(meses[0], log.monthKey(new Date()));
  assert.deepEqual(log.listAvailableMonths('g-sem-nada'), []);
});

test('topTracks/topArtists vem cortados em 5', () => {
  const log = carregarLogIsolado();
  for (let i = 0; i < 10; i++) {
    log.recordPlay('u1', 'Fulano', 'g1', faixa(`t${i}`, { artists: [`Artista ${i}`] }));
  }
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.topTracks.length, 5);
  assert.equal(retro.topArtists.length, 5);
});
