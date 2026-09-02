// Validacao de variaveis de ambiente criticas, chamada na subida do
// processo (ver src/index.js). Falhar aqui, cedo e com mensagem clara, e
// melhor que falhar silenciosamente depois - antes, sem WEB_ORIGIN
// configurado, o callback do OAuth caia num fallback que confiava no header
// Host da propria requisicao (controlavel pelo cliente) pra montar o
// redirect que carrega o token de sessao recem-criado (ver F3 da auditoria
// de seguranca).
function requireWebOrigin(env = process.env) {
  if (!env.WEB_ORIGIN) {
    throw new Error(
      'WEB_ORIGIN precisa estar configurado no .env (URL publica onde a interface web esta acessivel) - o redirect de login depois do OAuth do Discord depende dela.'
    );
  }
  return env.WEB_ORIGIN;
}

module.exports = { requireWebOrigin };
