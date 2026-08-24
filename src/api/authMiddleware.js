const session = require('../discord/session');

function requireAuth(req, res, next) {
  const token = req.header('x-session-token');
  const user = token && session.getSession(token);

  if (!user) {
    return res.status(401).json({ error: 'Login com Discord necessario' });
  }

  req.user = user;
  next();
}

module.exports = { requireAuth };
