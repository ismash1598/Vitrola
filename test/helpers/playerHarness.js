const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

// Monta um guildPlayers isolado, com as dependencias externas trocadas por
// dublês: nada de rede, de yt-dlp ou de ffmpeg de verdade.
//
// Por que assim: os bugs mais caros do projeto foram todos de ORDEM e
// TEMPO na fila (pular pulava a fila inteira, a musica nao avancava
// sozinha, a proxima entrava furando fila, o autoplay trocava de estilo do
// nada). Nenhum deles precisa de audio real pra acontecer - precisam de
// controle sobre "quando o processo termina" e "quanto demora pra resolver
// o audio", que e exatamente o que os dublês dao aqui.

// Processo de ffmpeg falso. O de verdade encerra sozinho quando o audio
// acaba (evento 'close' com code 0) ou e morto por nos num skip/seek
// ('close' com signal) - a distincao entre os dois e o que decide se a fila
// avanca sozinha, entao o dublê precisa reproduzir os dois casos.
function criarProcessoFalso() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.morto = false;

  proc.kill = (signal) => {
    if (proc.morto) return;
    proc.morto = true;
    proc.emit('close', null, signal || 'SIGKILL');
  };

  // Simula a musica chegando ao fim naturalmente.
  proc.terminarNaturalmente = () => {
    if (proc.morto) return;
    proc.morto = true;
    proc.emit('close', 0, null);
  };

  return proc;
}

function purgarCache() {
  for (const id of Object.keys(require.cache)) {
    if (id.includes(`${require('node:path').sep}src${require('node:path').sep}`)) {
      delete require.cache[id];
    }
  }
}

function substituirModulo(caminho, exports) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports,
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.atrasoResolucaoMs] quanto demora pra "resolver" o
 *   audio de uma faixa (simula a ida ao YouTube). Util pra testar corrida.
 * @param {string[]} [opts.mixIds] ids que o autoplay vai sugerir, em ordem.
 */
function montarPlayer(opts = {}) {
  const { atrasoResolucaoMs = 0, mixIds = ['mix1', 'mix2', 'mix3'] } = opts;

  const processos = [];
  const chamadas = { findAudio: [], resolveUrl: [], getMix: [] };

  purgarCache();

  const spawnOriginal = childProcess.spawn;
  const execFileSyncOriginal = childProcess.execFileSync;

  childProcess.spawn = () => {
    const proc = criarProcessoFalso();
    processos.push(proc);
    return proc;
  };
  // resolveFfmpegPath() usa isso pra procurar o ffmpeg do sistema.
  childProcess.execFileSync = () => {
    throw new Error('sem ffmpeg no PATH (dublê)');
  };

  substituirModulo('ffmpeg-static', '/dublê/ffmpeg');

  const audioPlayer = new EventEmitter();
  audioPlayer.play = () => {};
  audioPlayer.pause = () => {};
  audioPlayer.unpause = () => {};
  audioPlayer.stop = () => {};

  substituirModulo('@discordjs/voice', {
    createAudioPlayer: () => audioPlayer,
    createAudioResource: () => ({ volume: { setVolume() {} }, playbackDuration: 0 }),
    joinVoiceChannel: () => {
      const conn = new EventEmitter();
      conn.joinConfig = { channelId: 'canal-1' };
      conn.subscribe = () => {};
      conn.destroy = () => {};
      return conn;
    },
    entersState: async () => {},
    StreamType: { Raw: 'raw' },
    VoiceConnectionStatus: { Ready: 'ready' },
  });

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  substituirModulo('../../src/youtube/youtubeSource', {
    async findAudioForTrack(track) {
      chamadas.findAudio.push(track.name);
      if (atrasoResolucaoMs) await espera(atrasoResolucaoMs);
      return { videoUrl: `https://www.youtube.com/watch?v=${track.id}`, title: track.name, durationSec: 100 };
    },
    async resolveDirectAudioUrl(videoUrl) {
      chamadas.resolveUrl.push(videoUrl);
      if (atrasoResolucaoMs) await espera(atrasoResolucaoMs);
      return `${videoUrl}&audio=1`;
    },
    async getMixQueue(videoId) {
      chamadas.getMix.push(videoId);
      return mixIds.map((id) => ({
        videoUrl: `https://www.youtube.com/watch?v=${id}`,
        title: `Sugerida ${id}`,
        durationSec: 100,
      }));
    },
    extractVideoId: (url) => (url.match(/[?&]v=([^&]+)/) || [])[1] || null,
    parseYoutubeTitle: (t) => ({ name: t, artists: [] }),
  });

  const { getPlayer } = require('../../src/discord/guildPlayers');
  const player = getPlayer(`teste-${Math.random()}`);

  return {
    player,
    processos,
    chamadas,
    audioPlayer,
    // Deixa o event loop girar o suficiente pra cadeia de awaits do
    // advanceQueue terminar (busca do audio -> spawn do ffmpeg).
    async assentar(voltas = 12) {
      for (let i = 0; i < voltas; i++) await espera(atrasoResolucaoMs ? atrasoResolucaoMs + 2 : 1);
    },
    processoAtual: () => processos[processos.length - 1],
    restaurar() {
      childProcess.spawn = spawnOriginal;
      childProcess.execFileSync = execFileSyncOriginal;
      purgarCache();
    },
  };
}

function faixa(id) {
  return { id, name: `Faixa ${id}`, artists: ['Artista'], albumArt: null, durationMs: 100000 };
}

module.exports = { montarPlayer, faixa };
