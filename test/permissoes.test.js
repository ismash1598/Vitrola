const test = require('node:test');
const assert = require('node:assert');
const { requireSameVoiceChannel, requireTrackOwnerOrAdmin, isUserInChannel } = require('../src/discord/guilds');
const { canView, canEdit } = require('../src/db/playlists');

function clienteComUsuarioEm(canalDoUsuario) {
  return {
    guilds: {
      cache: {
        get: () => ({
          voiceStates: {
            cache: {
              get: () => (canalDoUsuario ? { channelId: canalDoUsuario } : undefined),
            },
          },
        }),
      },
    },
  };
}

const playerNoCanal = (id) => ({ getVoiceChannelId: () => id });

test('bloqueia quem nao esta no mesmo canal de voz que o bot', () => {
  const casos = [
    ['usuario em outro canal', 'canal-B'],
    ['usuario fora de canal de voz', null],
  ];
  for (const [descricao, canal] of casos) {
    assert.throws(
      () => requireSameVoiceChannel(clienteComUsuarioEm(canal), 'g1', 'u1', playerNoCanal('canal-A')),
      (err) => err.status === 403,
      descricao
    );
  }
});

test('libera quem esta no mesmo canal do bot', () => {
  assert.doesNotThrow(() =>
    requireSameVoiceChannel(clienteComUsuarioEm('canal-A'), 'g1', 'u1', playerNoCanal('canal-A'))
  );
});

test('nao exige canal quando o bot nao esta tocando em lugar nenhum', () => {
  assert.doesNotThrow(() =>
    requireSameVoiceChannel(clienteComUsuarioEm(null), 'g1', 'u1', playerNoCanal(null))
  );
});

// ---- Presenca no canal (usado pro credito pessoal de historico/retrospectiva) ----
// F: registrar historico so quando quem pediu ainda esta na call quando a
// musica toca de verdade (ver trackPlayTracker.js).

test('isUserInChannel confirma quem esta no canal certo', () => {
  assert.equal(isUserInChannel(clienteComUsuarioEm('canal-A'), 'g1', 'u1', 'canal-A'), true);
});

test('isUserInChannel nega quem esta em outro canal ou fora de canal nenhum', () => {
  assert.equal(isUserInChannel(clienteComUsuarioEm('canal-B'), 'g1', 'u1', 'canal-A'), false);
  assert.equal(isUserInChannel(clienteComUsuarioEm(null), 'g1', 'u1', 'canal-A'), false);
});

test('isUserInChannel nega quando nao ha canal do bot pra comparar', () => {
  assert.equal(isUserInChannel(clienteComUsuarioEm('canal-A'), 'g1', 'u1', null), false);
});

// ---- Posse de faixa (skip / remover da fila / reordenar) ----
// F4 da auditoria de seguranca: so /skip verificava addedBy/admin; remover e
// reordenar itens da fila deixavam qualquer pessoa no canal mexer nas
// faixas de QUALQUER outra pessoa.

function clienteComAdmin(ehAdmin) {
  return {
    guilds: {
      fetch: async () => ({
        members: {
          fetch: async () => ({
            permissions: { has: () => ehAdmin },
          }),
        },
      }),
    },
  };
}

test('requireTrackOwnerOrAdmin libera quem adicionou a propria faixa', async () => {
  await assert.doesNotReject(() => requireTrackOwnerOrAdmin(null, 'g1', 'u1', 'u1'));
});

test('requireTrackOwnerOrAdmin libera faixa sem dono (veio do autoplay)', async () => {
  await assert.doesNotReject(() => requireTrackOwnerOrAdmin(null, 'g1', 'u1', null));
});

test('requireTrackOwnerOrAdmin bloqueia quem nao adicionou e nao e admin', async () => {
  await assert.rejects(
    () => requireTrackOwnerOrAdmin(clienteComAdmin(false), 'g1', 'u1', 'outro-usuario'),
    (err) => err.status === 403
  );
});

test('requireTrackOwnerOrAdmin libera administrador mesmo sem ser quem adicionou', async () => {
  await assert.doesNotReject(() =>
    requireTrackOwnerOrAdmin(clienteComAdmin(true), 'g1', 'u1', 'outro-usuario')
  );
});

// ---- Visibilidade de playlist ----

const dono = { id: 'u-dono', guildIds: ['g1'] };
const colega = { id: 'u-colega', guildIds: ['g1'] };
const estranho = { id: 'u-estranho', guildIds: ['g2'] };

const privada = { visibility: 'private', ownerId: dono.id, guildId: 'g1' };
const doServidor = { visibility: 'server', ownerId: dono.id, guildId: 'g1' };
const publica = { visibility: 'public', ownerId: dono.id, guildId: 'g1' };

test('playlist privada so aparece pro dono', () => {
  assert.equal(canView(privada, dono), true);
  assert.equal(canView(privada, colega), false);
  assert.equal(canView(privada, estranho), false);
});

test('playlist do servidor aparece pra quem esta no servidor', () => {
  assert.equal(canView(doServidor, dono), true);
  assert.equal(canView(doServidor, colega), true);
  assert.equal(canView(doServidor, estranho), false, 'quem nao esta no servidor nao deveria ver');
});

test('playlist publica aparece pra qualquer um', () => {
  assert.equal(canView(publica, estranho), true);
});

test('so o dono edita, mesmo em playlist publica', () => {
  assert.equal(canEdit(publica, dono), true);
  assert.equal(canEdit(publica, colega), false);
  assert.equal(canEdit(doServidor, colega), false);
});

test('visibilidade desconhecida nega o acesso (falha pro lado seguro)', () => {
  assert.equal(canView({ visibility: 'qualquer-coisa', ownerId: dono.id }, dono), false);
});
