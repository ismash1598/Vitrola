const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// O modulo grava em data/ relativo a raiz do projeto, entao cada teste roda
// numa copia isolada pra nao encostar nos dados de verdade.
function carregarHistoricoIsolado() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vitrola-hist-'));
  const src = path.join(raiz, 'src', 'discord');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(path.join(raiz, 'src', 'db'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'node_modules'), { recursive: true });

  const base = path.join(__dirname, '..');
  fs.copyFileSync(path.join(base, 'src', 'discord', 'history.js'), path.join(src, 'history.js'));
  fs.copyFileSync(
    path.join(base, 'src', 'db', 'asyncFileAdapter.js'),
    path.join(raiz, 'src', 'db', 'asyncFileAdapter.js')
  );
  fs.symlinkSync(
    path.join(base, 'node_modules', 'lowdb'),
    path.join(raiz, 'node_modules', 'lowdb'),
    'junction'
  );

  const modulo = path.join(src, 'history.js');
  delete require.cache[require.resolve(modulo)];
  return { historico: require(modulo), raiz, arquivo: path.join(raiz, 'data', 'history.json') };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('guarda a faixa ouvida e devolve na consulta', () => {
  const { historico } = carregarHistoricoIsolado();
  historico.recordHistory('u1', { id: 't1', name: 'Uma' });
  assert.deepEqual(historico.getHistory('u1').map((t) => t.id), ['t1']);
});

test('a mais recente aparece primeiro', () => {
  const { historico } = carregarHistoricoIsolado();
  historico.recordHistory('u1', { id: 't1', name: 'Primeira' });
  historico.recordHistory('u1', { id: 't2', name: 'Segunda' });
  assert.deepEqual(historico.getHistory('u1').map((t) => t.id), ['t2', 't1']);
});

test('ouvir de novo sobe a faixa em vez de duplicar', () => {
  const { historico } = carregarHistoricoIsolado();
  historico.recordHistory('u1', { id: 't1', name: 'A' });
  historico.recordHistory('u1', { id: 't2', name: 'B' });
  historico.recordHistory('u1', { id: 't1', name: 'A' });
  assert.deepEqual(historico.getHistory('u1').map((t) => t.id), ['t1', 't2']);
});

test('guarda no maximo 10 faixas', () => {
  const { historico } = carregarHistoricoIsolado();
  for (let i = 0; i < 25; i++) historico.recordHistory('u1', { id: `t${i}`, name: `F${i}` });
  const lista = historico.getHistory('u1');
  assert.equal(lista.length, 10);
  assert.equal(lista[0].id, 't24', 'a mais recente deveria estar no topo');
});

test('cada usuario tem o proprio historico', () => {
  const { historico } = carregarHistoricoIsolado();
  historico.recordHistory('u1', { id: 'a', name: 'A' });
  historico.recordHistory('u2', { id: 'b', name: 'B' });
  assert.deepEqual(historico.getHistory('u1').map((t) => t.id), ['a']);
  assert.deepEqual(historico.getHistory('u2').map((t) => t.id), ['b']);
});

test('usuario sem historico devolve lista vazia', () => {
  const { historico } = carregarHistoricoIsolado();
  assert.deepEqual(historico.getHistory('ninguem'), []);
});

// O motivo de existir esta mudanca: antes o "Recomendado para voce" sumia
// toda vez que o servidor reiniciava.
test('sobrevive ao reinicio do servidor', async () => {
  const primeiro = carregarHistoricoIsolado();
  primeiro.historico.recordHistory('u1', { id: 't1', name: 'Nao pode sumir' });
  await esperar(80);

  // Simula subir o processo de novo: mesmo diretorio, modulo recarregado.
  delete require.cache[require.resolve(path.join(primeiro.raiz, 'src', 'discord', 'history.js'))];
  const depoisDoRestart = require(path.join(primeiro.raiz, 'src', 'discord', 'history.js'));

  assert.deepEqual(
    depoisDoRestart.getHistory('u1').map((t) => t.id),
    ['t1'],
    'o historico deveria continuar la depois de reiniciar'
  );
});
