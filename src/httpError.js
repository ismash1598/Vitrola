// Erro com status HTTP embutido.
//
// Antes, qualquer throw dentro de uma rota caia no handler de erro do
// Express e virava 500 - inclusive coisas que sao CULPA DO USUARIO, tipo
// "voce nao esta no mesmo canal de voz que o bot". Isso confundia o
// diagnostico (parecia bug do servidor) e escondia problemas reais no meio
// dos 500 legitimos.
//
// Regra: erro esperado/previsto -> HttpError com 4xx. Qualquer outro throw
// continua virando 500, que e o que 500 deveria significar de verdade.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const badRequest = (message) => new HttpError(400, message);
const forbidden = (message) => new HttpError(403, message);
const notFound = (message) => new HttpError(404, message);

module.exports = { HttpError, badRequest, forbidden, notFound };
