require('dotenv').config();

const path = require('path');
const express = require('express');
const bot = require('./discord/bot');
const apiRoutes = require('./api/routes');
const authRoutes = require('./api/authRoutes');

const app = express();
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Garante que erros nas rotas da API voltem como JSON (nunca a pagina de erro HTML do Express)
app.use('/api', (err, req, res, next) => {
  console.error('[api] erro:', err.message);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`[web] Servidor rodando em http://localhost:${port}`);
});

bot.start().catch((err) => {
  console.error('[bot] Falha ao iniciar:', err.message);
});
