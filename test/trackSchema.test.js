const test = require('node:test');
const assert = require('node:assert');
const { sanitizeTrack, sanitizeTrackList } = require('../src/api/trackSchema');

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

// F1 da auditoria de seguranca: httpUrl() devolvia o texto ORIGINAL da URL,
// entao uma aspa solta no path/query sobrevivia intacta e quebrava pra fora
// de um atributo src="${url}" no front (XSS armazenado). Agora devolve a
// URL normalizada pelo proprio WHATWG URL, que escapa esse tipo de
// caractere.
test('normaliza a URL de imagem em vez de devolver o texto original (evita quebra de atributo HTML)', () => {
  const saida = sanitizeTrack({
    name: 'A',
    albumArt: 'https://evil.example/x?y=" onerror="alert(1)',
  });
  assert.ok(saida.albumArt, 'deveria aceitar a URL (esquema http/https valido)');
  assert.ok(!saida.albumArt.includes('"'), `nao deveria sobrar aspa literal: ${saida.albumArt}`);
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

// F2 da auditoria de seguranca: /playlists/import-spotify e /import-youtube
// gravavam as faixas importadas direto no banco, sem passar por
// sanitizeTrack() - diferente de toda outra rota que grava faixa. Titulo de
// video no YouTube e definido livremente por quem fez upload.
test('sanitizeTrackList aplica o allowlist em cada faixa de uma playlist importada', () => {
  const importadas = [
    { name: 'Musica valida', artists: ['Artista'], albumArt: 'https://i.scdn.co/x' },
    { name: '', artists: ['sem nome, devia ser descartada'] },
    { artists: ['tambem sem nome'] },
  ];
  const saida = sanitizeTrackList(importadas);
  assert.equal(saida.length, 1, 'so a faixa com nome valido deveria sobrar');
  assert.equal(saida[0].name, 'Musica valida');
});

test('sanitizeTrackList preserva a dica _youtube das faixas importadas do YouTube', () => {
  const saida = sanitizeTrackList([
    {
      id: 'yt:abc123',
      name: 'Musica do YouTube',
      artists: [],
      _youtube: { videoUrl: 'https://www.youtube.com/watch?v=abc123', title: 'Titulo bruto', durationSec: 210 },
    },
  ]);
  assert.equal(saida.length, 1);
  assert.equal(saida[0]._youtube.videoUrl, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(saida[0]._youtube.durationSec, 210);
});

test('sanitizeTrackList nao derruba a lista inteira por causa de uma faixa invalida', () => {
  assert.deepEqual(sanitizeTrackList('nao e uma lista'), []);
  assert.deepEqual(sanitizeTrackList(null), []);
  assert.deepEqual(sanitizeTrackList(undefined), []);
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
