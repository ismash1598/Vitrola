const test = require('node:test');
const assert = require('node:assert');
const { createStreamTicket, consumeStreamTicket } = require('../src/discord/session');

// Ticket que autentica o /listen (ver comentario em session.js) - precisa
// ser de uso unico e devolver o usuario certo, sem depender do token de
// sessao de 90 dias (esse nunca pode aparecer numa URL de <audio src>).

test('consumeStreamTicket devolve o usuario que gerou o ticket', () => {
  const user = { id: 'u1', username: 'Fulano', guildIds: ['g1'] };
  const ticket = createStreamTicket(user);
  assert.deepEqual(consumeStreamTicket(ticket), user);
});

test('consumeStreamTicket e de uso unico - a segunda tentativa falha', () => {
  const user = { id: 'u1', guildIds: [] };
  const ticket = createStreamTicket(user);
  consumeStreamTicket(ticket);
  assert.equal(consumeStreamTicket(ticket), null);
});

test('consumeStreamTicket recusa ticket que nunca existiu', () => {
  assert.equal(consumeStreamTicket('ticket-inventado'), null);
});

test('consumeStreamTicket recusa ticket vazio/undefined', () => {
  assert.equal(consumeStreamTicket(undefined), null);
  assert.equal(consumeStreamTicket(''), null);
});
