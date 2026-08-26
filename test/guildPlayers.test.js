const test = require('node:test');
const assert = require('node:assert');
const { montarPlayer, faixa } = require('./helpers/playerHarness');

// Cada teste aqui corresponde a um bug que aconteceu de verdade em uso.
// Se algum voltar a falhar, o comentario diz qual sintoma o usuario veria.

test('a fila avanca sozinha quando a musica termina', async (t) => {
  // Sintoma do bug: "a musica acaba e nao passa para a proxima" - so
  // avancava clicando em pular.
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('a'));
  h.player.enqueue(faixa('b'));
  await h.assentar();
  assert.equal(h.player.getStatus().current.track.id, 'a');

  h.processoAtual().terminarNaturalmente();
  await h.assentar();

  assert.equal(h.player.getStatus().current.track.id, 'b', 'deveria ter avancado sozinha para a faixa b');
});

test('pular avanca exatamente uma faixa', async (t) => {
  const h = montarPlayer();
  t.after(() => h.restaurar());

  ['a', 'b', 'c'].forEach((id) => h.player.enqueue(faixa(id)));
  await h.assentar();
  assert.equal(h.player.getStatus().current.track.id, 'a');

  h.player.skip();
  await h.assentar();

  assert.equal(h.player.getStatus().current.track.id, 'b');
  assert.equal(h.player.getStatus().queueLength, 1, 'so a faixa c deveria restar na fila');
});

test('cliques rapidos em pular nao varrem a fila inteira', async (t) => {
  // Sintoma do bug: "ao clicar no botao de pular varias vezes o bot buga e
  // sai pulando todas as musicas". Com atraso na resolucao do audio, varios
  // avancos ficam em voo ao mesmo tempo - e ai a corrida aparece.
  const h = montarPlayer({ atrasoResolucaoMs: 10 });
  t.after(() => h.restaurar());

  ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id) => h.player.enqueue(faixa(id)));
  await h.assentar();
  assert.equal(h.player.getStatus().current.track.id, 'a');

  h.player.skip();
  h.player.skip();
  await h.assentar(30);

  const restante = h.player.getStatus().queueLength;
  assert.ok(restante >= 3, `a fila nao deveria ter sido varrida (restaram ${restante} de 5)`);
});

test('adicionar uma faixa nao fura a fila', async (t) => {
  // Sintoma do bug: "ao adicionar a musica a fila ela esta entrando na
  // frente das outras como ordem de prioridade".
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('tocando'));
  h.player.enqueue(faixa('ja-na-fila'));
  await h.assentar();

  h.player.enqueue(faixa('nova'));
  await h.assentar();

  const fila = h.player.getStatus({ fullQueue: true }).queue.map((t2) => t2.id);
  assert.deepEqual(fila, ['ja-na-fila', 'nova'], 'a nova deveria entrar no fim');
});

test('playNext coloca a faixa na frente da fila', async (t) => {
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('tocando'));
  h.player.enqueue(faixa('ja-na-fila'));
  await h.assentar();

  h.player.enqueue(faixa('urgente'), true);
  await h.assentar();

  const fila = h.player.getStatus({ fullQueue: true }).queue.map((t2) => t2.id);
  assert.deepEqual(fila, ['urgente', 'ja-na-fila']);
});

test('pular nao dispara um avanco duplo', async (t) => {
  // Sintoma do bug: matar o processo do ffmpeg num skip emitia o mesmo
  // evento de "terminou" que o fim natural, e a fila andava duas casas.
  const h = montarPlayer();
  t.after(() => h.restaurar());

  ['a', 'b', 'c', 'd'].forEach((id) => h.player.enqueue(faixa(id)));
  await h.assentar();

  h.player.skip();
  await h.assentar(20);

  assert.equal(h.player.getStatus().current.track.id, 'b', 'pulou mais de uma faixa');
});

test('pular enquanto a faixa ainda carrega nao trava o avanco depois', async (t) => {
  // Sintoma do bug: "so ta passando quando eu aperto o botao, nao ta pulando
  // sozinho". A causa era sutil: pular ANTES do audio comecar (faixa ainda
  // sendo resolvida) deixava um "ignore o proximo fim de musica" pendurado,
  // sem nada pra consumir - e esse aviso acabava engolindo o fim de uma
  // musica seguinte, sem relacao nenhuma, travando o avanco automatico.
  //
  // Por isso o pulo aqui acontece SEM esperar o assentar(): e justamente a
  // janela em que ainda nao existe processo de audio rodando.
  const h = montarPlayer({ atrasoResolucaoMs: 10 });
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('a'));
  h.player.enqueue(faixa('b'));
  h.player.enqueue(faixa('c'));

  h.player.skip(); // <- durante o carregamento, sem processo ativo
  await h.assentar(30);

  const tocandoAgora = h.player.getStatus().current;
  assert.ok(tocandoAgora, 'deveria estar tocando alguma coisa depois do pulo');

  // Agora o teste de verdade: um fim NATURAL logo depois precisa avancar.
  h.processoAtual().terminarNaturalmente();
  await h.assentar(30);

  const depois = h.player.getStatus().current;
  assert.ok(depois, 'a fila travou: o fim natural nao avancou a faixa');
  assert.notEqual(depois.track.id, tocandoAgora.track.id, 'deveria ter trocado de faixa sozinha');
});

test('a faixa ja comeca marcada como tocando', async (t) => {
  // Sintoma do bug: "coloco uma musica e ela entra pausada".
  const h = montarPlayer({ atrasoResolucaoMs: 5 });
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('a'));
  await h.assentar();

  assert.equal(h.player.getStatus().current.paused, false);
});

test('a fila esvazia quando acaba e o autoplay esta desligado', async (t) => {
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.setAutoplay(false);
  h.player.enqueue(faixa('unica'));
  await h.assentar();

  h.processoAtual().terminarNaturalmente();
  await h.assentar();

  assert.equal(h.player.getStatus().current, null);
});

test('o autoplay entra quando a fila acaba', async (t) => {
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('unica'));
  await h.assentar();

  h.processoAtual().terminarNaturalmente();
  await h.assentar(20);

  const atual = h.player.getStatus().current;
  assert.ok(atual, 'o autoplay deveria ter emendado outra faixa');
  assert.match(atual.track.id, /^yt:mix/, `veio ${atual.track.id}`);
});

test('a sugestao do autoplay se baseia na musica que acabou de tocar', async (t) => {
  // Sintoma do bug: "eu estava numa musica de um estilo e do nada veio
  // outro". A sugestao adiantada em segundo plano ficava presa a uma musica
  // antiga quando o usuario mexia na fila no meio do caminho.
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('primeira'));
  await h.assentar(20);

  // Enquanto a primeira toca, o usuario adiciona outra: a sugestao adiantada
  // (baseada na "primeira") nao vale mais, porque quem vai terminar antes do
  // autoplay entrar agora e a "segunda".
  h.player.enqueue(faixa('segunda'));
  await h.assentar();

  h.processoAtual().terminarNaturalmente(); // acaba a primeira
  await h.assentar(20);
  assert.equal(h.player.getStatus().current.track.id, 'segunda');

  h.chamadas.getMix.length = 0;
  h.processoAtual().terminarNaturalmente(); // acaba a segunda -> autoplay
  await h.assentar(20);

  assert.ok(
    h.chamadas.getMix.includes('segunda'),
    `o mix deveria partir de "segunda", mas partiu de: ${JSON.stringify(h.chamadas.getMix)}`
  );
});

test('a proxima faixa e adiantada enquanto a atual toca', async (t) => {
  // Garante que a otimizacao de pre-busca continua valendo: sem ela, cada
  // troca de musica espera a ida ao YouTube na hora.
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('a'));
  h.player.enqueue(faixa('b'));
  await h.assentar(20);

  assert.ok(
    h.chamadas.resolveUrl.some((u) => u.includes('v=b')),
    'o audio da faixa b deveria ter sido resolvido antes dela tocar'
  );
});

// O volume virou um filtro do ffmpeg (nao mais inline), entao mudar o
// volume agora reinicia o processo - mas o slider manda uma requisicao por
// tique do arrasto. Sem o debounce, cada tique reiniciaria o audio.
test('arrastar o volume so reinicia o audio uma vez, depois de parar', async (t) => {
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('a'));
  await h.assentar(20);
  const antes = h.processoAtual();

  // Simula o arrasto: varios tiques em sequencia rapida.
  h.player.setVolume(0.8);
  h.player.setVolume(0.5);
  h.player.setVolume(0.3);

  assert.equal(
    h.processoAtual(),
    antes,
    'nao deveria ter reiniciado o audio enquanto o volume ainda estava mudando'
  );
  assert.equal(h.player.getStatus().volume, 0.3, 'o valor exibido deve atualizar na hora, mesmo antes do reinicio');

  await new Promise((r) => setTimeout(r, 300));

  assert.notEqual(
    h.processoAtual(),
    antes,
    'depois de parar de arrastar, o audio deveria ter reiniciado com o volume final'
  );
});

// skip()/advanceQueue() incrementam playToken, entao o proprio myToken do
// setVolume ja barraria um reinicio pendente depois de um skip - esse caso
// nao precisa do clearTimeout em killCurrentProcess pra ficar seguro.
// seek() e diferente: ele NAO incrementa playToken, entao e o unico jeito de
// exercitar de verdade essa segunda camada de protecao.
test('dar seek durante o arrasto do volume nao gera um reinicio extra depois', async (t) => {
  const h = montarPlayer();
  t.after(() => h.restaurar());

  h.player.enqueue(faixa('a'));
  await h.assentar(20);

  h.player.setVolume(0.4); // agenda um reinicio pendente (so daria em 250ms)
  await h.player.seek(30); // deveria cancelar aquele reinicio, nao empilhar outro
  const depoisDoSeek = h.processoAtual();

  await new Promise((r) => setTimeout(r, 300)); // tempo de sobra pro reinicio pendente disparar, se nao foi cancelado

  assert.equal(
    h.processoAtual(),
    depoisDoSeek,
    'o reinicio de volume agendado antes do seek nao deveria reiniciar o audio de novo depois'
  );
});
