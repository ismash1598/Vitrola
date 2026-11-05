// Logica pura da tela de configuracao inicial (sem rede, sem disco) - fica
// separada do servidor pra poder ser testada sozinha.

const REQUIRED_KEYS = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'WEB_ORIGIN',
  'DISCORD_REDIRECT_URI',
];

// Connect + Speak + View Channels + Send Messages
const INVITE_PERMISSIONS = 3148800;

// Valores gravados sem aspas no .env: espaco, aspas e "#" quebrariam o parser.
const SAFE = /^[^\s#'"`\\]+$/;

function missingRequired(env = process.env) {
  return REQUIRED_KEYS.filter((key) => !String(env[key] ?? '').trim());
}

function inviteUrl(clientId) {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${INVITE_PERMISSIONS}`;
}

// Aceita "https://abc.trycloudflare.com/qualquer/coisa" e devolve so a origem.
// Vazio -> localhost (o caso normal: so o proprio computador acessa).
function resolveOrigin(publicUrl, port) {
  const raw = String(publicUrl ?? '').trim();
  if (!raw) return { origin: `http://localhost:${port}` };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'URL invalida - use algo como https://exemplo.trycloudflare.com' };
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    return { error: 'A URL publica precisa comecar com https://' };
  }
  return { origin: parsed.origin };
}

const RULES = {
  token: {
    key: 'DISCORD_TOKEN',
    test: (v) => v.length >= 50 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(v),
    message: 'Esse token nao parece valido (ele tem 3 partes separadas por ponto). Copie de novo em Bot > Reset Token.',
  },
  clientId: {
    key: 'DISCORD_CLIENT_ID',
    test: (v) => /^\d{17,20}$/.test(v),
    message: 'O Client ID e um numero de 17 a 20 digitos (OAuth2 > General).',
  },
  clientSecret: {
    key: 'DISCORD_CLIENT_SECRET',
    test: (v) => /^[\w-]{20,64}$/.test(v),
    message: 'Esse Client Secret nao parece valido (OAuth2 > General > Reset Secret).',
  },
  spotifyClientId: {
    key: 'SPOTIFY_CLIENT_ID',
    test: (v) => /^[a-f0-9]{32}$/i.test(v),
    message: 'O Client ID do Spotify tem 32 caracteres (letras e numeros).',
  },
  spotifyClientSecret: {
    key: 'SPOTIFY_CLIENT_SECRET',
    test: (v) => /^[a-f0-9]{32}$/i.test(v),
    message: 'O Client Secret do Spotify tem 32 caracteres (letras e numeros).',
  },
};

const REQUIRED_FIELDS = ['token', 'clientId', 'clientSecret'];
const SPOTIFY_FIELDS = ['spotifyClientId', 'spotifyClientSecret'];

// form: o que a pessoa digitou. existing: o .env atual (ao reconfigurar, campo
// em branco significa "manter o que ja esta la"). Devolve { errors, values },
// onde values sao so as chaves a gravar no .env.
function validateForm(form, existing = {}, port = 3000) {
  const errors = {};
  const values = {};

  Object.entries(RULES).forEach(([field, rule]) => {
    const typed = String(form?.[field] ?? '').trim();
    if (!typed) {
      if (REQUIRED_FIELDS.includes(field) && !String(existing[rule.key] ?? '').trim()) {
        errors[field] = 'Campo obrigatorio.';
      }
      return;
    }
    if (!SAFE.test(typed) || !rule.test(typed)) {
      errors[field] = rule.message;
      return;
    }
    values[rule.key] = typed;
  });

  const spotifyAfter = SPOTIFY_FIELDS.map((f) => values[RULES[f].key] ?? existing[RULES[f].key]);
  if (!errors.spotifyClientId && !errors.spotifyClientSecret && Boolean(spotifyAfter[0]) !== Boolean(spotifyAfter[1])) {
    errors[spotifyAfter[0] ? 'spotifyClientSecret' : 'spotifyClientId'] =
      'Preencha o Client ID e o Client Secret do Spotify juntos (ou deixe os dois em branco).';
  }

  const resolved = resolveOrigin(form?.publicUrl, port);
  if (resolved.error) {
    errors.publicUrl = resolved.error;
  } else {
    values.WEB_ORIGIN = resolved.origin;
    values.DISCORD_REDIRECT_URI = `${resolved.origin}/auth/discord/callback`;
  }

  return { errors, values };
}

// Atualiza (ou acrescenta) so as chaves pedidas, preservando o resto do
// arquivo - comentarios e variaveis que a pessoa tenha posto a mao.
function mergeEnv(existingText, updates) {
  const lines = existingText ? existingText.split(/\r?\n/) : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const match = /^\s*(?:export\s+)?([\w.-]+)\s*=/.exec(line);
    if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  Object.entries(updates).forEach(([key, value]) => {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  });
  return `${out.join('\n')}\n`;
}

// Impede que uma pagina qualquer na internet fale com o servidor de
// configuracao via DNS rebinding (o navegador manda o Host do atacante).
function isLocalHost(hostHeader) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(hostHeader ?? ''));
}

module.exports = {
  REQUIRED_KEYS,
  missingRequired,
  inviteUrl,
  resolveOrigin,
  validateForm,
  mergeEnv,
  isLocalHost,
};
