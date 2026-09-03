// Liga o evento 'trackStart' do guildPlayers (uma faixa REALMENTE comecou a
// tocar, ver comentario em startFfmpegAndPlay) ao registro permanente de
// historico/retrospectiva - nunca no momento em que a faixa e adicionada na
// fila. Uma fila longa pode levar minutos pra chegar na vez de uma faixa, e
// ela pode ser pulada/removida antes disso - nada disso deveria contar como
// "ouvida".
//
// "Pessoal" conta pra TODO MUNDO que estava no canal de voz no instante em
// que a faixa comecou - pedida por essa pessoa ou nao. "Quem mais pediu" e
// "sua posicao no servidor" continuam sendo so sobre quem ADICIONOU
// (addedBy), que e um dado diferente.
const bot = require('./bot');
const { playerEvents, getPlayer } = require('./guildPlayers');
const history = require('./history');
const listeningLog = require('./listeningLog');

playerEvents.on('trackStart', ({ guildId, track }) => {
  try {
    const botChannelId = getPlayer(guildId).getVoiceChannelId();
    const guild = bot.client.guilds.cache.get(guildId);
    const channel = botChannelId ? guild?.channels.cache.get(botChannelId) : null;

    const listeners = channel
      ? [...channel.members.values()]
          .filter((m) => !m.user.bot)
          .map((m) => ({ id: m.id, username: m.user.username }))
      : [];

    // Quem pediu so conta pro ranking de "quem mais pediu" se ainda
    // estiver la - se ja tiver saido antes da faixa comecar, o pedido nao
    // e creditado a ninguem (mas a faixa continua contando pra quem
    // realmente estava ouvindo, via "listeners" acima).
    const stillPresent = track.addedBy && listeners.some((l) => l.id === track.addedBy);
    const requesterId = stillPresent ? track.addedBy : null;
    const requesterUsername = stillPresent ? track.addedByUsername || null : null;

    listeningLog.recordPlay({ guildId, track, requesterId, requesterUsername, listeners });

    // "Recomendado pra voce" (tela inicial) passa a refletir o que cada um
    // realmente ouviu, nao so o que pediu - mesma logica.
    listeners.forEach((l) => history.recordHistory(l.id, track));
  } catch (err) {
    console.error('[trackPlayTracker] falha ao registrar reproducao:', err.message);
  }
});

module.exports = {};
