// Liga o evento 'trackStart' do guildPlayers (uma faixa REALMENTE comecou a
// tocar, ver comentario em startFfmpegAndPlay) ao registro permanente de
// historico/retrospectiva - nunca no momento em que a faixa e adicionada na
// fila. Uma fila longa pode levar minutos pra chegar na vez de uma faixa, e
// ela pode ser pulada/removida antes disso - nada disso deveria contar como
// "ouvida".
//
// Alem disso, so credita ao HISTORICO PESSOAL de quem adicionou (e a
// disputa de "quem mais pediu") se essa pessoa ainda estiver no mesmo canal
// de voz que o bot no instante em que a faixa comeca. Se ja tiver saido, a
// faixa ainda conta pra retrospectiva do SERVIDOR (tocou de verdade, pra
// quem estava la) mas fica sem credito pessoal - mesmo tratamento que
// faixas de autoplay, que tambem nao tem addedBy.
const bot = require('./bot');
const { playerEvents, getPlayer } = require('./guildPlayers');
const { isUserInChannel } = require('./guilds');
const history = require('./history');
const listeningLog = require('./listeningLog');

playerEvents.on('trackStart', ({ guildId, track }) => {
  try {
    let userId = track.addedBy || null;
    let username = track.addedByUsername || null;

    if (userId) {
      const botChannelId = getPlayer(guildId).getVoiceChannelId();
      if (!isUserInChannel(bot.client, guildId, userId, botChannelId)) {
        userId = null;
        username = null;
      }
    }

    listeningLog.recordPlay(userId, username, guildId, track);
    if (userId) history.recordHistory(userId, track);
  } catch (err) {
    console.error('[trackPlayTracker] falha ao registrar reproducao:', err.message);
  }
});

module.exports = {};
