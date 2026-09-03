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

// "Pessoal" = tudo que tocou enquanto a pessoa estava na call, pedido por
// ela ou nao - por isso listeners e o campo que importa pro escopo
// pessoal, nao requesterId.

test('scope "personal" conta faixa ouvida mesmo sem ter sido pedida por essa pessoa', () => {
  const log = carregarLogIsolado();
  log.recordPlay({
    guildId: 'g1',
    track: faixa('t1'),
    requesterId: 'u1', // quem pediu
    requesterUsername: 'Fulano',
    listeners: [{ id: 'u1', username: 'Fulano' }, { id: 'u2', username: 'Ciclano' }], // quem estava ouvindo
  });

  const retroDeQuemPediu = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u1' });
  const retroDeQuemSoOuviu = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u2' });
  assert.equal(retroDeQuemPediu.totalPlays, 1);
  assert.equal(retroDeQuemSoOuviu.totalPlays, 1, 'quem so estava ouvindo (nao pediu) tambem deveria contar');
});

test('scope "personal" nao conta pra quem nao estava na call', () => {
  const log = carregarLogIsolado();
  log.recordPlay({
    guildId: 'g1',
    track: faixa('t1'),
    requesterId: 'u1',
    listeners: [{ id: 'u1', username: 'Fulano' }],
  });

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u-ausente' });
  assert.equal(retro.totalPlays, 0);
});

test('scope "server" conta todo mundo, independente de quem pediu ou ouviu', () => {
  const log = carregarLogIsolado();
  log.recordPlay({ guildId: 'g1', track: faixa('t1'), requesterId: 'u1', listeners: [{ id: 'u1', username: 'Fulano' }] });
  log.recordPlay({ guildId: 'g1', track: faixa('t2'), requesterId: null, listeners: [{ id: 'u2', username: 'Ciclano' }] }); // autoplay
  log.recordPlay({ guildId: 'g2', track: faixa('t3'), requesterId: 'u1', listeners: [{ id: 'u1', username: 'Fulano' }] }); // outro servidor

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.totalPlays, 2);
});

test('faixa de autoplay (sem requester) conta pra quem estava ouvindo', () => {
  const log = carregarLogIsolado();
  log.recordPlay({
    guildId: 'g1',
    track: faixa('t1'),
    requesterId: null,
    requesterUsername: null,
    listeners: [{ id: 'u1', username: 'Fulano' }],
  });

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u1' });
  assert.equal(retro.totalPlays, 1, 'autoplay nao tem "dono", mas quem estava la ouviu de verdade');
});

test('registro antigo (so com userId/username) continua contando como "ouvida" por compatibilidade', () => {
  const log = carregarLogIsolado();
  // Formato de antes dessa mudanca - grava direto sem passar por recordPlay.
  log.recordPlay({ guildId: 'g1', track: faixa('t-novo'), requesterId: 'u1', listeners: [{ id: 'u1', username: 'Fulano' }] });
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u1' });
  assert.equal(retro.totalPlays, 1);
});

test('buildRequesterRanking (via side card) so conta quem PEDIU, nao quem so ouviu', () => {
  const log = carregarLogIsolado();
  for (let i = 0; i < 3; i++) {
    log.recordPlay({
      guildId: 'g1',
      track: faixa(`a${i}`),
      requesterId: 'u1',
      requesterUsername: 'Pediu Sempre',
      listeners: [{ id: 'u1', username: 'Pediu Sempre' }, { id: 'u2', username: 'So Ouve' }],
    });
  }

  const retroServidor = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retroServidor.side.title, 'Quem mais pediu');
  assert.equal(retroServidor.side.name, 'Pediu Sempre');

  const retroDeQuemSoOuve = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u2' });
  assert.equal(retroDeQuemSoOuve.totalPlays, 3, 'quem so ouviu tem as 3 faixas no proprio historico pessoal');
  assert.match(retroDeQuemSoOuve.side.note, /ainda não pediu/, 'mas nao aparece no ranking de quem pediu');
});

test('distinctArtists conta artistas unicos, mesmo com varias faixas do mesmo', () => {
  const log = carregarLogIsolado();
  log.recordPlay({ guildId: 'g1', track: faixa('t1', { artists: ['Legião Urbana'] }), requesterId: 'u1', listeners: [{ id: 'u1', username: 'F' }] });
  log.recordPlay({ guildId: 'g1', track: faixa('t2', { artists: ['Legião Urbana'] }), requesterId: 'u1', listeners: [{ id: 'u1', username: 'F' }] });
  log.recordPlay({ guildId: 'g1', track: faixa('t3', { artists: ['Taylor Swift'] }), requesterId: 'u1', listeners: [{ id: 'u1', username: 'F' }] });

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.distinctArtists, 2);
});

test('weeklyMinutes soma em 4 semanas, sem perder nenhum minuto', () => {
  const log = carregarLogIsolado();
  log.recordPlay({ guildId: 'g1', track: faixa('t1', { durationMs: 600000 }), requesterId: 'u1', listeners: [{ id: 'u1', username: 'F' }] }); // 10 min
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.weeklyMinutes.length, 4);
  const total = retro.weeklyMinutes.reduce((sum, w) => sum + w.minutes, 0);
  assert.equal(total, 10);
});

test('topDays identifica o dia com mais minutos ouvidos', () => {
  const log = carregarLogIsolado();
  log.recordPlay({ guildId: 'g1', track: faixa('t1', { durationMs: 300000 }), requesterId: 'u1', listeners: [{ id: 'u1', username: 'F' }] }); // 5 min hoje
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.topDays.length, 1);
  assert.equal(retro.topDays[0].minutes, 5);
});

test('side card "sua posicao" (modo pessoal) calcula o rank certo, com vizinhos', () => {
  const log = carregarLogIsolado();
  const listeners = [{ id: 'u1', username: 'Lider' }, { id: 'u2', username: 'Segundo' }, { id: 'u3', username: 'Terceiro' }];
  for (let i = 0; i < 5; i++) log.recordPlay({ guildId: 'g1', track: faixa(`a${i}`), requesterId: 'u1', requesterUsername: 'Lider', listeners });
  for (let i = 0; i < 3; i++) log.recordPlay({ guildId: 'g1', track: faixa(`b${i}`), requesterId: 'u2', requesterUsername: 'Segundo', listeners });
  log.recordPlay({ guildId: 'g1', track: faixa('c0'), requesterId: 'u3', requesterUsername: 'Terceiro', listeners });

  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'u2' });
  assert.equal(retro.side.title, 'Sua posição no servidor');
  assert.equal(retro.side.name, '2º lugar');
  assert.match(retro.side.note, /Lider/);
  assert.match(retro.side.note, /Terceiro/);
});

test('side card lida com usuario que nao pediu nada esse mes', () => {
  const log = carregarLogIsolado();
  log.recordPlay({ guildId: 'g1', track: faixa('t1'), requesterId: 'u1', listeners: [{ id: 'u1', username: 'F' }] });
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'personal', userId: 'ninguem' });
  assert.match(retro.side.note, /ainda não pediu/);
});

test('listAvailableMonths e por servidor, nao por usuario', () => {
  const log = carregarLogIsolado();
  log.recordPlay({ guildId: 'g1', track: faixa('t1'), requesterId: 'u1', listeners: [{ id: 'u1', username: 'F' }] });
  const meses = log.listAvailableMonths('g1');
  assert.equal(meses.length, 1);
  assert.equal(meses[0], log.monthKey(new Date()));
  assert.deepEqual(log.listAvailableMonths('g-sem-nada'), []);
});

test('topTracks/topArtists vem cortados em 5', () => {
  const log = carregarLogIsolado();
  for (let i = 0; i < 10; i++) {
    log.recordPlay({
      guildId: 'g1',
      track: faixa(`t${i}`, { artists: [`Artista ${i}`] }),
      requesterId: 'u1',
      listeners: [{ id: 'u1', username: 'F' }],
    });
  }
  const retro = log.getRetrospective({ guildId: 'g1', scope: 'server', userId: 'u1' });
  assert.equal(retro.topTracks.length, 5);
  assert.equal(retro.topArtists.length, 5);
});

test('getListenerIds cai pro userId antigo quando nao tem listeners (compatibilidade)', () => {
  const log = carregarLogIsolado();
  assert.deepEqual(log.getListenerIds({ userId: 'u1' }), ['u1']);
  assert.deepEqual(log.getListenerIds({ listeners: [{ id: 'u1' }, { id: 'u2' }] }), ['u1', 'u2']);
  assert.deepEqual(log.getListenerIds({}), []);
});
