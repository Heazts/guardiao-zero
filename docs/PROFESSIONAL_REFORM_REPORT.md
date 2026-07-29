# Relatório Técnico — Reformulação Profissional 3.1.0

**Data:** 29 de julho de 2026
**Escopo:** interface, acessibilidade, personalização, filtros, segurança,
performance, testes, privacidade e preparação para publicação.

## Resultado executivo

O Guardião Zero Pro passou de uma interface monocromática inconsistente para o
sistema de identidade próprio Limiar Zero. O monograma `0|` representa,
respectivamente, exposição/telemetria zero e o limite local que uma navegação
bloqueada não atravessa. A composição editorial numerada, a tipografia
Newsreader e a ausência deliberada de iconografia decorativa diferenciam o
produto de dashboards genéricos. A arquitetura de proteção ganhou importação
conservadora de filtros,
precedência DNR para a whitelist, persistência transacional e builds separados
para Firefox e Chromium.

A validação final automatizada contém 36 testes, 391 cenários determinísticos,
272.868 domínios validados e lint AMO com zero erros, notices ou warnings. O
teste externo tentou 47 URLs reais; 23 retornaram conteúdo avaliável. Nesse
subconjunto houve 5 verdadeiros positivos, 1 falso negativo, 17 verdadeiros
negativos e nenhum falso positivo.

O carregamento temporário no Firefox e a auditoria do console dependem de
confirmação explícita do usuário no momento da instalação. A publicação pública
também depende da confirmação de proveniência da blocklist.

## Problemas encontrados

### Interface e acessibilidade

- foco invisível em switches visualmente ocultos;
- bordas e focos abaixo do contraste recomendado para componentes;
- links do popup dependentes de ícone e `title`;
- botão de copiar diagnóstico destruía o próprio SVG depois do primeiro uso;
- hash navigation ignorava abertura direta e voltar/avançar;
- margem negativa em layout móvel;
- página bloqueada invertia tokens e comprometia tema escuro;
- valores truncados sem forma de revelar ou copiar;
- controles exibiam valores hardcoded antes do estado real;
- ausência de tema, accent color, alto contraste e política navegável;
- fonte Inter declarada, mas não empacotada;
- targets pequenos, SVGs decorativos expostos e alegação incorreta de “IA”.

### Bloqueio e listas

- whitelist protegia a decisão JavaScript, mas não regras DNR;
- importação anterior aceitava apenas backup JSON;
- remoção de `www.` quebrava a diferença entre domínio exato e domínio pai;
- limite de 5.000 entradas manuais não era aplicado no fluxo individual;
- ASN era aceito, mas sem fonte de ASN no runtime;
- redirects e páginas sem conteúdo podiam escapar da análise posterior ao DOM;
- falhas de storage podiam deixar DNR e configuração divergentes;
- estatísticas de anúncio/rastreador eram estimativas, não matches DNR.

### Publicação

- ausência de licença, política de privacidade e avisos de terceiros;
- manifesto portátil produzia warnings no pacote Firefox;
- `gecko_android` declarava uma plataforma sem evidência de teste;
- inexistência de corpus real, pacote reprodutível e lint `web-ext`;
- repositório local sem histórico, remote ou autenticação válida do `gh`;
- origem/licença da blocklist não documentada.

## Correções realizadas e justificativas

| Área | Alteração | Justificativa |
|---|---|---|
| Design | tokens semânticos para canvas, superfície, texto, borda, foco, estados e accent | consistência e contraste independente do tema |
| Marca | monograma vetorial `0|`, derivado em todos os ícones raster | expressa zero exposição e o limiar local sem recorrer ao escudo genérico |
| Estrutura visual | registro editorial numerado, regras horizontais e superfícies sem cards decorativos | cria hierarquia reconhecível e reduz ruído |
| Tipografia | Newsreader Variable para títulos + Inter Variable para interface, ambas locais e com OFL integral | voz própria sem CDN ou rastreamento |
| Iconografia | símbolos somente quando funcionais; setas e numeração seguem uma gramática única | evita o conjunto heterogêneo típico de interfaces geradas |
| Personalização | tema, accent, contraste, densidade e movimento | autonomia do usuário; persistência apenas local |
| A11y | foco de 3 px, labels, `aria-describedby`, logs, alerts e 40–44 px targets | teclado, leitores de tela e baixa visão |
| UX | skeletons, status de salvamento, toasts, confirmações e estados de erro | elimina ambiguidade em operações assíncronas |
| Detecção | preservação de `www` e varredura DOM apenas para apostas | semântica correta e menor CPU |
| Whitelist | allow rules DNR com prioridade 100 para destino e iniciador | precedência também na camada de rede |
| Filtros | parser local para sintaxes populares, sem scriptlets/redirect/headers | compatibilidade sem executar conteúdo importado |
| Quota | 4.900 regras importadas + reserva para allow rules | compatibilidade com o limite portátil do Firefox |
| Estado | update de rede, persistência e rollback antes de commit em memória | evita estados parcialmente aplicados |
| Mensagens | validação estrita de appearance, fontes e backups | reduz injeção, payload excessivo e corrupção |
| Build | alvos Firefox/Chromium distintos | remove propriedades ignoradas sem duplicar runtime |
| Privacidade | política em Markdown e página empacotada | transparência para usuário e AMO |
| Avaliação | corpus real versionado, fetch limitado, hashes e exclusão explícita de indisponíveis | resultado auditável sem inventar conteúdo |

## Precisão

### Cenários determinísticos de regressão

| Métrica | Antes | Depois |
|---|---:|---:|
| verdadeiros positivos | 142/145 | 145/145 |
| falsos negativos | 3 | 0 |
| verdadeiros negativos | 245/246 | 246/246 |
| falsos positivos | 1 | 0 |
| acurácia | 98,98% | 100% |

Esses cenários são testes de software, não tráfego real.

O gráfico publicado no GitHub é gerado pelo mesmo comando, tem fundo branco
explícito e não contém números inseridos manualmente:
`docs/assets/benchmark-evolution.svg`. A saída completa é preservada em
`docs/reports/benchmark-results.json`.

### Execução real

Fonte positiva: domínios autorizados pela Secretaria de Prêmios e Apostas do
Ministério da Fazenda, planilha de 15/07/2026. Controles negativos: serviços,
bancos, universidades, governo, documentação, comércio e páginas informativas
reais.

| Item | Resultado |
|---|---:|
| URLs tentadas | 47 |
| respostas utilizáveis | 23 |
| indisponíveis/excluídas | 24 |
| TP / FN | 5 / 1 |
| TN / FP | 17 / 0 |
| precisão positiva | 100% |
| recall | 83,33% |
| especificidade | 100% |
| acurácia | 95,65% |

O falso negativo foi `blaze.bet.br`: a resposta utilizável expôs apenas
evidência de domínio/índice e o motor, deliberadamente, não bloqueia por um
único grupo. Esse trade-off preserva a meta prioritária de falsos positivos
baixos. As 24 recusas por HTTP, timeout, intersticial ou conteúdo vazio não
foram convertidas em acertos.

Resultados completos:
`docs/reports/real-world-results.json`. Gráfico:
`docs/assets/precision-real-world.svg`.

## Performance

Benchmark local, 7.820 classificações:

| Medida | Legado | Multifator 3.1 |
|---|---:|---:|
| média do classificador | 0,0385 ms | 0,2656 ms |
| total mediano | 300,73 ms | 2.077,14 ms |

O classificador isolado é mais caro porque produz score, fatores e safeguards,
mas permaneceu abaixo de 0,27 ms por amostra nessa execução. Não foi
classificado como “ganho de performance”: trata-se de um custo consciente para
eliminar os quatro erros observados no corpus. Os valores são medianas de cinco
repetições alternadas após aquecimento; as amostras brutas estão no relatório
JSON. O custo sistêmico é limitado por:

- nenhuma varredura DOM quando somente anúncios/rastreadores estão ativos;
- frame principal apenas;
- no máximo três análises numa janela de 20 segundos;
- debounce, fingerprint e cache limitado;
- DNR antes do carregamento;
- busca binária sem materializar 272.868 strings em `Set`.

Memória observada evitada ao não criar o `Set`: aproximadamente 18,25 MiB. Dez
mil lookups binários levaram 113,55 ms, ou cerca de 0,0114 ms por consulta
(mediana de sete repetições).
A consulta binária é mais lenta que `Set.has`, porém evita manter 272.868
strings como objetos no heap.
Não há percentual honesto de melhoria total sem profiling no navegador.

## Segurança

- CSP sem `unsafe-inline`, `eval`, `new Function`, `innerHTML` ou código remoto;
- mensagens com schemas, limites de bytes e validação de sender/origem;
- URLs somente HTTP(S), regex limitada e proteção contra padrões
  potencialmente catastróficos;
- filtros importados nunca executados;
- valores de inputs, cookies e storages não coletados;
- regras e preferências exclusivamente em `storage.local`;
- permissões limitadas a `storage`, `declarativeNetRequest`,
  `webNavigation` e hosts necessários à função principal;
- rollback quando DNR ou persistência falha;
- builds não minificados e auditáveis.

## Arquivos e módulos

### Novos

- `src/shared/appearance.js`;
- `src/shared/filters/filter-list-parser.js`;
- `src/privacy/privacy.html` e `privacy.css`;
- `tests/filter-list-parser.test.mjs`;
- `tests/real-world-corpus.json`;
- `tools/real-world-evaluation.mjs`;
- `tools/package-amo.mjs`;
- `PRIVACY.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`;
- `docs/AMO_SUBMISSION.md`;
- `docs/reports/real-world-results.json`;
- `docs/reports/benchmark-results.json`;
- `docs/assets/precision-real-world.svg`;
- `docs/assets/benchmark-evolution.svg`;
- `assets/brand/limiar-zero.svg`;
- `docs/BRAND_SYSTEM.md`;
- fontes Inter/Newsreader WOFF2 e respectivas licenças OFL.

### Reformulados

- manifesto, background, schema de mensagens e matcher de listas;
- popup, opções, bloqueio, ajuda, diagnóstico, privacidade e overlay;
- design system Limiar Zero compartilhado, família de ícones e gerador;
- build, validação, README, changelog e testes de integração.

### Código removido ou evitado

- alegações de inteligência artificial sem implementação;
- escudos genéricos, ícones decorativos e grades de cards sem função;
- tokens visuais legados e estilos de inversão quebrados;
- dependência de tooltip somente por `title`;
- substituição destrutiva de `textContent` em botões;
- varredura DOM para toggles tratados inteiramente por DNR;
- propriedade `service_worker` no ZIP Firefox e `background.scripts` no build
  Chromium;
- suporte Android não testado.

O repositório local recebido não possuía commits; todos os arquivos apareciam
como untracked. Por isso não existe um diff Git confiável contra o estado
recebido. O inventário acima e o pacote-fonte representam o changeset
auditável; inventar um “diff anterior” seria tecnicamente incorreto.

## Validação

- `npm run lint`: aprovado;
- `npm test`: 36/36 aprovados;
- `npm run benchmark`: aprovado;
- `npm run test:real`: concluído com indisponíveis explicitamente registrados;
- `npm run build:firefox`: aprovado;
- `web-ext@10 lint --warnings-as-errors`: 0 erros, 0 notices, 0 warnings;
- pacote: `web-ext-artifacts/guardi_o_zero_pro-3.1.0.zip`;
- SHA-256:
  `D296EAEA716E851E3DB384AABB461263D528BEAE8B1CDF4A0553713D06F8F052`.

## Limitações e bloqueadores

1. `src/filters/heazts-blocklist.txt` não possui origem/licença comprovada. A
   MIT não deve ser aplicada a esse arquivo sem confirmação.
2. A auditoria do console em Firefox real exige carregar temporariamente a
   extensão; essa ação depende de confirmação explícita do usuário.
3. ASN só pode ser avaliado se o contexto fornecer um ASN confiável; não há
   consulta externa por privacidade.
4. DNR não oferece a mesma semântica para todos os tipos avançados de
   whitelist. Regex, hash e assinatura continuam prioritários na decisão de
   navegação; allow rules de rede são geradas para hosts e URLs compatíveis.
5. Estatísticas de anúncios/rastreadores são estimativas de recursos
   identificados, explicitamente rotuladas na interface.

## Recomendações

1. confirmar a autoria/licença da blocklist antes de publicar;
2. executar smoke tests Firefox e Chromium em CI por release;
3. ampliar mensalmente o corpus real com snapshots autorizados e páginas
   renderizadas, mantendo indisponíveis fora das métricas;
4. calibrar pesos apenas com exemplos rotulados e revisão humana;
5. adicionar i18n antes de expansão internacional;
6. realizar auditoria independente de segurança antes de distribuição ampla.
