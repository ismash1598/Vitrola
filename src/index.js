const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.join(__dirname, '..', '.env');
dotenv.config({ path: ENV_PATH });

const { missingRequired } = require('./setup/envFile');
const { openBrowser } = require('./setup/openBrowser');

const port = process.env.PORT || 3000;
// Definido pelo Iniciar.bat: abre o navegador sozinho quando o servidor sobe.
let shouldOpenBrowser = process.env.VITROLA_OPEN_BROWSER === '1';

function startApp() {
  const { requireWebOrigin } = require('./config');
  requireWebOrigin();

  const express = require('express');
  const bot = require('./discord/bot');
  const apiRoutes = require('./api/routes');
  const authRoutes = require('./api/authRoutes');
  // So pelo efeito colateral: liga o evento de "faixa comecou a tocar" do
  // guildPlayers ao registro de historico/retrospectiva (ver trackPlayTracker.js).
  require('./discord/trackPlayTracker');

  const app = express();
  app.use(express.json());

  app.use('/auth', authRoutes);
  app.use('/api', apiRoutes);

  // Paginas legais (URL limpa, sem .html) - exigidas pelo Discord Developer
  // Portal pra habilitar certos recursos do app (ex: OAuth em produção).
  app.get('/terms-of-service', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'terms-of-service.html'));
  });
  app.get('/privacy-policy', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'privacy-policy.html'));
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Garante que erros nas rotas da API voltem como JSON (nunca a pagina de erro
  // HTML do Express). Erros previstos carregam o proprio status (ver
  // HttpError) - so o que NAO for previsto vira 500, e ai o stack vai pro log,
  // porque ai sim e bug de verdade e precisa ser investigado.
  // eslint-disable-next-line no-unused-vars -- o Express so reconhece o handler de erro com 4 argumentos
  app.use('/api', (err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error(`[api] erro nao tratado em ${req.method} ${req.originalUrl}:`, err.stack || err.message);
    }
    res.status(status).json({ error: err.message });
  });

  app.listen(port, () => {
    console.log(`[web] Servidor rodando em http://localhost:${port}`);
    if (shouldOpenBrowser) openBrowser(`http://localhost:${port}`);
  });

  bot.start().catch((err) => {
    console.error('[bot] Falha ao iniciar:', err.message);
  });
}

// Primeiro uso (sem .env completo) ou "--setup": abre a tela de configuracao
// no navegador em vez de subir o bot. Ao salvar, o .env e recarregado e o bot
// sobe no mesmo processo - sem precisar reiniciar nada na mao.
if (process.argv.includes('--setup') || missingRequired(process.env).length) {
  const { startSetupServer } = require('./setup/setupServer');
  startSetupServer({
    envPath: ENV_PATH,
    port,
    onListening: (url) => {
      if (shouldOpenBrowser) openBrowser(`${url}/setup`);
      shouldOpenBrowser = false;
    },
    onSaved: () => {
      dotenv.config({ path: ENV_PATH, override: true });
      startApp();
    },
  });
} else {
  startApp();
}
