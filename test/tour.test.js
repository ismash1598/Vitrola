const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { FLOWS, SCREEN_FLOW, detectScreen } = require('../demo/tour');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('roteiros: cada passo tem id único, título e texto', () => {
  for (const [name, flow] of Object.entries(FLOWS)) {
    assert.ok(flow.label, name);
    assert.ok(flow.steps.length > 0, name);
    const ids = flow.steps.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `ids repetidos em ${name}`);
    for (const step of flow.steps) {
      assert.ok(step.id && step.title && step.text, `${name}/${step.id}`);
    }
  }
});

test('roteiros: passo que exige ação sabe quando terminou (e não fica preso)', () => {
  for (const [name, flow] of Object.entries(FLOWS)) {
    for (const step of flow.steps) {
      if (!step.needsAction) continue;
      // chooser não tem done: sai dele quando a tela muda (ver detectScreen)
      if (name === 'chooser') continue;
      assert.ok(typeof step.done === 'function' || step.advanceOnClick, `${name}/${step.id} nunca avançaria`);
    }
  }
});

test('roteiros: o último passo de cada modo pode ser concluído com um clique', () => {
  for (const name of ['browser', 'discord']) {
    const last = FLOWS[name].steps.at(-1);
    assert.ok(!last.needsAction, `${name}/${last.id} deixaria a pessoa presa no fim`);
  }
});

test('roteiros: os elementos destacados existem no index.html', () => {
  const hasId = (id) => html.includes(`id="${id}"`);
  const hasClass = (cls) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(html);
  const hasTab = (tab) => html.includes(`data-tab="${tab}"`);

  for (const [name, flow] of Object.entries(FLOWS)) {
    for (const step of flow.steps) {
      if (step.dynamic) continue; // criado em tempo de execução (resultados, servidores)
      for (const sel of step.target || []) {
        const where = `${name}/${step.id}: ${sel}`;
        for (const m of sel.matchAll(/#([\w-]+)/g)) assert.ok(hasId(m[1]), `${where} (#${m[1]})`);
        for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) assert.ok(hasClass(m[1]), `${where} (.${m[1]})`);
        for (const m of sel.matchAll(/data-tab="([\w-]+)"/g)) assert.ok(hasTab(m[1]), `${where} (data-tab=${m[1]})`);
      }
    }
  }
});

test('roteiros: ids usados nas condições de término existem no index.html', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'demo', 'tour.js'), 'utf8');
  for (const m of source.matchAll(/(?:shown|has)\(d, '#([\w-]+)/g)) {
    assert.ok(html.includes(`id="${m[1]}"`), `#${m[1]}`);
  }
  for (const m of source.matchAll(/isActive\('([\w-]+)'\)/g)) {
    assert.ok(html.includes(`id="${m[1]}"`), `#${m[1]}`);
  }
});

test('cada tela do app aponta para um roteiro que existe', () => {
  for (const flow of Object.values(SCREEN_FLOW)) assert.ok(FLOWS[flow], flow);
});

test('detectScreen reconhece a tela visível, na ordem certa', () => {
  const fakeDoc = (visible) => ({
    querySelector: (sel) => (sel in visible ? { classList: { contains: () => !visible[sel] } } : null),
  });
  const screens = {
    landing: { '#landing-page': true },
    browser: { '#landing-page': false, '#browser-player-shell': true },
    guild: { '#landing-page': false, '#guild-picker-screen': true },
    chooser: { '#landing-page': false, '#mode-chooser': true },
    app: { '#landing-page': false, '.app-shell': true },
  };
  for (const [expected, visible] of Object.entries(screens)) {
    assert.equal(detectScreen(fakeDoc(visible)), expected);
  }
  assert.equal(detectScreen(fakeDoc({})), 'none');
  // login ainda carregando: landing manda mesmo se o app-shell ainda não foi escondido
  assert.equal(detectScreen(fakeDoc({ '#landing-page': true, '.app-shell': true })), 'landing');
});

test('texto do passo de escolha muda conforme o que já foi visto', () => {
  const text = FLOWS.chooser.steps[0].text;
  const none = text({ completed: {} });
  const one = text({ completed: { browser: true } });
  const both = text({ completed: { browser: true, discord: true } });
  assert.notEqual(none, one);
  assert.notEqual(one, both);
});
