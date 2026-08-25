const session = require('./session');

// Revalida, em segundo plano, de quais servidores o usuario ainda faz parte.
//
// O problema: a lista de servidores vem do OAuth e e gravada na sessao, que
// dura 90 dias. Se a pessoa sair de um servidor nesse meio tempo, ela
// continuaria enxergando as playlists com visibilidade "servidor" dele ate a
// sessao expirar.
//
// A limitacao: sem a intent privilegiada GuildMembers, o bot nao tem cache
// de membros - descobrir se alguem ainda esta num servidor custa uma chamada
// a API do Discord. Por isso aqui:
//
// - roda no maximo 1x a cada 10 min por usuario (nao a cada requisicao);
// - nao bloqueia requisicao nenhuma: dispara e segue a vida, o resultado
//   vale pra proxima requisicao;
// - so consegue verificar servidores onde o BOT tambem esta - que sao
//   justamente os unicos que importam pra playlists "do servidor".

const REVALIDATE_EVERY_MS = 10 * 60 * 1000;
const DISCORD_UNKNOWN_MEMBER = 10007;

const lastCheckByUser = new Map();

async function revalidateGuilds(client, user) {
  const stored = user.guildIds || [];
  const checkable = stored.filter((id) => client.guilds.cache.has(id));
  if (!checkable.length) return;

  const results = await Promise.all(
    checkable.map(async (guildId) => {
      try {
        await client.guilds.cache.get(guildId).members.fetch(user.id);
        return { guildId, left: false };
      } catch (err) {
        // So trata como "saiu" quando o Discord confirma que o membro nao
        // existe. Qualquer outra falha (rede, rate limit, API fora do ar)
        // mantem o acesso como esta - derrubar o acesso de todo mundo por
        // causa de uma instabilidade seria bem pior que o problema original.
        return { guildId, left: err?.code === DISCORD_UNKNOWN_MEMBER };
      }
    })
  );

  const left = results.filter((r) => r.left).map((r) => r.guildId);
  if (!left.length) return;

  const updated = stored.filter((id) => !left.includes(id));
  if (session.updateUserGuilds(user.id, updated)) {
    console.log(`[auth] ${user.username} nao esta mais em ${left.length} servidor(es) - acesso atualizado`);
  }
}

function scheduleGuildRevalidation(client, user) {
  if (!client?.isReady?.()) return;
  const last = lastCheckByUser.get(user.id) || 0;
  if (Date.now() - last < REVALIDATE_EVERY_MS) return;
  lastCheckByUser.set(user.id, Date.now());

  revalidateGuilds(client, user).catch((err) => {
    console.error('[auth] falha ao revalidar servidores:', err.message);
  });
}

module.exports = { scheduleGuildRevalidation };
