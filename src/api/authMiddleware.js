const session = require('../discord/session');
const bot = require('../discord/bot');
const { scheduleGuildRevalidation } = require('../discord/guildMembership');

function requireAuth(req, res, next) {
  const token = req.header('x-session-token');
  const user = token && session.getSession(token);

  if (!user) {
    return res.status(401).json({ error: 'Login com Discord necessario' });
  }

  req.user = user;
  // Dispara e segue: nao espera resposta, so mantem a lista de servidores
  // da sessao fresca com o tempo (ver guildMembership.js).
  scheduleGuildRevalidation(bot.client, user);
  next();
}

module.exports = { requireAuth };
