// Monta o site de demonstração (GitHub Pages) em dist-demo/:
// uma cópia de public/ + demo/demo.js (API simulada) + demo/tour.js (tutorial
// guiado), carregados antes do app.js.
// Uso: npm run demo:build   (o workflow .github/workflows/pages.yml faz o mesmo)
const fs = require('fs');
const path = require('path');

const MARKER = '<script src="app.js"></script>';

function buildDemo({ root = path.join(__dirname, '..'), outDir = path.join(root, 'dist-demo') } = {}) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'public'), outDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'demo', 'demo.js'), path.join(outDir, 'demo.js'));
  fs.copyFileSync(path.join(root, 'demo', 'tour.js'), path.join(outDir, 'tour.js'));

  const indexPath = path.join(outDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes(MARKER)) {
    throw new Error(`public/index.html não tem ${MARKER}; o build da demo precisa dele para injetar o demo.js`);
  }
  // função em vez de string: o "$" em replace() teria significado especial
  fs.writeFileSync(indexPath, html.replace(MARKER, () => `<script src="demo.js"></script>\n  <script src="tour.js"></script>\n  ${MARKER}`));

  // Sem Jekyll: o Pages serve os arquivos exatamente como estão.
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
  return outDir;
}

// Servidor estático mínimo, só para olhar a demo localmente (npm run demo:serve).
function serveDir(dir, port) {
  const http = require('http');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      return res.end('requisicao invalida');
    }
    const file = path.join(dir, pathname === '/' ? 'index.html' : pathname);
    // não deixa "../" sair da pasta da demo
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('nao encontrado');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  // só na própria máquina: é um servidor de teste, não de produção
  server.listen(port, '127.0.0.1', () => console.log(`Demo em http://localhost:${port}`));
  return server;
}

if (require.main === module) {
  const out = buildDemo();
  console.log(`Demo gerada em ${out}`);
  if (process.argv.includes('--serve')) serveDir(out, Number(process.env.PORT) || 8080);
}

module.exports = { buildDemo, serveDir };
