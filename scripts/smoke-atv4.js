/* Teste real via HTTP: os serviços precisam estar iniciados pelo Docker Compose. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const hosts = { 3000: 'cinebridge-api', 3001: 'cinebridge-profissionais', 3002: 'cinebridge-projetos', 3003: 'cinebridge-notificacoes' };
const base = port => `http://${process.env.SMOKE_IN_DOCKER ? hosts[port] : 'localhost'}:${port}`;
async function call(port, url, method = 'GET', body) {
  const r = await fetch(base(port) + url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const result = await r.json();
  assert(r.ok, `${method} ${url}: HTTP ${r.status} ${JSON.stringify(result)}`);
  return result;
}
const example = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', name), 'utf8'));
async function main() {
  for (const port of [3000, 3001, 3002, 3003]) {
    assert.equal((await call(port, '/health')).status, 'ok');
  }
  await call(3001, '/profissionais', 'POST', example('profissional-diretor.json'));
  await call(3001, '/profissionais', 'POST', example('profissional-editor.json'));
  const result = await call(3000, '/recomendacoes', 'POST', example('recomendacao.json'));
  assert.equal(result.validacao.valido, true);
  assert.equal(result.alocacoes.length, 2);
  assert((await call(3000, `/recomendacoes/${result.id}`)).id === result.id);
  const projeto = await call(3002, `/projetos/${result.projetoId}`);
  await call(3002, `/projetos/${projeto.id}`, 'PUT', { ...projeto.projeto, nome: 'Curta atualizado ATVIV' });
  const convite = await call(3002, `/projetos/${projeto.id}/convites`, 'POST', { profissionalId: 'prof-ana' });
  await call(3002, `/projetos/${projeto.id}/convites/${convite.id}/aceitar`, 'POST');
  // Repetição deve ser idempotente.
  await call(3002, `/projetos/${projeto.id}/convites/${convite.id}/aceitar`, 'POST');
  const segunda = await call(3000, '/recomendacoes', 'POST', { projetoId: projeto.id, estrategia: 'FILTRAGEM_COLABORATIVA' });
  assert.equal(segunda.projetoId, projeto.id);
  await call(3002, `/projetos/${projeto.id}/finalizar`, 'POST', { metricas: { duracaoReal: 30 }, resultado: { entregue: true } });
  const esperado = ['PROJETO_CRIADO', 'PROJETO_ATUALIZADO', 'PROJETO_FINALIZADO', 'RECOMENDACAO_GERADA', 'CONVITE_ACEITO'];
  let notificacoes = [];
  for (let i = 0; i < 40; i++) {
    notificacoes = (await call(3003, '/notificacoes')).filter(n => n.agregadoId === projeto.id);
    if (esperado.every(tipo => notificacoes.some(n => n.tipo === tipo))) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  for (const tipo of esperado) assert(notificacoes.some(n => n.tipo === tipo), `Notificação ausente: ${tipo}`);
  assert.equal(notificacoes.filter(n => n.tipo === 'CONVITE_ACEITO').length, 1);
  console.log('ATVIV OK: quatro health checks, cadastro, consultas MQ, recomendação, persistência, ciclo de projeto, convite e notificações.', { projetoId: projeto.id, recomendacaoId: result.id });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
