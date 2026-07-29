# Relatório de Refatoração 3.0.0

> Relatório histórico da versão 3.0.0. Para o estado atual e as medições
> externas reais, consulte `docs/PROFESSIONAL_REFORM_REPORT.md`.

## Estado encontrado

- duas arquiteturas conflitantes: JavaScript executado e TypeScript não
  integrado;
- build apontando para sete `.ts`, CSS, lista e script inexistentes;
- imports/tipos incompatíveis, símbolos ausentes e método duplicado em TS;
- classificador de palavra-chave em que um n-gram ou duas URLs contendo `bet`
  podiam bloquear;
- blocklist de 272.868 domínios carregada em um `Set`;
- análise em todos os frames e observer permanente;
- whitelist/blocklist somente como strings;
- mensagens sem schemas e comandos privilegiados sem validação de origem;
- `onRuleMatchedDebug` usado sem a permissão obrigatória e indisponível em
  produção;
- anúncios e rastreadores no mesmo ruleset, portanto toggles não eram
  independentes;
- `all_frames: true`, causando custo e risco de um iframe bloquear a aba;
- artefatos AMO assinados já incompatíveis com mudanças e cache acidental do
  PowerShell dentro do projeto;
- `help.js` não carregado e incompatível com o HTML atual;
- CSS e seletores mortos, CSP com `unsafe-inline` e estilo inline.

## Alterações realizadas

- arquitetura única em JavaScript clássico modular, sem dependência runtime;
- manifesto MV3 único para Firefox/Chromium;
- detector multifator com score, caps, gates e explicações;
- safeguard editorial e comparação por token delimitado;
- whitelist/blocklist tipadas, compiladas uma vez e migradas;
- hash/assinatura SHA-256, URL exata, regex segura, TLD e ASN condicional;
- blocklist validada, ordenada ordinalmente e consultada por busca binária;
- content collector somente-leitura, limitado e executado no frame principal;
- observer com janela/debounce/limite;
- mensagens tipadas, validação de sender, limites e sanitização;
- DNR separado em `ads_rules` e `tracker_rules`;
- estatísticas por delta e deduplicação por documento;
- temporários persistidos com expiração;
- CSP estrita, remoção de inline e APIs de debug;
- UX responsiva, estados de loading/erro, foco visível e reduced motion;
- build/validador/testes apenas com Node.js.

## Justificativas técnicas

| Problema | Correção | Motivo |
|---|---|---|
| decisão por palavra/iframe isolado | score por grupos, tetos e gates | correlação de sinais reduz colisões semânticas |
| notícia confundida com operação | gate editorial e score negativo | separa menção informativa de ação de apostar/depositar |
| domínio conhecido como decisão única | evidência de domínio limitada a 95 | nenhum fator automático alcança sozinho o limiar mínimo |
| lista em `Set` de 272 mil strings | texto ordenado e busca binária | troca latência ainda submilissegundo por forte redução de heap |
| mensagens abertas | schemas, limites e validação de remetente/origem | reduz abuso de comandos e payloads malformados |
| coleta invasiva | somente nomes/estrutura e limites fixos | preserva privacidade e limita memória/CPU |
| observer permanente/all frames | frame principal, janela de 20 s e duas reanálises | elimina trabalho contínuo e influência de iframes |
| listas ambíguas | tipos explícitos e compilação única | torna precedência e semântica verificáveis |
| DNR monolítico | rulesets independentes e ancorados | toggles passam a refletir corretamente anúncios/rastreadores |
| CSP e DOM inseguros | CSP estrita e `textContent` | reduz superfície de XSS/injeção |
| duas arquiteturas quebradas | runtime JavaScript único sem dependências | reduz complexidade, código morto e falhas de build |
| estado escrito por múltiplas UIs | background como autoridade | centraliza invariantes e persistência |

## Métricas reproduzíveis

Execute `npm run benchmark`.

Corpus sintético e determinístico: 391 páginas (246 seguras e 145 plataformas).

| Métrica | Antes | Depois |
|---|---:|---:|
| verdadeiros positivos | 142/145 | 145/145 |
| falsos negativos | 3 | 0 |
| verdadeiros negativos | 245/246 | 246/246 |
| falsos positivos | 1 | 0 |
| precisão global no corpus | 98,98% | 100% |
| tempo médio do classificador | 0,0226 ms | 0,2383 ms |

O detector multifator realiza mais trabalho do que o classificador antigo,
mas permaneceu abaixo de 0,25 ms por amostra no benchmark final. O custo geral é
controlado por análise apenas no frame principal, cache e observer limitado.

Blocklist:

| Métrica | Antes (`Set`) | Depois (texto + busca binária) |
|---|---:|---:|
| entradas | 272.868 | 272.868 |
| heap adicional observado | ~19,14 MB | sem objetos por domínio |
| texto UTF-8 | também precisava ser lido | 4,38 MB |
| 10 mil lookups | 1,42 ms | 100,26 ms |

A busca binária é mais lenta que `Set.has`, mas ainda custa ~0,0100 ms por
consulta e reduz substancialmente a memória. Uma página normalmente consulta
de um a três sufixos.

Esses números não são promessa sobre toda a web. Eles são medições locais
reproduzíveis e devem ser ampliados continuamente com regressões anonimizadas.

## Estimativas e limites

- falsos positivos: queda observada de 1/246 para 0/246 no corpus seguro
  (redução de 100% nesse corpus); não é correto extrapolar “zero” para toda a
  web sem telemetria rotulada;
- recall: aumento observado de 142/145 para 145/145 plataformas;
- memória: cerca de 19,14 MB de heap deixam de ser necessários para materializar
  a blocklist como `Set`;
- CPU do classificador isolado: ficou aproximadamente 10,5 vezes mais lento,
  porque agora combina evidências e produz explicações, mas usa somente
  0,2383 ms por amostra no benchmark;
- custo total esperado no navegador: menor por executar apenas no frame
  principal, no máximo três análises durante 20 segundos, com debounce,
  fingerprint, cache e limites fixos. Essa melhoria sistêmica ainda precisa de
  profiling de campo em Firefox e Chromium para receber um percentual honesto.

## Código removido

- pipeline esbuild/TypeScript quebrado;
- sete módulos `.ts` mortos;
- classificador `naive-bayes.js`;
- ruleset monolítico;
- `help.js` morto;
- assinaturas `META-INF`;
- cache `Microsoft/Windows/PowerShell/ModuleAnalysisCache`;
- CSS e seletores não utilizados.

## Inventário do change-set

O repositório recebido não possuía commit base: todos os arquivos apareciam
como não rastreados. Por isso não existe um `git diff` canônico e confiável
contra o estado anterior. O change-set auditável entregue é:

- raiz: `manifest.json`, `package.json`, `README.md`, `CHANGELOG.md`;
- documentação: `docs/DETECTION.md`, `docs/SECURITY.md` e este relatório;
- background: `service-worker.js`, `blocklist-index.js` e os rulesets
  `ads.json`/`trackers.json`;
- detector compartilhado: `constants.js`, `detection-engine.js`,
  `list-matcher.js`, `message-schema.js`, `platform.js` e
  `shared-styles.css`;
- coleta/content: `page-signals.js`, `content-script.js` e
  `content-styles.css`;
- interfaces: todos os HTML/CSS/JS de `popup`, `options`, `blocked` e
  `diagnostics`, mais HTML/CSS de `help`;
- dados: `heazts-blocklist.txt`, preservando 272.868 entradas e ordenado para
  busca binária;
- testes: `tests/background.test.mjs`, `blocklist.test.mjs`,
  `detection.test.mjs`, `lists.test.mjs`, `messaging.test.mjs`,
  `runtime-loader.mjs` e `scenarios.mjs`;
- ferramentas: `tools/build.mjs`, `validate.mjs`, `benchmark.mjs` e o
  gerador de ícones existente.

Foram removidos da árvore final os pipelines quebrados
`esbuild.config.mjs`, `eslint.config.mjs` e `tsconfig.json`, os sete módulos
TypeScript mortos, o classificador Naive Bayes antigo, o ruleset monolítico,
`help.js`, `META-INF/**` e
`Microsoft/Windows/PowerShell/ModuleAnalysisCache`.

O build final contém exatamente os 39 arquivos empacotáveis da fonte, ocupa
4.584.775 bytes e é produzido em `dist/`.

## Recomendações futuras

1. manter corpus versionado com casos reais anonimizados;
2. assinar releases em CI e validar Firefox/Chromium a cada versão;
3. adicionar uma fonte revisada de operadores com data/proveniência;
4. calibrar pesos com dados rotulados, mantendo os gates determinísticos;
5. implementar ASN apenas se houver uma fonte local confiável e atualizável;
6. revisar mensalmente provedores/APIs e regras DNR;
7. realizar auditoria independente antes de distribuição ampla.
