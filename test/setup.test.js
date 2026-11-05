const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  missingRequired,
  inviteUrl,
  resolveOrigin,
  validateForm,
  mergeEnv,
  isLocalHost,
} = require('../src/setup/envFile');
const { createSetupApp } = require('../src/setup/setupServer');

const TOKEN = `${'A'.repeat(26)}.${'b'.repeat(6)}.${'C'.repeat(38)}`;
const CLIENT_ID = '123456789012345678';
const SECRET = 'x'.repeat(32);

const validForm = { token: TOKEN, clientId: CLIENT_ID, clientSecret: SECRET };

test('missingRequired lista o que falta no .env', () => {
  assert.deepEqual(missingRequired({}), [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'WEB_ORIGIN',
    'DISCORD_REDIRECT_URI',
  ]);
  assert.deepEqual(
    missingRequired({
      DISCORD_TOKEN: 't',
      DISCORD_CLIENT_ID: 'i',
      DISCORD_CLIENT_SECRET: 's',
      WEB_ORIGIN: 'http://localhost:3000',
      DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/discord/callback',
    }),
    []
  );
  assert.deepEqual(missingRequired({ DISCORD_TOKEN: '   ' }).includes('DISCORD_TOKEN'), true);
});

test('inviteUrl pede conectar, falar, ver canais e enviar mensagens', () => {
  const url = new URL(inviteUrl(CLIENT_ID));
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('scope'), 'bot');
  assert.equal(url.searchParams.get('permissions'), '3148800');
});

test('resolveOrigin: vazio vira localhost, aceita https e rejeita http remoto', () => {
  assert.deepEqual(resolveOrigin('', 3000), { origin: 'http://localhost:3000' });
  assert.deepEqual(resolveOrigin('https://abc.trycloudflare.com/qualquer/coisa', 3000), {
    origin: 'https://abc.trycloudflare.com',
  });
  assert.ok(resolveOrigin('http://exemplo.com', 3000).error);
  assert.ok(resolveOrigin('nao e url', 3000).error);
  assert.deepEqual(resolveOrigin('http://localhost:4000', 3000), { origin: 'http://localhost:4000' });
});

test('validateForm aceita o minimo e monta WEB_ORIGIN/redirect para localhost', () => {
  const { errors, values } = validateForm(validForm);
  assert.deepEqual(errors, {});
  assert.equal(values.DISCORD_TOKEN, TOKEN);
  assert.equal(values.DISCORD_CLIENT_ID, CLIENT_ID);
  assert.equal(values.WEB_ORIGIN, 'http://localhost:3000');
  assert.equal(values.DISCORD_REDIRECT_URI, 'http://localhost:3000/auth/discord/callback');
  assert.equal('SPOTIFY_CLIENT_ID' in values, false);
});

test('validateForm exige os campos do Discord, mas aceita em branco ao reconfigurar', () => {
  const { errors } = validateForm({});
  assert.deepEqual(Object.keys(errors).sort(), ['clientId', 'clientSecret', 'token']);

  const existing = { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'i', DISCORD_CLIENT_SECRET: 's' };
  assert.deepEqual(validateForm({}, existing).errors, {});
});

test('validateForm recusa valores com formato errado ou caracteres que quebram o .env', () => {
  assert.ok(validateForm({ ...validForm, token: 'curto' }).errors.token);
  assert.ok(validateForm({ ...validForm, clientId: 'abc' }).errors.clientId);
  assert.ok(validateForm({ ...validForm, clientSecret: `${SECRET} # x` }).errors.clientSecret);
  assert.ok(validateForm({ ...validForm, publicUrl: 'http://exemplo.com' }).errors.publicUrl);
});

test('validateForm: Spotify e opcional, mas so vale com os dois campos', () => {
  const id = 'a'.repeat(32);
  const secret = 'b'.repeat(32);
  assert.deepEqual(validateForm({ ...validForm, spotifyClientId: id, spotifyClientSecret: secret }).errors, {});
  assert.ok(validateForm({ ...validForm, spotifyClientId: id }).errors.spotifyClientSecret);
  assert.ok(validateForm({ ...validForm, spotifyClientSecret: secret }).errors.spotifyClientId);
  assert.ok(validateForm({ ...validForm, spotifyClientId: 'curto', spotifyClientSecret: secret }).errors.spotifyClientId);
  // ja configurado no .env + so um campo novo = continua par completo
  assert.deepEqual(
    validateForm(
      { ...validForm, spotifyClientId: id },
      { SPOTIFY_CLIENT_ID: 'x', SPOTIFY_CLIENT_SECRET: 'y' }
    ).errors,
    {}
  );
});

test('mergeEnv preserva comentarios e variaveis alheias, atualiza e acrescenta', () => {
  const before = '# meu bot\nPORT=4000\nDISCORD_TOKEN=velho\nDISCORD_TOKEN=duplicado\n';
  const after = mergeEnv(before, { DISCORD_TOKEN: 'novo', DISCORD_CLIENT_ID: '1' });
  assert.equal(after, '# meu bot\nPORT=4000\nDISCORD_TOKEN=novo\nDISCORD_TOKEN=novo\nDISCORD_CLIENT_ID=1\n');
  assert.equal(mergeEnv('', { A: '1' }), 'A=1\n');
});

test('isLocalHost so aceita o proprio computador', () => {
  assert.equal(isLocalHost('localhost:3000'), true);
  assert.equal(isLocalHost('127.0.0.1:3000'), true);
  assert.equal(isLocalHost('localhost'), true);
  assert.equal(isLocalHost('evil.com'), false);
  assert.equal(isLocalHost('localhost.evil.com'), false);
  assert.equal(isLocalHost(undefined), false);
});

function request(port, { method = 'GET', path: reqPath, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: reqPath,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withSetupApp(fetchImpl, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitrola-setup-'));
  const envPath = path.join(dir, '.env');
  let saved = 0;
  const app = createSetupApp({ envPath, port: 3000, fetchImpl, onSaved: () => saved++ });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    await fn({ port: server.address().port, envPath, savedCount: () => saved });
  } finally {
    server.close();
    server.closeAllConnections?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const discordOk = async () => ({ ok: true, status: 200, json: async () => ({ id: CLIENT_ID, username: 'meubot' }) });
const discord401 = async () => ({ ok: false, status: 401, json: async () => ({}) });

test('POST /setup/save grava o .env, devolve o link de convite e avisa que salvou', async () => {
  await withSetupApp(discordOk, async ({ port, envPath, savedCount }) => {
    const res = await request(port, { method: 'POST', path: '/setup/save', body: validForm });
    const json = JSON.parse(res.body);
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.match(json.inviteUrl, /client_id=123456789012345678/);

    const written = fs.readFileSync(envPath, 'utf8');
    assert.match(written, new RegExp(`DISCORD_TOKEN=${TOKEN}`));
    assert.match(written, /WEB_ORIGIN=http:\/\/localhost:3000/);
    assert.match(written, /DISCORD_REDIRECT_URI=http:\/\/localhost:3000\/auth\/discord\/callback/);

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(savedCount(), 1);
  });
});

test('POST /setup/save nao grava nada se o Discord recusar o token', async () => {
  await withSetupApp(discord401, async ({ port, envPath, savedCount }) => {
    const res = await request(port, { method: 'POST', path: '/setup/save', body: validForm });
    assert.equal(res.status, 400);
    assert.ok(JSON.parse(res.body).errors.token);
    assert.equal(fs.existsSync(envPath), false);
    assert.equal(savedCount(), 0);
  });
});

test('POST /setup/save com campos invalidos devolve os erros por campo', async () => {
  await withSetupApp(discordOk, async ({ port, envPath }) => {
    const res = await request(port, { method: 'POST', path: '/setup/save', body: { token: 'x' } });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(JSON.parse(res.body).errors).sort(), ['clientId', 'clientSecret', 'token']);
    assert.equal(fs.existsSync(envPath), false);
  });
});

test('a tela de configuracao recusa Host/Origin que nao sejam do proprio computador', async () => {
  await withSetupApp(discordOk, async ({ port, envPath }) => {
    const rebind = await request(port, {
      method: 'POST',
      path: '/setup/save',
      headers: { Host: 'evil.com' },
      body: validForm,
    });
    assert.equal(rebind.status, 403);

    const crossOrigin = await request(port, {
      method: 'POST',
      path: '/setup/save',
      headers: { Origin: 'https://evil.com' },
      body: validForm,
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(fs.existsSync(envPath), false);
  });
});

test('GET /setup/info nunca devolve segredos', async () => {
  await withSetupApp(discordOk, async ({ port, envPath }) => {
    fs.writeFileSync(envPath, `DISCORD_TOKEN=${TOKEN}\nDISCORD_CLIENT_SECRET=${SECRET}\n`);
    const res = await request(port, { path: '/setup/info' });
    assert.equal(res.status, 200);
    assert.ok(!res.body.includes(TOKEN));
    assert.ok(!res.body.includes(SECRET));
    const info = JSON.parse(res.body);
    assert.equal(info.configured.token, true);
    assert.equal(info.configured.clientId, false);
  });
});
