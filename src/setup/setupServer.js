const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const { validateForm, mergeEnv, inviteUrl, isLocalHost } = require('./envFile');

// Pergunta pro Discord quem e o dono do token - confirma que o token e
// valido e ja descobre o Client ID (o id do usuario-bot e o mesmo do app).
async function verifyBotToken(token, fetchImpl = fetch) {
  try {
    const res = await fetchImpl('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) return { ok: false, invalid: true, error: 'O Discord recusou esse token. Gere um novo em Bot > Reset Token.' };
    if (!res.ok) return { ok: false, error: `O Discord respondeu ${res.status}. Tente de novo em instantes.` };
    const me = await res.json();
    return { ok: true, id: me.id, username: me.username };
  } catch {
    return { ok: false, error: 'Nao consegui falar com o Discord (sem internet?). O token sera conferido quando o bot iniciar.' };
  }
}

function createSetupApp({ envPath, port, onSaved, fetchImpl }) {
  const app = express();

  // Barra qualquer pedido cujo Host nao seja o proprio computador (DNS
  // rebinding) - essa tela grava segredos no .env, so quem esta na maquina
  // pode usar.
  app.use((req, res, next) => {
    if (!isLocalHost(req.headers.host)) return res.status(403).send('Acesso negado.');
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (!isLocalHost(new URL(origin).host)) return res.status(403).send('Acesso negado.');
      } catch {
        return res.status(403).send('Acesso negado.');
      }
    }
    next();
  });
  app.use(express.json({ limit: '10kb' }));

  const readExisting = () => {
    try {
      return dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    } catch {
      return {};
    }
  };

  app.get('/', (req, res) => res.redirect('/setup'));
  app.get('/setup', (req, res) => res.sendFile(path.join(__dirname, 'setup.html')));

  // Nunca devolve segredos - so diz o que ja esta preenchido.
  app.get('/setup/info', (req, res) => {
    const existing = readExisting();
    const origin = existing.WEB_ORIGIN || '';
    res.json({
      port,
      configured: {
        token: Boolean(existing.DISCORD_TOKEN),
        clientId: Boolean(existing.DISCORD_CLIENT_ID),
        clientSecret: Boolean(existing.DISCORD_CLIENT_SECRET),
        spotify: Boolean(existing.SPOTIFY_CLIENT_ID && existing.SPOTIFY_CLIENT_SECRET),
      },
      publicUrl: /^https:/.test(origin) ? origin : '',
    });
  });

  app.post('/setup/verify', async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'Cole o token primeiro.' });
    res.json(await verifyBotToken(token, fetchImpl));
  });

  app.post('/setup/save', async (req, res) => {
    const existing = readExisting();
    const { errors, values } = validateForm(req.body, existing, port);
    if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

    if (values.DISCORD_TOKEN) {
      const check = await verifyBotToken(values.DISCORD_TOKEN, fetchImpl);
      if (check.invalid) return res.status(400).json({ ok: false, errors: { token: check.error } });
    }

    let previous = '';
    try {
      previous = fs.readFileSync(envPath, 'utf8');
    } catch {
      // primeiro uso: ainda nao existe .env
    }
    fs.writeFileSync(envPath, mergeEnv(previous, values), 'utf8');

    const clientId = values.DISCORD_CLIENT_ID || existing.DISCORD_CLIENT_ID;
    res.on('finish', () => setImmediate(() => onSaved()));
    res.json({
      ok: true,
      inviteUrl: inviteUrl(clientId),
      redirectUri: values.DISCORD_REDIRECT_URI,
      origin: values.WEB_ORIGIN,
    });
  });

  return app;
}

function startSetupServer({ envPath, port, onSaved, onListening, fetchImpl }) {
  let server;
  const app = createSetupApp({
    envPath,
    port,
    fetchImpl,
    onSaved: () => {
      // Libera a porta pro servidor de verdade assumir no mesmo processo.
      server.close(() => onSaved());
      server.closeAllConnections?.();
    },
  });
  server = app.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  Vitrola - configuracao inicial');
    console.log(`  Abra no navegador: ${url}/setup`);
    console.log('');
    onListening?.(url);
  });
  return server;
}

module.exports = { createSetupApp, startSetupServer, verifyBotToken };
