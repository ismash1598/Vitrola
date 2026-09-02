const test = require('node:test');
const assert = require('node:assert');
const { requireWebOrigin } = require('../src/config');

// F3 da auditoria de seguranca: sem essa validacao, o processo subia normal
// mesmo sem WEB_ORIGIN, e o callback do OAuth caia num fallback que confiava
// no header Host da requisicao pra montar o redirect do login.
test('requireWebOrigin recusa subir quando WEB_ORIGIN nao esta definido', () => {
  assert.throws(() => requireWebOrigin({}), /WEB_ORIGIN/);
  assert.throws(() => requireWebOrigin({ WEB_ORIGIN: '' }), /WEB_ORIGIN/);
});

test('requireWebOrigin devolve o valor quando esta definido', () => {
  assert.equal(requireWebOrigin({ WEB_ORIGIN: 'https://exemplo.trycloudflare.com' }), 'https://exemplo.trycloudflare.com');
});
