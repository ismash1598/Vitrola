const { spawn, execFileSync } = require('child_process');

// O binario generico baixado pelo pacote ffmpeg-static falha pra resolver
// hostnames novos (tipo os do CDN de video do YouTube, que mudam a cada
// faixa) dentro de ambientes proot (ex: rodando em Ubuntu via proot-distro
// no Termux, num celular) - o DNS do sistema funciona (confirmado com
// ping), mas esse binario especifico nao. Se o sistema ja tiver um ffmpeg
// de verdade instalado (via apt, por exemplo - compilado pra essa
// plataforma), usa ele em vez do generico.
function resolveFfmpegPath() {
  try {
    // stderr ignorado de proposito: quando nao acha, o "which" escreve a
    // lista inteira do PATH no console - poluia o log toda vez que subia no
    // Windows (onde o normal e nao ter ffmpeg no PATH mesmo).
    const systemPath = execFileSync('which', ['ffmpeg'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (systemPath) return systemPath;
  } catch {
    // sem ffmpeg no PATH do sistema - usa o do pacote mesmo
  }
  return require('ffmpeg-static');
}

const ffmpegPath = resolveFfmpegPath();
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

// Quantos ms esperar sem nenhuma mudanca de volume antes de reiniciar o
// ffmpeg com o valor final (ver setVolume). O slider manda uma requisicao a
// cada tique do arrasto - sem essa espera, cada pixel arrastado reiniciaria
// o processo de audio, o que soaria muito pior do que um pequeno atraso pra
// o volume "assentar" depois que o usuario solta o controle.
const VOLUME_RESTART_DEBOUNCE_MS = 250;

const {
  resolveTrackAudio,
  getMixQueue,
  extractVideoId,
  parseYoutubeTitle,
} = require('../youtube/youtubeSource');

const EMPTY_CHANNEL_TIMEOUT_MS = 90_000; // 1min30s sozinho no canal -> sai

// Um player independente por servidor Discord: cada guilda toca sua propria
// fila/musica, com seu proprio autoplay e conexao de voz.
function createGuildPlayer() {
  const audioPlayer = createAudioPlayer();

  let connection = null;
  let queue = [];
  let currentTrack = null;
  let currentProcess = null;
  let currentResource = null;

  let offsetBase = 0;
  let isPaused = true;
  let currentVolume = 1;
  let volumeRestartTimer = null;

  let autoplayEnabled = true;
  const recentlyPlayedVideoIds = [];
  const RECENTLY_PLAYED_LIMIT = 15;

  let emptyChannelTimer = null;
  let pausedDueToInactivity = false;

  // Cliques rapidos em "pular" disparam varias advanceQueue() em paralelo
  // (cada uma buscando audio/URL pra uma faixa diferente de forma
  // assincrona). Sem isso, cada uma que termina chama audioPlayer.play(),
  // o que gera um Idle "falso" a cada troca e recomeca o avanco sozinho -
  // o bot acaba pulando a fila inteira. So a advanceQueue() mais recente
  // (playToken mais alto) tem permissao de realmente comecar a tocar.
  let playToken = 0;

  // O avanco automatico (fim natural de uma faixa) e disparado direto pelo
  // encerramento do PROCESSO do ffmpeg (evento "close", ligado em
  // startFfmpegAndPlay), nao pelo evento "Idle" do audioPlayer do
  // @discordjs/voice. Motivo: o Idle e um evento unico e compartilhado, e
  // pra saber se ele "era esperado" (por causa de um skip/seek nosso) ou se
  // era o fim de verdade de uma musica, a gente precisava de uma flag
  // booleana tentando adivinhar qual dos dois motivos causou aquele Idle
  // especifico - e como o Idle podia demorar mais (ou menos) que o esperado
  // pra chegar, essa flag as vezes ficava "devendo" e acabava engolindo o
  // fim de uma musica seguinte completamente sem relacao, travando o
  // autoplay. Comparando o processo do proprio evento "close" com
  // currentProcess (que so aponta pro processo "oficial" de agora) resolve
  // isso sem depender de timing: cada fechamento de processo sabe, sozinho,
  // se ainda e o processo atual ou se ja foi substituido.
  audioPlayer.on('error', (error) => {
    console.error('[player] erro no audioPlayer:', error.message);
    advanceQueue();
  });

  async function ensureConnected(guild, voiceChannelId) {
    if (connection && connection.joinConfig.channelId === voiceChannelId) return;

    connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    // Sem isso, uma falha de rede passageira (ex: DNS temporario tentando
    // falar com o servidor de voz do Discord, comum em rede de celular)
    // derrubava o processo Node INTEIRO - "error" sem quem escute vira
    // excecao nao tratada em EventEmitter. So loga e deixa o
    // @discordjs/voice tentar se reconectar sozinho.
    connection.on('error', (err) => {
      console.error('[player] erro na conexao de voz:', err.message);
    });

    connection.subscribe(audioPlayer);
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    cancelEmptyChannelTimer();
    if (pausedDueToInactivity) {
      pausedDueToInactivity = false;
      resume();
    }
  }

  function hasVoiceConnection() {
    return connection !== null;
  }

  function getVoiceChannelId() {
    return connection ? connection.joinConfig.channelId : null;
  }

  // Chamado pelo bot sempre que alguem entra/sai de um canal de voz nessa
  // guilda. Se o canal onde o bot esta ficar sem nenhum humano, agenda a
  // saida automatica; se alguem voltar antes, cancela.
  function onVoiceStateChange(guild) {
    const channelId = getVoiceChannelId();
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    const humanCount = channel ? channel.members.filter((m) => !m.user.bot).size : 0;

    if (humanCount === 0) {
      scheduleEmptyChannelLeave(guild);
    } else {
      cancelEmptyChannelTimer();
    }
  }

  function scheduleEmptyChannelLeave(guild) {
    if (emptyChannelTimer) return;
    emptyChannelTimer = setTimeout(() => {
      emptyChannelTimer = null;
      leaveIfStillEmpty(guild);
    }, EMPTY_CHANNEL_TIMEOUT_MS);
  }

  function cancelEmptyChannelTimer() {
    if (emptyChannelTimer) {
      clearTimeout(emptyChannelTimer);
      emptyChannelTimer = null;
    }
  }

  function leaveIfStillEmpty(guild) {
    const channelId = getVoiceChannelId();
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    const humanCount = channel ? channel.members.filter((m) => !m.user.bot).size : 0;
    if (humanCount > 0) return;

    if (currentTrack && !isPaused) {
      pause();
      pausedDueToInactivity = true;
    }
    connection?.destroy();
    connection = null;
  }

  // O proprio evento "close" do processo (ligado em startFfmpegAndPlay)
  // decide se avanca sozinho ou nao - matar aqui so precisa acontecer, sem
  // mais nenhuma flag pra coordenar.
  function killCurrentProcess() {
    // Qualquer encerramento "de verdade" (skip, seek, avanco, reset) invalida
    // um reinicio de volume pendente - sem isso, ele reiniciaria de novo por
    // cima do que acabou de comecar (ver setVolume).
    clearTimeout(volumeRestartTimer);
    if (currentProcess) {
      currentProcess.kill('SIGKILL');
      currentProcess = null;
    }
  }

  function rememberPlayedVideoId(videoId) {
    if (!videoId) return;
    recentlyPlayedVideoIds.push(videoId);
    if (recentlyPlayedVideoIds.length > RECENTLY_PLAYED_LIMIT) {
      recentlyPlayedVideoIds.shift();
    }
  }

  async function buildAutoplayTrack() {
    const lastVideoId = recentlyPlayedVideoIds[recentlyPlayedVideoIds.length - 1];
    if (!lastVideoId) return null;

    try {
      const candidates = await getMixQueue(lastVideoId);
      const next = candidates.find(
        (c) => !recentlyPlayedVideoIds.includes(extractVideoId(c.videoUrl))
      );
      if (!next) return null;

      const videoId = extractVideoId(next.videoUrl);
      const { name, artists } = parseYoutubeTitle(next.title);
      return {
        id: `yt:${videoId}`,
        name,
        artists,
        album: null,
        albumArt: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationMs: next.durationSec ? next.durationSec * 1000 : null,
        spotifyUrl: null,
        addedBy: null, // ninguem "pediu" essa, veio do autoplay
        _youtube: next,
        _autoplay: true,
      };
    } catch (err) {
      console.error('[player] autoplay: falha ao buscar musicas parecidas:', err.message);
      return null;
    }
  }

  async function startFfmpegAndPlay(audioUrl, offsetSeconds, audioCodec) {
    // O audio do YouTube ja vem em opus (ver resolveTrackAudio) - antes,
    // ffmpeg decodificava tudo pra PCM cru e o @discordjs/voice recodificava
    // de volta pra opus em JS puro (opusscript), rodando 50x por segundo sem
    // parar. Isso e o gasto de CPU mais caro do bot em hardware fraco (ex:
    // celular). Pedindo pro proprio ffmpeg (em C nativo, libopus) entregar
    // opus pronto, o @discordjs/voice so repassa os pacotes - sem recodificar
    // nada em JS.
    //
    // Custo dessa troca: o ajuste de volume nao pode mais ser inline (isso
    // so funciona em PCM cru) - agora e um filtro do proprio ffmpeg, aplicado
    // aqui embutido no comando. Mudar o volume precisa reiniciar esse
    // processo (ver setVolume).
    //
    // Enquanto o volume estiver no padrao (1), nao ha nenhum filtro pra
    // aplicar - e a fonte ja e opus na maioria das faixas (formato de audio
    // de maior bitrate do YouTube). Nesse caso da pra pedir pro ffmpeg so
    // REMUXAR (-c:a copy: trocar o container, sem decodificar nem
    // recodificar nada) em vez de decodificar+recodificar um audio que ja
    // estava pronto - o trabalho de codec cai a praticamente zero pelo tempo
    // que o volume ficar no padrao. So volta a decodificar/recodificar
    // quando alguem realmente muda o volume, ou quando a fonte nao e opus
    // (raro, videos antigos que so tem AAC como bestaudio).
    const canStreamCopy = currentVolume === 1 && audioCodec === 'opus';

    const args = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-ss', String(offsetSeconds),
      '-i', audioUrl,
      '-analyzeduration', '0',
      '-loglevel', 'error',
      '-vn',
      ...(canStreamCopy
        ? ['-c:a', 'copy']
        : ['-af', `volume=${currentVolume}`, '-c:a', 'libopus', '-ar', '48000', '-ac', '2']),
      '-f', 'opus',
      'pipe:1',
    ];

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    currentProcess = ffmpeg;

    // Sem isso, se o binario do ffmpeg nao existir/nao rodar nesse sistema
    // (ex: arquitetura errada num celular ARM), o processo falhava ao
    // iniciar SEM logar nada em lugar nenhum - parecia que "nao acontecia
    // nada" ao tentar tocar.
    ffmpeg.on('error', (err) => {
      console.error(`[player] falha ao iniciar o ffmpeg (${ffmpegPath}):`, err.message);
    });

    // -loglevel error faz o ffmpeg so escrever no stderr quando da erro de
    // verdade - sem ler isso, qualquer problema dele (url invalida, decoder
    // faltando, etc) era jogado fora silenciosamente.
    let ffmpegStderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString();
    });

    // "close" e o sinal de verdade de que essa faixa acabou. Se currentProcess
    // ja for outro (substituido por um skip/nova faixa nesse meio-tempo), ou
    // se "signal" existir (fomos nos que matamos o processo, ver
    // killCurrentProcess), quem chamou o kill ja esta cuidando do avanco -
    // esse handler nao faz nada. So avanca sozinho quando o ffmpeg morreu
    // por conta propria (fim natural do audio).
    ffmpeg.once('close', (code, signal) => {
      if (currentProcess !== ffmpeg) return;
      currentProcess = null;
      if (!signal && code !== 0 && ffmpegStderr.trim()) {
        console.error(`[player] ffmpeg terminou com erro (code ${code}):`, ffmpegStderr.trim());
      }
      if (signal) return;
      advanceQueue();
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus,
    });
    currentResource = resource;

    offsetBase = offsetSeconds;
    isPaused = false;

    audioPlayer.play(resource);

    // A faixa atual ja esta tocando - aproveita pra ja resolver o audio da
    // proxima da fila em segundo plano, pra quando ela realmente for tocar
    // (fim natural ou skip) nao precisar esperar a busca no YouTube de novo.
    prefetchNextTrack();
  }

  // Busca e resolve o audio da proxima faixa da fila com antecedencia (sem
  // bloquear nada). Idempotente: se ja tiver _audioUrl ou ja estiver em
  // andamento, nao faz nada. So ajuda quando ja existe uma faixa tocando -
  // a primeirissima musica de uma fila vazia nao tem como ser adiantada.
  const prefetchingTracks = new Set();
  let prefetchedAutoplay = null;
  // videoId da musica que estava tocando quando o prefetchedAutoplay acima
  // foi calculado - se uma musica DIFERENTE terminar tocando antes dele ser
  // usado (ex: usuario adicionou/pulou pra outra coisa no meio do caminho),
  // esse candidato fica desatualizado (baseado na musica errada) e nao pode
  // ser reaproveitado, senao o autoplay pula pra um estilo aleatorio do nada.
  let prefetchedAutoplayBasedOn = null;
  let prefetchingAutoplay = false;

  function prefetchNextTrack() {
    const next = queue[0];
    if (next) {
      if (next._audioUrl || prefetchingTracks.has(next)) return;
      prefetchingTracks.add(next);
      (async () => {
        try {
          await resolveTrackAudio(next);
        } catch (err) {
          console.error(`[player] falha ao pre-buscar audio de "${next.name}":`, err.message);
        } finally {
          prefetchingTracks.delete(next);
        }
      })();
      return;
    }

    const lastVideoId = recentlyPlayedVideoIds[recentlyPlayedVideoIds.length - 1];
    if (prefetchedAutoplay && prefetchedAutoplayBasedOn !== lastVideoId) {
      prefetchedAutoplay = null;
      prefetchedAutoplayBasedOn = null;
    }

    // Fila vazia: se autoplay estiver ligado, ja adianta em segundo plano
    // qual seria a proxima musica "parecida" e resolve o audio dela tambem -
    // sem isso, quando a faixa atual termina sozinha (fila vazia), o avanco
    // so comecava a buscar tudo isso NA HORA, o que demorava varios segundos
    // (busca do Mix do YouTube + resolucao do audio, em sequencia).
    if (autoplayEnabled && !prefetchedAutoplay && !prefetchingAutoplay) {
      prefetchingAutoplay = true;
      (async () => {
        try {
          const track = await buildAutoplayTrack();
          if (track) {
            await resolveTrackAudio(track);
            prefetchedAutoplay = track;
            prefetchedAutoplayBasedOn = lastVideoId;
          }
        } catch (err) {
          console.error('[player] falha ao pre-buscar autoplay:', err.message);
        } finally {
          prefetchingAutoplay = false;
        }
      })();
    }
  }

  // myToken (opcional): se informado, so realmente comeca a tocar se
  // nenhuma advanceQueue() mais nova tiver acontecido enquanto isso
  // buscava o audio (ver comentario de playToken la em cima).
  //
  // Guarda a faixa num "track" local logo no inicio e trabalha so com ele
  // daqui pra frente - nunca releia "currentTrack" (a variavel compartilhada)
  // depois de um await. Se ela reler, e uma advanceQueue() mais nova trocar
  // currentTrack por outra faixa enquanto essa aqui ainda esta esperando a
  // busca no YouTube, os campos _youtube/_audioUrl acabavam sendo escritos
  // na faixa ERRADA (a nova, nao a que essa chamada estava resolvendo) -
  // dai o "Cannot read properties of undefined (reading 'videoUrl')" e a
  // fila travando sem conseguir avançar.
  async function playCurrentAtOffset(offsetSeconds, myToken) {
    const track = currentTrack;
    if (!track) return;

    if (!track._audioUrl) {
      await resolveTrackAudio(track);
    }

    if (myToken !== undefined && myToken !== playToken) return;

    rememberPlayedVideoId(extractVideoId(track._youtube.videoUrl));

    await startFfmpegAndPlay(track._audioUrl, offsetSeconds, track._youtube.audioCodec);
  }

  // Avanca para a proxima faixa da fila (ou autoplay, se a fila estiver
  // vazia). Chamado quando uma faixa termina sozinha ou e pulada — nunca
  // chamado so por causa de alguem adicionar algo novo (ver enqueue()).
  async function advanceQueue() {
    const myToken = ++playToken;
    killCurrentProcess();

    if (queue.length === 0 && autoplayEnabled) {
      // Se ja tinha sido adiantada em segundo plano (ver prefetchNextTrack),
      // usa ela na hora em vez de buscar tudo de novo do zero - mas so se
      // ainda for baseada na musica que realmente acabou de tocar agora,
      // senao seria pular pra um estilo aleatorio (baseado em algo antigo).
      const lastVideoId = recentlyPlayedVideoIds[recentlyPlayedVideoIds.length - 1];
      let autoTrack;
      if (prefetchedAutoplay && prefetchedAutoplayBasedOn === lastVideoId) {
        autoTrack = prefetchedAutoplay;
      } else {
        autoTrack = await buildAutoplayTrack();
      }
      prefetchedAutoplay = null;
      prefetchedAutoplayBasedOn = null;
      if (myToken !== playToken) return;
      if (autoTrack) queue.push(autoTrack);
    }

    if (queue.length === 0) {
      if (myToken !== playToken) return;
      currentTrack = null;
      currentResource = null;
      isPaused = true;
      offsetBase = 0;
      return;
    }

    currentTrack = queue.shift();
    // Marca como "tocando" assim que a faixa e escolhida, nao so quando o
    // ffmpeg realmente comeca a rodar — sem isso, quem chama getStatus()
    // logo em seguida (ex: front-end apos adicionar na fila vazia) ainda
    // via isPaused=true por causa da busca assincrona do audio no YouTube,
    // e a musica "entrava pausada" na tela mesmo tocando de verdade.
    isPaused = false;

    // Adianta a busca da PROXIMA (agora queue[0]) em paralelo com a
    // resolucao/inicio da faixa atual, em vez de esperar startFfmpegAndPlay
    // terminar pra so entao comecar. Isso importa principalmente quando a
    // faixa atual demora pra carregar (nao tinha sido pre-buscada) ou e
    // curta - sem isso, sobrava pouco tempo de folga e a proxima as vezes
    // ainda nao estava pronta quando a vez dela chegava.
    prefetchNextTrack();

    try {
      await playCurrentAtOffset(0, myToken);
    } catch (err) {
      console.error(`[player] falha ao tocar "${currentTrack?.name}":`, err.message);
      if (myToken === playToken) await advanceQueue();
    }
  }

  // Adicionar uma musica NUNCA interrompe o que esta tocando: ela entra na
  // fila (na frente, se playNext=true) e so comeca a tocar quando a atual
  // acabar ou for pulada. So comeca imediatamente se nao havia nada tocando.
  function enqueue(track, playNext = false, addedBy = null) {
    const item = { ...track, addedBy };
    if (playNext) {
      queue.unshift(item);
    } else {
      queue.push(item);
    }
    if (!currentTrack) {
      advanceQueue();
    }
    prefetchNextTrack();
  }

  // Mesma logica de "nunca interromper", mas para uma playlist inteira: todas
  // as faixas entram no inicio da fila, na ordem da playlist.
  function playPlaylistNext(tracks, addedBy = null) {
    const items = tracks.map((t) => ({ ...t, addedBy }));
    queue.unshift(...items);
    if (!currentTrack) {
      advanceQueue();
    }
    prefetchNextTrack();
  }

  function removeFromQueue(index) {
    if (index < 0 || index >= queue.length) return false;
    queue.splice(index, 1);
    return true;
  }

  function reorderQueue(from, to) {
    if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return false;
    const [item] = queue.splice(from, 1);
    queue.splice(to, 0, item);
    return true;
  }

  // Limpa so as proximas da fila; nao mexe na faixa que esta tocando agora.
  function clearQueue() {
    queue = [];
  }

  function pause() {
    if (!currentTrack || isPaused) return;
    isPaused = true;
    audioPlayer.pause();
  }

  function resume() {
    if (!currentTrack || !isPaused) return;
    isPaused = false;
    audioPlayer.unpause();
  }

  // Pular e a UNICA acao que interrompe o que esta tocando de verdade — quem
  // pode chamar isso e decidido na camada de rotas (dono da musica ou admin).
  function skip() {
    if (!currentTrack) return;
    killCurrentProcess();
    advanceQueue();
  }

  // Botao de emergencia: para tudo, esvazia a fila e desconecta do canal de
  // voz. Usado pra desempacar o bot quando ele trava, sem precisar reiniciar
  // o processo inteiro.
  function forceReset() {
    cancelEmptyChannelTimer();
    pausedDueToInactivity = false;
    killCurrentProcess();
    queue = [];
    currentTrack = null;
    currentResource = null;
    isPaused = true;
    offsetBase = 0;
    connection?.destroy();
    connection = null;
  }

  async function seek(seconds) {
    if (!currentTrack) return;
    killCurrentProcess();
    await playCurrentAtOffset(Math.max(0, seconds));
  }

  function setVolume(volume) {
    currentVolume = Math.min(2, Math.max(0, volume));
    if (!currentTrack) return;

    // O volume agora e um filtro do proprio ffmpeg (ver startFfmpegAndPlay),
    // entao aplicar um valor novo exige reiniciar o processo - o audio
    // continua exatamente de onde parou. Espera um tempo sem mudanca (ver
    // VOLUME_RESTART_DEBOUNCE_MS) pra nao reiniciar a cada tique do arrasto
    // do slider.
    const myToken = playToken;
    clearTimeout(volumeRestartTimer);
    volumeRestartTimer = setTimeout(() => {
      // Confere de novo na hora de disparar: se um skip/seek/avanco de
      // verdade aconteceu nesse meio-tempo, currentProcess ja mudou (ou
      // sumiu) e esse reinicio ficou obsoleto - nao faz nada.
      if (!currentTrack || !currentProcess || myToken !== playToken) return;
      const elapsed = computeElapsedSeconds();
      killCurrentProcess();
      playCurrentAtOffset(elapsed, myToken).catch((err) => {
        console.error('[player] falha ao aplicar novo volume:', err.message);
      });
    }, VOLUME_RESTART_DEBOUNCE_MS);
  }

  function setAutoplay(enabled) {
    autoplayEnabled = Boolean(enabled);
    if (autoplayEnabled) prefetchNextTrack();
  }

  function computeElapsedSeconds() {
    if (!currentTrack || !currentResource) return offsetBase;
    return offsetBase + currentResource.playbackDuration / 1000;
  }

  function computeDurationSeconds() {
    if (!currentTrack) return null;
    if (currentTrack._youtube?.durationSec) return currentTrack._youtube.durationSec;
    return currentTrack.durationMs ? currentTrack.durationMs / 1000 : null;
  }

  // Por padrao a fila vai CORTADA nas primeiras faixas. O front consulta o
  // status a cada 1s, e a fila inteira (que pode ter 100+ faixas) eram
  // dezenas de KB de JSON por segundo, por navegador aberto - sendo que o
  // polling so precisa da faixa atual, do tamanho da fila e das primeiras
  // faixas (previa "a seguir" e previa da tela inicial). Quem realmente
  // precisa da fila toda (aba Fila, painel "a seguir" expandido) pede com
  // fullQueue; queueLength vai sempre, pros contadores continuarem certos.
  const QUEUE_PREVIEW_SIZE = 6;

  function getStatus({ fullQueue = false } = {}) {
    return {
      current: currentTrack
        ? {
            track: {
              id: currentTrack.id,
              name: currentTrack.name,
              artists: currentTrack.artists,
              album: currentTrack.album,
              albumArt: currentTrack.albumArt,
              durationMs: currentTrack.durationMs,
              spotifyUrl: currentTrack.spotifyUrl,
              addedBy: currentTrack.addedBy ?? null,
            },
            elapsedSeconds: computeElapsedSeconds(),
            durationSeconds: computeDurationSeconds(),
            paused: isPaused,
          }
        : null,
      queue: fullQueue ? queue : queue.slice(0, QUEUE_PREVIEW_SIZE),
      queueLength: queue.length,
      volume: currentVolume,
      autoplay: autoplayEnabled,
      connected: hasVoiceConnection(),
    };
  }

  return {
    ensureConnected,
    hasVoiceConnection,
    getVoiceChannelId,
    onVoiceStateChange,
    enqueue,
    playPlaylistNext,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    forceReset,
    pause,
    resume,
    skip,
    seek,
    setVolume,
    setAutoplay,
    getStatus,
  };
}

const players = new Map(); // guildId -> GuildPlayer

function getPlayer(guildId) {
  if (!players.has(guildId)) {
    players.set(guildId, createGuildPlayer());
  }
  return players.get(guildId);
}

function hasPlayer(guildId) {
  return players.has(guildId);
}

module.exports = { getPlayer, hasPlayer };
