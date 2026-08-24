// Login com Discord (OAuth2 Authorization Code Flow). Troca o "code" que o
// Discord manda de volta por um access token, e usa esse token so na hora do
// login para descobrir quem e o usuario e em quais servidores ele esta -
// depois disso o token do Discord e descartado (guardamos so uma sessao
// nossa, mais simples).
function buildAuthorizeUrl() {
  const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  return url.toString();
}

async function exchangeCodeForUser(code) {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = process.env;

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Falha ao trocar code por token: ${tokenRes.status} ${text}`);
  }

  const tokenData = await tokenRes.json();
  const auth = { Authorization: `${tokenData.token_type} ${tokenData.access_token}` };

  const [userRes, guildsRes] = await Promise.all([
    fetch('https://discord.com/api/users/@me', { headers: auth }),
    fetch('https://discord.com/api/users/@me/guilds', { headers: auth }),
  ]);

  if (!userRes.ok) throw new Error(`Falha ao buscar usuario: ${userRes.status}`);
  if (!guildsRes.ok) throw new Error(`Falha ao buscar guildas: ${guildsRes.status}`);

  const user = await userRes.json();
  const guilds = await guildsRes.json();

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : null,
    guildIds: guilds.map((g) => g.id),
  };
}

module.exports = { buildAuthorizeUrl, exchangeCodeForUser };
