# Vitrola

Bot de Discord multi-servidor + interface web de busca/player (Spotify para busca, YouTube para o áudio), com login via Discord, fila, playlists com visibilidade (privada/servidor/pública) e evolução futura para app Android via Capacitor.

## 1. Instalação

```bash
npm install
cp .env.example .env
```

Preencha o `.env` com suas credenciais (veja seção 2).

```bash
npm start
```

O servidor sobe em `http://localhost:3000` (ou na porta definida em `PORT`). O bot não entra em nenhum canal de voz sozinho — ele conecta sob demanda, no canal de voz onde o usuário logado está, no servidor Discord escolhido na interface.

## 2. Configuração

### 2.1 Bot do Discord

1. Acesse https://discord.com/developers/applications e crie uma aplicação.
2. Na aba **Bot**, crie o bot e copie o **token** → `DISCORD_TOKEN`.
3. Não é necessário nenhum Privileged Gateway Intent além dos padrões (Guilds, Guild Voice States).
4. Em **OAuth2 → URL Generator**, marque o escopo `bot` e as permissões `Connect`, `Speak`, `View Channels`, `Send Messages`.
5. Use a URL gerada para convidar o bot a quantos servidores Discord quiser — o bot é multi-servidor: cada servidor toca sua própria fila/música de forma independente.

### 2.2 Login com Discord (OAuth2)

A interface web usa "Entrar com Discord" em vez de senha ou chave fixa — cada pessoa loga com a própria conta.

1. No mesmo app do Developer Portal, aba **OAuth2 → General**, copie **Client ID** e **Client Secret** → `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` (não confundir com o token do bot).
2. Em **OAuth2 → Redirects**, adicione a URL exata do seu backend + `/auth/discord/callback` (ex.: `https://sua-url.ngrok-free.app/auth/discord/callback` ou `https://seu-dominio.com/auth/discord/callback`).
3. Preencha `DISCORD_REDIRECT_URI` e `WEB_ORIGIN` no `.env` com essa mesma URL.
4. Se você estiver testando por um túnel temporário (ngrok etc.), a URL muda a cada reinício — atualize o `.env` **e** o Developer Portal toda vez que isso acontecer.

Depois de logar, a pessoa escolhe (nas Configurações ⚙) em qual servidor em comum com o bot ela quer controlar a reprodução.

### 2.3 Spotify (somente busca)

1. Acesse https://developer.spotify.com/dashboard e crie um app.
2. Copie **Client ID** e **Client Secret** → `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.

> O áudio tocado no canal de voz vem do YouTube, não do Spotify — a API do Spotify não permite streaming de faixas completas por apps de terceiros. A busca (nome, artista, capa, duração) usa o Spotify; o backend localiza a mesma faixa no YouTube para reproduzir. Apps novos do Spotify (sem Extended Quota Mode) tem o parâmetro `limit` da busca restrito a no máximo 10 resultados — já configurado assim por padrão.

## 3. Uso da interface

- **Buscar**: pesquise por nome/artista, veja capa e resultados, toque agora, adicione à fila ou a uma playlist. Antes de buscar, mostra um acesso rápido às suas playlists.
- **Fila**: veja a música atual e as próximas; remova itens ou arraste para reordenar; ligue/desligue o autoplay (continua com músicas parecidas quando a fila acaba, usando o Mix/Radio do YouTube).
- **Playlists**: crie com três níveis de visibilidade — **privada** (só você vê), **servidor** (qualquer membro do servidor Discord onde foi criada vê), **pública** (qualquer usuário logado, de qualquer servidor com o bot, vê e pode tocar). Só o dono edita/apaga.
- **Barra do player** (flutuante, fixa embaixo): play/pause, pular, barra de progresso com seek, volume.
- **Configurações (⚙)**: entrar/sair com Discord, escolher o servidor ativo, e a URL do backend (útil quando hospedado remotamente ou rodando como app Android).

## 4. Deploy 24/7

Recomendado, do mais simples ao mais robusto:

- **Railway / Render**: conecte o repositório Git, configure as variáveis de ambiente do `.env` no painel, plano always-on.
- **VPS próprio**: rode com [pm2](https://pm2.keymetrics.io/) para manter o processo ativo e reiniciar sozinho:

```bash
npm install -g pm2
pm2 start src/index.js --name meuplayer
pm2 save
pm2 startup
```

O `ffmpeg-static` já embute o binário do ffmpeg — não é necessário instalá-lo manualmente na maioria das plataformas.

## 5. Empacotando como app Android (.apk) com Capacitor

A interface web em `public/` é estática e independente (só faz `fetch` para a URL configurada nas Configurações), então é compatível nativamente com Capacitor.

Pré-requisitos: Node instalado e [Android Studio](https://developer.android.com/studio) instalado.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "MeuPlayer" "com.seunome.meuplayer" --web-dir=public
npx cap add android
npx cap sync android
npx cap open android
```

No Android Studio: **Build → Build Bundle(s)/APK(s) → Build APK(s)** para gerar o `.apk`, ou rode direto num emulador/celular conectado.

O template padrão do Capacitor já inclui a permissão `INTERNET` no `AndroidManifest.xml`.

Dentro do app, abra as Configurações (⚙) e aponte para a URL do backend hospedado (Railway/Render/VPS) — o app não roda o backend localmente, só se conecta a ele pela internet.

## 6. Estrutura do projeto

```
meuplayer/
├── src/
│   ├── index.js                  # inicializa bot + servidor Express juntos
│   ├── discord/
│   │   ├── bot.js                 # cliente discord.js (login, sem canal fixo)
│   │   ├── guildPlayers.js        # um player independente por servidor (fila, play/pause/skip/seek/volume/autoplay)
│   │   ├── guilds.js              # servidores em comum bot+usuario, auto-join no canal do usuario
│   │   ├── oauth.js               # troca de code por token/usuario no login do Discord
│   │   └── session.js             # sessoes em memoria (token opaco -> usuario)
│   ├── spotify/spotifyClient.js  # autenticação + busca
│   ├── youtube/youtubeSource.js  # busca, resolução de áudio e Mix/Radio (autoplay) via yt-dlp
│   ├── api/
│   │   ├── routes.js              # rotas principais da API
│   │   ├── authRoutes.js          # /auth/discord/login e /callback
│   │   └── authMiddleware.js      # exige sessao valida (x-session-token)
│   └── db/playlists.js           # CRUD + visibilidade de playlists (lowdb)
├── data/playlists.json           # banco local das playlists
└── public/                       # front-end estático (também usado pelo Capacitor)
    ├── index.html
    ├── style.css
    └── app.js
```

## 7. Endpoints da API

Sob `/api`, exceto `/api/search` (pública), todas as rotas exigem o header `x-session-token` (obtido no login com Discord). Rotas de reprodução também exigem `guildId` (query string em GET, corpo em POST) apontando para um servidor em comum entre o usuário logado e o bot.

| Método | Rota | Função |
|---|---|---|
| GET | `/auth/discord/login` | Redireciona para o login OAuth do Discord |
| GET | `/auth/discord/callback` | Callback do OAuth; cria a sessão e redireciona de volta com `?sessionToken=` |
| GET | `/api/me` | Dados do usuário logado |
| POST | `/api/logout` | Encerra a sessão |
| GET | `/api/guilds` | Servidores em comum entre o usuário e o bot |
| GET | `/api/search?q=texto` | Busca músicas no Spotify |
| GET | `/api/status?guildId=` | Estado atual do servidor: faixa, tempo decorrido, fila, volume, autoplay |
| POST | `/api/queue` | Adiciona à fila (`{ guildId, track, playNow }`) — conecta ao canal de voz do usuário se ainda não estiver conectado |
| DELETE | `/api/queue/:index?guildId=` | Remove da fila |
| POST | `/api/queue/reorder` | Reordena a fila (`{ guildId, from, to }`) |
| POST | `/api/pause` / `/api/resume` / `/api/skip` | Controles de reprodução (`{ guildId }`) |
| POST | `/api/seek` | Pula para um tempo (`{ guildId, seconds }`) |
| POST | `/api/volume` | Ajusta volume (`{ guildId, volume }`, 0 a 2) |
| POST | `/api/autoplay` | Liga/desliga o autoplay (`{ guildId, enabled }`) |
| GET/POST | `/api/playlists` | Lista (filtradas por visibilidade) / cria playlists (`{ name, visibility, guildId }`) |
| GET/PATCH/DELETE | `/api/playlists/:id` | Detalhe / renomeia / apaga (editar exige ser o dono) |
| POST/DELETE | `/api/playlists/:id/tracks[/:index]` | Adiciona/remove música (exige ser o dono) |
| POST | `/api/playlists/:id/play` | Toca a playlist inteira (`{ guildId }`) — qualquer um com acesso de visualização pode tocar |

## 8. Uso responsável

Tocar áudio extraído do YouTube em um servidor de Discord pessoal, sem fins comerciais, é prática comum entre bots caseiros, mas não é a forma oficialmente sancionada pelas políticas de uso do YouTube. Projetos desse tipo já sofreram bloqueios no passado (ex.: bot "Rythm", desligado em 2021). Avalie esse risco antes de hospedar publicamente ou distribuir o bot para terceiros.
