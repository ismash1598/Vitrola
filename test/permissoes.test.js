const test = require('node:test');
const assert = require('node:assert');
const { requireSameVoiceChannel } = require('../src/discord/guilds');
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
