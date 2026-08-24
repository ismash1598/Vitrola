const { Client, GatewayIntentBits } = require('discord.js');
const { hasPlayer, getPlayer } = require('./guildPlayers');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

async function start() {
  const { DISCORD_TOKEN } = process.env;

  if (!DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN precisa estar configurado no .env');
  }

  client.once('clientReady', () => {
    console.log(`[bot] Logado como ${client.user.tag}, em ${client.guilds.cache.size} servidor(es).`);
  });

  // So verifica guildas que ja tem um player ativo (evita trabalho a toa
  // para servidores onde o bot nunca tocou nada).
  client.on('voiceStateUpdate', (oldState, newState) => {
    const guild = newState.guild ?? oldState.guild;
    if (!hasPlayer(guild.id)) return;
    getPlayer(guild.id).onVoiceStateChange(guild);
  });

  return client.login(DISCORD_TOKEN);
}

module.exports = { client, start };
