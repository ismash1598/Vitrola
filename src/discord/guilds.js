const { PermissionFlagsBits } = require('discord.js');
const { getPlayer } = require('./guildPlayers');
const { forbidden, badRequest } = require('../httpError');

// Servidores onde o bot esta E o usuario tambem esta (interseccao entre o
// cache de guildas do bot e a lista de guildas do usuario, vinda do OAuth).
function listMutualGuilds(client, userGuildIds) {
  const idSet = new Set(userGuildIds);
  return client.guilds.cache
    .filter((g) => idSet.has(g.id))
    .map((g) => ({ id: g.id, name: g.name, icon: g.iconURL() }));
}

function isMutualGuild(client, userGuildIds, guildId) {
  return client.guilds.cache.has(guildId) && userGuildIds.includes(guildId);
}

// Garante que uma acao de tocar/enfileirar so acontece se o usuario estiver
// no lugar certo:
// - Se o bot ainda nao esta em nenhum canal de voz dessa guilda, entra
//   automaticamente no canal onde o usuario esta agora.
// - Se o bot JA esta tocando em algum canal, o usuario precisa estar
//   exatamente nesse mesmo canal - senao ninguem consegue "sequestrar" a fila
//   de outro canal ou de outro servidor.
async function ensureVoiceForUser(client, guildId, userId) {
  const guild = await client.guilds.fetch(guildId);
  const player = getPlayer(guildId);
  const botChannelId = player.getVoiceChannelId();

  if (botChannelId) {
    const voiceState = guild.voiceStates.cache.get(userId);
    if (voiceState?.channelId !== botChannelId) {
      throw forbidden('Você não está no mesmo canal de voz que o bot.');
    }
    return player;
  }

  const voiceState = guild.voiceStates.cache.get(userId);
  const channelId = voiceState?.channelId;
  if (!channelId) {
    throw badRequest('Entre em um canal de voz do Discord primeiro.');
  }
  await player.ensureConnected(guild, channelId);
  return player;
}

// Usado tanto pra proteger rotas (requireSameVoiceChannel abaixo) quanto
// pra decidir, na hora que uma faixa REALMENTE comeca a tocar, se quem
// pediu ainda esta la pra receber o credito no historico pessoal (ver
// trackPlayTracker.js) - por isso devolve booleano em vez de lancar.
function isUserInChannel(client, guildId, userId, channelId) {
  if (!channelId) return false;
  const guild = client.guilds.cache.get(guildId);
  const voiceState = guild?.voiceStates.cache.get(userId);
  return voiceState?.channelId === channelId;
}

// Igual a checagem acima, mas so valida (nunca conecta o bot em lugar
// nenhum) - usada para acoes sobre uma fila que ja existe, como reordenar ou
// remover itens. Se o bot nao esta tocando em nenhum canal ainda, nao ha o
// que proteger.
function requireSameVoiceChannel(client, guildId, userId, player) {
  const botChannelId = player.getVoiceChannelId();
  if (!botChannelId) return;

  if (!isUserInChannel(client, guildId, userId, botChannelId)) {
    throw forbidden('Você não está no mesmo canal de voz que o bot.');
  }
}

async function isGuildAdmin(client, guildId, userId) {
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(userId);
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

// So quem adicionou uma faixa (addedBy) ou um administrador da guild pode
// fazer algo disruptivo com ela (pular, remover da fila, reordenar). Faixas
// sem addedBy (autoplay) nao tem dono - qualquer um no canal pode mexer.
//
// Extraido daqui em vez de repetir em cada rota: antes so /skip tinha essa
// checagem, e /queue/:index, /queue e /queue/reorder deixavam qualquer
// pessoa no canal de voz mexer nas faixas de QUALQUER outra pessoa (ver F4
// da auditoria de seguranca).
async function requireTrackOwnerOrAdmin(client, guildId, userId, addedBy) {
  if (!addedBy || addedBy === userId) return;
  const admin = await isGuildAdmin(client, guildId, userId);
  if (!admin) {
    throw forbidden('Só quem adicionou essa música ou um administrador pode fazer isso.');
  }
}

module.exports = {
  listMutualGuilds,
  isMutualGuild,
  ensureVoiceForUser,
  requireSameVoiceChannel,
  isUserInChannel,
  isGuildAdmin,
  requireTrackOwnerOrAdmin,
};
