# Vitrola

Bot de música para Discord **com painel web**: busca, fila com autoplay, playlists (privadas, do servidor ou públicas), histórico e uma "Cápsula do tempo" mensal, no estilo retrospectiva. Cada pessoa roda o **próprio bot no próprio computador** — não existe servidor central.

> **Projeto pessoal, feito para estudo e uso próprio com amigos.** O áudio é extraído do YouTube com o yt-dlp, o que não é a forma oficialmente permitida pelos termos do YouTube. Veja [Uso responsável](#uso-responsável) antes de hospedar ou distribuir.

## Instalação rápida (Windows)

Você precisa de: Windows 10 ou 11, internet e uma conta no Discord. O resto o próprio instalador resolve.

1. Baixe o projeto: botão verde **Code → Download ZIP** nesta página, e extraia a pasta.
2. Dê dois cliques em **`Iniciar.bat`**.
   - Na primeira vez ele instala o que falta (inclusive o Node.js, se você não tiver) e baixa as dependências. Pode levar alguns minutos.
   - Se ele pedir para fechar e abrir de novo depois de instalar o Node.js, é só abrir o `Iniciar.bat` outra vez.
3. O navegador abre sozinho numa **tela de configuração**. Siga o passo a passo dela (resumo abaixo).
4. Clique em **Convidar o bot para o meu servidor**, escolha o servidor e autorize.
5. Clique em **Abrir o Vitrola**, entre com o Discord, escolha o servidor e a música. O bot entra no canal de voz onde você estiver.

Deixe a janela preta do `Iniciar.bat` aberta enquanto estiver usando — se você a fechar, o bot desliga. Nas próximas vezes é só abrir o `Iniciar.bat` de novo; nada precisa ser configurado outra vez.

### O que a tela de configuração pede

| Campo | Onde pegar |
|---|---|
| **Token do bot** | [Discord Developer Portal](https://discord.com/developers/applications) → New Application → **Bot** → **Reset Token** |
| **Client ID** | Preenchido sozinho quando o token for válido (ou **OAuth2 → General**) |
| **Client Secret** | **OAuth2 → Reset Secret** (é diferente do token do bot) |
| **Redirect** | **OAuth2 → Redirects → Add Redirect**, colando o endereço que a própria tela mostra |

Não precisa ligar nenhum "Privileged Intent". O token e o secret ficam só no arquivo `.env` do seu computador (ele nunca vai para o GitHub).

Para trocar o token, ligar o Spotify depois ou mudar qualquer coisa, abra o **`Configurar.bat`**: ele reabre a mesma tela (campos em branco mantêm o valor atual).

## Spotify (opcional)

A busca de músicas funciona de dois jeitos:

| | Spotify | YouTube Music |
|---|---|---|
| Resultados | Mais precisos: capa, artista e duração certinhos | Bons, mas às vezes vêm versões ou vídeos errados, sem duração |
| Precisa configurar | Sim, com chaves de API | Não |

**Se você não colocar as chaves do Spotify, a busca usa o YouTube Music automaticamente** — não há nada quebrado em deixar em branco. O áudio sempre vem do YouTube; o Spotify serve só para a busca.

Para ligar a busca pelo Spotify:

1. Entre em [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) e clique em **Create app**.
2. Dê um nome e uma descrição quaisquer. Em **Redirect URI** coloque `http://127.0.0.1:3000` (não é usado de verdade) e marque **Web API**.
3. Abra o app criado → **Settings**. Copie o **Client ID** e, em **View client secret**, o **Client Secret**.
4. Abra o `Configurar.bat`, cole os dois na seção "Spotify" e salve.

> **Importante:** atualmente o Spotify só libera a busca por API se a conta que criou o app tiver **Spotify Premium ativo**. Sem Premium a busca do Spotify responde erro 403 — e o Vitrola cai no YouTube Music sozinho. Se você assinar o Premium depois, pode levar algumas horas para o Spotify liberar; não precisa mexer em mais nada.

O Spotify também é usado para **importar playlists por link**; isso funciona mesmo sem chaves.

## Amigos usando de outro computador (opcional)

Por padrão o painel só abre no computador onde o bot roda (`http://localhost:3000`). Para os amigos abrirem o painel no navegador deles, você precisa de um endereço público. O jeito mais simples é um túnel gratuito da Cloudflare:

1. Instale o `cloudflared` (no PowerShell): `winget install Cloudflare.cloudflared`
2. Com o bot rodando, em outro terminal: `cloudflared tunnel --url http://localhost:3000`
3. Ele mostra um endereço `https://alguma-coisa.trycloudflare.com`. Abra o **`Configurar.bat`**, cole esse endereço em "Seus amigos entram de outro computador?" e salve.
4. No Developer Portal, em **OAuth2 → Redirects**, adicione o novo redirect que a tela de configuração mostra.

Esse endereço **muda toda vez que o túnel é reiniciado** — nesse caso repita os passos 3 e 4. Para um endereço fixo, use um [Cloudflare Tunnel nomeado](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) com um domínio seu.

Quem só quer ouvir música no Discord **não precisa do painel**: o painel é só para quem controla o bot.

## Problemas comuns

- **"Invalid OAuth2 redirect_uri" ao entrar com o Discord:** o endereço do Redirect no Developer Portal precisa ser *exatamente* o que a tela de configuração mostrou. Se mudou o endereço público, adicione o novo.
- **O bot não entra no canal de voz:** confira se ele foi convidado com as permissões *Connect*, *Speak* e *View Channels* (o link da tela de configuração já pede isso) e se você está em um canal de voz.
- **A música não toca / erro do YouTube:** o YouTube muda com frequência e versões velhas do yt-dlp quebram. O `Iniciar.bat` já atualiza o yt-dlp a cada abertura — basta fechar e abrir de novo.
- **A porta 3000 está ocupada:** adicione `PORT=3001` (ou outra) no arquivo `.env`, ou feche o programa que usa a porta.
- **A janela fechou sozinha / quero ver o erro:** abra o `Iniciar.bat` pelo terminal (`cmd`) para a mensagem ficar na tela.

## Para desenvolvedores

Também dá para rodar sem o `.bat`:

```bash
npm install
npm start          # sem .env completo, abre a tela de configuração
npm run dev        # reinicia sozinho ao editar
npm test           # testes automatizados
```

O `.env` pode ser preenchido à mão, a partir do `.env.example`.

### Painel

- **Buscar**: pesquise por nome ou artista, toque agora, adicione à fila ou a uma playlist.
- **Fila**: veja a música atual e as próximas; remova, reordene arrastando e ligue o autoplay (continua com músicas parecidas usando o Mix do YouTube).
- **Playlists**: **privada** (só você), **servidor** (membros do servidor onde foi criada) ou **pública** (qualquer usuário logado). Importa do Spotify e do YouTube Music por link. Só o dono edita.
- **Histórico / Cápsula do tempo**: retrospectiva mensal do servidor ou só sua, com cartão para compartilhar como imagem.
- **Ouvir no site**: player independente do Discord, que toca no próprio navegador.
- **Compartilhar**: gera uma imagem vertical da música que está tocando.
- **Configurações (⚙)**: conta, servidor ativo e volume.

### Como funciona por dentro

- **Um player por servidor** (`guildPlayers.js`): fila, seek, volume e autoplay independentes.
- **Áudio**: o yt-dlp resolve a URL do áudio e o ffmpeg a envia ao Discord como Opus. Quando o volume é 100% e a fonte já é Opus, o áudio só é remuxado (`-c:a copy`), sem recodificar, o que reduz bastante o uso de CPU.
- **Login**: OAuth2 do Discord com escopo mínimo (`identify guilds`); sessões com token opaco no header `x-session-token`, nunca em cookie.
- **Segurança**: isolamento por servidor, checagem de permissão em cada rota, listas de permissão ao receber faixas do cliente e tickets de uso único para o áudio no navegador. Ver `docs/security-audit/` se presente.
- **Persistência**: arquivos JSON (lowdb) com escrita atômica, em `data/` (fora do git).
- **Testes**: `node --test`, sem dependências extras.

### Estrutura

```
src/
├── index.js                 # sobe o bot + servidor web (ou a tela de configuração)
├── setup/                   # tela de primeira configuração (grava o .env)
├── discord/                 # bot, players por servidor, sessões, histórico
├── spotify/spotifyClient.js # busca (opcional) e importação de playlists
├── youtube/youtubeSource.js # busca, resolução de áudio e Mix (autoplay) via yt-dlp
├── api/                     # rotas REST e login OAuth
└── db/                      # playlists
public/                      # front-end estático (também usado pelo app Android)
test/                        # testes automatizados
Iniciar.bat / Configurar.bat # launchers do Windows
```

### API

Tudo em `/api`, exceto `/api/search` e `/api/public-stats` (públicas), exige o header `x-session-token`.

| Método | Rota | Função |
|---|---|---|
| GET | `/auth/discord/login` · `/callback` | Login OAuth do Discord |
| GET | `/api/me` · `/api/guilds` | Usuário logado · servidores em comum com o bot |
| GET | `/api/search?q=` | Busca músicas (Spotify se configurado, senão YouTube Music) |
| GET | `/api/status?guildId=` | Estado do servidor: faixa, tempo, fila, volume, autoplay |
| POST/DELETE | `/api/queue` | Adiciona / limpa a fila |
| POST | `/api/pause` · `/resume` · `/skip` · `/seek` · `/volume` · `/autoplay` | Controles |
| GET/POST/PATCH/DELETE | `/api/playlists[/:id]` | Playlists, com visibilidade |
| GET | `/api/retrospective?guildId=&scope=&month=` | Cápsula do tempo |

### Hospedagem 24/7

Quem quer o bot sempre ligado pode usar uma máquina que fique ligada (um VPS, por exemplo) com [pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start src/index.js --name vitrola
pm2 save
```

Observação: o YouTube costuma bloquear o yt-dlp em IPs de datacenter. Em casa isso quase não acontece.

### App Android (opcional)

O painel em `public/` é estático e pode ser empacotado como `.apk` com [Capacitor](https://capacitorjs.com/) (as dependências do Capacitor ficam em `devDependencies`):

```bash
npx cap add android
npx cap sync android
cd android && gradlew assembleDebug
```

Dentro do app, abra as Configurações (⚙) e cole a URL do backend. Ela aparece só no app, não no site.

## Uso responsável

Tocar áudio extraído do YouTube em um servidor de Discord pessoal, sem fins comerciais, é prática comum entre bots caseiros, mas não é permitido pelos termos de uso do YouTube. Projetos assim já foram derrubados no passado (o bot Rythm, por exemplo, foi desligado em 2021). Este projeto é **educacional**: use por sua conta e risco, apenas com amigos, e **não o venda nem ofereça como serviço**. Não há afiliação com Discord, YouTube ou Spotify.
