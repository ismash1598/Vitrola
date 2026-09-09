// Streama uma faixa qualquer direto pro navegador, sem depender de
// nenhuma guild nem canal de voz - usado pelo modo "so no navegador"
// (player independente do Discord, escolhido logo apos o login).
//
// Mesma logica de remux de guildPlayers.js (attachHttpListener): se a
// fonte ja for opus (a maioria), so remuxa (-c:a copy), sem gastar CPU
// decodificando/recodificando - volume fica por conta do <audio> do
// navegador, que ja tem controle local.
const { spawn } = require('child_process');
const { ffmpegPath } = require('./guildPlayers');
const { resolveTrackAudio } = require('../youtube/youtubeSource');

async function streamTrackToResponse(track, res) {
  try {
    await resolveTrackAudio(track);
  } catch (err) {
    res.status(404).json({ error: `Nao foi possivel resolver o audio: ${err.message}` });
    return;
  }

  const audioCodec = track._youtube?.audioCodec;
  const args = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', track._audioUrl,
    '-analyzeduration', '0',
    '-loglevel', 'error',
    '-vn',
    ...(audioCodec === 'opus' ? ['-c:a', 'copy'] : ['-c:a', 'libopus', '-ar', '48000', '-ac', '2']),
    '-f', 'opus',
    'pipe:1',
  ];

  const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.on('error', (err) => {
    console.error(`[browserPlayer] falha ao iniciar o ffmpeg (${ffmpegPath}):`, err.message);
    res.end();
  });

  let ffmpegStderr = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegStderr += chunk.toString();
  });
  ffmpeg.once('close', (code, signal) => {
    if (!signal && code !== 0 && ffmpegStderr.trim()) {
      console.error(`[browserPlayer] ffmpeg terminou com erro (code ${code}):`, ffmpegStderr.trim());
    }
    res.end();
  });

  // Se o navegador fechar a conexao (pulou faixa, fechou a aba, etc), mata
  // o processo - sem isso cada troca de faixa deixaria um ffmpeg orfao.
  res.on('close', () => {
    if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
  });

  res.setHeader('Content-Type', 'audio/ogg');
  ffmpeg.stdout.pipe(res);
}

module.exports = { streamTrackToResponse };
