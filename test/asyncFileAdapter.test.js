const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const low = require('lowdb');
const AsyncFileAdapter = require('../src/db/asyncFileAdapter');

function arquivoTemporario() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vitrola-')), 'dados.json');
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('grava e le de volta', async () => {
  const arquivo = arquivoTemporario();
  const db = low(new AsyncFileAdapter(arquivo, { defaultValue: { itens: [] } }));
  db.defaults({ itens: [] }).write();
  db.get('itens').push({ a: 1 }).write();

  await esperar(50);
  assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, 'utf-8')).itens, [{ a: 1 }]);
});

test('arquivo inexistente comeca do valor padrao', () => {
  const adapter = new AsyncFileAdapter(arquivoTemporario(), { defaultValue: { itens: [] } });
  assert.deepEqual(adapter.read(), { itens: [] });
});

test('uma rajada de gravacoes termina com o estado final correto', async () => {
  // O ponto da otimizacao: gravacoes em sequencia sao coalescidas, entao o
  // disco nao precisa acompanhar uma por uma - mas o resultado final tem que
  // bater exatamente com o que esta em memoria.
  const arquivo = arquivoTemporario();
  const db = low(new AsyncFileAdapter(arquivo, { defaultValue: { itens: [] } }));
  db.defaults({ itens: [] }).write();

  for (let i = 0; i < 300; i++) db.get('itens').push({ i }).write();

  await esperar(200);
  const noDisco = JSON.parse(fs.readFileSync(arquivo, 'utf-8')).itens;
  assert.equal(noDisco.length, 300);
  assert.equal(noDisco[299].i, 299);
});

test('nao deixa arquivo temporario pra tras', async () => {
  const arquivo = arquivoTemporario();
  const db = low(new AsyncFileAdapter(arquivo, { defaultValue: { itens: [] } }));
  db.defaults({ itens: [] }).write();
  for (let i = 0; i < 50; i++) db.get('itens').push({ i }).write();

  await esperar(150);
  assert.equal(fs.existsSync(`${arquivo}.tmp`), false);
});

test('write() nao bloqueia esperando o disco', () => {
  // Se voltar a gravar de forma sincrona, isso aqui estoura - era esse
  // bloqueio que engasgava o audio no celular.
  const arquivo = arquivoTemporario();
  const db = low(new AsyncFileAdapter(arquivo, { defaultValue: { itens: [] } }));
  db.defaults({ itens: [] }).write();

  const grande = 'x'.repeat(2000);
  const inicio = Date.now();
  for (let i = 0; i < 200; i++) db.get('itens').push({ i, grande }).write();
  const decorrido = Date.now() - inicio;

  assert.ok(decorrido < 250, `200 gravacoes bloquearam ${decorrido}ms - deveria ser bem menos`);
});

test('flushSync grava o que estava pendente', () => {
  const arquivo = arquivoTemporario();
  const adapter = new AsyncFileAdapter(arquivo, { defaultValue: { itens: [] } });
  adapter.write({ itens: [{ pendente: true }] });
  adapter.flushSync();

  assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, 'utf-8')).itens, [{ pendente: true }]);
});

test('serializa o estado no momento da chamada, nao depois', async () => {
  // O objeto que o lowdb passa e mutavel: se a serializacao ficasse pra
  // depois, uma mudanca posterior vazaria pra uma gravacao antiga.
  const arquivo = arquivoTemporario();
  const adapter = new AsyncFileAdapter(arquivo, { defaultValue: {} });

  const estado = { valor: 'antes' };
  adapter.write(estado);
  estado.valor = 'depois';

  await esperar(50);
  assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf-8')).valor, 'antes');
});
