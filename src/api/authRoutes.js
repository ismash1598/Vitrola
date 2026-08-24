const express = require('express');
const { buildAuthorizeUrl, exchangeCodeForUser } = require('../discord/oauth');
const session = require('../discord/session');

const router = express.Router();

router.get('/discord/login', (req, res) => {
  res.redirect(buildAuthorizeUrl());
});

router.get('/discord/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Login cancelado ou negado: ${error}`);
  }
  if (!code) {
    return res.status(400).send('Faltou o parametro code na resposta do Discord.');
  }

  try {
    const user = await exchangeCodeForUser(code);
    const token = session.createSession(user);
    const webOrigin = process.env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
    res.redirect(`${webOrigin}/?sessionToken=${token}`);
  } catch (err) {
    console.error('[auth] erro no callback do Discord:', err.message);
    res.status(500).send(`Falha no login com Discord: ${err.message}`);
  }
});

module.exports = router;
