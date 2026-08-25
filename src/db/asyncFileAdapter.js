const fs = require('fs');
const path = require('path');

// Adapter de arquivo pro lowdb que grava de forma ASSINCRONA e atomica,
// mantendo a interface sincrona que o lowdb 1.x espera.
//
// O FileSync que vem no lowdb reescreve o arquivo INTEIRO com writeFileSync
// a cada .write(). Com o playlists.json passando de 100 KB, isso trava o
// event loop inteiro durante a gravacao - o suficiente pra engasgar o audio
// em hardware fraco (ex: rodando no celular). E como qualquer acao pequena
// (favoritar, adicionar uma faixa) dispara uma gravacao completa, isso
// acontecia com frequencia.
//
// Aqui o dado ja esta atualizado em memoria assim que write() retorna, e o
// arquivo e gravado logo em seguida sem bloquear. Detalhes que importam:
//
// - Gravacoes que chegam enquanto outra esta em andamento sao COALESCIDAS:
//   so o estado final vai pro disco, entao uma rajada de mudancas nao vira
//   uma fila de gravacoes.
// - O arquivo e escrito num .tmp e trocado por rename (atomico no mesmo
//   sistema de arquivos), entao nunca sobra um JSON pela metade no disco,
//   nem se o processo morrer no meio da gravacao.
// - Se o processo for encerrado com algo ainda pendente, flushSync() grava
//   de forma sincrona antes de sair (ver registerExitFlush).
class AsyncFileAdapter {
  constructor(filename, { defaultValue = {} } = {}) {
    this.filename = filename;
    this.defaultValue = defaultValue;
    this.writing = false;
    this.pending = null;
    registerExitFlush(this);
  }

  read() {
    try {
      const raw = fs.readFileSync(this.filename, 'utf-8');
      return raw.trim() ? JSON.parse(raw) : this.defaultValue;
    } catch (err) {
      if (err.code === 'ENOENT') return this.defaultValue;
      throw err;
    }
  }

  write(data) {
    // Serializa AGORA (nao dentro do flush): o objeto e mutavel e pode ser
    // alterado de novo antes da gravacao assincrona acontecer.
    this.pending = JSON.stringify(data, null, 2);
    this.flush();
    return data;
  }

  async flush() {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.pending !== null) {
        const payload = this.pending;
        this.pending = null;
        const tmp = `${this.filename}.tmp`;
        try {
          await fs.promises.writeFile(tmp, payload);
          await fs.promises.rename(tmp, this.filename);
        } catch (err) {
          console.error(`[db] falha ao gravar ${path.basename(this.filename)}:`, err.message);
        }
      }
    } finally {
      this.writing = false;
    }
  }

  // Ultimo recurso, so na saida do processo: 'exit' do Node nao espera
  // promise nenhuma, entao aqui tem que ser sincrono mesmo.
  flushSync() {
    if (this.pending === null) return;
    const payload = this.pending;
    this.pending = null;
    try {
      fs.writeFileSync(this.filename, payload);
    } catch (err) {
      console.error(`[db] falha ao gravar ${path.basename(this.filename)} na saida:`, err.message);
    }
  }
}

const openAdapters = new Set();
let exitHookInstalled = false;

function registerExitFlush(adapter) {
  openAdapters.add(adapter);
  if (exitHookInstalled) return;
  exitHookInstalled = true;

  process.on('exit', () => {
    openAdapters.forEach((a) => a.flushSync());
  });
  // Ctrl+C / kill nao disparam 'exit' sozinhos - sem isso, uma mudanca
  // feita segundos antes de parar o servidor poderia se perder.
  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      openAdapters.forEach((a) => a.flushSync());
      process.exit(0);
    });
  });
}

module.exports = AsyncFileAdapter;
