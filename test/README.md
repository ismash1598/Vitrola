# Testes

```bash
npm test           # roda tudo
npm run test:watch # re-roda a cada alteracao
```

Usa o test runner que ja vem no Node (>=18) - nenhuma dependencia nova, o que
importa porque o projeto tambem roda em celular, via Termux.

## O que tem aqui

| Arquivo | Cobre |
|---|---|
| `guildPlayers.test.js` | Ordem e tempo da fila: avanco automatico, pular, autoplay, pre-busca |
| `trackSchema.test.js` | Validacao do que o cliente manda (inclui o link repassado ao yt-dlp) |
| `permissoes.test.js` | Canal de voz e visibilidade de playlist |
| `asyncFileAdapter.test.js` | Gravacao em disco: coalescencia, atomicidade, nao-bloqueio |

## Como escrever teste novo aqui

**Parta de um sintoma real, nao de uma funcao.** Quase todo teste em
`guildPlayers.test.js` nasceu de um bug que aconteceu em uso - o comentario
de cada um guarda a frase que descrevia o problema ("a musica acaba e nao
passa para a proxima"). Isso mantem o teste ligado a algo que importa, e
quando ele quebra no futuro da pra saber na hora o que o usuario veria.

**Confira que o teste falha com o bug.** Um teste que passa nos dois casos
nao protege nada. O jeito pratico: reintroduza o bug de proposito, rode, veja
falhar, desfaca. Isso ja pegou duas coisas aqui:

- um teste que parecia cobrir "pular", mas nao cobria pular *durante o
  carregamento* - que era justamente a condicao do bug real;
- um bug de verdade no `asyncFileAdapter`, onde uma gravacao em andamento
  podia se perder se o processo encerrasse naquele instante.

**Nada de rede, disco de verdade ou audio.** O `helpers/playerHarness.js`
troca `@discordjs/voice`, o `ffmpeg` e o `youtubeSource` por dubles, e da
controle sobre o que importa: quando o processo termina, e quanto demora pra
resolver o audio de uma faixa. Os bugs de fila sao todos de ordem e tempo -
nao precisam de som nenhum pra aparecer.

**Atencao ao tempo.** Muita coisa no player e assincrona sem `await` (de
proposito: enfileirar nao pode travar a requisicao). Use `await
h.assentar()` pra deixar o event loop girar, e `montarPlayer({
atrasoResolucaoMs })` quando quiser reproduzir corrida - varios bugs so
aparecem quando duas operacoes ficam em voo ao mesmo tempo.
