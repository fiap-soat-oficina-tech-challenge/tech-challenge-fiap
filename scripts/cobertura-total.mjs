// Soma a cobertura dos testes unitários (coverage/) e dos e2e (coverage-e2e/)
// num relatório só, em coverage-total/. Os repositórios Prisma (src/infra) só
// são exercitados pelos e2e, então o número do serviço é o dos dois juntos,
// o mesmo que o SonarQube Cloud mostra.
//
// Uso: npm run test:cov && npm run test:e2e:cov && npm run test:cov:total
import fs from 'node:fs';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const ENTRADAS = [
  'coverage/coverage-final.json',
  'coverage-e2e/coverage-final.json',
];

const mapa = libCoverage.createCoverageMap({});
for (const arquivo of ENTRADAS) {
  if (!fs.existsSync(arquivo)) {
    console.error(
      `${arquivo} não existe: rode antes npm run test:cov e npm run test:e2e:cov.`,
    );
    process.exit(1);
  }
  mapa.merge(JSON.parse(fs.readFileSync(arquivo, 'utf8')));
}

const contexto = libReport.createContext({
  dir: 'coverage-total',
  coverageMap: mapa,
});
for (const formato of ['html', 'text-summary']) {
  reports.create(formato).execute(contexto);
}
console.log('Relatório em coverage-total/index.html');
