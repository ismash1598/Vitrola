const test = require('node:test');
const assert = require('node:assert');
const { sanitizeTrack } = require('../src/api/trackSchema');

test('mantem uma faixa normal do Spotify intacta', () => {
  const entrada = {
    id: '5i91iDdOjC7sexvXV3MlRc',
    name: 'Solta Minha Blusa',
    artists: ['pumapjl', 'SonoTWS'],
    album: 'Autodominio',
    albumArt: 'https://i.scdn.co/image/abc',
    durationMs: 117500,
    spotifyUrl: 'https://open.spotify.com/track/5i91iDdOjC7sexvXV3MlRc',
  };
  const saida = sanitizeTrack(entrada);

  assert.equal(saida.name, 'Solta Minha Blusa');
  assert.deepEqual(saida.artists, ['pumapjl', 'SonoTWS']);
  assert.equal(saida.albumArt, entrada.albumArt);
  assert.equal(saida.durationMs, 117500);
  assert.equal(saida.spotifyUrl, entrada.spotifyUrl);
});

test('preserva a dica _youtube quando o link e do YouTube', () => {
  const saida = sanitizeTrack({
    name: 'A',
    _youtube: { videoUrl: 'https://www.youtube.com/watch?v=abc', title: 'T', durationSec: 200 },
  });
  assert.equal(saida._youtube.videoUrl, 'https://www.youtube.com/watch?v=abc');
  assert.equal(saida._youtube.durationSec, 200);
});

// _youtube.videoUrl e repassado pro yt-dlp - se passasse qualquer URL, daria
// pra fazer o servidor sair buscando endereco arbitrario.
test('descarta a dica _youtube apontando pra fora do YouTube', () => {
  for (const url of [
    'https://evil.example.com/x',
    'http://127.0.0.1:3000/admin',
    'file:///etc/passwd',
    'https://youtube.com.evil.com/x',
  ]) {
    const saida = sanitizeTrack({ name: 'A', _youtube: { videoUrl: url } });
    assert.equal(saida._youtube, null, `deveria recusar: ${url}`);
  }
});

test('aceita os dominios legitimos do YouTube', () => {
  for (const url of [
    'https://youtube.com/watch?v=a',
    'https://www.youtube.com/watch?v=a',
    'https://m.youtube.com/watch?v=a',
    'https://music.youtube.com/watch?v=a',
    'https://youtu.be/a',
  ]) {
    const saida = sanitizeTrack({ name: 'A', _youtube: { videoUrl: url } });
    assert.ok(saida._youtube, `deveria aceitar: ${url}`);
  }
});

test('recusa URL que nao seja http(s) nos campos de imagem/link', () => {
  const saida = sanitizeTrack({
    name: 'A',
    albumArt: 'javascript:alert(1)',
    spotifyUrl: 'data:text/html,<script>',
  });
  assert.equal(saida.albumArt, null);
  assert.equal(saida.spotifyUrl, null);
});

test('descarta campos nao declarados em vez de grava-los', () => {
  const saida = sanitizeTrack({ name: 'A', lixo: 'x', outroCampo: { grande: 'y' } });
  assert.equal(saida.lixo, undefined);
  assert.equal(saida.outroCampo, undefined);
  assert.deepEqual(Object.keys(saida).sort(), [
    '_youtube', 'album', 'albumArt', 'artists', 'durationMs', 'id', 'name', 'spotifyUrl',
  ]);
});

test('limita tamanho de texto e quantidade de artistas', () => {
  const saida = sanitizeTrack({ name: 'N'.repeat(5000), artists: Array(200).fill('X') });
  assert.equal(saida.name.length, 300);
  assert.equal(saida.artists.length, 20);
});

test('normaliza duracao invalida para null', () => {
  assert.equal(sanitizeTrack({ name: 'A', durationMs: -5 }).durationMs, null);
  assert.equal(sanitizeTrack({ name: 'A', durationMs: 'abc' }).durationMs, null);
  assert.equal(sanitizeTrack({ name: 'A', durationMs: NaN }).durationMs, null);
});

test('rejeita entrada que nao e uma faixa utilizavel', () => {
  for (const entrada of [null, undefined, [1, 2], 'texto', 42, {}, { artists: ['x'] }, { name: '   ' }]) {
    assert.throws(
      () => sanitizeTrack(entrada),
      (err) => err.status === 400,
      `deveria rejeitar: ${JSON.stringify(entrada)}`
    );
  }
});
